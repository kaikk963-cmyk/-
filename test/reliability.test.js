// 演出の信頼度がデータの rel どおりに出るかをモンテカルロで確認する。
// 実行: node test/reliability.test.js [通常時の回転数] [スペック middle|ama99|ama]
// 甘デジなどでは、ハズレ時の出方はそのままで信頼度が上がる。その上がった信頼度どおりに出るかを確かめる。
const D = require("../app/data.js");
const { createEngine } = require("../app/engine.js");

const N = +process.argv[2] || 2_000_000;
const specKey = process.argv[3] || "middle";
Object.assign(D.SPEC, D.SPECS[specKey], { key: specKey });
const eng = createEngine(D);
console.log(`スペック: ${D.SPEC.label}`);

function collector() {
  const stats = new Map();
  return {
    stats,
    add(info, hit, rush) {
      if (!info || info.rel == null) return;
      const key = `${info.group} / ${info.label}`;
      const s = stats.get(key) || { rel: info.rel, n: 0, hit: 0, rush: 0 };
      s.n++;
      if (hit) s.hit++;
      if (hit && rush) s.rush++;
      stats.set(key, s);
    },
  };
}

function runNormal(n, custom, c) {
  let hits = 0, rushHits = 0, charges = 0, chargeRush = 0;
  for (let i = 0; i < n; i++) {
    const hold = eng.makeHold("normal", custom);
    const r = hold.result;
    const hit = r.kind === "hit";
    if (hit) { hits++; if (r.rush) rushHits++; }
    if (r.kind === "charge") { charges++; if (r.rush) chargeRush++; }
    c.add(hold.colorInfo, hit, r.rush);
    for (const pr of hold.preread) c.add(pr.info, hit, r.rush);
    if (hold.senbare) c.add(hold.senbare.info, hit, r.rush);
    const sc = eng.normalScenario(hold, custom);
    for (const st of sc.steps) {
      if (st.t === "holdChange" || st.t === "sealBreak") continue; // 保留は入賞時に集計済み
      c.add(st.info, hit, r.rush);
      if (st.handInfo && st.handAt) c.add(st.handInfo, hit, r.rush);
    }
    if (hit) {
      // BONUS中の裏ボタンは「RUSH突入」を当たりとして集計
      for (const st of eng.bonusSteps(r, sc.digits, "normal", custom)) {
        if (st.t === "bonus" && st.ura && st.ura.info) c.add({ ...st.ura.info, group: st.ura.info.group + "（RUSH率）" }, r.rush, r.rush);
      }
    }
  }
  return { hits, rushHits, charges, chargeRush };
}

function runRush(n, custom, c) {
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const hold = eng.makeHold("rush", custom);
    const hit = hold.result.kind === "hit";
    if (hit) hits++;
    c.add(hold.colorInfo, hit, true);
    for (const pr of hold.preread) c.add(pr.info, hit, true);
    for (const st of eng.rushScenario(hold, custom).steps) {
      if (st.t === "holdChange") continue;
      c.add(st.info, hit, true);
      if (st.handInfo && st.handAt) c.add(st.handInfo, hit, true);
    }
  }
  return { hits };
}

const base = { senbare: "s40", sakiyomi: "osusume", leverBuru: "off", impact: "off", rushMode: "default", challenge: "koumakan" };
const c = collector();

const r1 = runNormal(N, base, c);
console.log(`通常時 ${N}回転: 図柄揃い 1/${(N / r1.hits).toFixed(1)}  チャージ 1/${(N / r1.charges).toFixed(1)}  合算 1/${(N / (r1.hits + r1.charges)).toFixed(1)}  図柄揃いのRUSH直行 ${(r1.rushHits / r1.hits * 100).toFixed(1)}%`);
runNormal(N / 2, { ...base, senbare: "s90", leverBuru: "on", impact: "on" }, c);
runNormal(N / 2, { ...base, senbare: "ex" }, c);
const r2 = runRush(N / 2, base, c);
console.log(`RUSH中 ${N / 2}回転: 大当り 1/${(N / 2 / r2.hits).toFixed(1)}`);
runRush(N / 4, { ...base, rushMode: "renda" }, c);

// 大当り時にRUSH直行しか出ない（RUSH濃厚）はずの演出
const RUSH_ONLY = [/保留変化予告 \/ 虹$/, /先陰陽玉落下（EX）/, /インパクトフラッシュ/, /^リーチ \/ 全回転$/];

let bad = 0;
for (const [key, s] of [...c.stats.entries()].sort()) {
  const got = s.hit / s.n;
  const se = Math.sqrt(Math.max(s.rel * (1 - s.rel), 1e-4) / s.n);
  const tol = Math.max(4 * se, 0.02);
  const enough = s.hit >= 30 || s.rel >= 1;
  let ok = !enough || Math.abs(got - s.rel) <= tol;
  if (RUSH_ONLY.some((re) => re.test(key)) && !key.includes("RUSH") && s.hit !== s.rush) ok = false;
  if (!ok) bad++;
  const flag = ok ? (enough ? "  " : "··") : "NG";
  console.log(`${flag} ${key.padEnd(44)} 設定 ${(s.rel * 100).toFixed(1).padStart(5)}%  実測 ${(got * 100).toFixed(1).padStart(5)}%  (${s.hit}/${s.n})`);
}
console.log("\n（·· は当たりのサンプルが少なく判定対象外）");

// 先読みカスタムごとの先読み全体の信頼度（参考値。実機は通常時 3%未満/約49%/約93%、RUSH中 約8%/約84%/濃厚）
for (const mode of ["normal", "rush"]) {
  for (const sakiyomi of ["osusume", "chance", "atsu"]) {
    let n = 0, hit = 0;
    for (let i = 0; i < N / 4; i++) {
      const h = eng.makeHold(mode, { ...base, senbare: "off", sakiyomi });
      if ((h.color && h.reveal === "entry") || h.preread.length) {
        n++;
        if (h.result.kind === "hit") hit++;
      }
    }
    console.log(`先読みカスタム ${mode === "rush" ? "RUSH中" : "通常時"} ${D.CUSTOMS.sakiyomi.choices[sakiyomi]}: 先読み発生時の信頼度 ${(hit / n * 100).toFixed(1)}%（${n}回中）`);
  }
}

console.log(bad ? `\nNG: ${bad}件が設定値とずれている` : "\nOK: すべて設定値の範囲内");
process.exit(bad ? 1 : 0);
