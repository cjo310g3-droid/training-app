const P = require(process.argv[2] + "/program.js");
const ref = require(process.argv[3]);
let bad = 0, checked = 0;
for (const row of ref) {
  const [key, w, d, title, phase, mainName, how, rest, accName, accHow, accRest, finName, finHow, finRest, target] = row;
  const day = P.buildDay(w, d, {});
  const [m, a, f] = day.blocks;
  const pairs = [
    ["title", day.title, title], ["phase", day.phase, phase], ["主項", m.name, mainName], ["主項做法", m.excelHow, how],
    ["主項休息", m.restText, rest], ["輔助", a.name, accName], ["輔助做法", a.excelHow, accHow], ["輔助休息", a.restText, accRest],
    ["收尾", f ? f.name : "（本週免收尾）", finName], ["收尾做法", f ? f.excelHow : null, finHow], ["收尾休息", f ? f.restText : null, finRest],
    ["目標", day.target, target],
  ];
  for (const [k, got, want] of pairs) { checked++; if (got !== want) { bad++; console.log(key, k, JSON.stringify(got), "!=", JSON.stringify(want)); } }
}
console.log(`比對 ${ref.length} 天、${checked} 個欄位，不一致 ${bad} 個`);
process.exit(bad ? 1 : 0);
