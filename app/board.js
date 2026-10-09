// 玉を打つ盤面の物理演算と描画。
// 左のレールから玉を打ち出し、釘に当たりながら落ちて、ヘソ（始動口）・電チュー・アタッカー・一般入賞口に入る。
// 物理部分（Board）は DOM に依存しないので node でも動く。
(function (root) {
  const W = 300;
  const H = 240;
  const CX = 150;
  const CY = 150;
  const R = 146;          // 盤面上部の円弧（外レール）
  const BALL = 3;
  const PIN = 1.4;
  const G = 420;          // 重力 px/s^2
  const SUB = 1 / 240;    // 物理の刻み

  // 液晶（中央の障害物）
  const LCD = { x0: 92, x1: 208, y0: 34, y1: 118 };
  // 入賞口
  const HESO = { x: 150, y: 197, w: 4.2 };
  const DENCHU = { x: 254, y: 190, w: 6 };
  const ATTACKER = { x0: 222, x1: 246, y: 222 };
  const POCKETS = [{ x: 30, y: 214, w: 5, pay: 5 }, { x: 196, y: 214, w: 4, pay: 5 }];
  // 道釘（玉が転がる道）。途中のすき間から落ちた玉はアウト
  const RAMPS = [
    // 液晶の屋根（落ちてきた玉を左右に振り分ける）
    [90, 36, 150, 25], [150, 25, 210, 36],
    [12, 166, 34, 170], [50, 172, 70, 175.5], [86, 177.5, 104, 180], [118, 181.5, 130, 183.5],
    // 右打ちルート：電チューへ寄せる道と、アタッカーへ流す道
    [292, 168, 263, 183], [292, 202, 247, 212],
  ];
  const RAIL_FRICTION = 0.55;
  // ワープ入口（液晶の左）に入った玉は、液晶下のステージに出てくる
  const WARP = { x0: 81, x1: 85, y0: 75, y1: 78, outX: 104, outY: 118 };
  // ステージ（中央が低い皿）。ワープから出た玉はステージを転がり、
  // 中央の溝から落ちればヘソの真上へ、そうでなければ左右にこぼれる
  const STAGE = [[98, 122, 150, 129], [150, 129, 202, 122]];
  const STAGE_CENTER = 0.32;
  const stageY = (x) => (x < 150 ? 122 + ((x - 98) / 52) * 7 : 129 - ((x - 150) / 52) * 7) - BALL - 1;
  // 風車（当たった玉を回転方向にはじく）
  const WINDMILL = { x: 58, y: 126, r: 5, spin: 1 };

  function buildPins(hesoOpen) {
    const pins = [];
    const inside = (x, y) => (y >= CY || Math.hypot(x - CX, y - CY) < R - 12) && x > 10 && x < W - 10;
    const outsideLcd = (x, y) => !(x > LCD.x0 - 5 && x < LCD.x1 + 5 && y > LCD.y0 - 5 && y < LCD.y1 + 5);
    // 左の釘（ここを抜けた玉が道釘に乗る）
    for (let row = 0, y = 44; y <= 156; row++, y += 11) {
      for (let x = 16 + (row % 2) * 7; x <= 84; x += 14) {
        if (Math.hypot(x - WINDMILL.x, y - WINDMILL.y) < 12) continue;
        if (inside(x, y) && outsideLcd(x, y)) pins.push([x, y]);
      }
    }
    // 右（右打ちルート）の釘は少なめ
    for (let row = 0, y = 44; y <= 156; row++, y += 16) {
      for (let x = 218 + (row % 2) * 9; x <= 288; x += 18) if (inside(x, y) && outsideLcd(x, y)) pins.push([x, y]);
    }
    // 液晶の下の釘（ステージから真下のヘソへの通り道はあけておく）
    for (let row = 0, y = 142; y <= 164; row++, y += 11) {
      for (let x = 100 + (row % 2) * 7; x <= 200; x += 14) if (Math.abs(x - HESO.x) > 10) pins.push([x, y]);
    }
    // ヘソの命釘（hesoOpen で開け閉めする）
    const g = 4 + hesoOpen;
    pins.push([HESO.x - g, 189], [HESO.x + g, 189], [HESO.x + g + 6, 183]);
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
      this.pins = buildPins(open);
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
      const v = 250 + this.strength * 3.3 + (this.rng() - 0.5) * 18;
      this.balls.push({ x: CX - R + BALL + 1, y: CY + 30, vx: 0, vy: -v, life: 0 });
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
        this.denchuOpen = this.denchuT % 1.1 < 0.8;
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
        // 打ち出し直後、レールに乗る前に失速した玉は戻り玉（ファウル）
        if (b.life > 0.25 && b.x < 14 && b.y > CY + 20 && b.vy > 0) { this.stats.out++; continue; }

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
          st.t += dt;
          const k = Math.min(1, st.t / st.dur);
          const wob = Math.sin(k * Math.PI * st.swings) * (1 - k) * 34;
          const x = st.x0 + (st.x1 - st.x0) * (1 - Math.pow(1 - k, 2)) + wob;
          b.x = Math.max(99, Math.min(201, x));
          b.y = stageY(b.x);
          if (k >= 1) {
            b.stage = null;
            if (st.out === "center") { b.x = 150 + (this.rng() - 0.5) * 7; b.y = 134; b.vx = 0; b.vy = 30; }
            else { b.vx = st.out === "left" ? -50 : 50; b.vy = 0; b.y = stageY(b.x) - 1; b.x += st.out === "left" ? -3 : 3; }
          }
          keep.push(b);
          continue;
        }
        // ワープ（右向きに飛び込んだ玉だけ入る）
        if (b.vx > 0 && b.x > WARP.x0 && b.x < WARP.x1 && b.y > WARP.y0 && b.y < WARP.y1) {
          this.stats.warp = (this.stats.warp || 0) + 1;
          const r = this.rng();
          const out = r < STAGE_CENTER ? "center" : r < (1 + STAGE_CENTER) / 2 ? "left" : "right";
          b.stage = { t: 0, dur: 1 + this.rng() * 0.8, x0: WARP.outX, x1: out === "center" ? 150 : out === "left" ? 97 : 203, swings: 1 + Math.floor(this.rng() * 3), out };
          b.warped = true;
          b.x = WARP.outX; b.y = stageY(WARP.outX);
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
        if (Math.abs(b.x - HESO.x) < HESO.w && b.y > HESO.y - 2 && b.y < HESO.y + 4) {
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
      g.fillStyle = "#a99fcb";
      g.font = "10px sans-serif";
      g.textAlign = "center";
      g.fillText("液晶", CX, (LCD.y0 + LCD.y1) / 2 + 3);
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

  const api = { Board, createBoardView, W, H };
  if (typeof module !== "undefined") module.exports = api;
  else root.GensouBoard = api;
})(this);
