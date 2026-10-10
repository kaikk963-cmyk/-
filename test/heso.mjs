// ヘソに入った玉が全部回転になるか（保留を1つずつ追跡する）。20秒ごとにハンドルを離して戻す。
// 実行: node test/heso.mjs [演出スピード turbo|real] [秒数]   （PLAYWRIGHT_MODULE で playwright の場所を指定できる）
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const pw = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { chromium } = pw.default || pw;
const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const speed = process.argv[2] || "turbo", secs = +(process.argv[3] || 160);
const srv = spawn("python3", ["-m", "http.server", "8797", "-d", appDir], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto("http://localhost:8797/index.html");
await p.evaluate((speed) => {
  localStorage.clear();
  localStorage.setItem("gensou-danmaku-v1", JSON.stringify({ v: 1, devV: 3, settings: { board: "on", speed, autoPush: "on", sound: "off", autoShot: "on" }, custom: { senbare: "s40" }, dev: { force: "none", senbare: "off", overrides: {} },
    balls: 0, invested: 0, totalOut: 0, usedBalls: 0, fired: 0, returns: 0, spins: 0, sinceBonus: 0, rushSpins: 0, hits: 0, charges: 0, rushEntries: 0, rushHits: 0, mode: "normal", stLeft: 0, chain: 0, chainBalls: 0, maxChain: 0, holds: [], rushHolds: [], history: [], graph: [0], log: [], completed: false }));
}, speed);
await p.reload(); await p.waitForTimeout(600);
await p.evaluate(() => {
  const g = window.gensouDebug, e = g.engine;
  window.__t = { heso: 0, made: new Set(), spun: new Set(), over: 0, hesoInRush: 0 };
  const mh = e.makeHold;
  e.makeHold = (mode, c, f) => { const h = mh(mode, c, f); if (mode === "normal") window.__t.made.add(h.id); return h; };
  for (const fn of ["normalScenario", "quietScenario"]) { const o = e[fn]; e[fn] = (h, c) => { window.__t.spun.add(h.id); return o(h, c); }; }
  const on = g.board.handlers.onHeso;
  g.board.handlers.onHeso = () => { window.__t.heso++; const n = g.state.holds.length; if (g.state.mode === "rush") window.__t.hesoInRush++; on(); if (g.state.holds.length === n) window.__t.over++; };
});
const t0 = Date.now();
let k = 0;
while (Date.now() - t0 < secs * 1000) {
  // 20秒ごとにハンドルを離して3秒後に戻す。途中で1回だけRUSH直行の当たりを仕込む
  await p.click("#handleBtn"); await p.waitForTimeout(17000);
  await p.click("#handleBtn"); await p.waitForTimeout(3000);
}
// ハンドルを離したまま、残りの保留が消化されるのを待つ
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(2000);
  const left = await p.evaluate(() => { const st = window.gensouDebug.state; return st.mode === "normal" && !document.querySelector(".bonus-screen") ? st.holds.length + window.gensouDebug.board.balls.length : 99; });
  if (left === 0) break;
}
const r = await p.evaluate(() => { const t = window.__t, st = window.gensouDebug.state; const notSpun = [...t.made].filter((id) => !t.spun.has(id)); return { heso: t.heso, holdsMade: t.made.size, spun: [...t.made].filter((id) => t.spun.has(id)).length, notSpun: notSpun.length, over: t.over, hesoInRush: t.hesoInRush, holdsLeft: st.holds.length, mode: st.mode, rushEntries: st.rushEntries }; });
console.log(speed, JSON.stringify({ ...r, errors }));
await b.close(); srv.kill();
const ok = r.notSpun === 0 && !errors.length;
console.log(ok ? "OK: ヘソに入って保留になった玉は全部回転した" : "NG: 回転にならなかった保留がある");
process.exit(ok ? 0 : 1);
