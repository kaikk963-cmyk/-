// app/ を1枚のHTMLにまとめる（claude.ai のアーティファクトとして公開する用）。
// 実行: node tools/build-artifact.mjs <出力ファイル>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const out = process.argv[2] || "gensou-artifact.html";
const html = readFileSync(path.join(app, "index.html"), "utf8");
const read = (f) => readFileSync(path.join(app, f), "utf8");

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/)[0];
let body = html.match(/<body>([\s\S]*)<\/body>/)[1];
body = body.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script>\n${read(f).replace(/<\/script/gi, "<\\/script")}\n</script>`);

// アーティファクトの外枠が doctype・head・body を付けるので、中身だけを書き出す
writeFileSync(out, `${title}\n${fonts}\n<style>\n${read("style.css")}\n</style>\n${body}`);
console.log(`wrote ${out}`);
