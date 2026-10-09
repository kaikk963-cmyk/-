// ブラウザで実際に打ち出して、エラーなく通常時・BONUS・RUSHが回るかを確認する。
// 実行: node test/smoke.mjs [出力ディレクトリ]
// PLAYWRIGHT_MODULE で playwright の場所を指定できる。
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..", "app");
const out = process.argv[2] || path.join(here, "out");
mkdirSync(out, { recursive: true });

const pw = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { chromium } = pw.default || pw;

const port = 8800 + Math.floor(Math.random() * 100);
const server = spawn("python3", ["-m", "http.server", String(port)], { cwd: appDir, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/fonts\.g/.test(m.text()) && errors.push(m.text()));

const STATE_KEY = "gensou-danmaku-v1";
await page.goto(`http://localhost:${port}/index.html`);
await page.evaluate((k) => localStorage.removeItem(k), STATE_KEY);
await page.reload();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(out, "01-start.png") });

// 爆速・自動PUSH・先バレEX・信頼度表示ON
await page.click("#menuBtn");
await page.click('[data-set="custom.senbare"][data-val="ex"]');
await page.screenshot({ path: path.join(out, "02-custom.png") });
await page.click('#menuTabs [data-tab="settings"]');
await page.click('[data-set="settings.speed"][data-val="turbo"]');
await page.click('[data-set="settings.autoPush"][data-val="on"]');
await page.click("#menuClose");

await page.click("#handleBtn");

const read = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), STATE_KEY);
let shotReach = false, shotRush = false, lastRight = false;
const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  await page.waitForTimeout(300);
  const s = await read();
  // 物理盤面：通常時は左打ち、RUSH・BONUS中は右打ち
  const needRight = s && (s.mode === "rush" || (await page.$(".bonus-screen")));
  if (needRight !== lastRight) {
    await page.click(needRight ? "#rightShot" : "#leftShot");
    lastRight = needRight;
  }
  if (!shotReach && (await page.$(".reach-title"))) {
    await page.screenshot({ path: path.join(out, "03-reach.png") });
    shotReach = true;
  }
  if (s && s.mode === "rush" && !shotRush) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, "04-rush.png") });
    shotRush = true;
  }
  if (s && s.history.some((h) => h.type === "end") && shotReach) break;
}
await page.click("#handleBtn");
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(out, "05-after.png"), fullPage: true });

// すべての演出ステップを1回ずつ再生して、例外が出ないか確認する
const covered = await page.evaluate(async () => {
  const { stage } = window.gensouDebug;
  stage.setSpeed(0.05);
  stage.setAutoPush(true);
  const d = [3, 4, 3];
  const steps = [
    { t: "holdChange", color: "red" }, { t: "sealBreak", color: "gold" }, { t: "impact" }, { t: "leverBuru", color: "rainbow" },
    { t: "logo", color: "red" }, { t: "sakura", id: "su3drop", drop: true, text: "西行妖が咲く…" },
    { t: "giji", n: 3, yukari: true, reimu: true }, { t: "card", id: "kaiwa", title: "会話予告", text: "金セリフ", color: "gold" },
    { t: "su", step: 4, color: "gold", char: "reimu" }, { t: "tokitome", color: "gold" }, { t: "mono", color: "red" },
    { t: "bg", bg: "meikai" }, { t: "hand", sound: "low" }, { t: "cirno", color: "red" }, { t: "zone", device: "lever" },
    { t: "kyouki", success: true }, { t: "reels", digits: d, reach: true }, { t: "reach", label: "弾幕クライマックスリーチ vsレミリア", kind: "climax", char: "remilia", color: "gold" },
    { t: "declare", color: "red", text: "神槍「スピア・ザ・グングニル」" }, { t: "telop", text: "テスト", color: "gold" }, { t: "lamp" },
    { t: "hand", sound: "normal", timing: "veryEarly" }, { t: "cutin", color: "rainbow", text: "霊符「夢想封印」" },
    { t: "device", device: "lever", handAt: "deviceOperate" }, { t: "fakeEnd" }, { t: "sukima", text: "まだよ" },
    { t: "bundan", n: 4 }, { t: "spellMoji", word: "夢想天生", color: "gold" }, { t: "notice", text: "フラン襲来", char: "flandre" },
    { t: "renda", n: 5, hit: true }, { t: "wait", ms: 10 },
    { t: "revive", id: "aori", hit: false, stopAt: 4 }, { t: "revive", id: "drop", hit: true, stopAt: null },
    { t: "revive", id: "sukima", hit: true, stopAt: null }, { t: "revive", id: "aori", hit: true, stopAt: null },
    { t: "serif", char: "remilia", text: "こんなに紅い夜だもの", color: "red" }, { t: "serif", char: "reimu", text: "異変は、ここで終わりよ！", color: "gold" },
    { t: "revive", id: "sukima", hit: true, stopAt: null, line: ["yukari", "まだ終わらせないわ"] },
    { t: "final", digits: d, hit: false, charge: false },
    { t: "zenkaiten" }, { t: "final", digits: [7, 7, 7], hit: true, charge: false },
    { t: "bonus", title: "異変解決BONUS", sub: "10R", rounds: 10, payout: 1400, ura: { color: "red", info: null } },
    { t: "challenge", kind: "koumakan", serif: true, device: "lever" }, { t: "challenge", kind: "ippatsu", at: -1 },
    { t: "rushResult", success: true, text: "霊夢図柄 RUSH確定" }, { t: "rushResult", success: false },
    { t: "charge", payout: 280, promote: true }, { t: "rushContinue" }, { t: "rushEnd", chain: 5, balls: 12600 },
    { t: "reels", digits: [1, 2, 3], reach: false }, { t: "final", digits: [1, "C", 3], hit: false, charge: true },
  ];
  await stage.play(steps);
  stage.setMode("normal");
  return steps.length;
});
console.log("全ステップ再生:", covered);

// 立ち絵の取り込み（アイコン画像を霊夢の立ち絵として入れてみる）
await page.click("#menuBtn");
await page.click('#menuTabs [data-tab="art"]');
await page.setInputFiles('[data-asset="chara:reimu"]', path.join(appDir, "icon-512.png"));
await page.waitForSelector('[data-asset-del="chara:reimu"]', { timeout: 5000 });
await page.click("#menuClose");
const artInReels = await page.$$eval(".cell-art", (n) => n.length);
console.log("立ち絵が入った図柄セル:", artInReels);
await page.screenshot({ path: path.join(out, "07-art.png") });

// 役物投下・先バレの音の差し替え（生成したwavを取り込んで、取り込んだ音が鳴るか確かめる）
function makeWav(freq) {
  const rate = 8000, n = 2400, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / rate) * 12000), 44 + i * 2);
  return buf;
}
await page.evaluate(() => {
  window.__bufStarts = 0;
  const orig = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { if (this.buffer && this.buffer.duration > 0.2 && Math.abs(this.buffer.duration - 1) > 0.01) window.__bufStarts++; return orig.apply(this, a); };
});
await page.click("#menuBtn");
await page.click('#menuTabs [data-tab="sound"]');
for (const [slot, f] of [["yakumono", 440], ["senbare", 660]]) {
  await page.setInputFiles(`[data-asset="sound:${slot}"]`, { name: `${slot}.wav`, mimeType: "audio/wav", buffer: makeWav(f) });
  await page.waitForSelector(`[data-asset-del="sound:${slot}"]`, { timeout: 5000 });
}
// 音として読めないファイルはエラーを出して取り込まない
await page.setInputFiles('[data-asset="sound:kyuin"]', path.join(appDir, "icon-192.png"));
await page.waitForSelector(".warn[role=status]", { timeout: 5000, state: "attached" });
if (await page.$('[data-asset-del="sound:kyuin"]')) errors.push("画像が音として取り込まれた");
// 内蔵の音を選ぶ
await page.click('[data-set="settings.presetSenbare"][data-val="pokyun"]');
if ((await page.getAttribute('[data-set="settings.presetSenbare"][data-val="pokyun"]', "aria-pressed")) !== "true") errors.push("内蔵の音が選べない");
await page.click('[data-set="settings.presetSenbare"][data-val="std"]');
await page.waitForTimeout(500);
for (const sel of ['[data-try-sound="yakumono"]', '[data-try="normal"][data-try-sound="senbare"]', '[data-try="high"][data-try-sound="senbare"]', '[data-preview="senbare"]']) {
  await page.click(sel);
  await page.waitForTimeout(300);
}
await page.screenshot({ path: path.join(out, "08-sound.png") });
await page.click("#menuClose");
await page.click("#dropBtn");
await page.waitForTimeout(300);
const customPlays = await page.evaluate(() => window.__bufStarts);
console.log("取り込んだ音の再生回数:", customPlays);
if (customPlays < 6) errors.push(`取り込んだ音が鳴っていない（${customPlays}回）`);
await page.screenshot({ path: path.join(out, "06-steps.png") });

const s = await read();
console.log(JSON.stringify({
  spins: s.spins, rushSpins: s.rushSpins, hits: s.hits, charges: s.charges,
  rushEntries: s.rushEntries, rushHits: s.rushHits, maxChain: s.maxChain,
  balls: s.balls, invested: s.invested, usedBalls: s.usedBalls,
  rate: s.usedBalls ? +(s.spins / (s.usedBalls / 250)).toFixed(1) : null,
  logSample: s.log.slice(0, 5).map((l) => `${l.group}/${l.label}`),
}, null, 1));
console.log("errors:", errors);
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
