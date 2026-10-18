// claude.ai のアカウント側への保存（db・assets 機能）。
// スマホのアプリなどでブラウザの保存領域が消えても、設定・プレイデータ・取り込んだ素材が残るようにする。
// 使えない環境（ローカルで開いたとき等）では何もせず、端末内の保存だけで動く。
(function (root) {
  let db = null;
  let assets = null;
  let uid = null;
  let ready = false;
  let artMap = {};

  const saveDoc = () => db.doc(`data/users/${uid}/save`);
  const artDoc = () => db.doc(`data/users/${uid}/art`);

  async function init() {
    const c = root.claude;
    if (!c || typeof c.use !== "function") return false;
    try {
      const [d, u] = await Promise.all([c.use("db"), c.use("user")]);
      if (!d || !u) return false;
      uid = await u.id();
      if (!uid) return false;
      db = d;
      assets = await c.use("assets");
      const art = await artDoc().get();
      artMap = art.exists ? { ...(art.data().map || {}) } : {};
      ready = true;
      return true;
    } catch {
      return false;
    }
  }

  async function loadState() {
    if (!ready) return null;
    try {
      const s = await saveDoc().get();
      return s.exists ? s.data().state || null : null;
    } catch {
      return undefined; // 読めなかった（保存なしの null と区別する）
    }
  }

  // 書き込みは1件ずつ、数秒ぶんまとめて行う
  let pending = null;
  let writing = false;
  let timer = null;
  function saveState(state) {
    if (!ready) return;
    pending = state;
    if (!timer && !writing) timer = setTimeout(flush, 4000);
  }
  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (!ready || writing || !pending) return;
    writing = true;
    const s = pending;
    pending = null;
    try {
      await saveDoc().set({ state: JSON.parse(JSON.stringify(s)), savedAt: Date.now() });
    } catch {}
    writing = false;
    if (pending) timer = setTimeout(flush, 4000);
  }

  const toBase64 = (blob) => new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.readAsDataURL(blob);
  });

  // 画像はそのまま、音声は assets が受け付けないので JSON（base64）に包んで保存する
  async function putArt(key, blob) {
    if (!ready || !assets) return false;
    try {
      let up;
      const isImage = blob.type && blob.type.startsWith("image/");
      if (isImage) up = await assets.upload(blob);
      else {
        const wrapped = JSON.stringify({ type: blob.type || "audio/mpeg", data: await toBase64(blob) });
        up = await assets.upload(new Blob([wrapped], { type: "application/json" }), { type: "application/json" });
      }
      const old = artMap[key];
      artMap[key] = { id: up.id, kind: isImage ? "image" : "audio" };
      await artDoc().set({ map: artMap });
      if (old && old.id !== up.id) assets.delete(old.id).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  async function removeArt(key) {
    if (!ready) return;
    const old = artMap[key];
    if (!old) return;
    delete artMap[key];
    try {
      await artDoc().set({ map: artMap });
      if (assets) await assets.delete(old.id);
    } catch {}
  }

  async function fetchArt(key) {
    const a = artMap[key];
    if (!a) return null;
    try {
      const res = await fetch("/_blob/" + a.id);
      if (!res.ok) return null;
      if (a.kind === "image") return await res.blob();
      const { type, data } = await res.json();
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    } catch {
      return null;
    }
  }

  root.GensouCloud = {
    init,
    loadState,
    saveState,
    flush,
    putArt,
    removeArt,
    fetchArt,
    artKeys: () => Object.keys(artMap),
    isReady: () => ready,
    canStoreArt: () => ready && !!assets,
  };
})(this);
