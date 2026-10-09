// 液晶と役物の描画。engine.js が作った演出ステップを順番に再生する。
(function (root) {
  const D = root.GENSOU_DATA;
  const h = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const rand = (n) => Math.floor(Math.random() * n);

  // ---------------- 紋（キャラのエンブレム） ----------------

  const KANJI = {
    sakuya: "時", remilia: "紅", flandre: "禁", patchouli: "書", meiling: "龍", cirno: "氷",
    rumia: "闇", youmu: "魂", yuyuko: "蝶", yukari: "隙", sanae: "風", aya: "文",
  };

  function yinyangSVG(red = "#e8313f") {
    return `<svg viewBox="-52 -52 104 104" aria-hidden="true">
      <circle r="50" fill="#fffaf2" stroke="#1d1a28" stroke-width="2.5"/>
      <path d="M0,-50 A50,50 0 0,1 0,50 A25,25 0 0,1 0,0 A25,25 0 0,0 0,-50 Z" fill="${red}"/>
      <circle cy="-25" r="8" fill="${red}"/><circle cy="25" r="8" fill="#fffaf2"/>
      <circle r="50" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1"/>
    </svg>`;
  }

  function starSVG(fill, stroke) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 22 : 50;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      pts.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`);
    }
    return `<svg viewBox="-52 -52 104 104" aria-hidden="true"><polygon points="${pts.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/></svg>`;
  }

  function crestSVG(key) {
    const c = D.CHARS[key];
    if (!c) return "";
    if (c.emblem === "yinyang") return yinyangSVG(c.color);
    if (c.emblem === "star") return starSVG(c.color, c.sub);
    return `<svg viewBox="-52 -52 104 104" aria-hidden="true">
      <circle r="48" fill="${c.sub}" fill-opacity=".14" stroke="${c.color}" stroke-width="5"/>
      <circle r="40" fill="none" stroke="${c.color}" stroke-width="1.5" stroke-dasharray="3 4"/>
      <text y="17" text-anchor="middle" font-size="50" font-family="Yuji Syuku, Hiragino Mincho ProN, serif" fill="${c.color}">${KANJI[key] || ""}</text>
    </svg>`;
  }

  // 取り込んだ立ち絵があればそれを、なければ紋を使う
  const art = (key) => (root.GensouAssets && key ? root.GensouAssets.url(`chara:${key}`) : null);
  const crest = (key, cls = "crest") => {
    if (!key) return "";
    const u = art(key);
    return u ? `<span class="${cls} portrait"><img src="${u}" alt=""></span>` : `<span class="${cls}">${crestSVG(key)}</span>`;
  };
  function bigArt(key) {
    const u = art(key);
    if (!u) return h("div", "big-crest", crestSVG(key));
    return h("div", "tachie", `<img src="${u}" alt="">`);
  }

  // ---------------- 弾幕エフェクト（canvas） ----------------

  class FX {
    constructor(canvas) {
      this.c = canvas;
      this.g = canvas.getContext("2d");
      this.parts = [];
      this.mode = "idle";
      this.color = "#ff5a7a";
      this.tone = "shrine";
      this.acc = 0;
      this.angle = 0;
      this.last = performance.now();
      this.reduced = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.resize();
      root.addEventListener("resize", () => this.resize());
      const loop = (t) => {
        this.frame(Math.min(0.05, (t - this.last) / 1000));
        this.last = t;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    resize() {
      const r = this.c.getBoundingClientRect();
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      this.w = r.width || 300;
      this.hgt = r.height || 400;
      this.c.width = Math.round(this.w * dpr);
      this.c.height = Math.round(this.hgt * dpr);
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    setMode(mode, color) {
      this.mode = mode;
      if (color) this.color = color;
    }
    spawnBullet(x, y, a, sp, color, r = 3.2) {
      this.parts.push({ k: "b", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r, color, life: 6 });
    }
    burst(color, n = 36, x = this.w / 2, y = this.hgt * 0.4) {
      for (let i = 0; i < n; i++) this.spawnBullet(x, y, (Math.PI * 2 * i) / n, 140 + Math.random() * 60, color, 3.6);
    }
    kedama(n, y = this.hgt * 0.9) {
      for (let i = 0; i < n; i++) {
        this.parts.push({ k: "kedama", x: -20 - i * 22, y: y + (Math.random() - 0.5) * 20, vx: 110 + Math.random() * 40, vy: 0, r: 7 + Math.random() * 3, color: "#fff", life: 6, ph: Math.random() * 6 });
      }
    }
    bats(color, n = 8, y = this.hgt * 0.88) {
      for (let i = 0; i < n; i++) {
        this.parts.push({ k: "bat", x: this.w + 20 + i * 18, y: y + (Math.random() - 0.5) * 30, vx: -150 - Math.random() * 40, vy: 0, r: 7, color, life: 6, ph: Math.random() * 6 });
      }
    }
    frame(dt) {
      const { g, w, hgt } = this;
      const density = this.reduced ? 0.3 : 1;
      this.acc += dt;
      this.angle += dt * 1.7;

      // モードごとの発生
      if (this.mode === "idle") {
        if (Math.random() < dt * 5 * density) {
          const petal = this.tone !== "koumakan";
          this.parts.push({ k: petal ? "petal" : "spark", x: Math.random() * w, y: -10, vx: (Math.random() - 0.5) * 20, vy: 18 + Math.random() * 20, r: 3 + Math.random() * 2, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 3, color: petal ? "#ffc4dc" : "#ff6b6b", life: 30 });
        }
      } else if (this.mode === "reach" || this.mode === "zone") {
        const every = this.mode === "zone" ? 0.05 : 0.11;
        while (this.acc > every) {
          this.acc -= every;
          const arms = this.mode === "zone" ? 7 : 5;
          for (let i = 0; i < arms * density; i++) {
            const a = this.angle + (Math.PI * 2 * i) / arms;
            this.spawnBullet(w / 2, hgt * 0.36, a, 90, this.color);
            if (this.mode === "zone") this.spawnBullet(w / 2, hgt * 0.36, -a, 120, "#ffffff", 2.4);
          }
        }
      } else if (this.mode === "rush") {
        while (this.acc > 0.09) {
          this.acc -= 0.09;
          const hue = (performance.now() / 20) % 360;
          this.spawnBullet(Math.random() * w, hgt + 6, -Math.PI / 2 + (Math.random() - 0.5) * 0.5, 120 + Math.random() * 80, `hsl(${hue},90%,65%)`, 2.6);
        }
      } else if (this.mode === "bonus") {
        while (this.acc > 0.04) {
          this.acc -= 0.04;
          this.parts.push({ k: "spark", x: w / 2 + (Math.random() - 0.5) * w * 0.6, y: hgt + 4, vx: (Math.random() - 0.5) * 80, vy: -220 - Math.random() * 160, r: 2 + Math.random() * 2, color: Math.random() < 0.5 ? "#ffd257" : "#fff3c4", life: 3, grav: 160 });
        }
      } else {
        this.acc = 0;
      }

      g.clearRect(0, 0, w, hgt);
      const keep = [];
      for (const p of this.parts) {
        p.life -= dt;
        if (p.grav) p.vy += p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.life <= 0 || p.x < -60 || p.x > w + 60 || p.y < -60 || p.y > hgt + 60) continue;
        keep.push(p);
        if (p.k === "b") {
          g.globalAlpha = 0.35;
          g.fillStyle = p.color;
          g.beginPath(); g.arc(p.x, p.y, p.r * 2, 0, 7); g.fill();
          g.globalAlpha = 1;
          g.fillStyle = "#fff";
          g.beginPath(); g.arc(p.x, p.y, p.r * 0.75, 0, 7); g.fill();
        } else if (p.k === "petal") {
          p.rot += p.vr * dt;
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
          g.globalAlpha = 0.85; g.fillStyle = p.color;
          g.beginPath(); g.ellipse(0, 0, p.r * 1.4, p.r * 0.8, 0, 0, 7); g.fill();
          g.restore();
        } else if (p.k === "spark") {
          g.globalAlpha = Math.min(1, p.life);
          g.fillStyle = p.color;
          g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill();
          g.globalAlpha = 1;
        } else if (p.k === "kedama") {
          p.ph += dt * 12;
          const yy = p.y + Math.sin(p.ph) * 3;
          g.fillStyle = "#fff";
          g.beginPath();
          for (let i = 0; i < 12; i++) {
            const a = (Math.PI * 2 * i) / 12;
            const rr = p.r * (i % 2 ? 0.75 : 1.15);
            g.lineTo(p.x + Math.cos(a) * rr, yy + Math.sin(a) * rr);
          }
          g.fill();
          g.fillStyle = "#222";
          g.beginPath(); g.arc(p.x + 2, yy - 1, 1.6, 0, 7); g.arc(p.x - 2, yy - 1, 1.6, 0, 7); g.fill();
        } else if (p.k === "bat") {
          p.ph += dt * 18;
          const flap = Math.sin(p.ph) * 5;
          g.fillStyle = p.color;
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - 9, p.y - 4 - flap);
          g.lineTo(p.x - 5, p.y);
          g.lineTo(p.x, p.y + 2);
          g.lineTo(p.x + 5, p.y);
          g.lineTo(p.x + 9, p.y - 4 - flap);
          g.closePath();
          g.fill();
        }
      }
      this.parts = keep.length > 900 ? keep.slice(-900) : keep;
    }
  }

  // ---------------- リール ----------------

  const CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  function cellHTML(d) {
    const key = D.DIGIT_CHARS[d];
    const c = D.CHARS[key];
    const u = art(key);
    const back = u ? `<img class="cell-art" src="${u}" alt="">` : crest(key);
    return `<div class="cell" style="--cc:${c.color}">${back}<div class="num">${d}</div><div class="name">${c.short}</div></div>`;
  }

  class Reels {
    constructor(root) {
      this.root = root;
      this.reels = [];
      this.digits = [7, 3, 5];
      const stripHTML = [...CELLS, ...CELLS, ...CELLS].map(cellHTML).join("");
      for (let i = 0; i < 3; i++) {
        const reel = h("div", "reel");
        const strip = h("div", "strip", stripHTML);
        const over = h("div", "cell over", "");
        over.style.position = "absolute";
        over.style.inset = "0";
        over.hidden = true;
        reel.append(strip, over);
        root.append(reel);
        this.reels.push({ reel, strip, over });
      }
      this.measure();
      root.ownerDocument.defaultView.addEventListener("resize", () => this.measure());
      this.digits.forEach((d, i) => this.place(i, d, false));
    }
    // 立ち絵を差し替えたときに図柄を作り直す
    refresh() {
      const stripHTML = [...CELLS, ...CELLS, ...CELLS].map(cellHTML).join("");
      for (const r of this.reels) r.strip.innerHTML = stripHTML;
    }
    measure() {
      const r = this.reels[0].reel.getBoundingClientRect();
      this.root.style.setProperty("--cell-h", `${Math.max(40, r.height)}px`);
    }
    place(i, d, bounce = true) {
      const { strip } = this.reels[i];
      const idx = 9 + d - 1;
      const target = (-idx * 100) / 27;
      strip.style.transition = "none";
      strip.style.transform = `translateY(${bounce ? target - 1.2 : target}%)`;
      if (bounce) {
        void strip.offsetWidth;
        strip.style.transition = "transform 0.22s cubic-bezier(0.3, 1.8, 0.5, 1)";
        strip.style.transform = `translateY(${target}%)`;
      }
    }
    spin(i, slow = false) {
      const r = this.reels[i];
      r.over.hidden = true;
      r.strip.hidden = false;
      r.strip.style.transition = "none";
      r.strip.style.transform = "";
      r.reel.classList.add("spinning");
      r.reel.classList.toggle("slow", slow);
    }
    spinAll() { for (let i = 0; i < 3; i++) this.spin(i); }
    isSpinning(i) { return this.reels[i].reel.classList.contains("spinning"); }
    stop(i, d) {
      const r = this.reels[i];
      r.reel.classList.remove("spinning", "slow", "shake");
      if (typeof d === "number") {
        r.over.hidden = true;
        r.strip.hidden = false;
        this.place(i, d);
        this.digits[i] = d;
      } else {
        this.special(i, d);
      }
    }
    special(i, kind) {
      const r = this.reels[i];
      r.reel.classList.remove("spinning", "slow");
      r.strip.hidden = true;
      r.over.hidden = false;
      if (kind === "C") {
        r.over.className = "cell over charge";
        r.over.style.setProperty("--cc", "#f3c252");
        r.over.innerHTML = `${crest("reimu")}<div class="num">霊力<br>チャージ</div>`;
      } else {
        r.over.className = "cell over next";
        r.over.style.setProperty("--cc", "#9a5ef0");
        r.over.innerHTML = `${crest("yukari")}<div class="num">続</div>`;
      }
    }
    mark(cls, idxs, on = true) {
      for (const i of idxs) this.reels[i].reel.classList.toggle(cls, on);
    }
    clearMarks() {
      for (const r of this.reels) r.reel.classList.remove("tenpai", "hit", "shake");
    }
  }

  // ---------------- 背景 ----------------

  const BG_ART = {
    shrine: `<svg viewBox="0 0 300 120" preserveAspectRatio="xMidYMax slice"><g fill="#0b0920">
      <rect x="0" y="100" width="300" height="20"/>
      <rect x="80" y="40" width="140" height="10" rx="3"/><rect x="70" y="34" width="160" height="7" rx="3"/>
      <rect x="92" y="58" width="116" height="6"/><rect x="100" y="40" width="9" height="62"/><rect x="191" y="40" width="9" height="62"/>
      <path d="M0 100 Q40 70 70 100 Z M230 100 Q270 64 300 100 Z"/></g></svg>`,
    koumakan: `<svg viewBox="0 0 300 120" preserveAspectRatio="xMidYMax slice"><g fill="#1a0308">
      <rect x="0" y="96" width="300" height="24"/><rect x="40" y="62" width="220" height="40"/>
      <rect x="128" y="30" width="44" height="40"/><path d="M122 32 L150 6 L178 32 Z"/>
      <circle cx="150" cy="44" r="9" fill="#ffd257" opacity=".8"/>
      <rect x="52" y="70" width="10" height="14" fill="#ff9a3c" opacity=".6"/><rect x="238" y="70" width="10" height="14" fill="#ff9a3c" opacity=".6"/></g></svg>`,
    meikai: `<svg viewBox="0 0 300 120" preserveAspectRatio="xMidYMax slice"><g fill="#2a1c40">
      <rect x="0" y="104" width="300" height="16"/>
      <path d="M40 104 L46 60 L52 104 Z M250 104 L256 56 L262 104 Z"/>
      <circle cx="46" cy="56" r="26" fill="#f6b6d6" opacity=".55"/><circle cx="256" cy="52" r="30" fill="#f6b6d6" opacity=".55"/>
      <rect x="0" y="96" width="300" height="3" fill="#fff" opacity=".2"/></g></svg>`,
    rush: "",
    bonus: "",
  };

  // ---------------- ステージ本体 ----------------

  const TONE_COLOR = { white: "#ffffff", blue: "#59a9ff", green: "#4fd88f", purple: "#bb80ff", red: "#ff3b52", gold: "#ffd257", rainbow: "#ff7ad9" };

  function createStage(el, handlers = {}) {
    const stage = el;
    stage.innerHTML = `
      <div class="bg shrine"></div>
      <canvas class="fx"></canvas>
      <div class="sakura-yaku" aria-hidden="true">${sakuraSVG()}</div>
      <div class="reels"></div>
      <div class="layer"></div>
      <div class="yinyang" aria-hidden="true">${yinyangSVG()}</div>
      <div class="logo">弾幕録</div>
      <div class="status"><span class="chip mode">通常</span></div>
      <div class="right-shoot" hidden>右打ち ▶▶</div>
      <div class="holds"></div>
      <div class="flash"></div>`;
    const q = (s) => stage.querySelector(s);
    const bg = q(".bg");
    const layer = q(".layer");
    const yinyang = q(".yinyang");
    const sakura = q(".sakura-yaku");
    const logo = q(".logo");
    const status = q(".status");
    const holdsEl = q(".holds");
    const flashEl = q(".flash");
    const rightShoot = q(".right-shoot");
    const fx = new FX(q(".fx"));
    const reels = new Reels(q(".reels"));
    if (root.ResizeObserver) new ResizeObserver(() => { fx.resize(); reels.measure(); }).observe(stage);

    let speed = 1;
    let autoPush = false;
    let pending = null;
    let baseMode = "normal";
    let baseTone = "shrine";
    let persist = [];
    let activeHoldEl = null;
    let uraWindow = null;

    // 再生速度をかけて待つ。名目の時間は打ち出し計算のためにアプリへ知らせる。
    function wait(ms) {
      handlers.onTime && handlers.onTime(ms);
      return new Promise((r) => setTimeout(r, ms * speed));
    }
    const sfx = (name, arg) => root.Sound && root.Sound.play(name, arg);

    function setBg(tone) {
      bg.className = `bg ${tone}`;
      const u = root.GensouAssets && root.GensouAssets.url(`bg:${tone}`);
      bg.style.backgroundImage = u ? `linear-gradient(rgba(10,8,22,.25), rgba(10,8,22,.45)), url("${u}")` : "";
      bg.innerHTML = u ? "" : BG_ART[tone] || "";
      fx.tone = tone;
    }

    function flash(cls = "") {
      flashEl.className = `flash ${cls}`;
      void flashEl.offsetWidth;
      flashEl.className = `flash ${cls} go`;
    }
    function quake() {
      stage.classList.remove("quake");
      void stage.offsetWidth;
      stage.classList.add("quake");
      setTimeout(() => stage.classList.remove("quake"), 700);
    }

    function add(node, keep = false) {
      layer.append(node);
      if (keep) persist.push(node);
      return node;
    }
    const tone = (color) => `tone-${color || "white"}`;

    function dropYinyang(kind = "normal", { weak = false, early = false, sound = null } = {}) {
      yinyang.classList.remove("drop", "drop-weak", "drop-early");
      void yinyang.offsetWidth;
      yinyang.classList.add(weak ? "drop-weak" : "drop");
      if (early) yinyang.classList.add("drop-early");
      sfx(sound || (weak ? "weakDrop" : "drop"), kind);
      if (!weak) {
        setTimeout(quake, 280 * speed);
        handlers.onVibrate && handlers.onVibrate(kind === "normal" ? [60, 40, 60] : [200, 60, 200]);
      }
      setTimeout(() => yinyang.classList.remove("drop", "drop-weak", "drop-early"), 1100);
    }

    // ---- 入力待ち（PUSH・八卦炉レバー・連打） ----

    function waitInput(kind, { count = 1, autoMs = 3200 } = {}) {
      return new Promise((resolve) => {
        const prompt = h("div", "prompt");
        const label = kind === "lever" ? `八卦炉<small>レバーを引け</small>` : kind === "renda" ? `連打<small>PUSH</small>` : `PUSH`;
        prompt.innerHTML = `<div class="orb ${kind === "lever" ? "lever" : ""}">${label}</div>${kind === "renda" ? `<div class="count">0 / ${count}</div>` : ""}`;
        stage.append(prompt);
        sfx("prompt");
        handlers.onPrompt && handlers.onPrompt(kind);
        let timer = null;
        let autoTimer = null;
        const finish = (byUser) => {
          if (!pending) return;
          pending = null;
          clearTimeout(timer);
          clearInterval(autoTimer);
          prompt.remove();
          handlers.onPrompt && handlers.onPrompt(null);
          sfx(kind === "lever" ? "lever" : "press");
          resolve(byUser);
        };
        pending = {
          kind,
          got: 0,
          press(src) {
            if (kind === "lever" && src === "button") return false;
            if (kind !== "lever" && src === "lever") return false;
            this.got++;
            if (kind === "renda") {
              sfx("press");
              prompt.querySelector(".count").textContent = `${this.got} / ${count}`;
              if (this.got < count) return true;
            }
            finish(true);
            return true;
          },
        };
        prompt.addEventListener("click", () => pending && pending.press(kind === "lever" ? "lever" : "button"));
        const idle = autoPush ? 450 : autoMs;
        timer = setTimeout(() => {
          if (kind === "renda") {
            autoTimer = setInterval(() => pending && pending.press("button"), 45);
          } else finish(false);
        }, idle * speed);
      });
    }

    function input(src) {
      if (pending) return pending.press(src);
      if (uraWindow && src === "button") {
        const w = uraWindow;
        uraWindow = null;
        w(src);
        return true;
      }
      return false;
    }

    // ---- 保留表示 ----

    function holdClass(hold, active) {
      if (!hold) return "hold empty";
      const c = hold.shown ? ` c-${hold.shown}` : "";
      return `hold${active ? " active" : ""}${c}`;
    }

    function renderHolds(active, list) {
      holdsEl.innerHTML = "";
      activeHoldEl = h("div", holdClass(active, true));
      if (!active) activeHoldEl.className = "hold active empty";
      holdsEl.append(activeHoldEl);
      for (let i = 0; i < D.SPEC.holdMax; i++) holdsEl.append(h("div", holdClass(list[i], false)));
    }

    function setActiveColor(color) {
      handlers.onActiveColor && handlers.onActiveColor(color);
      if (!activeHoldEl) return;
      activeHoldEl.className = `hold active c-${color}`;
      void activeHoldEl.offsetWidth;
      activeHoldEl.classList.add("pop");
    }

    // 保留入賞時の演出（先読み・先バレ）。変動の再生とは並行して動く。
    function entry(index, hold) {
      const node = holdsEl.children[index + 1];
      if (hold.preread) {
        for (const pr of hold.preread) {
          if (pr.group === "kedama") fx.kedama(pr.id === "many" ? 14 : 4);
          else if (pr.group === "batSaki") fx.bats(pr.id === "red" ? "#ff2a4a" : "#2a2a3a", pr.id === "red" ? 14 : 7);
          else if (pr.group === "sukimaSaki") {
            const gap = add(h("div", "sukima", `<i class="ribbon" style="left:12%"></i><i class="ribbon" style="right:12%"></i>`));
            gap.style.top = "auto";
            gap.style.bottom = "4%";
            gap.style.height = pr.id === "strong" ? "16%" : "9%";
            sfx("gap");
            setTimeout(() => gap.remove(), 1300);
          }
          handlers.onLog && handlers.onLog(pr.info);
        }
      }
      if (hold.shown && node) {
        setTimeout(() => {
          node.classList.add("pop");
          sfx("hold", hold.shown);
        }, hold.preread && hold.preread.length ? 600 : 0);
        if (hold.colorInfo) handlers.onLog && handlers.onLog(hold.colorInfo);
      }
      if (hold.notice) {
        flash("red");
        const n = add(h("div", "notice tone-red", "フラン襲来"));
        sfx("notice");
        setTimeout(() => n.remove(), 1200);
      }
      if (hold.senbare) {
        dropYinyang(hold.senbare.sound, { sound: "senbare" });
        flash();
        handlers.onLog && handlers.onLog(hold.senbare.info);
        // 落下後しばらくPUSHで裏ボタン
        handlers.onUra && handlers.onUra(true);
        const close = setTimeout(() => {
          if (uraWindow) { uraWindow = null; handlers.onUra && handlers.onUra(false); }
        }, 2600 * Math.max(speed, 0.5));
        uraWindow = () => {
          clearTimeout(close);
          handlers.onUra && handlers.onUra(false);
          sfx("press");
          if (hold.ura) {
            flash("red");
            handlers.onVibrate && handlers.onVibrate([300, 80, 300]);
            const n = add(h("div", "card tone-red", `${crest("reimu")}<div class="t">裏ボタン</div><div class="m">この異変、本気で行くわよ</div>`));
            n.style.top = "62%";
            sfx("card", "red");
            handlers.onLog && handlers.onLog({ group: "先バレ後の裏ボタン", label: "赤バイブ＋霊夢のセリフ", rel: 1 });
            setTimeout(() => n.remove(), 1800);
          }
        };
      }
    }

    // ---- 1変動の後片付け ----

    function clearSpin() {
      for (const n of persist) n.remove();
      persist = [];
      layer.innerHTML = "";
      stage.querySelectorAll(".telop, .edge, .serif").forEach((n) => n.remove());
      stage.classList.remove("mono", "freeze");
      yinyang.classList.remove("lamp");
      sakura.classList.remove("bloom");
      reels.clearMarks();
      q(".reels").classList.remove("dim");
      fx.setMode(baseMode === "rush" ? "rush" : "idle");
      if (bg.classList[1] !== baseTone) setBg(baseTone);
    }

    function setTelop(text, color) {
      stage.querySelectorAll(".telop").forEach((n) => n.remove());
      const t = h("div", `telop ${tone(color)}`, text);
      stage.append(t);
      persist.push(t);
    }

    // ---- ステップごとの演出 ----

    const RUN = {
      async holdChange(st) {
        setActiveColor(st.color);
        sfx("hold", st.color);
        await wait(650);
      },
      async sealBreak(st) {
        await wait(300);
        setActiveColor(st.color);
        flash("gold");
        sfx("hold", "gold");
        await wait(900);
      },
      async impact() {
        flash();
        quake();
        sfx("impact");
        handlers.onVibrate && handlers.onVibrate([400]);
        const n = add(h("div", "notice tone-rainbow", `<div class="m rainbow-text">IMPACT</div>`));
        await wait(1400);
        n.remove();
      },
      async leverBuru(st) {
        handlers.onBuru && handlers.onBuru(st.color);
        handlers.onVibrate && handlers.onVibrate([80, 40, 80, 40, 80]);
        sfx("buru");
        const e = h("div", `edge ${tone(st.color)}`);
        stage.append(e);
        await wait(1000);
        e.remove();
      },
      async logo(st) {
        logo.className = `logo flash-${st.color === "red" ? "red" : "white"}`;
        sfx("card", st.color);
        await wait(550);
        logo.className = "logo";
      },
      async sakura(st) {
        sakura.classList.add("bloom");
        sfx("card", "red");
        if (st.drop) setTimeout(() => dropYinyang("normal", { weak: true }), 250 * speed);
        if (st.text) setTelop(st.text, st.id === "strong" ? "red" : "white");
        await wait(1300);
      },
      async giji(st) {
        for (let i = 1; i < st.n; i++) {
          if (!reels.isSpinning(0)) reels.spinAll();
          sfx("start");
          await wait(650);
          reels.stop(0, 1 + rand(9));
          await wait(160);
          reels.stop(2, 1 + rand(9));
          await wait(160);
          reels.special(1, "next");
          sfx("card", i === st.n - 1 ? "red" : "white");
          const chip = add(h("div", "notice tone-purple", `<div>×${i + 1}</div>`));
          chip.style.fontSize = "14cqw";
          if (st.reimu && i === 1) {
            flash("red");
            const r = add(h("div", "card tone-red", `${crest("reimu")}<div class="t">連続予告</div><div class="m">霊夢 出現</div>`));
            setTimeout(() => r.remove(), 900);
          }
          if (st.yukari && i === st.n - 1) {
            add(h("div", "sukima", `<i class="ribbon" style="left:14%"></i><i class="ribbon" style="right:14%"></i>`));
            sfx("gap");
          }
          await wait(700);
          chip.remove();
          layer.querySelectorAll(".sukima").forEach((n) => n.remove());
          reels.spinAll();
        }
      },
      // キャラのセリフ（下側のセリフ枠に1文字ずつ出す）
      async serif(st) {
        stage.querySelectorAll(".serif").forEach((n) => n.remove());
        const c = D.CHARS[st.char];
        const box = h("div", `serif ${tone(st.color)}`, `${crest(st.char, "crest face")}<div class="body"><div class="who" style="color:${c ? c.color : "#fff"}">${c ? c.name : ""}</div><div class="txt"></div></div>`);
        stage.append(box);
        const txt = box.querySelector(".txt");
        const chars = [...st.text];
        let i = 0;
        const timer = setInterval(() => {
          i += 1;
          txt.textContent = chars.slice(0, i).join("");
          if (i >= chars.length) clearInterval(timer);
        }, 38 * speed);
        if (st.color !== "white") sfx("card", st.color);
        else sfx("tick");
        await wait(700 + chars.length * 60);
        clearInterval(timer);
        box.remove();
      },
      async card(st) {
        const main = st.text || st.title;
        const n = add(h("div", `card ${tone(st.color)}`, `${crest(st.char)}${st.text ? `<div class="t">${st.title || ""}</div>` : ""}<div class="m">${main}</div>`));
        sfx("card", st.color);
        await wait(1300);
        n.remove();
      },
      async su(st) {
        const box = add(h("div", "su"));
        const labels = ["予兆", "スペルカード", "宣言", D.CHARS[st.char].spell];
        for (let i = 0; i < st.step; i++) {
          const last = i === st.step - 1;
          const color = last ? st.color : i >= 2 ? "red" : "white";
          const row = h("div", `step ${tone(color)}`, `${last ? crest(st.char) : ""}<span>${last ? `${D.CHARS[st.char].short} ${D.CHARS[st.char].spell}` : labels[i]}</span>`);
          box.append(row);
          sfx(last ? "card" : "tick", color);
          await wait(last ? 950 : 380);
        }
        box.remove();
      },
      async tokitome(st) {
        stage.classList.add("freeze");
        const c = add(h("div", `clock-fx ${tone(st.color)}`));
        sfx("freeze");
        const t = add(h("div", `card ${tone(st.color)}`, `${crest("sakuya")}<div class="t">時止め</div><div class="m">そして時は動き出す</div>`));
        t.style.top = "66%";
        await wait(1500);
        c.remove();
        t.remove();
        stage.classList.remove("freeze");
      },
      async mono(st) {
        stage.classList.add("mono");
        const n = add(h("div", `card ${tone(st.color)}`, `<div class="t">モノクロの異変</div><div class="m">${st.color === "red" ? "色が…消えていく" : "……？"}</div>`));
        sfx("gap");
        await wait(1400);
        n.remove();
        stage.classList.remove("mono");
      },
      async bg(st) {
        setBg(st.bg);
        sfx("whoosh");
        const n = add(h("div", "card tone-white", `<div class="t">背景移行</div><div class="m">${D.STAGES[st.bg].name}</div>`));
        n.style.top = "8%";
        await wait(900);
        n.remove();
      },
      async hand(st) {
        const early = st.timing === "early" || st.timing === "veryEarly";
        if (st.timing === "veryEarly") await wait(50);
        else if (st.timing === "early") await wait(150);
        else if (st.timing === "normal") await wait(400);
        dropYinyang(st.sound || "normal", { early });
        if (st.notice) {
          const n = add(h("div", "notice tone-gold", st.notice));
          setTimeout(() => n.remove(), 1300 * speed);
          flash("gold");
        }
        await wait(early ? 900 : 1250);
      },
      async lamp() {
        yinyang.classList.add("lamp");
        sfx("tick");
        await wait(700);
      },
      async reels(st, opts) {
        if (!reels.isSpinning(0)) {
          reels.spinAll();
          sfx("start");
        }
        // 「実機」スピードでは、保留が少ないほど長く、3個以上で短縮変動になる
        const base = opts.real
          ? opts.rush || st.quick ? 1100 : opts.holds >= 3 ? 2400 : opts.holds === 2 ? 4500 : 7000
          : st.quick ? 350 : opts.short ? 520 : 900;
        await wait(base);
        reels.stop(0, st.digits[0]);
        sfx("stop");
        await wait(st.quick ? 120 : 220);
        reels.stop(2, st.digits[2]);
        sfx("stop");
        if (st.reach) {
          reels.mark("tenpai", [0, 2]);
          reels.spin(1, true);
          sfx("reach");
          const n = add(h("div", "notice tone-red", "リーチ"));
          n.style.fontSize = "13cqw";
          await wait(750);
          n.remove();
          fx.setMode("reach", D.CHARS[D.DIGIT_CHARS[st.digits[0]]].color);
        } else {
          await wait(st.quick ? 80 : 160);
        }
      },
      async kyouki(st) {
        if (!reels.isSpinning(0)) reels.spinAll();
        const n = add(h("div", "card tone-red", `${crest("flandre")}<div class="t">495年の狂気</div><div class="m">ねえ、壊していい？</div>`));
        n.style.top = "62%";
        sfx("gap");
        await wait(700);
        reels.reels[2].reel.classList.add("shake");
        await wait(1100);
        reels.reels[2].reel.classList.remove("shake");
        if (st.success) {
          flash("red");
          sfx("card", "red");
        } else {
          sfx("fail");
        }
        n.remove();
        await wait(300);
      },
      async cirno(st) {
        const n = add(h("div", `roulette ${tone(st.color)}`, `<div class="t">チルノルーレット</div><div class="m">1</div>`));
        if (st.color === "red") n.style.borderColor = "var(--c-red)";
        const m = n.querySelector(".m");
        for (let i = 0; i < 16; i++) {
          m.textContent = String(1 + ((i * 7) % 9));
          sfx("tick");
          await wait(70 + i * 6);
        }
        m.textContent = "⑨";
        sfx("card", st.color);
        await wait(700);
        m.textContent = "発展！";
        await wait(500);
        n.remove();
      },
      async zone(st) {
        fx.setMode("zone", "#62cdf5");
        const n = add(h("div", "notice tone-blue", "弾幕ZONE"));
        sfx("whoosh");
        await wait(900);
        n.remove();
        await waitInput(st.device === "lever" ? "lever" : "button");
        flash();
        await wait(400);
      },
      async reach(st) {
        const color = TONE_COLOR[st.color] || "#fff";
        fx.setMode("reach", st.char ? D.CHARS[st.char].color : color);
        layer.querySelectorAll(".reach-title, .big-crest, .tachie").forEach((n) => n.remove());
        if (st.char) add(bigArt(st.char), true);
        const kind = st.kind === "normal" ? "" : st.label.split(" ")[0];
        const main = st.label.includes(" ") ? st.label.slice(st.label.indexOf(" ") + 1) : st.label;
        add(h("div", `reach-title ${tone(st.color)}`, `<div class="k">${kind}</div><div class="m">${main}</div>`), true);
        sfx("whoosh");
        sfx("card", st.color);
        await wait(1700);
      },
      async telop(st) {
        setTelop(st.text, st.color);
        sfx("card", st.color);
        await wait(1300);
      },
      async declare(st) {
        const n = add(h("div", `card ${tone(st.color)}`, `<div class="t">スペル宣言</div><div class="m">${st.text}</div>`));
        n.style.top = "40%";
        flash(st.color === "gold" ? "gold" : st.color === "red" ? "red" : "");
        sfx("card", st.color);
        await wait(1500);
        n.remove();
      },
      async cutin(st) {
        const n = add(h("div", `cutin ${tone(st.color)}`, `${crest("reimu")}<div class="m">${st.text}</div>`));
        sfx("whoosh");
        sfx("card", st.color);
        await wait(1300);
        n.remove();
      },
      async device(st) {
        if (st.handAt === "deviceAppear") setTimeout(() => dropYinyang("high"), 350 * speed);
        await waitInput(st.device);
        if (st.handAt === "deviceOperate") dropYinyang("high");
        if (st.handInfo && st.handAt) handlers.onLog && handlers.onLog(st.handInfo);
        flash();
        await wait(st.handAt ? 900 : 350);
      },
      async fakeEnd() {
        const d = reels.digits[0];
        reels.stop(1, (d % 9) + 1);
        sfx("fail");
        q(".reels").classList.add("dim");
        stage.querySelectorAll(".telop").forEach((n) => n.remove());
        await wait(1300);
        q(".reels").classList.remove("dim");
        reels.spin(1, true);
      },
      async sukima(st) {
        add(h("div", "sukima", `<i class="ribbon" style="left:12%"></i><i class="ribbon" style="right:12%"></i>`));
        const n = add(h("div", "card tone-purple", `${crest("yukari")}<div class="t">スキマ</div><div class="m">${st.text}</div>`));
        n.style.top = "62%";
        sfx("gap");
        await wait(1400);
        layer.querySelectorAll(".sukima").forEach((x) => x.remove());
        n.remove();
      },
      async zenkaiten() {
        reels.spinAll();
        sfx("whoosh");
        const n = add(h("div", "notice tone-gold", "全回転"), true);
        n.style.alignItems = "start";
        n.style.paddingTop = "6%";
        await wait(900);
        for (let d = 1; d <= 7; d++) {
          for (let i = 0; i < 3; i++) reels.stop(i, d);
          sfx("tick");
          await wait(d === 7 ? 600 : 260);
        }
      },
      async bundan(st) {
        for (let i = 0; i < st.n; i++) {
          const l = add(h("div", "laser"));
          l.style.top = `${24 + i * (32 / st.n)}%`;
          sfx("laser");
          await wait(220);
        }
        await wait(500);
        layer.querySelectorAll(".laser").forEach((n) => n.remove());
      },
      async spellMoji(st) {
        const n = add(h("div", `word ${tone(st.color)}`, [...st.word].map((ch, i) => `<span style="animation-delay:${i * 0.12 * speed}s">${ch}</span>`).join("")));
        if (st.color === "gold") n.classList.add("rainbow-text");
        sfx("card", st.color);
        await wait(1500);
        n.remove();
      },
      async notice(st) {
        if (st.char) add(bigArt(st.char));
        const n = add(h("div", "notice tone-gold", st.text));
        flash("gold");
        sfx("notice");
        await wait(1500);
        n.remove();
      },
      async renda(st) {
        const n = add(h("div", "card tone-gold", `${crest("marisa")}<div class="t">マスパ連打</div><div class="m">${st.n}回押せ！</div>`));
        n.style.top = "8%";
        await waitInput("renda", { count: st.n, autoMs: 1800 });
        n.remove();
        if (st.hit) {
          flash("gold");
          const s = add(h("div", "notice tone-gold", "マスタースパーク"));
          sfx("notice");
          await wait(1200);
          s.remove();
        } else {
          sfx("fail");
          await wait(400);
        }
      },
      async wait(st) {
        await wait(st.ms);
      },
      async final(st) {
        if (reels.isSpinning(0)) {
          reels.stop(0, st.digits[0]);
          reels.stop(2, st.digits[2]);
        }
        reels.stop(1, st.digits[1]);
        sfx("stop");
        if (st.hit) {
          reels.mark("hit", [0, 1, 2]);
          flash("gold");
          fx.burst("#ffd257", 48);
          sfx("kyuin");
          handlers.onVibrate && handlers.onVibrate([120, 60, 120, 60, 300]);
          const n = add(h("div", "notice tone-gold", st.digits[0] === 7 ? "異変解決!!" : "大当り"));
          n.style.alignItems = "end";
          n.style.paddingBottom = "18%";
          await wait(1700);
          n.remove();
        } else if (st.charge) {
          flash("gold");
          sfx("card", "gold");
          await wait(1000);
        } else {
          await wait(layer.children.length ? 700 : 220);
        }
        clearSpin();
      },

      // ---- BONUS・RUSH ----

      async bonus(st) {
        setBg("bonus");
        fx.setMode("bonus");
        const scr = add(h("div", "bonus-screen", `
          <div class="t">${st.title}</div><div class="sub">${st.sub}</div>
          <div class="round">ROUND 0 / ${st.rounds}</div><div class="count"></div><div class="pay">0</div>
          ${st.ura ? `<div class="ura" hidden></div><div class="hint">PUSHで裏ボタン</div>` : ""}`));
        sfx("fanfare");
        rightShoot.hidden = false;
        let uraShown = false;
        if (st.ura) {
          uraWindow = () => {
            uraShown = true;
            const u = scr.querySelector(".ura");
            u.hidden = false;
            u.className = `ura ${tone(st.ura.color)}`;
            scr.querySelector(".hint").textContent = "ロゴ色でRUSH期待度を示唆";
            sfx("card", st.ura.color);
            if (st.ura.info) handlers.onLog && handlers.onLog(st.ura.info);
          };
        }
        await wait(700);
        await runRounds(scr, st.rounds, st.payout);
        await wait(700);
        if (!uraShown) uraWindow = null;
        scr.remove();
      },
      async challenge(st) {
        if (st.kind === "koumakan") {
          setBg("koumakan");
          fx.setMode("reach", "#d0193f");
          const n = add(h("div", "card tone-red", `${crest("remilia")}<div class="t">RUSH突入チャレンジ</div><div class="m">紅魔館突破</div>`));
          sfx("whoosh");
          await wait(1500);
          n.remove();
          if (st.serif) {
            const s = add(h("div", "card tone-gold", `${crest("reimu")}<div class="t">霊夢</div><div class="m">この先、通してもらうわよ</div>`));
            sfx("card", "gold");
            await wait(1300);
            s.remove();
          }
          await waitInput(st.device);
          flash();
          await wait(300);
        } else {
          setBg("bonus");
          fx.setMode("idle");
          const title = add(h("div", "card tone-gold", `<div class="t">RUSH突入チャレンジ</div><div class="m">一発告知</div>`));
          title.style.top = "6%";
          const cd = add(h("div", "notice countdown", "33"));
          for (let c = 33; c >= 0; c--) {
            cd.textContent = String(c);
            sfx("tick");
            if (st.at === c) break;
            await wait(c < 4 ? 420 : 115);
          }
          if (st.at === -1) {
            cd.textContent = "0";
            sfx("fail");
            await wait(1100);
            const r = add(h("div", "card tone-rainbow", `${crest("yukari")}<div class="t">復活</div><div class="m">まだよ</div>`));
            sfx("gap");
            await wait(1000);
            r.remove();
          }
          if (st.at != null) {
            flash("gold");
            sfx("notice");
            cd.textContent = "告知";
            await wait(900);
          } else {
            await wait(600);
          }
          title.remove();
          cd.remove();
        }
      },
      async rushResult(st) {
        if (st.success) {
          setBg("rush");
          fx.setMode("rush");
          flash();
          const n = add(h("div", "notice tone-rainbow", `<div class="rainbow-text">弾幕RUSH<br>突入</div>`));
          if (st.text) {
            const s = add(h("div", "card tone-gold", `<div class="m">${st.text}</div>`));
            s.style.top = "70%";
          }
          sfx("rushIn");
          handlers.onVibrate && handlers.onVibrate([100, 50, 100, 50, 400]);
          await wait(2200);
          n.remove();
        } else {
          const n = add(h("div", "card tone-white", `<div class="t">異変解決</div><div class="m">RUSH 非突入…</div>`));
          sfx("fail");
          await wait(1800);
          n.remove();
        }
        layer.innerHTML = "";
      },
      async charge(st) {
        setBg("bonus");
        fx.setMode("bonus");
        const scr = add(h("div", "bonus-screen", `<div class="t">霊力チャージ</div><div class="sub">2R</div><div class="round"></div><div class="count"></div><div class="pay">0</div>`));
        sfx("card", "gold");
        rightShoot.hidden = false;
        await wait(600);
        await runRounds(scr, 2, st.payout);
        await wait(900);
        scr.remove();
        if (st.promote) {
          flash();
          const n = add(h("div", "notice tone-rainbow", `<div class="rainbow-text">昇格<br>弾幕RUSHへ</div>`));
          sfx("rushIn");
          await wait(2200);
          n.remove();
        }
      },
      async rushContinue() {
        const n = add(h("div", "notice tone-red", "継続"));
        sfx("rushIn");
        await wait(1100);
        n.remove();
      },
      // SPリーチがハズレで止まったあとの復活
      async revive(st) {
        const d = reels.digits[0];
        reels.stop(1, st.stopAt != null ? st.stopAt : (d % 9) + 1);
        sfx("fail");
        q(".reels").classList.add("dim");
        stage.querySelectorAll(".telop").forEach((n) => n.remove());
        layer.querySelectorAll(".reach-title, .big-crest, .tachie").forEach((n) => n.remove());
        fx.setMode("idle");
        await wait(1200);
        if (st.id === "aori") {
          const n = add(h("div", "card tone-purple", `${crest(st.line ? st.line[0] : "reimu")}<div class="t">……</div><div class="m">${st.line ? st.line[1] : "まだ、終わってない？"}</div>`));
          sfx("gap");
          await wait(500);
          await waitInput("button", { autoMs: 2400 });
          n.remove();
          if (!st.hit) {
            sfx("fail");
            await wait(500);
            q(".reels").classList.remove("dim");
            return;
          }
        } else if (st.id === "drop") {
          await wait(250);
          dropYinyang("high");
          if (st.line) {
            const c = add(h("div", "card tone-red", `${crest(st.line[0])}<div class="m">${st.line[1]}</div>`));
            c.style.top = "62%";
            setTimeout(() => c.remove(), 1000 * speed);
          }
          await wait(700);
        } else {
          add(h("div", "sukima", `<i class="ribbon" style="left:12%"></i><i class="ribbon" style="right:12%"></i>`));
          const c = add(h("div", "card tone-purple", `${crest("yukari")}<div class="t">紫</div><div class="m">${st.line ? st.line[1] : "まだ終わらせないわ"}</div>`));
          c.style.top = "62%";
          sfx("gap");
          await wait(1300);
          layer.querySelectorAll(".sukima").forEach((x) => x.remove());
          c.remove();
        }
        q(".reels").classList.remove("dim");
        flash();
        const n = add(h("div", "notice tone-rainbow", `<div class="rainbow-text">復活</div>`));
        reels.spin(1, true);
        sfx("notice");
        handlers.onVibrate && handlers.onVibrate([200, 80, 200]);
        await wait(1300);
        n.remove();
      },
      async rushEnd(st) {
        const n = add(h("div", "card tone-white", `<div class="t">弾幕RUSH 終了</div><div class="m">${st.chain}連 ${st.balls.toLocaleString("ja-JP")}発</div>`));
        sfx("fail");
        await wait(2200);
        n.remove();
      },
    };

    // 大当りラウンドの消化。盤面があるときはアタッカーに実際に入った玉を数え（10カウントか開放時間切れで閉じる）、
    // ないときは決まった出玉を等分して払い出す
    async function runRounds(scr, rounds, payout) {
      const per = Math.floor(payout / rounds);
      let paid = 0;
      for (let r = 1; r <= rounds; r++) {
        scr.querySelector(".round").textContent = `ROUND ${r} / ${rounds}`;
        const countEl = scr.querySelector(".count");
        const base = paid;
        const got = handlers.bonusRound
          ? await handlers.bonusRound((count, roundPaid) => {
              countEl.textContent = `${count} / 10 カウント`;
              scr.querySelector(".pay").textContent = (base + roundPaid).toLocaleString("ja-JP");
              sfx("payout");
            })
          : null;
        if (got == null) {
          const amt = r === rounds ? payout - paid : per;
          paid += amt;
          handlers.onPayout && handlers.onPayout(amt);
          await wait(170);
        } else {
          paid += got;
          await wait(1200); // ラウンド間のインターバル
        }
        scr.querySelector(".pay").textContent = paid.toLocaleString("ja-JP");
        countEl.textContent = "";
        sfx("round");
      }
      return paid;
    }

    async function play(steps, opts = {}) {
      for (const st of steps) {
        if (st.info) handlers.onLog && handlers.onLog(st.info);
        const fn = RUN[st.t];
        if (fn) await fn(st, opts);
      }
    }

    function setMode(mode) {
      baseMode = mode;
      baseTone = mode === "rush" ? "rush" : "shrine";
      holdsEl.classList.toggle("rush", mode === "rush");
      rightShoot.hidden = mode !== "rush";
      setBg(baseTone);
      fx.setMode(mode === "rush" ? "rush" : "idle");
    }

    function setStatus(html) {
      status.innerHTML = html;
    }

    function overlay(html, cls) {
      const n = h("div", cls, html);
      stage.append(n);
      return n;
    }

    return {
      play, setMode, setStatus, renderHolds, entry, input, overlay, clearSpin,
      // 立ち絵・背景の差し替えを反映する
      refreshArt() {
        reels.refresh();
        reels.digits.forEach((d, i) => reels.place(i, d, false));
        setBg(bg.classList[1] || baseTone);
      },
      // 開発者用：陰陽玉を今すぐ落とす（演出のみで抽選には関係しない）
      drop(kind = "normal", weak = false, sound = null) {
        dropYinyang(kind, { weak, sound });
        if (!weak) flash();
      },
      setSpeed(v) { speed = v; },
      setAutoPush(v) { autoPush = v; },
      isWaiting: () => !!pending,
      reels,
    };
  }

  function sakuraSVG() {
    const blossoms = [[60, 30], [86, 52], [44, 64], [96, 92], [70, 110], [30, 98]]
      .map(([x, y]) => `<g class="blossom" transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map((a) => `<ellipse rx="7" ry="11" transform="rotate(${a}) translate(0 -9)" fill="#f9b8d3"/>`).join("")}<circle r="4" fill="#ffd257"/></g>`)
      .join("");
    return `<svg viewBox="0 0 120 140"><path d="M0 70 C30 60 50 40 70 20 M30 64 C50 70 70 80 100 92 M40 66 C40 80 50 96 70 112 M20 68 C22 82 26 92 30 100" stroke="#3b2430" stroke-width="5" fill="none" stroke-linecap="round"/>${blossoms}</svg>`;
  }

  root.GensouStage = { createStage, crestSVG, yinyangSVG };
})(this);
