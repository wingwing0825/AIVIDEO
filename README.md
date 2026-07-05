# AI Video Repair Console

藍白色本機 web app，用來準備 fal.ai video-to-video / video edit 的瑕疵修復工作。

## 開啟

```powershell
node local-server.js
```

然後打開 server 顯示的網址，通常是：

```text
http://localhost:4173
```

如果 `4173` 已經被佔用，server 會自動試下一個 port。

## 主要功能

- 在網頁輸入 fal API key，欄位可用星號遮住。
- 直接上傳本機影片作預覽和提交，不需要填 video_url。\n- 如已有公開影片 URL，可在進階欄位貼上 `video_url`。
- 選擇 fal.ai video-to-video / video edit 模型 profile。
- 用中文填寫瑕疵描述和額外要求。
- 後台自動生成英文 prompt，方便 AI 更穩定理解。
- 上傳 before / after 參考圖。
- 上傳瑕疵截圖並用紅色 50% 透明度筆刷畫 mask。
- 下載透明 `repair-mask.png`。
- 複製或下載 `repair-spec.json`。
- 可以按「開始上傳並修復」由瀏覽器直接把影片/圖片上傳到 fal storage，並等待 fal 回傳結果。
- 貼上輸出影片 URL，直接在網頁預覽回來的結果。

## API key 安全提醒

目前新版會在瀏覽器直接使用 fal API key 上傳到 fal storage。這可以避開 Vercel 上傳大小限制，但 API key 會在前端使用；只建議自己使用，不建議公開給其他人。

## 部署成公開網站

### Vercel

1. 建立 GitHub repo。
2. 把本資料夾內的檔案上傳到 repo root。
3. 到 Vercel 建立 New Project。
4. Import 你的 GitHub repo。
5. Framework Preset 選 `Other`。
6. Build Command 可以留空。
7. Install Command 用 `npm install`。
8. Output Directory 留空。
9. Environment Variables 可加：

```text
MAX_UPLOAD_MB=100
FAL_KEY=
```

`FAL_KEY` 可以留空，因為網頁可以每次輸入 API key。部署後，前端頁面會由 Vercel 靜態 hosting 提供，`/api/submit` 會由 `api/submit.js` serverless function 處理。

### Render

1. 把資料夾推到 GitHub。
2. 在 Render 建立 Web Service，連接 repo。
3. Render 會讀取 `render.yaml`。
4. Build command: `npm install`
5. Start command: `npm start`
6. 部署完成後打開 Render 給你的 HTTPS URL。

### Railway / Docker

可以直接使用 `Dockerfile`。需要環境變數：

```text
PORT=4173
MAX_UPLOAD_MB=250
```

`FAL_KEY` 可留空，因為 UI 可以每次提交時輸入 key；如果想用 server 固定 key，才設定 `FAL_KEY`。

## fal.ai Model Notes

Checked on 2026-07-03. fal.ai currently documents several video-to-video / video-edit endpoints, including:

- `google/gemini-omni-flash/edit`
- `xai/grok-imagine-video/edit-video`
- `fal-ai/kling-video-o1/video-to-video`
- `fal-ai/kling-video-o3-pro/video-to-video`
- `fal-ai/sora-2/video-to-video`
## 模型支援限制

目前 `google/gemini-omni-flash/edit` 官方 schema 只支援 `prompt` + `video_url`；`xai/grok-imagine-video/edit-video` 只支援 `prompt` + `video_url` + `resolution`。Before / after 圖和 mask 可以上傳到 fal storage 作紀錄，但這些模型不會把它們當正式 input 讀取。新版 UI 會在提交前警告，並在處理狀態中列出 `submitted_input` 和 `uploaded_but_not_model_input`。

