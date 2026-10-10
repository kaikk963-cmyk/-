// 玉を打つ盤面の物理演算と描画。
// 実機の釘配置図（ビスティ「P新世紀エヴァンゲリオン15」の遊技盤）を、縮尺をそろえてそのまま写した盤面。
// 釘の位置は図から1本ずつ読み取ったもので、外枠・ワープ・ステージ・右打ちの通路・アタッカー・電チュー・入賞口も図の位置。
// 物理部分（Board）は DOM に依存しないので node でも動く。
(function (root) {
  const W = 300;
  const H = 324.66;
  const [CX, CY] = [155.22,155.22];
  const R = 155.22;          // 外レール（盤面の外枠の円）
  const R_IN = 148.26;    // 内レール（打ち出しレーンと盤面の仕切り）
  const RAIL_TOP_Y = 85.99;     // 内レールの上端。ここより上で玉が盤面に出る
  const LANE_BOTTOM_Y = 196.63; // 打ち出しレーンの下端（発射位置）
  const RIGHT_X = 300.0, RIGHT_WALL_Y = 99.26; // 右の外枠（ここから下はまっすぐ）
  const BALL = 2.9;  // 玉の半径（図の縮尺で約11mm）
  const PIN = 0.55;  // 釘の半径（玉11mmに対して釘は約2mm）
  const G = 420;     // 重力 px/s^2
  const SUB = 1 / 240;

  // 液晶（ここに演出画面をはめ込む）＝図の液晶の窓
  const LCD = {"x0":69.86,"y0":68.6,"x1":248.47,"y1":218.76};
  const ROOF = [[69.86,68.6,164.7,44.89],[164.7,44.89,248.47,68.6]];
  // 図から読み取った釘と、左の寄り釘（図の2本のレールの目盛り）
  const PINS = [[62.59,281.66],[39.83,195.36],[70.81,281.66],[93.57,282.3],[49.0,73.34],[93.57,278.19],[35.72,235.19],[30.03,195.68],[120.44,296.52],[89.46,289.57],[26.87,216.86],[40.78,213.7],[34.14,93.89],[18.65,178.61],[43.62,79.98],[173.87,293.99],[261.43,232.67],[23.08,224.13],[40.78,217.81],[103.37,281.98],[40.78,221.6],[252.27,232.67],[261.43,224.13],[112.86,304.74],[56.9,274.39],[32.24,221.6],[165.02,292.73],[252.27,228.56],[137.51,292.73],[252.27,224.13],[27.5,178.61],[66.39,274.39],[19.28,212.12],[32.24,217.81],[84.4,272.18],[49.95,64.49],[25.92,89.78],[31.3,183.35],[43.31,91.68],[128.35,290.2],[36.35,203.27],[61.01,266.81],[84.09,282.3],[110.33,296.21],[77.13,263.96],[38.88,205.8],[98.0,289.57],[21.5,203.27],[119.18,285.14],[80.93,280.72],[74.92,274.08],[174.18,290.2],[30.03,211.17],[111.59,281.35],[42.04,244.99],[69.86,259.85],[32.24,214.01],[12.01,184.62],[49.32,61.01],[24.34,205.16],[14.54,197.89],[183.35,285.14],[9.17,193.47],[46.15,89.78],[68.6,270.6],[51.84,261.75],[83.46,267.12],[48.37,248.47],[34.14,186.2],[12.01,195.36],[51.53,250.05],[92.94,271.87],[89.78,270.28],[108.43,279.77],[63.86,256.69],[96.1,273.45],[105.27,278.19],[101.16,291.15],[60.7,255.11],[67.02,258.27],[80.3,265.54],[57.53,253.21],[107.17,294.63],[71.76,272.5],[57.85,264.91],[99.26,275.03],[54.69,263.33],[102.42,276.61],[122.02,286.72],[86.62,268.7],[14.54,186.83],[54.37,251.63],[45.21,246.58],[177.34,288.3],[180.51,286.72],[125.18,288.3],[104.0,292.73],[47.1,54.37],[48.37,57.85]];
  const YORI = [[21.56,93.89],[31.38,97.68],[20.35,101.48],[29.71,105.27],[19.17,109.06],[28.61,112.86],[18.26,116.65],[27.85,120.44],[17.37,124.24],[27.34,128.03],[16.91,131.82],[27.03,135.62],[16.46,139.41],[26.8,143.2],[16.15,147.0],[26.65,150.79],[15.84,154.58],[26.72,158.38],[16.07,162.17],[27.18,165.96],[16.38,169.76],[27.83,173.55],[28.97,181.14]];
  const LEFT_EDGE = [[5.69,196.63],[7.27,204.53],[9.17,212.43],[11.38,220.34],[14.23,228.24],[17.7,236.14],[21.5,244.05],[25.92,251.95],[30.66,259.85],[35.72,267.76],[41.41,275.66],[47.42,283.56],[54.69,291.46],[62.28,299.37],[70.18,307.27],[79.35,324.66]];
  const WINDMILL = { x: 35.09, y: 234.56, r: 6, spin: 1 };
  const HESO = { x: 150.47, y: 294.63, w: 3.6 };
  const INOCHI_Y = 289.88;
  const POCKETS = [[66.7,287.04,5],[93.57,294.94,5],[104.64,299.68,5],[210.54,307.9,1]].map(([x, y, pay]) => ({ x, y, w: 3.6, pay }));
  // ワープ：液晶の左の青い通路。入口に入った玉は通路を通って液晶下のステージに出る
  const WARP_IN = [[57.85,77.77],[69.86,82.82]];
  const FUNNEL = [[57.85,79.66,45.84,190.31],[45.84,190.31,51.53,218.76]];
  // ステージ：ワープの出口から中央の皿へ転がる。皿の中央の穴から落ちればヘソの真上
  const STAGE_PATH = [[50.9,225.08],[133.09,263.01],[150.47,278.82]];
  const STAGE_EXIT = [150.47,284.51];
  const STAGE_WALLS = [[51.53,218.76,49.0,236.14],[49.0,236.14,134.67,275.66],[134.67,275.66,145.73,281.98],[155.22,281.98,166.28,275.66],[166.28,275.66,243.73,237.72],[243.73,237.72,248.47,218.76]];
  const STAGE_CENTER = 0.2; // ステージに乗った玉のうち、中央の穴から落ちる割合
  // 右打ち：液晶の右の通路 → アタッカー（通路の右寄り）→ 左のすき間を抜けた玉は下の電チューへ
  const RIGHT_WALLS = [[288.62,75.87,288.62,142.89],[259.54,152.37,259.54,212.43],[259.54,152.37,288.62,142.89],[248.47,218.76,243.73,234.56],[243.73,234.56,243.73,263.01],[243.73,263.01,238.04,267.76],[261.43,234.56,261.43,263.01],[261.43,263.01,227.92,282.61]];
  const ATTACKER = {"x0":260.17,"y":141.62,"x1":286.72};
  const ATTACKER_LID = [286.72,139.73,260.17,143.52];
  const [DX, DY] = [201.37,286.41];
  const DENCHU = { x: DX, y: DY, w: 5 };
  const DENCHU_SLIDE = [227.92,282.61,207.69,285.77];
  const DENCHU_LID = [DX + 6, DY - 1.2, DX - 6, DY + 0.4];
  const RAIL_FRICTION = 0.55;

  const segsOf = (pts) => pts.slice(1).map((p, i) => [pts[i][0], pts[i][1], p[0], p[1]]);
  const STATIC_SEGS = [...ROOF, ...FUNNEL, ...STAGE_WALLS, ...RIGHT_WALLS, ...segsOf(LEFT_EDGE), DENCHU_SLIDE];

  // ヘソ釘（命釘2本）の間隔。設定の「ヘソ釘の開き」（0.5〜2.5）で実際に広がる。
  // 2本の間を抜けた玉だけがハカマの中を落ちてヘソに入る（入ったように見えて弾かれる、ということはない）
  const inochiHalf = (open) => 3.46 + open * 0.36; // 2.25で図の命釘の位置

  function buildPins(open) {
    const g = inochiHalf(open);
    return PINS.concat(YORI, [[HESO.x - g, INOCHI_Y], [HESO.x + g, INOCHI_Y]]);
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
      this.attackerOpen = false;
      this.handlers = opts.handlers || {};
      this.stats = { fired: 0, heso: 0, denchu: 0, attacker: 0, pocket: 0, out: 0 };
      this.setHeso(opts.hesoOpen ?? 2.25);
    }
    setHeso(open) {
      this.hesoOpen = open;
      this.pins = buildPins(open);
      const g = inochiHalf(open);
      // ハカマ：命釘からヘソの口までの左右の壁
      this.hakama = [[HESO.x - g, INOCHI_Y, HESO.x - g + 0.5, HESO.y + 3], [HESO.x + g, INOCHI_Y, HESO.x + g - 0.5, HESO.y + 3]];
      this.grid = new Map();
      for (const p of this.pins) {
        const k = `${Math.floor(p[0] / 10)},${Math.floor(p[1] / 10)}`;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(p);
      }
    }
    nearPins(x, y) {
      const gx = Math.floor(x / 10), gy = Math.floor(y / 10);
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
      // 打ち出しレーンの下から、外レールにそって上へ。ハンドルの強さで速さが決まる（ばらつきあり）
      const v = 230 + this.strength * 3.4 + (this.rng() - 0.5) * 18;
      const rm = (R + R_IN) / 2;
      const y = LANE_BOTTOM_Y - 2;
      const x = CX - Math.sqrt(rm * rm - (y - CY) * (y - CY));
      const nx = (x - CX) / rm, ny = (y - CY) / rm;
      // 円の接線のうち上向きのほう
      let tx = -ny, ty = nx;
      if (ty > 0) { tx = -tx; ty = -ty; }
      this.balls.push({ x, y, vx: tx * v, vy: ty * v, life: 0, lane: true, up: false });
    }
    step(dt) {
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
      const segs = STATIC_SEGS.concat(this.hakama, this.attackerOpen ? [] : [ATTACKER_LID], this.denchuOpen ? [] : [DENCHU_LID]);
      for (const b of this.balls) {
        b.life += dt;
        if (b.life > 25) { this.stats.stuck = (this.stats.stuck || 0) + 1; continue; } // 引っかかった玉は消す
        // ステージ上を転がっている玉（行き先は乗った時点で決まる）
        if (b.stage) {
          const st = b.stage;
          st.t += dt;
          const k = Math.min(1, st.t / st.dur);
          const n = STAGE_PATH.length - 1;
          const f = (1 - Math.pow(1 - k, 2)) * n;
          const i = Math.min(n - 1, Math.floor(f)), u = f - i;
          const wob = Math.sin(k * Math.PI * st.swings) * (1 - k) * 10;
          b.x = STAGE_PATH[i][0] + (STAGE_PATH[i + 1][0] - STAGE_PATH[i][0]) * u + wob * 0.6;
          b.y = STAGE_PATH[i][1] + (STAGE_PATH[i + 1][1] - STAGE_PATH[i][1]) * u - BALL - 1;
          if (k >= 1) {
            b.stage = null;
            if (st.center) { b.x = STAGE_EXIT[0] + (this.rng() - 0.5) * 6; b.y = STAGE_EXIT[1]; b.vx = 0; b.vy = 30; }
            else {
              // ステージの手前にこぼれて、下の道釘のほうへ落ちる
              const p = 0.15 + this.rng() * 0.75;
              const [x1, y1, x2, y2] = STAGE_WALLS[1];
              b.x = x1 + (x2 - x1) * p; b.y = y1 + (y2 - y1) * p + BALL + 2; b.vx = (this.rng() - 0.5) * 20; b.vy = 10;
            }
          }
          keep.push(b);
          continue;
        }
        // ほとんど止まったままの玉は、実際の玉のように少し揺れて釘から落ちる。
        // 同じところで何度も止まる玉は、実機なら後ろの玉に押されて抜けるので、釘のすき間をすり抜けさせる
        if (!b.lane && b.vx * b.vx + b.vy * b.vy < 25) {
          b.slow = (b.slow || 0) + dt;
          if (b.slow > 0.4) {
            b.vx = (this.rng() < 0.5 ? -1 : 1) * (20 + this.rng() * 25); b.vy = -12; b.slow = 0;
            b.nudges = (b.nudges || 0) + 1;
            if (b.nudges >= 3) { b.ghost = 0.18; b.nudges = 0; b.vx *= 0.3; b.vy = 25; }
          }
        } else { b.slow = 0; if (b.vx * b.vx + b.vy * b.vy > 2500) b.nudges = 0; }
        if (b.ghost > 0) b.ghost -= dt;
        b.vy += G * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        const dx0 = b.x - CX, dy0 = b.y - CY;
        const d0 = Math.hypot(dx0, dy0);
        const ring = (lim, outside) => {
          // 円のレール：outside=false なら内側に押し戻す、true なら外側に押し出す
          if (outside ? d0 >= lim : d0 <= lim) return;
          const nx = dx0 / d0, ny = dy0 / d0;
          b.x = CX + nx * lim; b.y = CY + ny * lim;
          const vn = b.vx * nx + b.vy * ny;
          if (outside ? vn < 0 : vn > 0) { b.vx -= vn * nx; b.vy -= vn * ny; }
          const fr = Math.exp(-RAIL_FRICTION * dt);
          b.vx *= fr; b.vy *= fr;
        };
        if (b.lane) {
          // 打ち出しレーン：外レールと内レールのあいだ
          ring(R - BALL, false);
          if (b.y > RAIL_TOP_Y && b.x < CX) ring(R_IN + BALL, true);
          if (b.y < RAIL_TOP_Y && b.x < CX + 40) { b.lane = false; b.up = true; }
          // 盤面まで届かずに戻ってきた玉（ファウル）
          if (b.vy > 0 && b.y > LANE_BOTTOM_Y + 2) { this.stats.out++; continue; }
          keep.push(b);
          continue;
        }
        // 盤面の外枠：左は内レール（その上は外レール）、右は外レールの円、その下はまっすぐな枠
        if (b.x < CX) {
          if (b.y < RAIL_TOP_Y) ring(R - BALL, false);
          else if (b.y < LANE_BOTTOM_Y) ring(R_IN - BALL, false);
        } else if (b.y < RIGHT_WALL_Y) ring(R - BALL, false);
        else if (b.x > RIGHT_X - BALL) { b.x = RIGHT_X - BALL; b.vx = -Math.abs(b.vx) * 0.4; }

        // 液晶の枠
        if (b.x > LCD.x0 - BALL && b.x < LCD.x1 + BALL && b.y > LCD.y0 - BALL && b.y < LCD.y1 + BALL) {
          const dl = b.x - (LCD.x0 - BALL), dr = LCD.x1 + BALL - b.x, dtp = b.y - (LCD.y0 - BALL), db = LCD.y1 + BALL - b.y;
          const m = Math.min(dl, dr, dtp, db);
          if (m === dtp) { b.y = LCD.y0 - BALL; b.vy = -Math.abs(b.vy) * 0.3; b.vx += (b.x < CX ? -1 : 1) * 12; }
          else if (m === db) { b.y = LCD.y1 + BALL; b.vy = Math.abs(b.vy) * 0.3; }
          else if (m === dl) { b.x = LCD.x0 - BALL; b.vx = -Math.abs(b.vx) * 0.3; }
          else { b.x = LCD.x1 + BALL; b.vx = Math.abs(b.vx) * 0.3; }
        }
        // ワープの入口
        if (b.x > WARP_IN[0][0] && b.x < WARP_IN[1][0] && b.y > WARP_IN[0][1] && b.y < WARP_IN[1][1]) {
          this.stats.warp = (this.stats.warp || 0) + 1;
          b.warped = true;
          b.stage = { t: 0, dur: 1.4 + this.rng() * 0.8, swings: 1 + Math.floor(this.rng() * 3), center: this.rng() < STAGE_CENTER };
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
            b.vx += -ny * 60 * WINDMILL.spin * dt * 60;
            b.vy += nx * 60 * WINDMILL.spin * dt * 60;
          }
        }
        // レール・壁（線分）。すり抜け中の玉もレールは通り抜けない（釘のすき間だけ）
        for (const [x1, y1, x2, y2] of segs) {
          const ex = x2 - x1, ey = y2 - y1;
          const t = Math.max(0, Math.min(1, ((b.x - x1) * ex + (b.y - y1) * ey) / (ex * ex + ey * ey)));
          const px = x1 + ex * t, py = y1 + ey * t;
          const dx = b.x - px, dy = b.y - py;
          const d = Math.hypot(dx, dy);
          if (d < BALL + 0.6 && d > 1e-6) {
            const nx = dx / d, ny = dy / d;
            b.x = px + nx * (BALL + 0.6);
            b.y = py + ny * (BALL + 0.6);
            const vn = b.vx * nx + b.vy * ny;
            if (vn < 0) { b.vx -= 1.25 * vn * nx; b.vy -= 1.25 * vn * ny; }
          }
        }
        // 釘
        if (!(b.ghost > 0)) for (const p of this.nearPins(b.x, b.y)) {
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
              b.vx += (this.rng() - 0.5) * 12;
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
        if (this.denchuOpen && Math.abs(b.x - DENCHU.x) < DENCHU.w && b.y > DENCHU.y - 4 && b.y < DENCHU.y + 4) {
          this.stats.denchu++;
          this.handlers.onDenchu && this.handlers.onDenchu();
          continue;
        }
        if (this.attackerOpen && b.x > ATTACKER.x0 && b.x < ATTACKER.x1 && b.y > ATTACKER.y - 6 && b.y < ATTACKER.y + 4) {
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
        if (b.y > H + 6 || b.x < -10 || b.x > W + 10) {
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
    const line = (segs, color, w) => {
      g.strokeStyle = color; g.lineWidth = w;
      for (const [x1, y1, x2, y2] of segs) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    };
    const aR = Math.asin((RIGHT_WALL_Y - CY) / R);            // 右の外枠が直線になる角度
    const aL = Math.PI - Math.asin((LANE_BOTTOM_Y - CY) / R); // 打ち出しレーンの下端の角度

    function draw() {
      g.clearRect(0, 0, W, H);
      // 盤面（外枠の内側）
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#2a2150");
      bg.addColorStop(1, "#16112c");
      g.fillStyle = bg;
      g.beginPath();
      g.arc(CX, CY, R, aL, aR + Math.PI * 2, false);
      g.lineTo(RIGHT_X, H);
      for (let i = LEFT_EDGE.length - 1; i >= 0; i--) g.lineTo(LEFT_EDGE[i][0], LEFT_EDGE[i][1]);
      g.closePath();
      g.fill();
      // 外レールと内レール
      g.strokeStyle = "#f3c252"; g.lineWidth = 2;
      g.beginPath(); g.arc(CX, CY, R, aL, aR + Math.PI * 2, false); g.lineTo(RIGHT_X, H); g.stroke();
      g.strokeStyle = "rgba(243,194,82,.8)"; g.lineWidth = 1.5;
      g.beginPath(); g.arc(CX, CY, R_IN, Math.PI - Math.asin((LANE_BOTTOM_Y - CY) / R_IN), Math.PI + Math.asin((CY - RAIL_TOP_Y) / R_IN), false); g.stroke();
      line(segsOf(LEFT_EDGE), "rgba(243,194,82,.8)", 1.5);
      // 液晶の枠と飾り
      g.fillStyle = "#0d0a1e";
      g.strokeStyle = "#e4412f";
      g.lineWidth = 2;
      g.beginPath();
      g.roundRect ? g.roundRect(LCD.x0, LCD.y0, LCD.x1 - LCD.x0, LCD.y1 - LCD.y0, 8) : g.rect(LCD.x0, LCD.y0, LCD.x1 - LCD.x0, LCD.y1 - LCD.y0);
      g.fill();
      g.stroke();
      g.fillStyle = "#3a2a6a";
      g.beginPath(); g.moveTo(ROOF[0][0], ROOF[0][1]); g.lineTo(ROOF[0][2], ROOF[0][3]); g.lineTo(ROOF[1][2], ROOF[1][3]); g.closePath(); g.fill();
      line(ROOF, "#f3c252", 1.5);
      // ワープの通路（液晶の左）とステージ
      g.fillStyle = "rgba(140,200,255,.25)";
      g.beginPath(); g.moveTo(WARP_IN[0][0], WARP_IN[0][1]); g.lineTo(LCD.x0, WARP_IN[1][1]); g.lineTo(LCD.x0, LCD.y1); g.lineTo(FUNNEL[1][2], FUNNEL[1][3]); g.lineTo(FUNNEL[0][2], FUNNEL[0][3]); g.closePath(); g.fill();
      line(FUNNEL, "#8cc8ff", 1.5);
      g.fillStyle = "rgba(13,10,30,.85)";
      g.beginPath(); g.moveTo(LCD.x0, LCD.y1); for (const s of STAGE_WALLS) g.lineTo(s[2], s[3]); g.lineTo(LCD.x1, LCD.y1); g.closePath(); g.fill();
      line(STAGE_WALLS, "#f3c252", 1.5);
      line(segsOf(STAGE_PATH), "rgba(243,194,82,.5)", 1);
      // 右打ちの通路
      line(RIGHT_WALLS, "#9a8fb5", 2);
      // アタッカー
      g.fillStyle = board.attackerOpen ? "#ffd257" : "#4a3a5a";
      g.fillRect(ATTACKER.x0, ATTACKER.y + 1, ATTACKER.x1 - ATTACKER.x0, 5);
      if (!board.attackerOpen) line([ATTACKER_LID], "#ff5a5a", 2);
      g.fillStyle = "#fff"; g.font = "6px sans-serif"; g.textAlign = "center";
      g.fillText("アタッカー", (ATTACKER.x0 + ATTACKER.x1) / 2, ATTACKER.y + 13);
      // 電チュー
      line([DENCHU_SLIDE], "#c9b97a", 2);
      g.fillStyle = board.denchuOpen ? "#ffd257" : "#7a6a3a";
      g.fillRect(DENCHU.x - 5, DENCHU.y + 2, 10, 3);
      if (!board.denchuOpen) line([DENCHU_LID], "#ffd257", 1.5);
      g.fillStyle = "#fff"; g.fillText("電チュー", DENCHU.x + 10, DENCHU.y - 6);
      // ヘソとハカマ
      line(board.hakama, "#e4412f", 1.5);
      g.fillStyle = "#e4412f";
      g.fillRect(HESO.x - 4, HESO.y + 2, 8, 3);
      g.fillStyle = "#fff"; g.fillText("ヘソ", HESO.x, HESO.y + 12);
      // 一般入賞口
      g.fillStyle = "#4fd88f";
      for (const pk of POCKETS) g.fillRect(pk.x - 4, pk.y + 2, 8, 2.5);
      // 風車
      g.save();
      g.translate(WINDMILL.x, WINDMILL.y);
      g.rotate((performance.now() / 300) % (Math.PI * 2));
      g.fillStyle = "#e4412f";
      for (let i = 0; i < 4; i++) { g.rotate(Math.PI / 2); g.fillRect(-1, 0, 2, WINDMILL.r + 1); }
      g.restore();
      // 釘
      g.fillStyle = "#d8d2ea";
      for (const p of board.pins) {
        g.beginPath();
        g.arc(p[0], p[1], 1.25, 0, 7);
        g.fill();
      }
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
