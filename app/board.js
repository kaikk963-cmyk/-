// 玉を打つ盤面の物理演算と描画。
// 左のレールから玉を打ち出し、釘に当たりながら落ちて、ヘソ（始動口）・電チュー・アタッカー・一般入賞口に入る。
// 物理部分（Board）は DOM に依存しないので node でも動く。
(function (root) {
  // 液晶を中央に埋め込んだ縦長の盤面。玉は液晶の左右のすき間を流れ、液晶の下のステージ・ヘソ・電チュー・アタッカーへ向かう
  const W = 300;
  const H = 464;
  const CX = 150;
  const CY = 180;
  const R = 150;          // 盤面上部の円弧（外レール）
  const BALL = 3;
  const PIN = 1.4;
  const G = 420;          // 重力 px/s^2
  const SUB = 1 / 240;    // 物理の刻み

  // 液晶（ここに演出画面をはめ込む）
  const LCD = { x0: 42, x1: 258, y0: 92, y1: 318 };
  // 入賞口
  const HESO = { x: 150, y: 418, w: 4.2 };
  const DENCHU = { x: 256, y: 386, w: 6 };
  const ATTACKER = { x0: 222, x1: 246, y: 426 };
  const POCKETS = [{ x: 22, y: 442, w: 5, pay: 5 }, { x: 196, y: 438, w: 4, pay: 5 }];
  // 道釘（玉が転がる道）。途中のすき間から落ちた玉はアウト
  const RAMPS = [
    // 液晶の屋根（落ちてきた玉を左右に振り分ける）
    [40, 94, 150, 82], [150, 82, 260, 94],
    // 左ルートの下からヘソへ寄せる道
    [6, 354, 60, 364], [69, 365.5, 104, 372], [112, 373.5, 136, 378],
    // 右打ちルート：電チューへ寄せる道と、アタッカーへ流す道
    [294, 364, 266, 378], [294, 404, 250, 414],
  ];
  const RAIL_FRICTION = 0.55;
  // ワープ入口（液晶の左の縁）に入った玉は、液晶下のステージに出てくる
  const WARP = { x0: 36, x1: 41, y0: 200, y1: 204, outX: 50 };
  // 2段ステージ（どちらも中央が低い皿）。ワープから出た玉は上段を転がり、
  // 中央から落ちれば下段へ。下段の中央の溝から落ちればヘソの真上、そうでなければ左右にこぼれる
  const STAGE_UP = [[44, 324, 150, 331], [150, 331, 256, 324]];
  const STAGE_LOW = [[72, 346, 150, 352], [150, 352, 228, 346]];
  const STAGE = STAGE_UP.concat(STAGE_LOW);
  const UP_CENTER = 0.45;   // 上段の中央から下段へ落ちる割合
  const LOW_CENTER = 0.55;  // 下段の中央の溝からヘソへ向かう割合
  const stageUpY = (x) => (x < 150 ? 324 + ((x - 44) / 106) * 7 : 331 - ((x - 150) / 106) * 7) - BALL - 1;
  const stageLowY = (x) => (x < 150 ? 346 + ((x - 72) / 78) * 6 : 352 - ((x - 150) / 78) * 6) - BALL - 1;
  // 風車（当たった玉を回転方向にはじく）
  const WINDMILL = { x: 24, y: 214, r: 5, spin: 1 };

  const HESO_GAP = 1.5;
  // ヘソ釘の開き → ヘソに来た玉が弾かれずに入る割合（開くほど入る）
  const hesoAccept = (open) => Math.max(0, Math.min(1, open / 2.5));

  function buildPins() {
    const pins = [];
    const inside = (x, y) => (y >= CY || Math.hypot(x - CX, y - CY) < R - 10) && x > 9 && x < W - 9;
    const outsideLcd = (x, y) => !(x > LCD.x0 - 5 && x < LCD.x1 + 5 && y > LCD.y0 - 8 && y < LCD.y1 + 5);
    // 左ルート（液晶の左のすき間）
    for (let row = 0, y = 110; y <= 316; row++, y += 11) {
      for (let x = 12 + (row % 2) * 7; x <= 34; x += 14) {
        if (Math.hypot(x - WINDMILL.x, y - WINDMILL.y) < 11) continue;
        if (inside(x, y) && outsideLcd(x, y)) pins.push([x, y]);
      }
    }
    // 右ルート（右打ち）
    for (let row = 0, y = 110; y <= 316; row++, y += 13) {
      for (let x = 266 + (row % 2) * 8; x <= 292; x += 16) if (inside(x, y) && outsideLcd(x, y)) pins.push([x, y]);
    }
    // 液晶の上（天釘）
    for (let x = 60; x <= 240; x += 20) if (inside(x, 70)) pins.push([x, 70 + (x % 40 === 0 ? 0 : 4)]);
    // 液晶の下・右寄りの釘（ステージ中央から真下のヘソへの通り道はあけておく）
    for (let row = 0, y = 370; y <= 392; row++, y += 11) {
      for (let x = 164 + (row % 2) * 7; x <= 246; x += 14) pins.push([x, y]);
    }
    // ヘソの命釘
    const g = 4 + HESO_GAP;
    pins.push([HESO.x - g, 410], [HESO.x + g, 410], [HESO.x + g + 6, 404]);
    return pins;
  }

  class Board {
    constructor(opts = {}) {
      this.rng = opts.rng || Math.random;
      this.balls = [];
      this.mode = "normal";      // normal | rush | bonus
      this.strength = 60;
      this.fireRate = 100 / 60;  // 発/秒
      this.firing = false;
      this.fireAcc = 0;
      this.denchuOpen = false;
      this.denchuT = 0;
      this.setHeso(opts.hesoOpen ?? 3);
      this.handlers = opts.handlers || {};
      this.stats = { fired: 0, heso: 0, denchu: 0, attacker: 0, pocket: 0, out: 0 };
    }
    setHeso(open) {
      this.hesoOpen = open;
      this.accept = hesoAccept(open);
      if (this.pins) return;
      this.pins = buildPins();
      // 当たり判定を速くするための格子
      this.grid = new Map();
      for (const p of this.pins) {
        const k = `${Math.floor(p[0] / 12)},${Math.floor(p[1] / 12)}`;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(p);
      }
    }
    nearPins(x, y) {
      const gx = Math.floor(x / 12), gy = Math.floor(y / 12);
      const out = [];
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const a = this.grid.get(`${gx + i},${gy + j}`);
        if (a) out.push(...a);
      }
      return out;
    }
    launch() {
      if (this.handlers.onFire && this.handlers.onFire() === false) return;
      this.stats.fired++;
      // ハンドルの強さで打ち出しの速さが決まる（ばらつきあり）
      const v = 230 + this.strength * 3.4 + (this.rng() - 0.5) * 18;
      this.balls.push({ x: CX - R + BALL + 1, y: CY + 30, vx: 0, vy: -v, life: 0, up: false });
    }
    step(dt) {
      // 打ち出し
      if (this.firing) {
        this.fireAcc += dt * this.fireRate;
        while (this.fireAcc >= 1) {
          this.fireAcc -= 1;
          if (this.balls.length < 80) this.launch();
        }
      }
      // 電チューは RUSH 中に開閉をくり返す
      if (this.mode === "rush") {
        this.denchuT += dt;
        this.denchuOpen = this.denchuT % 1 < 0.9;
      } else {
        this.denchuOpen = false;
      }
      let t = dt;
      while (t > 0) {
        const h = Math.min(SUB, t);
        this.sub(h);
        t -= h;
      }
    }
    sub(dt) {
      const keep = [];
      for (const b of this.balls) {
        b.life += dt;
        b.vy += G * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // 外レール（上部の円弧）：内側に押し戻して外向きの速度を消す。レールの摩擦で減速する
        if (b.y < CY) {
          const dx = b.x - CX, dy = b.y - CY;
          const d = Math.hypot(dx, dy);
          const lim = R - BALL;
          if (d > lim) {
            const nx = dx / d, ny = dy / d;
            b.x = CX + nx * lim;
            b.y = CY + ny * lim;
            const vn = b.vx * nx + b.vy * ny;
            if (vn > 0) { b.vx -= vn * nx; b.vy -= vn * ny; }
            const f = Math.exp(-RAIL_FRICTION * dt);
            b.vx *= f; b.vy *= f;
          }
        }
        // 左右の壁
        if (b.x < 4 + BALL) { b.x = 4 + BALL; b.vx = Math.abs(b.vx) * 0.4; }
        if (b.x > W - 4 - BALL) { b.x = W - 4 - BALL; b.vx = -Math.abs(b.vx) * 0.4; }
        // 打ち出したあと盤面まで届かずに落ちてきた玉は戻り玉（ファウル）
        if (b.y < CY - 40) b.up = true;
        if (!b.up && b.life > 0.2 && b.vy > 0 && b.y > CY + 20) { this.stats.out++; continue; }

        // 液晶の枠
        if (b.x > LCD.x0 - BALL && b.x < LCD.x1 + BALL && b.y > LCD.y0 - BALL && b.y < LCD.y1 + BALL) {
          const dl = b.x - (LCD.x0 - BALL), dr = LCD.x1 + BALL - b.x, dtp = b.y - (LCD.y0 - BALL), db = LCD.y1 + BALL - b.y;
          const m = Math.min(dl, dr, dtp, db);
          if (m === dtp) { b.y = LCD.y0 - BALL; b.vy = -Math.abs(b.vy) * 0.3; b.vx += (b.x < CX ? -1 : 1) * 12; }
          else if (m === db) { b.y = LCD.y1 + BALL; b.vy = Math.abs(b.vy) * 0.3; }
          else if (m === dl) { b.x = LCD.x0 - BALL; b.vx = -Math.abs(b.vx) * 0.3; }
          else { b.x = LCD.x1 + BALL; b.vx = Math.abs(b.vx) * 0.3; }
        }

        // ステージ上を転がっている玉（行き先は乗った時点で決まる）
        if (b.stage) {
          const st = b.stage;
          const low = st.tier === 2;
          const yOf = low ? stageLowY : stageUpY;
          st.t += dt;
          const k = Math.min(1, st.t / st.dur);
          const wob = Math.sin(k * Math.PI * st.swings) * (1 - k) * (low ? 24 : 34);
          const x = st.x0 + (st.x1 - st.x0) * (1 - Math.pow(1 - k, 2)) + wob;
          b.x = low ? Math.max(73, Math.min(227, x)) : Math.max(45, Math.min(255, x));
          // 下段に落ちた直後は上段から落ちてくる途中
          b.y = low && st.t < 0.18 ? st.y0 + (yOf(b.x) - st.y0) * (st.t / 0.18) : yOf(b.x);
          if (k >= 1) {
            if (!low && st.out === "center") {
              const r = this.rng();
              const out = r < LOW_CENTER ? "center" : r < (1 + LOW_CENTER) / 2 ? "left" : "right";
              b.stage = { tier: 2, t: 0, dur: 0.8 + this.rng() * 0.6, x0: 150, x1: out === "center" ? 150 : out === "left" ? 71 : 229, swings: 1 + Math.floor(this.rng() * 2), out, y0: b.y };
            } else {
              b.stage = null;
              if (st.out === "center") { b.x = 150 + (this.rng() - 0.5) * 7; b.y = 360; b.vx = 0; b.vy = 30; }
              else { b.vx = st.out === "left" ? -45 : 45; b.vy = 0; b.y = yOf(b.x) - 1; b.x += st.out === "left" ? -3 : 3; }
            }
          }
          keep.push(b);
          continue;
        }
        // ワープ（右向きに飛び込んだ玉だけ入る）
        if (b.vx > 0 && b.x > WARP.x0 && b.x < WARP.x1 && b.y > WARP.y0 && b.y < WARP.y1) {
          this.stats.warp = (this.stats.warp || 0) + 1;
          const r = this.rng();
          const out = r < UP_CENTER ? "center" : r < (1 + UP_CENTER) / 2 ? "left" : "right";
          b.stage = { tier: 1, t: 0, dur: 1 + this.rng() * 0.8, x0: WARP.outX, x1: out === "center" ? 150 : out === "left" ? 41 : 259, swings: 1 + Math.floor(this.rng() * 3), out };
          b.warped = true;
          b.x = WARP.outX; b.y = stageUpY(WARP.outX);
          keep.push(b);
          continue;
        }
        // 風車
        {
          const dx = b.x - WINDMILL.x, dy = b.y - WINDMILL.y;
          const d = Math.hypot(dx, dy);
          const min = WINDMILL.r + BALL;
          if (d < min && d > 1e-6) {
            const nx = dx / d, ny = dy / d;
            b.x = WINDMILL.x + nx * min;
            b.y = WINDMILL.y + ny * min;
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) { b.vx -= 1.3 * vn * nx; b.vy -= 1.3 * vn * ny; }
            // 時計回りに回っている羽根が玉を接線方向に押す
            b.vx += -ny * 60 * WINDMILL.spin * dt * 60;
            b.vy += nx * 60 * WINDMILL.spin * dt * 60;
          }
        }
        // 道釘（線分）とステージ
        for (const [x1, y1, x2, y2] of RAMPS.concat(STAGE)) {
          const ex = x2 - x1, ey = y2 - y1;
          const t = Math.max(0, Math.min(1, ((b.x - x1) * ex + (b.y - y1) * ey) / (ex * ex + ey * ey)));
          const px = x1 + ex * t, py = y1 + ey * t;
          const dx = b.x - px, dy = b.y - py;
          const d = Math.hypot(dx, dy);
          if (d < BALL + 1 && d > 1e-6) {
            const nx = dx / d, ny = dy / d;
            b.x = px + nx * (BALL + 1);
            b.y = py + ny * (BALL + 1);
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) { b.vx -= 1.25 * vn * nx; b.vy -= 1.25 * vn * ny; }
          }
        }

        // 釘
        for (const p of this.nearPins(b.x, b.y)) {
          const dx = b.x - p[0], dy = b.y - p[1];
          const d2 = dx * dx + dy * dy;
          const min = BALL + PIN;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const nx = dx / d, ny = dy / d;
            b.x = p[0] + nx * min;
            b.y = p[1] + ny * min;
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) {
              b.vx -= 1.45 * vn * nx;
              b.vy -= 1.45 * vn * ny;
              b.vx += (this.rng() - 0.5) * 14;
            }
          }
        }

        // 入賞判定
        if (!b.kicked && Math.abs(b.x - HESO.x) < HESO.w && b.y > HESO.y - 2 && b.y < HESO.y + 4) {
          // ヘソ弾き：命釘に当たって外へ弾かれる
          if (this.rng() > this.accept) {
            b.kicked = true;
            b.y = HESO.y - 5;
            b.vy = -40 - this.rng() * 30;
            b.vx = (this.rng() < 0.5 ? -1 : 1) * (50 + this.rng() * 40);
            keep.push(b);
            continue;
          }
          this.stats.heso++;
          if (b.warped) this.stats.hesoStage = (this.stats.hesoStage || 0) + 1;
          this.handlers.onHeso && this.handlers.onHeso();
          continue;
        }
        if (this.denchuOpen && Math.abs(b.x - DENCHU.x) < DENCHU.w && b.y > DENCHU.y - 3 && b.y < DENCHU.y + 4) {
          this.stats.denchu++;
          this.handlers.onDenchu && this.handlers.onDenchu();
          continue;
        }
        if (this.mode === "bonus" && b.x > ATTACKER.x0 && b.x < ATTACKER.x1 && b.y > ATTACKER.y - 3 && b.y < ATTACKER.y + 4) {
          this.stats.attacker++;
          this.handlers.onAttacker && this.handlers.onAttacker();
          continue;
        }
        let pocket = null;
        for (const pk of POCKETS) if (Math.abs(b.x - pk.x) < pk.w && b.y > pk.y - 2 && b.y < pk.y + 4) pocket = pk;
        if (pocket) {
          this.stats.pocket++;
          this.handlers.onPocket && this.handlers.onPocket(pocket.pay);
          continue;
        }
        if (b.y > H + 6) {
          this.stats.out++;
          continue;
        }
        keep.push(b);
      }
      this.balls = keep;
    }
  }

  // ---------------- 描画 ----------------

  function createBoardView(canvas, board) {
    const g = canvas.getContext("2d");
    let scale = 1;
    function resize() {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, root.devicePixelRatio || 1);
      scale = (r.width || W) / W;
      canvas.width = Math.round(W * scale * dpr);
      canvas.height = Math.round(H * scale * dpr);
      g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    }
    resize();
    if (root.ResizeObserver) new ResizeObserver(resize).observe(canvas);

    function draw() {
      g.clearRect(0, 0, W, H);
      // 盤面
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#2a2150");
      bg.addColorStop(1, "#16112c");
      g.fillStyle = bg;
      g.beginPath();
      g.arc(CX, CY, R, Math.PI, 0);
      g.lineTo(W - 4, H);
      g.lineTo(4, H);
      g.closePath();
      g.fill();
      g.strokeStyle = "#f3c252";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(CX, CY, R, Math.PI, 0);
      g.stroke();
      // 液晶
      g.fillStyle = "#0d0a1e";
      g.strokeStyle = "#e4412f";
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect ? g.roundRect(LCD.x0, LCD.y0, LCD.x1 - LCD.x0, LCD.y1 - LCD.y0, 8) : g.rect(LCD.x0, LCD.y0, LCD.x1 - LCD.x0, LCD.y1 - LCD.y0);
      g.fill();
      g.stroke();
      g.textAlign = "center";
      // 釘
      g.fillStyle = "#d8d2ea";
      for (const p of board.pins) {
        g.beginPath();
        g.arc(p[0], p[1], PIN, 0, 7);
        g.fill();
      }
      // ヘソ
      g.fillStyle = "#e4412f";
      g.fillRect(HESO.x - 6, HESO.y + 3, 12, 4);
      g.fillStyle = "#fff";
      g.font = "8px sans-serif";
      g.fillText("ヘソ", HESO.x, HESO.y + 15);
      // 電チュー
      g.fillStyle = board.denchuOpen ? "#ffd257" : "#7a6a3a";
      g.fillRect(DENCHU.x - 7, DENCHU.y + 3, 14, 4);
      if (board.denchuOpen) {
        g.strokeStyle = "#ffd257";
        g.beginPath(); g.moveTo(DENCHU.x - 7, DENCHU.y + 3); g.lineTo(DENCHU.x - 12, DENCHU.y - 4); g.moveTo(DENCHU.x + 7, DENCHU.y + 3); g.lineTo(DENCHU.x + 12, DENCHU.y - 4); g.stroke();
      }
      g.fillStyle = "#fff";
      g.fillText("電チュー", DENCHU.x, DENCHU.y + 15);
      // アタッカー
      g.fillStyle = board.mode === "bonus" ? "#ffd257" : "#4a3a5a";
      g.fillRect(ATTACKER.x0, ATTACKER.y + 3, ATTACKER.x1 - ATTACKER.x0, 5);
      g.fillStyle = "#fff";
      g.fillText("アタッカー", (ATTACKER.x0 + ATTACKER.x1) / 2, ATTACKER.y + 16);
      // ステージ
      g.strokeStyle = "#f3c252";
      g.lineWidth = 2;
      for (const [x1, y1, x2, y2] of STAGE) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
      // ワープ入口
      g.fillStyle = "#9a5ef0";
      g.fillRect(WARP.x0, WARP.y0, WARP.x1 - WARP.x0, WARP.y1 - WARP.y0);
      // 風車
      g.save();
      g.translate(WINDMILL.x, WINDMILL.y);
      g.rotate((performance.now() / 300) % (Math.PI * 2));
      g.fillStyle = "#e4412f";
      for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); g.fillRect(-1, 0, 2, WINDMILL.r + 1); }
      g.restore();
      // 道釘
      g.fillStyle = "#d8d2ea";
      for (const [x1, y1, x2, y2] of RAMPS) {
        const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 4);
        for (let i = 0; i <= n; i++) {
          g.beginPath();
          g.arc(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, PIN, 0, 7);
          g.fill();
        }
      }
      // 一般入賞口
      g.fillStyle = "#4fd88f";
      for (const pk of POCKETS) g.fillRect(pk.x - 5, pk.y + 3, 10, 3);
      // 玉
      for (const b of board.balls) {
        const grd = g.createRadialGradient(b.x - 1, b.y - 1, 0.5, b.x, b.y, BALL);
        grd.addColorStop(0, "#ffffff");
        grd.addColorStop(1, "#8d93a8");
        g.fillStyle = grd;
        g.beginPath();
        g.arc(b.x, b.y, BALL, 0, 7);
        g.fill();
      }
    }
    return { draw, resize };
  }

  const api = { Board, createBoardView, W, H, LCD };
  if (typeof module !== "undefined") module.exports = api;
  else root.GensouBoard = api;
})(this);
