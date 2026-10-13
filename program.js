// 八週課表內容與重量算法（照 v6 Excel 的 產生課表_v6.py 原封不動搬過來）
(function (root) {
  const LIFTS = ["深蹲", "硬舉", "臥推", "肩推"];
  const DEFAULT_MAX = { 深蹲: 110, 硬舉: 110, 臥推: 85, 肩推: 45 };
  const STEP = { 深蹲: 5, 硬舉: 5, 臥推: 2.5, 肩推: 2.5 };
  const DAYS = ["A", "B", "C", "D"];
  const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8];

  const PHASE = {
    1: "第一波｜建立", 2: "第一波｜建立", 3: "第一波｜建立", 4: "減量週｜輕鬆做",
    5: "第二波｜衝高", 6: "第二波｜衝高", 7: "第二波｜衝高", 8: "測驗週｜測新的最大重量",
  };
  const DAYNAME = { A: "A｜下肢力量日", B: "B｜上肢力量日", C: "C｜下肢速度日", D: "D｜上肢速度日" };

  // 力量日：週 -> [動作名, 基準項目, 比例, 下數]
  const ME = {
    A: { 1: ["暫停深蹲（蹲到底停 2 秒）", "深蹲", 0.80, 3], 2: ["暫停深蹲（蹲到底停 2 秒）", "深蹲", 0.85, 2],
         3: ["硬舉", "硬舉", 0.88, 3], 5: ["深蹲", "深蹲", 0.90, 3],
         6: ["深蹲", "深蹲", 0.95, 1], 7: ["硬舉", "硬舉", 0.95, 1] },
    B: { 1: ["窄握臥推（雙手與肩同寬）", "臥推", 0.82, 3], 2: ["窄握臥推（雙手與肩同寬）", "臥推", 0.87, 2],
         3: ["肩推", "肩推", 0.88, 3], 5: ["臥推", "臥推", 0.90, 3],
         6: ["臥推", "臥推", 0.95, 1], 7: ["肩推", "肩推", 0.95, 1] },
  };
  const DELOAD_ME = { A: "深蹲", B: "臥推" };
  const TEST = { A: "深蹲", B: "臥推", C: "硬舉", D: "肩推" };
  // 速度日：週 -> [組數, 比例]
  const DE_SQ = { 1: [8, .50], 2: [8, .55], 3: [8, .60], 4: [5, .50], 5: [8, .55], 6: [8, .60], 7: [6, .65] };
  const DE_DL = { 1: [4, .60], 2: [4, .65], 3: [4, .70], 4: [3, .60], 5: [4, .65], 6: [4, .70], 7: [3, .75] };
  const DE_BP = { 1: [8, .50], 2: [8, .55], 3: [8, .60], 4: [5, .50], 5: [8, .55], 6: [8, .60], 7: [6, .65] };

  // 四捨五入到 2.5 公斤（和 Excel 的 ROUND(x/2.5,0)*2.5 一樣，加一點點避免小數誤差）
  function r25(x) { return Math.round(x / 2.5 + 1e-9) * 2.5; }
  function n(x) { return String(Math.round(x * 100) / 100); }

  // 一行 = 一個動作；sets 是要點幾下圓圈，rest 是每點一下後休息幾秒
  function line(text, sets, rest, extra) { return Object.assign({ text, sets, rest }, extra || {}); }

  function mainBlock(day, w, m) {
    if (w === 8) {
      const lift = TEST[day], b = m[lift], top = b + STEP[lift];
      return {
        name: `${lift}｜測最大 1 下`, restText: "每組休 2～3 分鐘",
        tip: "成功可再加 2.5 公斤試一次，失敗就停",
        lines: [
          line(`${n(r25(b * 0.5))} kg × 5 下`, 1, 150), line(`${n(r25(b * 0.7))} kg × 3 下`, 1, 150),
          line(`${n(r25(b * 0.85))} kg × 1 下`, 1, 150), line(`${n(r25(b * 0.95))} kg × 1 下`, 1, 150),
          line(`挑戰 ${n(top)} kg × 1 下`, 1, 150, { target: true }),
        ],
        excelHow: `${n(r25(b * 0.5))} × 5 → ${n(r25(b * 0.7))} × 3 → ${n(r25(b * 0.85))} × 1 → ${n(r25(b * 0.95))} × 1 → 挑戰 ${n(top)} kg × 1 下\n成功可再加 2.5 公斤試一次，失敗就停`,
        excelTarget: `挑戰 ${n(top)} kg × 1 下`,
      };
    }
    if (day === "A" || day === "B") {
      if (w === 4) {
        const lift = DELOAD_ME[day], wt = r25(m[lift] * 0.65);
        return {
          name: lift, restText: "每組休 90 秒", tip: "輕鬆、動作漂亮就好",
          lines: [line(`${n(wt)} kg × 3 下`, 3, 90)],
          excelHow: `${n(wt)} kg｜3 組 × 3 下\n輕鬆、動作漂亮就好`, excelTarget: `${n(wt)} kg｜3 × 3`,
        };
      }
      const [name, lift, pct, reps] = ME[day][w];
      const T = r25(m[lift] * pct);
      const a = r25(T * 0.5), b = r25(T * 0.7), c = r25(T * 0.85);
      return {
        name, restText: "前三組休 1 分鐘，目標組前休 2 分鐘", tip: "做到目標就收，不加組",
        lines: [
          line(`${n(a)} kg × 5 下`, 1, 60), line(`${n(b)} kg × 3 下`, 1, 60), line(`${n(c)} kg × 2 下`, 1, 120),
          line(`目標 ${n(T)} kg × ${reps} 下`, 1, 60, { target: true }),
        ],
        excelHow: `${n(a)} × 5 → ${n(b)} × 3 → ${n(c)} × 2 → 目標 ${n(T)} kg × ${reps} 下\n做到目標就收，不加組`,
        excelTarget: `${n(T)} kg × ${reps} 下`,
      };
    }
    if (day === "C") {
      const [s, p] = DE_SQ[w], [s2, p2] = DE_DL[w];
      const sq = r25(m["深蹲"] * p), dl = r25(m["硬舉"] * p2);
      return {
        name: "速度深蹲 → 速度硬舉", restText: "每組只休 45 秒", tip: "每一下都全速",
        lines: [line(`深蹲 ${n(sq)} kg × 2 下`, s, 45), line(`硬舉 ${n(dl)} kg × 1 下`, s2, 45)],
        excelHow: `深蹲 ${n(sq)} kg｜${s} 組 × 2 下\n硬舉 ${n(dl)} kg｜${s2} 組 × 1 下　每一下都全速`,
        excelTarget: `深蹲 ${n(sq)} kg ${s}×2／硬舉 ${n(dl)} kg ${s2}×1`,
      };
    }
    const [s, p] = DE_BP[w];
    const bp = r25(m["臥推"] * p);
    return {
      name: "速度臥推", restText: "每組只休 45 秒", tip: "每一下都全速推",
      lines: [line(`臥推 ${n(bp)} kg × 3 下`, s, 45)],
      excelHow: `臥推 ${n(bp)} kg｜${s} 組 × 3 下\n每一下都全速推`,
      excelTarget: `臥推 ${n(bp)} kg ${s}×3`,
    };
  }

  function accessoryBlocks(day, w, m) {
    const light = w === 4 || w === 8;
    const r = light ? 2 : 3;
    let name, text;
    if (day === "A") {
      if (w === 3 || w === 7) { name = "啞鈴分腿蹲 ＋ 懸吊舉腿"; text = "分腿蹲每邊 8 下 ＋ 舉腿 10 下"; }
      else { name = "羅馬尼亞硬舉 ＋ 懸吊舉腿"; text = `羅馬尼亞硬舉 ${n(r25(m["硬舉"] * 0.5))} kg × 8 下 ＋ 舉腿 10 下`; }
    } else if (day === "B") { name = "引體向上 ＋ 伏地挺身"; text = "引體向上（留 1 下餘力）＋ 伏地挺身 12 下"; }
    else if (day === "C") { name = "啞鈴分腿蹲 ＋ 懸吊舉腿"; text = "分腿蹲每邊 8 下 ＋ 舉腿 10 下"; }
    else { name = "啞鈴單手划船 ＋ 爆發伏地挺身"; text = "划船每邊 10 下 ＋ 爆發伏地挺身 5 下（手推離地面）"; }
    const acc = {
      name, restText: "每輪做完休 60 秒", tip: "兩個動作輪流做，中間不空等",
      lines: [line(text, r, 60, { unit: "輪" })],
      excelHow: `${text}｜兩個輪流做 ${r} 輪`,
    };
    if (light) return [acc, null];
    let fin;
    if (day === "A") fin = { name: "壺鈴擺盪", restText: "每組休 30 秒", lines: [line("壺鈴擺盪 15 下", 4, 30)], excelHow: "15 下 × 4 組" };
    else if (day === "B") fin = { name: "單手提走", restText: "不休息", lines: [line("單手提壺鈴走 30 秒就換手", 4, 0, { unit: "趟" })], excelHow: "單手提壺鈴走 30 秒就換手，共 4 趟" };
    else if (day === "C") fin = { name: "壺鈴擺盪", restText: "已含在節奏內", lines: [line("壺鈴擺盪：做 20 秒／休 20 秒", 6, 0, { unit: "輪", interval: { work: 20, rest: 20 } })], excelHow: "做 20 秒／休 20 秒 × 6 輪" };
    else fin = { name: "簡化波比", restText: "已含在節奏內", lines: [line("簡化波比：做 20 秒／休 20 秒", 6, 0, { unit: "輪", interval: { work: 20, rest: 20 } })], excelHow: "做 20 秒／休 20 秒 × 6 輪" };
    return [acc, fin];
  }

  function buildDay(w, day, maxes) {
    const m = Object.assign({}, DEFAULT_MAX, maxes || {});
    const main = mainBlock(day, w, m);
    const [acc, fin] = accessoryBlocks(day, w, m);
    const blocks = [Object.assign({ label: "主項" }, main), Object.assign({ label: "輔助" }, acc)];
    if (fin) blocks.push(Object.assign({ label: "收尾" }, fin));
    return { key: `${w}${day}`, week: w, day, title: DAYNAME[day], phase: PHASE[w], blocks, target: main.excelTarget };
  }

  const ORDER = [];
  WEEKS.forEach((w) => DAYS.forEach((d) => ORDER.push(`${w}${d}`)));

  const GUIDE = [
    ["暖身 3 分鐘", "開合跳 30 秒、徒手深蹲 10 下、肩髖繞環。"],
    ["狀況不好時", "睡不好或剛下夜班：力量日目標重量減 10%，速度日照做。有痛就停，在備註寫一句。"],
    ["力量日：衝重", "用 3 組漸進組當暖身，第 4 組做到當天目標重量就結束。主項每兩週換一個變化動作，避免卡關。"],
    ["速度日：衝快", "用五到六成重量，每一下都用最快速度完成，每組只休 45 秒。重點是快，不是累；速度明顯變慢就停。"],
    ["輔助與收尾", "兩個動作輪流做、中間不空等，心肺靠這種緊湊節奏帶出來，不另外加跑步或大量組數。"],
    ["八週做完", "第 8 週測出新的最大重量後填回設定，再從第 1 週開始下一輪。"],
  ];
  const MOVES = [
    ["暫停深蹲", "蹲到最低點停 2 秒再站起來，不借反彈。練起身的爆發力。"],
    ["窄握臥推", "雙手握距與肩同寬，手肘靠近身體。加強手臂後側與推的力量。"],
    ["羅馬尼亞硬舉", "膝蓋微彎、屁股往後推，槓沿大腿下到小腿中段再站直。練大腿後側與臀部。"],
    ["懸吊舉腿", "雙手吊在單槓上，把膝蓋抬到胸口高度。吊不住可改躺在地上舉腿。"],
    ["啞鈴分腿蹲", "前後腳站開，垂直往下蹲到後膝快碰地，雙手各拿一個啞鈴。"],
    ["壺鈴擺盪", "用臀部往前頂的力量把壺鈴甩到胸口高度，手只是掛著。"],
    ["爆發伏地挺身", "用力推到雙手離開地面。做不到可改成跪姿。"],
    ["簡化波比", "站立 → 雙手撐地 → 雙腳往後伸 → 收回 → 站起，不加伏地挺身與跳躍。"],
    ["單手提走", "單手提壺鈴，身體保持正直不歪斜，原地來回走。"],
  ];

  const api = { LIFTS, DEFAULT_MAX, DAYS, WEEKS, ORDER, DAYNAME, PHASE, GUIDE, MOVES, buildDay, r25 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Program = api;
})(typeof self !== "undefined" ? self : this);
