// 確率まわりの総点検。スペックごとに、
//  1) 大当り確率・RUSH突入率・ST継続率・平均出玉が設計どおりか
//  2) 開発者タブの「出現」（約1/○回転）が実際の出現頻度と合っているか
// をモンテカルロで確かめる（許容幅はサンプル数に応じた約3.5σ）。実行: node test/audit.test.js [回転数]
const D = require("../app/data.js");
const { createEngine } = require("../app/engine.js");

const N = +process.argv[2] || 1_000_000;
const base = { senbare: "s40", sakiyomi: "osusume", leverBuru: "off", impact: "off", rushMode: "default", challenge: "koumakan" };
let bad = 0;
const check = (label, got, want, tolRel) => {
  const ok = Math.abs(got - want) <= Math.abs(want) * tolRel;
  if (!ok) bad++;
  console.log(`${ok ? "  " : "NG"} ${label.padEnd(36)} 設計 ${fmt(want).padStart(10)}  実測 ${fmt(got).padStart(10)}`);
};
const fmt = (x) => (Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(4));

for (const key of Object.keys(D.SPECS)) {
  // スペックごとに data.js を読み直して、前のスペックの換算が残らないようにする
  delete require.cache[require.resolve("../app/data.js")];
  const DD = require("../app/data.js");
  Object.assign(DD.SPEC, DD.SPECS[key], { key });
  const S = DD.SPEC;
  const eng = createEngine(DD);
  console.log(`\n=== ${S.label} ===`);

  // 1) 通常時の抽選
  let hit = 0, charge = 0, rushIn = 0;
  for (let i = 0; i < N; i++) {
    const r = eng.drawNormal();
    if (r.kind === "hit") { hit++; if (r.rush) rushIn++; }
    else if (r.kind === "charge") { charge++; if (r.rush) rushIn++; }
  }
  check("図柄揃い 1/x", N / hit, 1 / S.hitProb, 3.5 / Math.sqrt(hit));
  if (S.chargeProb) check("霊力チャージ 1/x", N / charge, 1 / S.chargeProb, 3.5 / Math.sqrt(charge));
  check("合算 1/x", N / (hit + charge), 1 / (S.hitProb + S.chargeProb), 3.5 / Math.sqrt(hit + charge));
  const entryWant = (S.hitProb * S.hitRushRate + S.chargeProb * S.chargeRushRate) / (S.hitProb + S.chargeProb);
  check("初当りのRUSH突入率", rushIn / (hit + charge), entryWant, 0.04);

  // ST継続率（ST回転数のうちに当たる割合）
  let cont = 0, trials = 200000;
  for (let t = 0; t < trials; t++) {
    for (let k = 0; k < S.stSpins; k++) if (eng.drawRush().kind === "hit") { cont++; break; }
  }
  check("RUSH継続率", cont / trials, 1 - Math.pow(1 - S.rushProb, S.stSpins), 0.02);
  let big = 0, rh = 0;
  for (let i = 0; i < N / 2; i++) { const r = eng.drawRush(); if (r.kind === "hit") { rh++; if (r.big) big++; } }
  check("RUSH中の当り 1/x", (N / 2) / rh, 1 / S.rushProb, 3.5 / Math.sqrt(rh));
  check("上位BONUS（上乗せ）の割合", big / rh, S.rush6000Rate, 0.15);

  // 2) 開発者タブの「出現」表示（app.js の devFreq と同じ式）と実測
  const groups = [
    ["先陰陽玉落下（" + base.senbare + "）", DD.SENBARE[base.senbare], "spin", (h) => (h.senbare ? h.senbare.info.label : null), "hold"],
    ["陰陽玉落下（変動中）", DD.NORMAL_YOKOKU.find((g) => g.id === "hand"), "spin", null, "scenario"],
  ];
  const missRate = (o, p) => (o.rel >= 1 || p >= 1 ? 0 : (o.share * p * (1 - o.rel)) / (o.rel * (1 - p)));
  const counts = {};
  const M = N;
  for (let i = 0; i < M; i++) {
    const hold = eng.makeHold("normal", base);
    if (hold.senbare) counts["sen:" + hold.senbare.info.label] = (counts["sen:" + hold.senbare.info.label] || 0) + 1;
    if (hold.result.kind === "hit" || Math.random() < 0.05) {
      // 変動中の陰陽玉落下はシナリオを作らないと分からないので、ハズレは5%だけ抜き取って重み20倍で数える
      const w = hold.result.kind === "hit" ? 1 : 20;
      for (const st of eng.normalScenario(hold, base).steps) {
        if (st.t === "hand" && st.info && st.info.group === "陰陽玉落下（変動中）") counts["hand:" + st.info.label] = (counts["hand:" + st.info.label] || 0) + w;
      }
    }
  }
  const P = eng.P.spin;
  for (const [title, g, , , kind] of groups) {
    for (const o of g.options) {
      const shown = 1 / (P * o.share + (1 - P) * missRate(o, P)); // 表示される「約1/○」
      const c = counts[(kind === "hold" ? "sen:" : "hand:") + o.label] || 0;
      if (c < 30) { console.log(`·· ${(title + " " + o.label).padEnd(36)} 表示 1/${shown.toFixed(0)}  実測サンプル不足`); continue; }
      check(`${title} ${o.label} 出現1/x`, M / c, shown, Math.max(0.1, 3.5 / Math.sqrt(c))); // まれな演出はサンプル数に応じて許容幅を広げる
    }
  }
}
console.log(bad ? `\nNG: ${bad}件` : "\nOK: すべて設計どおり");
process.exit(bad ? 1 : 0);
