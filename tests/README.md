# 測試

- `compare.js`：把 App 算出的 32 天內容和 v6 Excel 的計算結果（`excel-v6-reference.json`，最大重量 110/110/85/45）逐欄比對
  `node tests/compare.js . tests/excel-v6-reference.json`
- `e2e.js`：用 Playwright 模擬 Android 手機操作（需先在 8765 埠開本機伺服器）
  `npx http-server . -p 8765 -c-1 & node tests/e2e.js /tmp`
