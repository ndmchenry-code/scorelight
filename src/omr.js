// Sheet-music photo → ABC notation, using Claude with the user's own API key (kept on the device).
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5（最準確）" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5（較快、較省）" }
];

const ScoreSchema = z.object({
  title: z.string(),
  abc: z.string(),
  notes: z.string()
});

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
export async function recognizeScore({ apiKey, model, image, signal }){
  if(!apiKey) throw new OmrError("no_key");
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
  const out = response.parsed_output;
  if(!out || !/K:/.test(out.abc)) throw new OmrError("invalid");
  return out;
}
