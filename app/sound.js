// 効果音とBGMをWeb Audioで合成する（音声ファイルは使わない）。
// ブラウザの制約で、最初のタップ後に unlock() を呼ぶまで音は鳴らない。
(function (root) {
  let ctx = null;
  let master = null;
  let bgmGain = null;
  let enabled = true;
  let volume = 0.7;
  let bgmOn = false;
  let bgmTheme = "normal";
  let bgmTimer = null;
  let bgmStep = 0;
  let bgmNext = 0;

  // 取り込んだ音（名前ごと）。AudioContext ができてからデコードする
  const custom = {};

  // 最初のタップより前に読み込んでおけるよう、音を鳴らす前は別の（オフラインの）コンテキストで読み込む
  let decoder = null;
  function decodeWith() {
    if (ctx) return ctx;
    if (!decoder) {
      const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
      if (OAC) try { decoder = new OAC(1, 1, 44100); } catch {}
    }
    return decoder;
  }

  function decodeCustom(name) {
    const c = custom[name];
    const dc = decodeWith();
    if (!c || c.buffer || !dc) return Promise.resolve();
    if (!c.decoding) c.decoding = decodeInto(name, c, dc);
    return c.decoding;
  }

  async function decodeInto(name, c, dc) {
    try {
      const data = await c.blob.arrayBuffer();
      const buf = await new Promise((resolve, reject) => {
        const p = dc.decodeAudioData(data, resolve, reject);
        if (p && p.catch) p.catch(reject);
      });
      // 音量をほかの効果音にそろえる（RMSで正規化）
      let sum = 0, n = 0;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i += 4) { sum += d[i] * d[i]; n++; }
      }
      const rms = Math.sqrt(sum / Math.max(1, n)) || 0.1;
      if (custom[name] === c) { c.buffer = buf; c.gain = Math.min(1, 0.16 / rms); }
    } catch {
      if (custom[name] === c) delete custom[name];
    }
  }

  function playCustom(name) {
    const c = custom[name];
    if (!c || !c.buffer) return false;
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = c.buffer;
    g.gain.value = c.gain;
    src.connect(g).connect(master);
    src.start();
    return true;
  }

  function unlock() {
    try {
      if (!ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = volume;
        master.connect(ctx.destination);
        bgmGain = ctx.createGain();
        bgmGain.gain.value = 0.32;
        bgmGain.connect(master);
      }
      if (ctx.state === "suspended") ctx.resume();
      if (bgmOn) startBgm();
      Object.keys(custom).forEach(decodeCustom);
    } catch {}
  }

  const ready = () => ctx && enabled && ctx.state === "running";

  function tone({ freq = 440, type = "square", dur = 0.12, vol = 0.18, delay = 0, slide = null, attack = 0.004, out = master }) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  let noiseBuf = null;
  function noise({ dur = 0.2, vol = 0.2, delay = 0, type = "lowpass", freq = 1200, q = 0.8, sweep = null }) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  const notes = (seq, { type = "square", vol = 0.14, step = 0.09, len = 0.12 } = {}) =>
    seq.forEach((f, i) => f && tone({ freq: f, type, vol, delay: i * step, dur: len }));

  const HOLD_FREQ = { blink: 660, blue: 784, green: 880, purple: 988, red: 1175, gold: 1319, rainbow: 1568, seal: 523 };

  const sfx = {
    start() { tone({ freq: 1400, type: "square", dur: 0.03, vol: 0.05 }); },
    stop() { tone({ freq: 520, type: "triangle", dur: 0.07, vol: 0.16 }); },
    reach() { notes([784, 988, 1175, 1568], { type: "square", vol: 0.12, step: 0.07 }); },
    tenpai() { notes([1047, 1319], { type: "triangle", vol: 0.16, step: 0.08, len: 0.2 }); },
    hold(color) {
      const f = HOLD_FREQ[color] || 880;
      notes([f, f * 1.5, f * 2], { type: "triangle", vol: 0.16, step: 0.05, len: 0.18 });
      if (color === "gold" || color === "rainbow") notes([f * 2, f * 2.5, f * 3], { type: "sine", vol: 0.12, step: 0.06, len: 0.3 });
    },
    // 先バレ（保留入賞時の陰陽玉落下）。音を取り込んでいなければ落下音と同じ
    senbare(kind = "normal") { sfx.drop(kind); },
    // 役物投下ボタン。音を取り込んでいなければ落下音と同じ
    yakumono(kind = "normal") { sfx.drop(kind); },
    // 陰陽玉落下。通常音／低音／高音
    drop(kind = "normal") {
      if (kind === "low") {
        tone({ freq: 70, type: "sine", dur: 1.1, vol: 0.5, slide: 38 });
        noise({ dur: 0.5, vol: 0.35, type: "lowpass", freq: 300 });
      } else if (kind === "high") {
        tone({ freq: 2093, type: "triangle", dur: 0.9, vol: 0.22, slide: 3136 });
        tone({ freq: 2637, type: "sine", dur: 1.0, vol: 0.14, delay: 0.05 });
        noise({ dur: 0.3, vol: 0.18, type: "highpass", freq: 3000 });
      } else {
        noise({ dur: 0.35, vol: 0.4, type: "lowpass", freq: 900 });
        tone({ freq: 150, type: "triangle", dur: 0.45, vol: 0.35, slide: 60 });
        tone({ freq: 880, type: "square", dur: 0.08, vol: 0.06, delay: 0.02 });
      }
    },
    weakDrop() { noise({ dur: 0.2, vol: 0.2, type: "lowpass", freq: 700 }); tone({ freq: 220, type: "triangle", dur: 0.2, vol: 0.18, slide: 120 }); },
    prompt() { notes([1319, 0, 1319], { type: "square", vol: 0.1, step: 0.09, len: 0.07 }); },
    press() { tone({ freq: 1760, type: "square", dur: 0.06, vol: 0.12 }); },
    lever() { noise({ dur: 0.3, vol: 0.25, type: "bandpass", freq: 600, sweep: 3000, q: 2 }); },
    buru() {
      for (let i = 0; i < 6; i++) tone({ freq: 62, type: "sawtooth", dur: 0.06, vol: 0.25, delay: i * 0.07 });
    },
    whoosh() { noise({ dur: 0.45, vol: 0.22, type: "bandpass", freq: 400, sweep: 5000, q: 1.2 }); },
    card(color) {
      if (color === "gold" || color === "rainbow") notes([1047, 1319, 1568, 2093], { type: "triangle", vol: 0.14, step: 0.05, len: 0.25 });
      else if (color === "red") notes([880, 1109, 1319], { type: "square", vol: 0.1, step: 0.05 });
      else tone({ freq: 988, type: "triangle", dur: 0.15, vol: 0.12 });
    },
    // 大当り（キュイン）
    kyuin() {
      for (let i = 0; i < 3; i++) tone({ freq: 500, type: "square", dur: 0.28, vol: 0.12, slide: 2200, delay: i * 0.3 });
    },
    fanfare() {
      notes([523, 659, 784, 1047, 0, 784, 1047, 1319, 1568], { type: "square", vol: 0.12, step: 0.1, len: 0.16 });
      notes([262, 0, 0, 392, 0, 0, 523], { type: "triangle", vol: 0.18, step: 0.12, len: 0.3 });
    },
    round() { tone({ freq: 1568, type: "triangle", dur: 0.05, vol: 0.06 }); },
    payout() { tone({ freq: 2349, type: "sine", dur: 0.04, vol: 0.03 }); },
    rushIn() {
      notes([587, 740, 880, 1175, 880, 1175, 1480, 1760], { type: "square", vol: 0.12, step: 0.09, len: 0.14 });
      tone({ freq: 2349, type: "triangle", dur: 0.8, vol: 0.12, delay: 0.75 });
    },
    fail() { notes([659, 587, 523, 392], { type: "triangle", vol: 0.14, step: 0.16, len: 0.22 }); },
    impact() {
      tone({ freq: 55, type: "sine", dur: 1.3, vol: 0.6, slide: 30 });
      noise({ dur: 0.9, vol: 0.45, type: "lowpass", freq: 1600, sweep: 200 });
    },
    notice() { sfx.kyuin(); tone({ freq: 1760, type: "triangle", dur: 0.6, vol: 0.14, delay: 0.9 }); },
    laser() { tone({ freq: 3000, type: "sawtooth", dur: 0.3, vol: 0.06, slide: 400 }); },
    tick() { tone({ freq: 1200, type: "square", dur: 0.025, vol: 0.05 }); },
    freeze() { tone({ freq: 1760, type: "sine", dur: 1.2, vol: 0.12, slide: 220 }); },
    gap() { tone({ freq: 196, type: "sawtooth", dur: 0.9, vol: 0.08, slide: 98 }); noise({ dur: 0.9, vol: 0.12, type: "bandpass", freq: 300, sweep: 120 }); },
  };

  // 役物投下・先バレで選べる内蔵の音（すべてオリジナルの合成音）
  const PRESETS = {
    pokyun() {
      tone({ freq: 520, type: "square", dur: 0.08, vol: 0.14, slide: 1560 });
      tone({ freq: 1560, type: "sine", dur: 0.6, vol: 0.22, slide: 3120, delay: 0.07 });
      tone({ freq: 3120, type: "triangle", dur: 0.45, vol: 0.07, slide: 4680, delay: 0.09 });
    },
    kyuin() {
      tone({ freq: 220, type: "sawtooth", dur: 0.7, vol: 0.12, slide: 1760 });
      tone({ freq: 440, type: "square", dur: 0.7, vol: 0.07, slide: 3520 });
      tone({ freq: 1760, type: "sine", dur: 0.5, vol: 0.14, delay: 0.62 });
    },
    don() {
      tone({ freq: 120, type: "sine", dur: 1.0, vol: 0.6, slide: 36 });
      noise({ dur: 0.35, vol: 0.4, type: "lowpass", freq: 260 });
      tone({ freq: 60, type: "triangle", dur: 0.8, vol: 0.3, slide: 30, delay: 0.05 });
    },
    kiin() {
      [2637, 3951, 5274].forEach((f, i) => tone({ freq: f, type: "sine", dur: 1.5 - i * 0.35, vol: 0.13 / (i + 1), attack: 0.002 }));
      noise({ dur: 0.05, vol: 0.15, type: "highpass", freq: 6000 });
    },
    piron() { notes([1319, 1760, 2637, 3520], { type: "square", vol: 0.1, step: 0.07, len: 0.22 }); },
  };
  const presetOf = {};

  // 鳴らす順番：取り込んだ音（種類ごと → その場面）→ 選んだ内蔵の音 → 陰陽玉落下の取り込んだ音 → 標準の音
  function customChain(name, arg) {
    const kind = typeof arg === "string" ? arg : "";
    if (name === "senbare") return [`senbare:${kind}`, "senbare", "@senbare", `drop:${kind}`, "drop"];
    if (name === "yakumono") return ["yakumono", "@yakumono", `drop:${kind}`, "drop"];
    if (name === "drop") return [`drop:${kind}`, "drop"];
    return [name];
  }

  function playKey(key) {
    if (key[0] !== "@") return playCustom(key);
    const pr = PRESETS[presetOf[key.slice(1)]];
    if (!pr) return false;
    pr();
    return true;
  }

  function play(name, arg) {
    if (!ready() || !sfx[name]) return;
    try {
      for (const key of customChain(name, arg)) {
        // 取り込んだ音の読み込みが間に合っていなければ、読み込み終わりを待って鳴らす
        if (key[0] !== "@" && custom[key] && !custom[key].buffer) {
          decodeCustom(key).then(() => { try { if (!playCustom(key)) sfx[name](arg); } catch {} });
          return;
        }
        if (playKey(key)) return;
      }
      sfx[name](arg);
    } catch {}
  }

  // 取り込んだ音声（動画の音も可）を、頭の無音を詰めた最大8秒のモノラルWAVにする。読めない形式なら null
  async function convert(file) {
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OAC) return null;
    const RATE = 22050;
    let buf;
    try {
      const data = await file.arrayBuffer();
      const oc = new OAC(1, RATE, RATE);
      buf = await new Promise((resolve, reject) => {
        const p = oc.decodeAudioData(data, resolve, reject);
        if (p && p.catch) p.catch(reject);
      });
    } catch {
      return null;
    }
    if (!buf || !buf.length) return null;
    const rate = buf.sampleRate;
    const mono = new Float32Array(buf.length);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    let peak = 0;
    for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
    if (peak < 0.003) return null;
    let start = 0, end = mono.length;
    while (start < end && Math.abs(mono[start]) < peak * 0.02) start++;
    while (end > start && Math.abs(mono[end - 1]) < peak * 0.005) end--;
    start = Math.max(0, start - Math.round(rate * 0.005));
    end = Math.min(end, start + rate * 8);
    const n = end - start;
    const fade = Math.min(n, Math.round(rate * 0.02));
    const out = new ArrayBuffer(44 + n * 2);
    const v = new DataView(out);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      let x = mono[start + i] / peak * 0.9;
      if (i >= n - fade) x *= (n - i) / fade;
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 32767, true);
    }
    return { blob: new Blob([out], { type: "audio/wav" }), seconds: n / rate };
  }

  // ---- BGM（オリジナルの短いループ。都節音階） ----
  const D4 = 293.66, Eb4 = 311.13, G4 = 392, A4 = 440, Bb4 = 466.16, D5 = 587.33, Eb5 = 622.25, G5 = 783.99, A5 = 880;
  const THEMES = {
    normal: {
      bpm: 112,
      lead: [D5, 0, A4, Bb4, A4, 0, G4, 0, A4, Bb4, D5, 0, Eb5, D5, Bb4, A4, G4, 0, A4, 0, Bb4, A4, G4, Eb4, D4, 0, 0, 0, Eb4, G4, A4, 0],
      bass: [D4 / 2, 0, 0, 0, Bb4 / 4, 0, 0, 0, G4 / 4, 0, 0, 0, A4 / 4, 0, 0, 0],
      leadType: "triangle",
    },
    rush: {
      bpm: 150,
      lead: [D5, A5, G5, D5, Eb5, D5, A4, Bb4, D5, A5, G5, A5, Eb5 * 2, D5 * 2, A5, G5, D5, A5, G5, D5, Eb5, G5, A5, D5 * 2, A5, G5, Eb5, D5, A4, Bb4, A4, G4],
      bass: [D4 / 2, D4 / 2, D4, D4 / 2, Bb4 / 4, Bb4 / 4, Bb4 / 2, Bb4 / 4, G4 / 4, G4 / 4, G4 / 2, G4 / 4, A4 / 4, A4 / 4, A4 / 2, A4 / 4],
      leadType: "square",
    },
  };

  function schedule() {
    if (!ctx || !bgmOn || !enabled) return;
    const th = THEMES[bgmTheme] || THEMES.normal;
    const stepDur = 60 / th.bpm / 2;
    while (bgmNext < ctx.currentTime + 0.25) {
      const lf = th.lead[bgmStep % th.lead.length];
      const bf = th.bass[bgmStep % th.bass.length];
      const delay = Math.max(0, bgmNext - ctx.currentTime);
      if (lf) tone({ freq: lf, type: th.leadType, dur: stepDur * 0.9, vol: 0.08, delay, out: bgmGain });
      if (bf) tone({ freq: bf, type: "sine", dur: stepDur * 1.8, vol: 0.16, delay, out: bgmGain });
      bgmNext += stepDur;
      bgmStep++;
    }
  }

  function startBgm() {
    if (!ctx || bgmTimer) return;
    bgmNext = ctx.currentTime + 0.05;
    bgmTimer = setInterval(schedule, 100);
  }
  function stopBgm() {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }

  root.Sound = {
    unlock,
    play,
    setEnabled(v) { enabled = v; if (!v) stopBgm(); else if (bgmOn) startBgm(); },
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    setBgm(v) { bgmOn = v; if (v && enabled) startBgm(); else stopBgm(); },
    setCustom(name, blob) {
      if (blob) { custom[name] = { blob }; decodeCustom(name); }
      else delete custom[name];
    },
    // 試し聴き（設定がOFFでも鳴らす）
    // 試し聴き。slot は "drop:low" のような 名前:種類
    preview(slot) {
      unlock();
      if (!ctx) return;
      const [name, kind = "normal"] = slot.split(":");
      const keys = customChain(name, kind);
      const run = () => {
        try {
          for (const key of keys) if (playKey(key)) return;
          sfx[name](kind);
        } catch {}
      };
      Promise.all(keys.filter((k) => custom[k] && !custom[k].buffer).map(decodeCustom)).then(run);
    },
    convert,
    // 役物投下・先バレの内蔵の音を選ぶ（"std" は標準の音）
    setPreset(name, key) { presetOf[name] = key; },
    previewPreset(key) {
      unlock();
      if (!ctx) return;
      try { (PRESETS[key] || sfx.drop)("normal"); } catch {}
    },
    setTheme(name) { if (bgmTheme !== name) { bgmTheme = name; bgmStep = 0; } },
  };
})(this);
