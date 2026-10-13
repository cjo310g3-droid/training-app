// 休息提醒：網頁不在前景時背景程式會跳通知、回到 App 剩餘時間正確
// 需先在 8765 埠開本機伺服器：npx http-server . -p 8765 -c-1 & node tests/background.js
const { chromium, devices } = require("/opt/node22/lib/node_modules/playwright");
(async () => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const ctx = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "allow", permissions: ["notifications"] });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("http://127.0.0.1:8765/"); await page.waitForSelector(".day-title");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector(".day-title");
  // 無頭瀏覽器不能真的跳通知，把背景程式的 showNotification 換成記錄用
  const swk = ctx.serviceWorkers()[0];
  await swk.evaluate(() => { self.__shown = []; self.registration.showNotification = async (t, o) => { self.__shown.push(t + "｜" + o.body); }; });
  const schedule = (ms) => page.evaluate(async (ms) => {
    const r = await navigator.serviceWorker.ready;
    r.active.postMessage({ type: "rest-schedule", items: [{ at: Date.now() + ms, last: true, title: "休息結束", body: "該開始下一組了！" }] });
  }, ms);
  // 1) 網頁在前景時不跳通知（網頁自己嗶）
  await schedule(800); await page.waitForTimeout(1500);
  console.log("前景時通知(應為空):", await swk.evaluate(() => self.__shown));
  // 2) 排好後把網頁關掉（模擬切到別的 App），到點應跳通知
  await schedule(1500); await page.close();
  await new Promise((r) => setTimeout(r, 2500));
  console.log("背景通知:", await swk.evaluate(() => self.__shown));
  // 3) 排好後取消（按跳過），不應跳
  const p2 = await ctx.newPage(); p2.on("pageerror", (e) => errs.push(e.message));
  await p2.goto("http://127.0.0.1:8765/"); await p2.waitForSelector(".day-title");
  await swk.evaluate(() => { self.__shown = []; });
  await p2.evaluate(async () => { const r = await navigator.serviceWorker.ready;
    r.active.postMessage({ type: "rest-schedule", items: [{ at: Date.now() + 800, last: true, title: "x", body: "x" }] });
    r.active.postMessage({ type: "rest-cancel" }); });
  await p2.close(); await new Promise((r) => setTimeout(r, 1500));
  console.log("取消後通知(應為空):", await swk.evaluate(() => self.__shown));
  const page3 = await ctx.newPage(); page3.on("pageerror", (e) => errs.push(e.message));
  await page3.goto("http://127.0.0.1:8765/"); await page3.waitForSelector(".day-title");
  await page3.click('.dot[data-b="0"][data-l="0"][data-i="0"]');
  await page3.waitForTimeout(500);
  // 4) 模擬背景計時被暫停：把時間往後跳 70 秒，回來後應顯示休息結束
  await page3.evaluate(() => { const real = Date.now; const off = 70000; Date.now = () => real() + off; document.dispatchEvent(new Event("visibilitychange")); });
  await page3.waitForTimeout(400);
  console.log("跳過 70 秒後:", await page3.textContent("#timer-label"), await page3.textContent("#timer-num"));
  // 5) 設定頁有提醒卡片
  await page3.click('.tab[data-view="settings"]');
  console.log("設定卡片:", (await page3.textContent("#view-settings .card >> nth=1")).replace(/\s+/g, " ").slice(0, 60));
  await page3.click('[data-act="test-sound"]');
  if (process.argv[2]) await page3.screenshot({ path: process.argv[2] + "/settings-reminder.png" });
  console.log("錯誤:", errs.length ? errs : "無");
  await browser.close();
})();
