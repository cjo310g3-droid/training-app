# 測試

- `compare.js`：把 App 算出的 32 天內容和 v6 Excel 的計算結果（`excel-v6-reference.json`，最大重量 110/110/85/45）逐欄比對
  `node tests/compare.js . tests/excel-v6-reference.json`
- `e2e.js`：用 Playwright 模擬 Android 手機操作（需先在 8765 埠開本機伺服器）
  `npx http-server . -p 8765 -c-1 & node tests/e2e.js /tmp`
- `background.js`：休息提醒。App 在前景不跳通知、網頁關掉後背景程式到點跳通知、按跳過會取消、背景耽擱後回來時間正確、單手提走 30 秒換手計時
  `npx http-server . -p 8765 -c-1 & node tests/background.js`
