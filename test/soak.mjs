// 長時間の自動プレイで、エラー・止まり・持ち玉の帳尻ずれがないかを確認する。
// 実行: node test/soak.mjs [1設定あたりの秒数]
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const pw = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { chromium } = pw.default || pw;
const SEC = +process.argv[2] || 60;
const port = 8900 + Math.floor(Math.random() * 90);
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: path.join(here, "..", "app"), stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch();

const CASES = [
  { board: "on", rushMode: "default", senbare: "ex", sakiyomi: "osusume", challenge: "koumakan" },
  { board: "on", rushMode: "totsugeki", senbare: "s90", sakiyomi: "atsu", challenge: "ippatsu", leverBuru: "on", impact: "on" },
  { board: "off", rushMode: "shurai", senbare: "s40", sakiyomi: "chance", challenge: "ippatsu" },
  { board: "off", rushMode: "renda", senbare: "off", sakiyomi: "none", challenge: "koumakan" },
  { board: "on", spec: "ama99", rushMode: "default", senbare: "s40", sakiyomi: "osusume", challenge: "koumakan" },
  { board: "on", spec: "ama", rushMode: "shurai", senbare: "ex", sakiyomi: "chance", challenge: "ippatsu" },
];

let failed = 0;
for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/index.html`);
  await page.evaluate((c) => {
    localStorage.clear();
    const st = {
      v: 1,
      custom: { senbare: c.senbare, sakiyomi: c.sakiyomi, leverBuru: c.leverBuru || "off", impact: c.impact || "off", rushMode: c.rushMode, challenge: c.challenge },
      settings: { board: c.board, speed: "turbo", autoPush: "on", sound: "off", strength: 40, spec: c.spec || "middle" },
      dev: { force: "rushHit", senbare: "off", overrides: {} },
      balls: 0, invested: 0, totalOut: 0, usedBalls: 0, fired: 0, returns: 0,
      spins: 0, sinceBonus: 0, rushSpins: 0, hits: 0, charges: 0, rushEntries: 0, rushHits: 0,
      mode: "normal", stLeft: 0, chain: 0, chainBalls: 0, maxChain: 0, holds: [], rushHolds: [], history: [], graph: [0], log: [], completed: false,
    };
    localStorage.setItem("gensou-danmaku-v1", JSON.stringify(st));
  }, c);
  await page.reload();
  await page.waitForTimeout(400);
  await page.click("#handleBtn");
  const read = () => page.evaluate(() => JSON.parse(localStorage.getItem("gensou-danmaku-v1")));
  let lastRight = null, lastProgress = Date.now(), lastSpins = -1, stuck = false, bad = [];
  const t0 = Date.now();
  while (Date.now() - t0 < SEC * 1000) {
    await page.waitForTimeout(500);
    const s = await read();
    const right = s.mode === "rush" || !!(await page.$(".bonus-screen"));
    if (c.board === "on" && right !== lastRight) { await page.click(right ? "#rightShot" : "#leftShot"); lastRight = right; }
    const prog = s.spins + s.rushSpins;
    if (prog !== lastSpins) { lastSpins = prog; lastProgress = Date.now(); }
    else if (Date.now() - lastProgress > 25000) { stuck = true; break; }
    if (s.holds.length > 4 || s.rushHolds.length > 4) bad.push("保留が4個を超えた");
    if (s.stLeft < 0 || s.stLeft > ({ ama: 40, ama99: 64 }[c.spec] || 130)) bad.push(`ST残りが範囲外 ${s.stLeft}`);
    if (s.balls < 0) bad.push(`持ち玉がマイナス ${s.balls}`);
  }
  await page.click("#handleBtn");
  await page.waitForTimeout(3000);
  const s = await read();
  const expect = (s.invested / 1000) * 250 + s.totalOut + s.returns - s.fired;
  if (s.balls !== expect) bad.push(`持ち玉の帳尻ずれ 実際${s.balls} 計算${expect}`);
  const ok = !errors.length && !stuck && !bad.length;
  if (!ok) failed++;
  console.log(`${ok ? "OK" : "NG"} ${JSON.stringify(c)}`);
  console.log(`   通常${s.spins}回転 RUSH${s.rushSpins}回転 初当り${s.hits + s.charges} RUSH突入${s.rushEntries} RUSH中当り${s.rushHits} 持ち玉${s.balls} 投資${s.invested}`);
  if (errors.length) console.log("   errors:", errors.slice(0, 5));
  if (stuck) console.log("   進行が25秒止まった");
  if (bad.length) console.log("   ", [...new Set(bad)]);
  await page.close();
}
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
