// 取り込んだ立ち絵・背景画像を端末のブラウザ（IndexedDB）に保存する。
// 保存先が使えない環境（プライベートブラウズ等）では、開いている間だけ使える。
(function (root) {
  const DB = "gensou-assets";
  const STORE = "images";
  const MAX_SIDE = 1100;
  let db = null;
  const urls = {};
  const blobs = {};

  function open() {
    return new Promise((resolve, reject) => {
      const req = root.indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r && r.result);
      t.onerror = () => reject(t.error);
    });
  }

  async function init() {
    try {
      db = await open();
      await new Promise((resolve) => {
        const t = db.transaction(STORE, "readonly");
        const req = t.objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve();
          urls[c.key] = URL.createObjectURL(c.value);
          blobs[c.key] = c.value;
          c.continue();
        };
        req.onerror = () => resolve();
      });
    } catch {
      db = null;
    }
  }

  // 大きな画像は長辺 MAX_SIDE に縮めて PNG で保存する（透過を残すため）
  async function shrink(file) {
    if (!file.type.startsWith("image/")) return file; // 音声などはそのまま
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 1.5e6) return file;
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((r) => c.toBlob((b) => r(b || file), "image/png"));
    } catch {
      return file;
    }
  }

  async function put(key, file) {
    const blob = await shrink(file);
    if (db) {
      try { await tx("readwrite", (s) => s.put(blob, key)); } catch {}
    }
    if (urls[key]) URL.revokeObjectURL(urls[key]);
    urls[key] = URL.createObjectURL(blob);
    blobs[key] = blob;
  }

  async function remove(key) {
    if (db) {
      try { await tx("readwrite", (s) => s.delete(key)); } catch {}
    }
    if (urls[key]) URL.revokeObjectURL(urls[key]);
    delete urls[key];
    delete blobs[key];
  }

  root.GensouAssets = {
    init,
    put,
    remove,
    url: (key) => urls[key] || null,
    blob: (key) => blobs[key] || null,
    keys: () => Object.keys(blobs),
    persistent: () => !!db,
  };
})(this);
