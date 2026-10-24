// Sheet-music photo → ABC notation, using Claude or Gemini with the user's own API key (kept on the device).
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, ApiError as GeminiApiError } from "@google/genai";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const PROVIDERS = {
  claude: {
    label: "Claude（Anthropic）",
    name: "Claude",
    keyPlaceholder: "sk-ant-...",
    keyHelp: "到 console.anthropic.com 的 API Keys 頁面建立金鑰，依用量計費。",
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5（最準確）" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5（較快、較省）" }
    ]
  },
  gemini: {
    label: "Gemini（Google）",
    name: "Gemini",
    keyPlaceholder: "AIza...",
    keyHelp: "到 aistudio.google.com 的「Get API key」建立金鑰。有免費額度；免費方案送出的內容可能被 Google 用來改進產品。",
    models: [
      { id: "gemini-flash-latest", label: "Gemini Flash（最新版，較快、有免費額度）" },
      { id: "gemini-pro-latest", label: "Gemini Pro（最新版，較準確）" }
    ]
  }
};

const ScoreSchema = z.object({
  title: z.string(),
  abc: z.string(),
  notes: z.string()
});
const SCORE_JSON_SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, abc: { type: "string" }, notes: { type: "string" } },
  required: ["title", "abc", "notes"]
};

const PROMPT = `你是光學樂譜辨識（OMR）引擎。請把照片中的五線譜完整轉寫成 ABC notation 2.1。
規則：
- 必含 X:1、T:（照片上的曲名，沒有就寫「未命名」）、M:、L:、K:；有速度標記就加 Q:。
- 依照片的調號、拍號、臨時記號、附點、連結線、休止符、反覆記號轉寫；每小節以 | 分隔，每行約 4 小節。
- 若是鋼琴大譜表或多聲部，用 V:1、V:2 分聲部；只有單行旋律就不要加 V:。
- 看不清楚的地方寫出你最合理的判斷，不要省略小節。
title 填曲名；abc 填完整 ABC 譜；notes 用一句繁體中文說明不確定之處（沒有就空字串）。`;

export class OmrError extends Error {
  constructor(code, detail){ super(code); this.code = code; this.detail = detail }
}

// image: { mediaType: "image/jpeg", data: <base64 without prefix> }
export async function recognizeScore({ provider = "claude", apiKey, model, image, signal }){
  if(!apiKey) throw new OmrError("no_key");
  const out = provider === "gemini"
    ? await withGemini({ apiKey, model, image, signal })
    : await withClaude({ apiKey, model, image, signal });
  if(!out || typeof out.abc !== "string" || !/K:/.test(out.abc)) throw new OmrError("invalid");
  return { title: String(out.title || ""), abc: out.abc, notes: String(out.notes || "") };
}

async function withClaude({ apiKey, model, image, signal }){
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let response;
  try{
    response = await client.messages.parse({
      model,
      max_tokens: 16000,
      output_config: { effort: "high", format: zodOutputFormat(ScoreSchema) },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
          { type: "text", text: PROMPT }
        ]
      }]
    }, { signal });
  }catch(e){
    if(e instanceof Anthropic.APIUserAbortError) throw new OmrError("cancelled");
    if(e instanceof Anthropic.AuthenticationError) throw new OmrError("bad_key");
    if(e instanceof Anthropic.PermissionDeniedError) throw new OmrError("forbidden", e.message);
    if(e instanceof Anthropic.NotFoundError) throw new OmrError("bad_model");
    if(e instanceof Anthropic.RateLimitError) throw new OmrError("rate_limited");
    if(e instanceof Anthropic.BadRequestError) throw new OmrError("bad_request", e.message);
    if(e instanceof Anthropic.APIConnectionError) throw new OmrError("offline");
    if(e instanceof Anthropic.APIError) throw new OmrError(e.status === 402 ? "billing" : "server", e.message);
    throw e;
  }
  if(response.stop_reason === "refusal") throw new OmrError("refused");
  if(response.stop_reason === "max_tokens") throw new OmrError("too_long");
  return response.parsed_output;
}

async function withGemini({ apiKey, model, image, signal }){
  const ai = new GoogleGenAI({ apiKey });
  let response;
  try{
    response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [
        { inlineData: { mimeType: image.mediaType, data: image.data } },
        { text: PROMPT }
      ] }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: SCORE_JSON_SCHEMA,
        maxOutputTokens: 16000,
        abortSignal: signal
      }
    });
  }catch(e){
    if(signal?.aborted || e?.name === "AbortError") throw new OmrError("cancelled");
    if(e instanceof GeminiApiError){
      const msg = String(e.message || "");
      if(/API[_ ]KEY|api key/i.test(msg) && (e.status === 400 || e.status === 401 || e.status === 403)) throw new OmrError("bad_key");
      if(e.status === 403) throw new OmrError("forbidden", msg);
      if(e.status === 404) throw new OmrError("bad_model");
      if(e.status === 429) throw new OmrError("rate_limited");
      if(e.status === 400) throw new OmrError("bad_request", msg);
      throw new OmrError("server", msg);
    }
    if(e instanceof TypeError) throw new OmrError("offline");
    throw e;
  }
  if(response.promptFeedback?.blockReason) throw new OmrError("refused");
  const finish = response.candidates?.[0]?.finishReason;
  if(finish === "MAX_TOKENS") throw new OmrError("too_long");
  if(finish && /SAFETY|PROHIBITED|BLOCKLIST|RECITATION/.test(finish)) throw new OmrError("refused");
  try{ return JSON.parse(response.text || "") }catch(e){ throw new OmrError("invalid") }
}
