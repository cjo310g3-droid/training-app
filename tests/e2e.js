const { chromium, devices } = require("/opt/node22/lib/node_modules/playwright");
(async () => {
  const out = process.argv[2];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "allow" });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.goto("http://127.0.0.1:8765/");
  await page.waitForSelector(".day-title");
  console.log("標題:", await page.textContent(".day-title"), "|", await page.textContent("#progress"));
  await page.screenshot({ path: out + "/1-today.png", fullPage: false });
  // 點第一組 → 出現休息倒數
  await page.click('.dot[data-b="0"][data-l="0"][data-i="0"]');
  await page.waitForTimeout(1200);
  console.log("倒數:", await page.isVisible("#timer"), await page.textContent("#timer-num"), await page.textContent("#timer-sub"));
  await page.screenshot({ path: out + "/2-timer.png" });
  await page.click("#timer-plus"); console.log("+15:", await page.textContent("#timer-num"));
  await page.click("#timer-skip"); console.log("跳過後倒數還在?", await page.isVisible("#timer"));
  // 把 1A 所有圓圈點滿（跳過倒數）再完成
  const dots = await page.$$eval(".dot:not(.on)", (els) => els.length);
  for (let i = 0; i < dots; i++) { await page.click(".dot:not(.on) >> nth=0"); if (await page.isVisible("#timer")) await page.click("#timer-skip"); }
  await page.fill("#note", "測試備註：假資料");
  await page.click('[data-act="finish"]');
  await page.waitForTimeout(300);
  console.log("完成後:", await page.textContent(".day-title"), "|", await page.textContent("#progress"));
  // 1B 不打勾直接完成（會跳確認）
  await page.click('[data-act="finish"]');
  console.log("下一天:", await page.textContent(".day-week"), await page.textContent(".day-title"));
  await page.screenshot({ path: out + "/3-dayC.png", fullPage: true });
  // C 日的間歇計時按鈕存在
  console.log("間歇按鈕:", await page.$$eval('[data-act="interval"]', (e) => e.length));
  // 重新整理後紀錄還在
  await page.reload(); await page.waitForSelector(".day-title");
  console.log("重新整理後:", await page.textContent("#progress"));
  // 紀錄頁
  await page.click('.tab[data-view="log"]');
  await page.screenshot({ path: out + "/4-log.png", fullPage: true });
  console.log("紀錄筆數:", await page.$$eval(".hist-item", (e) => e.length));
  // 匯出
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="export"] >> nth=0')]);
  const p = out + "/backup.json"; await dl.saveAs(p); console.log("備份檔:", dl.suggestedFilename(), require("fs").readFileSync(p,"utf8").length);
  // 設定：改重量
  await page.click('.tab[data-view="settings"]');
  await page.screenshot({ path: out + "/5-settings.png", fullPage: true });
  await page.fill("#max-深蹲", "120"); await page.click('[data-act="save-max"]');
  // 點紀錄格子打開第 1 週 A
  await page.click('.tab[data-view="log"]'); await page.click('[data-open="1A"]');
  console.log("看 1A:", await page.textContent(".viewing"));
  console.log("1A 第一行(深蹲 120):", await page.textContent(".line-text >> nth=3"));
  // 匯入：先清空再還原
  await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForSelector(".day-title");
  console.log("清空後:", await page.textContent("#progress"));
  await page.click('.tab[data-view="log"]');
  await page.setInputFiles("#import-file", p); await page.waitForTimeout(300);
  console.log("匯入後:", await page.textContent("#progress"));
  // 離線
  await page.goto("http://127.0.0.1:8765/"); await page.waitForTimeout(1500);
  const swReady = await page.evaluate(async () => !!(await navigator.serviceWorker.ready));
  await ctx.setOffline(true); await page.reload(); await page.waitForSelector(".day-title");
  console.log("離線可開:", swReady, await page.textContent(".day-title"));
  await ctx.setOffline(false);
  console.log("錯誤:", errs.length ? errs : "無");
  await browser.close();
})();
