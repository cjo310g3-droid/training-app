// 體能課表 App：畫面、打勾、休息倒數、紀錄與備份。紀錄只存在這支手機的瀏覽器裡。
(function () {
  "use strict";
  const P = window.Program;
  const KEY = "training-app-v1";
  const BACKUP_REMIND_DAYS = 14;

  // ───────── 資料 ─────────
  function blankState() {
    return { version: 1, maxes: Object.assign({}, P.DEFAULT_MAX), cycle: 1, logs: {}, sets: {}, lastBackup: null, history: [] };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(blankState(), JSON.parse(raw));
    } catch (e) { /* 讀不到就用空白 */ }
    return blankState();
  }
  let state = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast("存檔失敗，請先匯出備份"); }
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function daysSince(dateStr) {
    if (!dateStr) return Infinity;
    return Math.floor((new Date(today()) - new Date(dateStr)) / 86400000);
  }
  function doneCount() { return P.ORDER.filter((k) => state.logs[k]).length; }
  function nextKey() { return P.ORDER.find((k) => !state.logs[k]) || null; }
  function parseKey(k) { return { week: Number(k.slice(0, -1)), day: k.slice(-1) }; }
  function dayLabel(k) { const { week, day } = parseKey(k); return `第 ${week} 週 ${P.DAYNAME[day]}`; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  let viewKey = null; // 從紀錄頁點進來看的那一天；null 代表「接著上次」

  // ───────── 提醒：嗶聲、震動、系統通知、螢幕不關 ─────────
  // 切到別的 App 或關螢幕時，網頁的計時會被手機暫停，所以：
  // 1. 嗶聲在開始休息時就先排進音效時間軸，到點由音效系統自己響，不靠網頁計時
  // 2. 同時請離線背景程式（sw.js）到點跳系統通知（會震動、用通知鈴聲），網頁在前景時就不跳
  // 3. 時間一律用「結束時刻」計算，回到 App 時剩幾秒馬上對
  let audio = null, master = null, scheduled = [];
  function unlockAudio() {
    if (!audio) {
      try {
        audio = new (window.AudioContext || window.webkitAudioContext)();
        // 壓縮器把峰值壓住再整體放大，手機喇叭聽起來更大聲又不破音
        const comp = audio.createDynamicsCompressor();
        comp.threshold.value = -18; comp.knee.value = 6; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.1;
        master = audio.createGain(); master.gain.value = 1.6;
        master.connect(comp).connect(audio.destination);
      } catch (e) { audio = null; }
    }
    if (audio && audio.state === "suspended") audio.resume();
  }
  // 在音效時間軸 t 秒處排一聲；回傳節點，之後可以取消
  function tone(t, freq, dur, peak) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "square"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.setValueAtTime(peak, t + dur - 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }
  // kind：pip＝倒數最後 3 秒的短嗶；step＝間歇換階段；end＝休息結束（最大聲、最長）
  function pattern(t, kind) {
    const out = [];
    if (kind === "pip") out.push(tone(t, 1319, 0.1, 0.35));
    else if (kind === "step") { out.push(tone(t, 1568, 0.3, 0.9)); out.push(tone(t + 0.4, 1568, 0.3, 0.9)); }
    else for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) out.push(tone(t + r * 1.4 + i * 0.4, i % 2 ? 2093 : 1568, 0.3, 0.9));
    return out;
  }
  function beepNow(kind) { if (audio) pattern(audio.currentTime + 0.02, kind); }
  function cancelSounds() { scheduled.forEach((o) => { try { o.stop(); } catch (e) { /* 已經響過 */ } }); scheduled = []; }

  function sw(msg) {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then((r) => { if (r.active) r.active.postMessage(msg); }).catch(() => {});
  }
  const NOTIFY_ASKED = "training-app-notify-asked";
  function canNotify() { return "Notification" in window && "serviceWorker" in navigator; }
  // 第一次開始休息時順便問一次要不要開通知（之後到「設定」也能開）
  function askNotifyOnce() {
    if (!canNotify() || Notification.permission !== "default") return;
    try { if (localStorage.getItem(NOTIFY_ASKED)) return; localStorage.setItem(NOTIFY_ASKED, "1"); } catch (e) { return; }
    Notification.requestPermission().then((p) => { if (p === "granted") toast("已開啟：切到別的 App 也會提醒休息結束"); renderSettings(); });
  }
  function enableNotify() {
    if (!canNotify()) { toast("這個瀏覽器不支援通知"); return; }
    Notification.requestPermission().then((p) => {
      toast(p === "granted" ? "已開啟背景提醒" : "通知被封鎖了，請到手機的 Chrome 網站設定裡允許通知");
      renderSettings();
    });
  }

  let wakeLock = null;
  async function keepAwake() {
    try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } }
    catch (e) { /* 不支援就算了 */ }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    sw({ type: "rest-clear" });
    if (!timer.active) return;
    keepAwake();
    // 回到 App：音效如果被暫停過，時間軸會落後，重排一次
    if (audio && audio.state !== "running") audio.resume().then(armAlerts).catch(() => {});
    tick();
  });

  // ───────── 倒數計時 ─────────
  const el = (id) => document.getElementById(id);
  const timer = { active: false, end: 0, phases: [], idx: 0, onPhaseDone: null, hideAt: 0 };
  let tickHandle = null;

  function runPhases(phases, onPhaseDone) {
    unlockAudio(); keepAwake(); askNotifyOnce();
    timer.active = true; timer.phases = phases; timer.idx = 0; timer.onPhaseDone = onPhaseDone || null; timer.hideAt = 0;
    startPhase(Date.now());
    armAlerts();
    if (!tickHandle) tickHandle = setInterval(tick, 200);
    tick();
  }
  // 從上一段的結束時刻接著算，背景耽擱也不會越拖越久
  function startPhase(from) {
    const ph = timer.phases[timer.idx];
    timer.end = from + ph.sec * 1000;
    timer.lastBeep = null;
    el("timer").hidden = false;
    el("timer").className = "timer" + (ph.kind === "work" ? " work" : "");
    el("timer-label").textContent = ph.label;
    el("timer-sub").textContent = ph.sub || "";
  }
  // 把剩下每一段的結束時刻排好：嗶聲排進音效時間軸，通知交給背景程式
  function armAlerts() {
    cancelSounds();
    const now = Date.now(), items = [];
    let end = timer.end;
    for (let j = timer.idx; j < timer.phases.length; j++) {
      if (j > timer.idx) end += timer.phases[j].sec * 1000;
      const ph = timer.phases[j], last = j === timer.phases.length - 1;
      const next = last ? null : timer.phases[j + 1];
      items.push({ at: end, last, title: last ? (ph.doneText || "休息結束") : next.label, body: last ? "該開始下一組了！" : (next.sub || "") });
      if (audio) {
        const base = audio.currentTime + (end - now) / 1000;
        for (let s = 3; s >= 1; s--) if (base - s > audio.currentTime) scheduled.push(...pattern(base - s, "pip"));
        if (base > audio.currentTime) scheduled.push(...pattern(base, last ? "end" : "step"));
      }
    }
    sw({ type: "rest-schedule", items });
  }
  function disarm() { cancelSounds(); sw({ type: "rest-cancel" }); }
  function fmtSec(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  function tick() {
    if (!timer.active) {
      if (timer.hideAt && Date.now() > timer.hideAt) { el("timer").hidden = true; timer.hideAt = 0; }
      if (!timer.hideAt && tickHandle) { clearInterval(tickHandle); tickHandle = null; }
      return;
    }
    // 背景回來時可能已經過了好幾段，一次補完
    while (timer.active && Date.now() >= timer.end) phaseDone(false);
    if (!timer.active) return;
    const left = Math.max(0, Math.ceil((timer.end - Date.now()) / 1000));
    el("timer-num").textContent = fmtSec(left);
    if (left <= 3 && left > 0 && timer.lastBeep !== left) { timer.lastBeep = left; if (navigator.vibrate) navigator.vibrate(60); }
  }
  function phaseDone(skipped) {
    const ph = timer.phases[timer.idx];
    const late = Date.now() - timer.end > 2000; // 在背景就過了，嗶聲和通知已經提醒過
    if (timer.onPhaseDone) timer.onPhaseDone(ph, timer.idx);
    timer.idx++;
    if (timer.idx < timer.phases.length) {
      if (!skipped && !late && navigator.vibrate) navigator.vibrate([250]);
      startPhase(skipped ? Date.now() : timer.end);
      if (skipped) armAlerts();
      return;
    }
    timer.active = false;
    if (!skipped) {
      if (!late && navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 700]);
      el("timer").className = "timer done";
      el("timer-label").textContent = ph.doneText || "休息結束";
      el("timer-num").textContent = "開始！";
      el("timer-sub").textContent = "";
      timer.hideAt = Date.now() + 2500;
    } else {
      disarm();
      el("timer").hidden = true;
    }
  }
  el("timer-plus").addEventListener("click", () => { if (timer.active) { timer.end += 15000; armAlerts(); tick(); } });
  el("timer-skip").addEventListener("click", () => {
    if (!timer.active) { el("timer").hidden = true; timer.hideAt = 0; return; }
    phaseDone(true);
  });
  function stopTimer() { if (timer.active) disarm(); timer.active = false; timer.hideAt = 0; el("timer").hidden = true; }

  // ───────── 小提示 ─────────
  let toastHandle = null;
  function toast(msg) {
    const t = el("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastHandle);
    toastHandle = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ───────── 今天 ─────────
  function lineId(bi, li) { return `${bi}-${li}`; }
  function getCount(k, id) { return (state.sets[k] && state.sets[k][id]) || 0; }
  function setCount(k, id, v) {
    state.sets[k] = state.sets[k] || {};
    state.sets[k][id] = v;
    save();
  }

  function backupBanner() {
    const n = doneCount() + state.history.length * 32;
    if (n < 4) return "";
    const d = daysSince(state.lastBackup);
    if (d < BACKUP_REMIND_DAYS) return "";
    const when = state.lastBackup ? `上次備份是 ${d} 天前` : "還沒備份過";
    return `<div class="banner">紀錄只存在這支手機，${when}。換手機或清除瀏覽器資料會不見。<br><button class="btn gold" data-act="export">現在匯出備份</button></div>`;
  }

  function renderToday() {
    const v = el("view-today");
    const k = viewKey || nextKey();
    if (!k) {
      v.innerHTML = `${backupBanner()}<div class="card day-head"><div class="day-title">八週完成</div>
        <p>到「設定」把第 8 週測出的新最大重量填進去，再按「開始下一輪」。</p>
        <button class="btn block" data-go="settings">去設定</button></div>`;
      return;
    }
    const { week, day } = parseKey(k);
    const d = P.buildDay(week, day, state.maxes);
    const log = state.logs[k];
    const isNext = k === nextKey();
    let html = backupBanner();
    html += `<div class="card day-head">
      <div class="day-week">第 ${state.cycle} 輪 · 第 ${week} 週</div>
      <div class="day-title">${esc(d.title)}</div>
      <span class="chip">${esc(d.phase)}</span>
      <div class="warmup">先暖身 3 分鐘：開合跳 30 秒、徒手深蹲 10 下、肩髖繞環</div>
      ${!isNext ? `<div class="viewing">${log ? `已在 ${esc(log.date)} 完成` : "這不是接下來的那一天"}。<button data-act="back-next">回到下一個該練的</button></div>` : ""}
    </div>`;
    d.blocks.forEach((b, bi) => {
      html += `<div class="card"><div><span class="block-label">${b.label}</span><span class="block-name">${esc(b.name)}</span></div>
        <div class="block-rest">${esc(b.restText)}</div>${b.tip ? `<div class="block-tip">${esc(b.tip)}</div>` : ""}`;
      b.lines.forEach((ln, li) => {
        const id = lineId(bi, li), c = getCount(k, id), unit = ln.unit || "組";
        html += `<div class="line${ln.target ? " target" : ""}${ln.sets === 1 ? " single" : ""}"><div class="line-text">${esc(ln.text)}</div>`;
        if (ln.sets > 1) html += `<div class="muted">${ln.sets} ${unit}</div>`;
        html += `<div class="dots">`;
        for (let i = 0; i < ln.sets; i++) {
          html += `<button class="dot${i < c ? " on" : ""}" data-k="${k}" data-b="${bi}" data-l="${li}" data-i="${i}" aria-label="第 ${i + 1} ${unit}${i < c ? "（已完成）" : ""}"><span>${i + 1}</span></button>`;
        }
        html += `</div>`;
        if (ln.interval) html += `<button class="btn ghost interval-btn" data-act="interval" data-k="${k}" data-b="${bi}" data-l="${li}">開始間歇計時（${ln.sets} 輪）</button>`;
        html += `</div>`;
      });
      html += `</div>`;
    });
    if (log) {
      html += `<div class="card">${log.note ? `<div class="hist-note">備註：${esc(log.note)}</div>` : '<div class="muted">沒有備註</div>'}
        <div class="btn-row" style="margin-top:10px"><button class="btn ghost" data-act="undo-done" data-k="${k}">取消完成</button></div></div>`;
    } else {
      html += `<div class="card"><label class="small" for="note">例外備註（沒照表做、改重量、身體狀況才寫）</label>
        <textarea id="note" placeholder="例如：剛下夜班，目標重量減 10%"></textarea>
        <div style="margin-top:12px"><button class="btn block" data-act="finish" data-k="${k}">完成這一天</button></div></div>`;
    }
    v.innerHTML = html;
  }

  function totalAndDone(k) {
    const { week, day } = parseKey(k);
    const d = P.buildDay(week, day, state.maxes);
    let total = 0, done = 0;
    d.blocks.forEach((b, bi) => b.lines.forEach((ln, li) => { total += ln.sets; done += Math.min(ln.sets, getCount(k, lineId(bi, li))); }));
    return { total, done, d };
  }

  function onDot(btn) {
    unlockAudio();
    const k = btn.dataset.k, bi = +btn.dataset.b, li = +btn.dataset.l, i = +btn.dataset.i;
    const id = lineId(bi, li), c = getCount(k, id);
    const { week, day } = parseKey(k);
    const ln = P.buildDay(week, day, state.maxes).blocks[bi].lines[li];
    if (i < c) { setCount(k, id, i); renderToday(); return; } // 點已打勾的圓圈＝取消到這一組
    setCount(k, id, i + 1);
    renderToday();
    if (ln.rest > 0 && !ln.interval) {
      runPhases([{ kind: "rest", sec: ln.rest, label: "休息", sub: `剛完成：${ln.text}${ln.sets > 1 ? `（${i + 1}/${ln.sets}）` : ""}` }]);
    }
  }

  function onInterval(btn) {
    const k = btn.dataset.k, bi = +btn.dataset.b, li = +btn.dataset.l;
    const { week, day } = parseKey(k);
    const ln = P.buildDay(week, day, state.maxes).blocks[bi].lines[li];
    const id = lineId(bi, li);
    const start = getCount(k, id) >= ln.sets ? 0 : getCount(k, id);
    if (start === 0) setCount(k, id, 0);
    const phases = [{ kind: "rest", sec: 5, label: "準備", sub: ln.text }];
    for (let r = start; r < ln.sets; r++) {
      phases.push({ kind: "work", sec: ln.interval.work, label: `第 ${r + 1} 輪：做`, sub: ln.text, round: r });
      phases.push({ kind: "rest", sec: ln.interval.rest, label: `第 ${r + 1} 輪：休息`, sub: r + 1 < ln.sets ? "下一輪快開始了" : "最後一次休息", round: r, doneText: "收尾完成" });
    }
    renderToday();
    runPhases(phases, (ph) => {
      if (ph.kind === "rest" && ph.round !== undefined) { setCount(k, id, ph.round + 1); renderToday(); }
    });
  }

  function onFinish(k) {
    const { total, done } = totalAndDone(k);
    const note = (el("note") && el("note").value.trim()) || "";
    if (done < total && !confirm(`還有 ${total - done} 組沒打勾，還是要完成這一天嗎？\n（沒照表做的話，建議在備註寫一句）`)) return;
    stopTimer();
    state.logs[k] = { date: today(), note, done, total };
    delete state.sets[k];
    save();
    viewKey = null;
    const nk = nextKey();
    toast(nk ? `完成！下次是 ${dayLabel(nk)}` : "八週全部完成！");
    renderAll();
    window.scrollTo(0, 0);
  }

  // ───────── 紀錄 ─────────
  function renderLog() {
    const v = el("view-log");
    const nk = nextKey();
    let html = `<div class="card"><h2>八週進度</h2><div class="weeks">`;
    P.WEEKS.forEach((w) => {
      html += `<div class="week-row"><div class="week-name">第 ${w} 週</div>`;
      P.DAYS.forEach((d) => {
        const k = `${w}${d}`;
        const cls = state.logs[k] ? "done" : k === nk ? "next" : "";
        html += `<button class="cell ${cls}" data-open="${k}" aria-label="${dayLabel(k)}${state.logs[k] ? "（已完成）" : ""}">${d}</button>`;
      });
      html += `</div>`;
    });
    html += `</div><div class="legend">綠色＝完成，金框＝下一個該練的。點任何一格可以打開那一天（補練或重看）。</div></div>`;

    const done = P.ORDER.filter((k) => state.logs[k]).sort((a, b) => (state.logs[b].date || "").localeCompare(state.logs[a].date || "") || P.ORDER.indexOf(b) - P.ORDER.indexOf(a));
    html += `<div class="card"><h2>練習紀錄</h2>`;
    if (!done.length) html += `<div class="muted">還沒有紀錄。練完一天按「完成這一天」就會出現在這裡。</div>`;
    done.forEach((k) => {
      const l = state.logs[k];
      const partial = l.total && l.done < l.total ? `，打勾 ${l.done}/${l.total}` : "";
      html += `<div class="hist-item"><div class="hist-title">${dayLabel(k)}</div><div class="hist-meta">${esc(l.date)}${partial}</div>${l.note ? `<div class="hist-note">${esc(l.note)}</div>` : ""}</div>`;
    });
    html += `</div>`;

    const d = daysSince(state.lastBackup);
    html += `<div class="card"><h2>備份</h2>
      <p class="muted">紀錄只存在這支手機的瀏覽器裡，不會上傳。換手機或清除瀏覽器資料前，先匯出備份檔；之後用「匯入備份」就能還原。</p>
      <p class="muted">${state.lastBackup ? `上次備份：${esc(state.lastBackup)}（${d} 天前）` : "還沒備份過"}</p>
      <div class="btn-row"><button class="btn" data-act="export">匯出備份</button><button class="btn ghost" data-act="import">匯入備份</button></div>
      <input type="file" id="import-file" accept="application/json,.json" hidden></div>`;
    if (state.history.length) {
      html += `<div class="card"><h2>之前的輪次</h2>`;
      state.history.slice().reverse().forEach((h) => {
        const n = Object.keys(h.logs || {}).length;
        html += `<div class="hist-item"><div class="hist-title">第 ${h.cycle} 輪</div><div class="hist-meta">完成 ${n}/32 次；當時最大重量 深蹲 ${h.maxes["深蹲"]}、硬舉 ${h.maxes["硬舉"]}、臥推 ${h.maxes["臥推"]}、肩推 ${h.maxes["肩推"]}</div></div>`;
      });
      html += `</div>`;
    }
    v.innerHTML = html;
    el("import-file").addEventListener("change", onImportFile);
  }

  async function exportBackup() {
    const data = JSON.stringify(Object.assign({}, state, { exportedAt: new Date().toISOString() }), null, 2);
    const name = `training-backup-${today()}.json`;
    const file = new File([data], name, { type: "application/json" });
    let ok = false;
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); ok = true; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    if (!ok) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    state.lastBackup = today(); save();
    toast("備份檔已匯出");
    renderAll();
  }

  function onImportFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data || typeof data.logs !== "object" || typeof data.maxes !== "object") throw new Error("格式不對");
        if (!confirm(`要用這個備份取代手機上現在的紀錄嗎？\n備份裡有 ${Object.keys(data.logs).length} 次紀錄。`)) return;
        delete data.exportedAt;
        state = Object.assign(blankState(), data);
        save(); viewKey = null; renderAll();
        toast("備份已還原");
      } catch (err) { toast("這個檔案不是體能課表的備份"); }
    };
    r.readAsText(f);
  }

  // ───────── 設定 ─────────
  function renderSettings() {
    const v = el("view-settings");
    let html = `<div class="card"><h2>最大重量（能做 1 下的公斤數）</h2>
      <p class="muted">整份課表的重量都照這四個數字自動算，四捨五入到 2.5 公斤。</p><div class="max-grid">`;
    P.LIFTS.forEach((l) => {
      html += `<div><label class="small" for="max-${l}">${l}</label><input type="number" inputmode="decimal" step="2.5" min="0" id="max-${l}" value="${state.maxes[l]}"></div>`;
    });
    html += `</div><div style="margin-top:12px"><button class="btn block" data-act="save-max">儲存</button></div></div>`;

    const perm = canNotify() ? Notification.permission : "unsupported";
    html += `<div class="card"><h2>休息提醒</h2>
      <p class="muted">${perm === "granted" ? "背景通知已開啟：切到別的 App 或關螢幕，休息結束時也會跳通知並震動。"
        : perm === "denied" ? "通知被封鎖了：請到 Chrome 的「網站設定 → 通知」允許這個網站，切到別的 App 時才會提醒。"
        : perm === "unsupported" ? "這個瀏覽器不支援通知；切到別的 App 時只能靠提示音（要把媒體音量開大）。"
        : "開啟通知後，切到別的 App 或關螢幕，休息結束時也會跳通知並震動。"}
      提示音走「媒體音量」，聽不清楚請把媒體音量調大。</p>
      <div class="btn-row">${perm === "default" ? `<button class="btn" data-act="notify">開啟背景通知</button>` : ""}
      <button class="btn ghost" data-act="test-sound">試聽提示音</button></div></div>`;

    html += `<div class="card"><h2>八週做完後</h2>
      <p class="muted">先把第 8 週測出的新重量填到上面並儲存，再按這裡從第 1 週重新開始。這一輪的紀錄會留在「紀錄」頁。</p>
      <button class="btn gold block" data-act="new-cycle">開始下一輪（第 ${state.cycle + 1} 輪）</button></div>`;

    html += `<div class="card"><h2>怎麼練</h2>`;
    P.GUIDE.forEach(([t, d]) => { html += `<details><summary>${esc(t)}</summary><p>${esc(d)}</p></details>`; });
    html += `</div><div class="card"><h2>動作說明</h2>`;
    P.MOVES.forEach(([t, d]) => { html += `<details><summary>${esc(t)}</summary><p>${esc(d)}</p></details>`; });
    html += `</div><p class="muted" style="text-align:center">紀錄只存在這支手機，不會上傳。版本 1.1</p>`;
    v.innerHTML = html;
  }

  function saveMax() {
    const m = {};
    for (const l of P.LIFTS) {
      const val = parseFloat(el(`max-${l}`).value);
      if (!(val > 0) || val > 500) { toast(`${l} 的數字不對`); return; }
      m[l] = val;
    }
    state.maxes = m; save();
    toast("已儲存，課表重量已更新");
    renderAll();
  }

  function newCycle() {
    if (!confirm(`確定要開始第 ${state.cycle + 1} 輪嗎？\n最大重量會沿用：深蹲 ${state.maxes["深蹲"]}、硬舉 ${state.maxes["硬舉"]}、臥推 ${state.maxes["臥推"]}、肩推 ${state.maxes["肩推"]}`)) return;
    state.history.push({ cycle: state.cycle, maxes: Object.assign({}, state.maxes), logs: state.logs });
    state.cycle += 1; state.logs = {}; state.sets = {};
    save(); viewKey = null;
    toast(`第 ${state.cycle} 輪開始`);
    show("today");
  }

  // ───────── 切換畫面 ─────────
  let current = "today";
  function renderAll() {
    el("progress").textContent = `第 ${state.cycle} 輪 · 已完成 ${doneCount()} / 32`;
    renderToday(); renderLog(); renderSettings();
  }
  function show(name) {
    current = name;
    ["today", "log", "settings"].forEach((n) => { el(`view-${n}`).hidden = n !== name; });
    document.querySelectorAll(".tab").forEach((t) => { if (t.dataset.view === name) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current"); });
    renderAll();
    window.scrollTo(0, 0);
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.classList.contains("tab")) { if (t.dataset.view === "today" && current === "today") viewKey = null; show(t.dataset.view); return; }
    if (t.classList.contains("dot")) { onDot(t); return; }
    if (t.dataset.open) { viewKey = t.dataset.open === nextKey() ? null : t.dataset.open; show("today"); return; }
    if (t.dataset.go) { show(t.dataset.go); return; }
    switch (t.dataset.act) {
      case "finish": onFinish(t.dataset.k); break;
      case "interval": onInterval(t); break;
      case "back-next": viewKey = null; renderToday(); window.scrollTo(0, 0); break;
      case "undo-done":
        if (confirm("取消這一天的完成紀錄？")) { delete state.logs[t.dataset.k]; save(); renderAll(); }
        break;
      case "export": exportBackup(); break;
      case "import": el("import-file").click(); break;
      case "save-max": saveMax(); break;
      case "new-cycle": newCycle(); break;
      case "notify": enableNotify(); break;
      case "test-sound": unlockAudio(); beepNow("end"); if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 700]); break;
    }
  });

  show("today");

  // 沒網路也能開：註冊離線快取
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  }
})();
