# 譜光跟奏台（PWA）

五線譜與演奏進度合成的即時視覺。可以安裝到手機主畫面，像一般 App 一樣使用，安裝後離線也能練習（拍照辨識需要連網）。

**網址：https://ndmchenry-code.github.io/scorelight/**

## 更新上線

改完原始碼後：

```bash
npm run build
git add -A
git commit -m "說明這次的修改"
git push
npm run deploy    # 把 www/ 推到 gh-pages 分支，約一分鐘後網站更新
```

## 功能

- 譜面跟奏：麥克風聽音高、畫面琴鍵或電腦鍵盤（A W S E D F T G Y H U J K）
- 讀音標示：唱名、音名、簡譜（依調號拼寫升降記號）
- 鋼琴捲簾進度、示範播放、段落練習、錯音標記、練習結果
- 拍照辨識：即時相機取景（支援手電筒）或選擇圖片，由 Claude 或 Gemini 轉成 ABC 譜
- 我的樂譜：辨識結果自動存在這支手機上

## 拍照辨識的設定

辨識使用你自己的 API 金鑰，可以在 Claude 和 Gemini 之間切換，兩把金鑰分開保存：

| 服務 | 金鑰從哪裡拿 | 模型選項 |
|---|---|---|
| Claude | console.anthropic.com → API Keys（依用量計費） | Claude Opus 5.5（預設）、Claude Sonnet 5.5 |
| Gemini | aistudio.google.com → Get API key（有免費額度） | Gemini Flash 最新版（預設）、Gemini Pro 最新版 |

打開 App，按右上角「設定」，選「辨識服務」，貼上那個服務的金鑰並儲存。

金鑰只存在該裝置的瀏覽器儲存空間，App 直接從手機呼叫你選的服務，不經過其他伺服器。Gemini 免費方案送出的內容可能被 Google 用來改進產品，詳情見 Google AI Studio 的條款。

## 開發

```bash
npm install
npm run build    # 產生 www/
npm run serve    # 在 http://localhost:8770 預覽
```

原始碼在 `src/`：`app.js`（主程式）、`omr.js`（Claude 辨識）、`index.html`、`sw.js`（離線快取）、`manifest.webmanifest`。圖示由 `tools/icons.mjs` 在建置時產生。

## 放到網路上，再安裝到手機

手機上的麥克風、相機和安裝功能都需要 HTTPS 網址。把 `www/` 資料夾放到任何靜態網站服務即可，例如：

- **Netlify Drop**：打開 app.netlify.com/drop，把 `www` 資料夾拖進去，就會得到一個 https 網址
- **GitHub Pages**：把 `www/` 的內容推到一個 repo，在 Settings → Pages 開啟
- **Cloudflare Pages**：上傳 `www` 資料夾

安裝方式：

- **Android（Chrome）**：打開網址，按 App 內的「安裝 App」，或瀏覽器選單的「安裝應用程式」
- **iPhone（Safari）**：打開網址，點「分享」→「加入主畫面」

更新：重新 `npm run build` 後再上傳一次 `www/`，App 下次開啟時會自動換成新版。
