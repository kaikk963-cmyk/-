// オフラインでも遊べるようにアプリ本体をキャッシュする。ファイルを更新したら VERSION を上げる。
const VERSION = "gensou-v18";
const FILES = ["./", "index.html", "style.css", "data.js", "engine.js", "sound.js", "assets.js", "cloud.js", "board.js", "stage.js", "app.js", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// 自分のファイルはキャッシュ優先、フォントなど外部はネット優先
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
