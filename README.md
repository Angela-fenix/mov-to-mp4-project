# MOV 轉 MP4

將 iPhone .mov 轉成 .mp4（`-c copy`，不重新編碼，畫質不變）。

## 執行
- VS Code：開啟本資料夾 → 按 F5（或 Run and Debug 面板的 ▶）
- 終端機：`npm start`，然後開 http://localhost:5500
- 手機測試：`npm run start:lan`，手機連終端機顯示的區網位址

## 三種轉換模式
| 模式 | 檔案大小 | 原理 | 備註 |
|---|---|---|---|
| 標準（瀏覽器內） | 建議 500 MB 內 | ffmpeg.wasm | 最嚴謹；占大量記憶體 |
| 大檔（重建索引） | 數 GB | mdat 不動；重建 moov：音訊描述與色彩資訊轉標準格式、移除 iPhone 專有軌 | 不占記憶體；不保留拍攝位置/機型 |
| 伺服器（本機 ffmpeg） | 無限制 | 電腦上的原生 ffmpeg | 需安裝 ffmpeg |

## 安裝 ffmpeg（伺服器模式用）
- Windows：`winget install Gyan.FFmpeg`，安裝後**完全關閉並重開 VS Code**，終端機輸入 `ffmpeg -version` 確認
- macOS：`brew install ffmpeg`
- Linux：`sudo apt install ffmpeg`
- 啟動伺服器時，終端機會顯示是否偵測到 ffmpeg
- ffmpeg 不在 PATH 時，可設定環境變數 `FFMPEG_PATH` 指向 ffmpeg 執行檔

## 注意
- 使用 `--lan` 時，同一網路的任何人都能上傳檔案到你的電腦轉檔，請只在信任的網路使用。
- 伺服器模式的暫存檔放在系統暫存資料夾（mov2mp4），原始上傳檔轉換後立即刪除，轉好的檔案保留 30 分鐘。

## 結構
- public/index.html   網頁本體
- server.js           靜態伺服器 + 轉檔 API
- .vscode/launch.json F5 一鍵啟動設定
