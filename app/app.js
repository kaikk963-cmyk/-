// 台の進行（打ち出し・保留・BONUS・RUSH）と、データカウンター・メニューの表示。
(function () {
  const D = window.GENSOU_DATA;
  const S = D.SPEC;
  const engine = window.createEngine(D);
  const KEY = "gensou-danmaku-v1";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString("ja-JP");

  const DEFAULT_CUSTOM = { senbare: "s40", sakiyomi: "osusume", leverBuru: "off", impact: "off", rushMode: "default", challenge: "koumakan", chargeMode: "toppa" };
  const DEFAULT_SETTINGS = { boardV: 8, board: "on", shot: "left", autoShot: "on", leftStrength: 45, rightStrength: 90, hesoOpen: 2.25, rate: 18, speed: "real", autoPush: "off", sound: "on", bgm: "off", volume: 0.7, vibe: "on", showRel: "on", presetYakumono: "std", presetSenbare: "std", spec: "middle", tomeuchi: "on" };
  const SPEEDS = { real: 1, slow: 1.35, normal: 1, fast: 0.5, turbo: 0.2 };
  const SPEED_LABEL = { real: "実機", normal: "標準", fast: "高速", turbo: "爆速" };
  const DEFAULT_DEV = { overrides: {}, force: "none", senbare: "off", rush6000: null, dropBtn: "on" };

  function fresh(custom, settings, dev) {
    return {
      v: 1,
      balls: 0, invested: 0, totalOut: 0, usedBalls: 0,
      fired: 0, returns: 0, // 玉の出入りの記録（持ち玉 = 貸し玉 + 払い出し + 入賞の戻り − 打ち出し）
      spins: 0, sinceBonus: 0, rushSpins: 0,
      hits: 0, charges: 0, rushEntries: 0, rushHits: 0,
      mode: "normal", stLeft: 0, chain: 0, chainBalls: 0, maxChain: 0,
      holds: [], rushHolds: [],
      history: [], graph: [0], log: [],
      completed: false,
      devV: 3,
      custom: { ...DEFAULT_CUSTOM, ...custom },
      settings: { ...DEFAULT_SETTINGS, ...settings },
      dev: { ...DEFAULT_DEV, ...dev },
    };
  }

  function load() {
    try {
      return migrate(JSON.parse(localStorage.getItem(KEY)));
    } catch {
      return null;
    }
  }

  // 古い版で保存されたデータを今の形にそろえる
  function migrate(s) {
    try {
      if (!s || s.v !== 1) return null;
      s.custom = { ...DEFAULT_CUSTOM, ...s.custom };
      s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
      // 盤面を液晶埋め込み型に作り直したので、打ち出しの強さと命釘は新しい初期値に戻す
      if (s.settings.boardV !== DEFAULT_SETTINGS.boardV) {
        for (const k of ["boardV", "leftStrength", "rightStrength", "hesoOpen"]) s.settings[k] = DEFAULT_SETTINGS[k];
      }
      s.dev = { ...DEFAULT_DEV, ...s.dev };
      // 役物投下ボタンは最初から出す（以前は初期OFFだった）
      if ((s.devV || 0) < 2) s.dev.dropBtn = "on";
      // 確定演出（EX先バレ・復活）の信頼度は100%固定にした。以前に書き換わった値は消す
      if ((s.devV || 0) < 3) {
        for (const k of Object.keys(s.dev.overrides || {})) {
          if (/^(senbare\.ex|revive|reviveRush):/.test(k)) delete s.dev.overrides[k];
        }
      }
      s.devV = 3;
      s.fired = s.fired || 0;
      s.returns = s.returns || 0;
      if (!D.CUSTOMS.senbare.choices[s.custom.senbare]) s.custom.senbare = DEFAULT_CUSTOM.senbare;
      return s;
    } catch {
      return null;
    }
  }

  let state = null;
  let stage = null;
  let cloudOn = false;
  let startSavedAt = 0;
  let running = false;
  let handleOn = false;
  let current = null;
  let fireAcc = 0;
  let inBonus = false;
  let pendingReset = false;
  let started = false;

  function save() {
    state.savedAt = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
    window.GensouCloud.saveState(state);
  }

  // アカウント側の保存と同期する。新しいほうのプレイデータを使い、素材は双方向にそろえる
  async function syncCloud() {
    const C = window.GensouCloud;
    if (!(await C.init())) return;
    cloudOn = true;
    const remote = migrate(await C.loadState());
    // 起動時に端末から読めたデータの保存時刻と比べる（起動直後の保存で新しく見えないように）
    if (remote && (remote.savedAt || 0) > startSavedAt && !running && !handleOn) {
      state = remote;
      current = null;
      applyDev();
      stage.setMode(state.mode);
      window.Sound.setTheme(state.mode === "rush" ? "rush" : "normal");
      applySettings();
      setShot(state.settings.shot);
      board.setHeso(state.settings.hesoOpen);
      render();
    } else {
      save();
    }
    const A = window.GensouAssets;
    let changed = false;
    for (const key of C.artKeys()) {
      if (A.blob(key)) continue;
      const blob = await C.fetchArt(key);
      if (blob) {
        await A.put(key, blob);
        changed = true;
      }
    }
    if (C.canStoreArt()) {
      for (const key of A.keys()) if (!C.artKeys().includes(key)) await C.putArt(key, A.blob(key));
    }
    if (changed) {
      stage.refreshArt();
      loadCustomSounds();
    }
    if (!$("menu").hidden) renderMenu();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const speedFactor = () => SPEEDS[state.settings.speed] || 1;

  // ---------------- 打ち出しと保留 ----------------

  const entryProb = () => state.settings.rate / S.rent.balls;

  function rent() {
    state.balls += S.rent.balls;
    state.invested += S.rent.yen;
  }

  function addHold() {
    if (state.holds.length >= S.holdMax) { // オーバー入賞（保留が満タン）。回転は増えないので、液晶の保留表示で知らせる
      if (state.mode === "normal") stage.overEntry();
      return;
    }
    const hold = engine.makeHold("normal", state.custom, takeForce("normal"));
    hold.shown = hold.reveal === "entry" ? hold.color : null;
    if (hold.senbare) hold.shown = "yin"; // 先バレした保留は陰陽玉の保留になる
    state.holds.push(hold);
    entryArrived();
    // RUSH中のヘソ入賞は表に出さずに貯めておく（RUSH終了後に消化）
    if (state.mode === "rush") return;
    renderHolds();
    stage.entry(state.holds.length - 1, hold);
  }

  function addRushHold() {
    if (state.rushHolds.length >= S.holdMax) return;
    const hold = engine.makeHold("rush", state.custom, takeForce("rush"));
    hold.shown = hold.reveal === "entry" ? hold.color : null;
    state.rushHolds.push(hold);
    entryArrived();
    renderHolds();
    stage.entry(state.rushHolds.length - 1, hold);
  }

  // ---------------- 物理盤面 ----------------

  const useBoard = () => state.settings.board === "on";
  let board = null;
  let boardView = null;
  let tomeuchi = false; // 止め打ち中（保留満タンで打ち出しを止めている）
  let entryWaiters = [];

  function entryArrived() {
    const w = entryWaiters;
    entryWaiters = [];
    w.forEach((r) => r());
  }
  // 入賞を待つ（ハンドルを離したときに抜けられるよう、少しずつ確認する）
  const waitEntry = () => new Promise((r) => {
    entryWaiters.push(r);
    setTimeout(r, 400);
  });

  function setupBoard() {
    const B = window.GensouBoard;
    // 盤面の形（縦横比）と液晶の位置を、盤面のデータに合わせる
    const mb = document.querySelector(".machine-board");
    if (mb) {
      mb.style.setProperty("--board-ar", `${B.W} / ${B.H}`);
      mb.style.setProperty("--lcd-l", `${(B.LCD.x0 / B.W) * 100}%`);
      mb.style.setProperty("--lcd-t", `${(B.LCD.y0 / B.H) * 100}%`);
      mb.style.setProperty("--lcd-w", `${((B.LCD.x1 - B.LCD.x0) / B.W) * 100}%`);
      mb.style.setProperty("--lcd-h", `${((B.LCD.y1 - B.LCD.y0) / B.H) * 100}%`);
    }
    board = new B.Board({
      hesoOpen: state.settings.hesoOpen,
      handlers: {
        onFire() {
          if (state.balls <= 0) rent();
          state.balls--;
          state.fired++;
          if (state.mode === "normal" && !inBonus) state.usedBalls++;
          scheduleRender();
          return true;
        },
        onHeso() {
          state.balls += 1;
          state.returns += 1;
          addHold();
          scheduleRender();
        },
        onDenchu() {
          if (inBonus) return;
          state.balls += 1;
          state.returns += 1;
          if (state.mode === "rush") addRushHold();
          scheduleRender();
        },
        onAttacker() {
          if (roundHook) roundHook();
        },
        onPocket(n) {
          state.balls += n;
          state.returns += n;
          scheduleRender();
        },
      },
    });
    board.strength = state.settings.leftStrength;
    boardView = B.createBoardView($("board"), board);
    let last = performance.now();
    const frame = (t) => {
      // 先に次のフレームを予約しておく（途中で例外が出ても盤面が止まらないように）
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      try {
      // 盤面は常に描く（物理演算OFFのときは玉を打たない）
      // 止め打ち：保留が満タンのあいだは打ち出しを止める（オーバー入賞で玉をむだにしない。BONUS中は止めない）
      const full = !inBonus && (state.mode === "rush" ? state.rushHolds.length : state.holds.length) >= S.holdMax;
      tomeuchi = useBoard() && handleOn && full && state.settings.tomeuchi === "on";
      board.firing = useBoard() && handleOn && !state.completed && !tomeuchi;
      board.mode = inBonus ? "bonus" : state.mode;
      // 演出スピードを上げても、盤面（玉の動きと打ち出し）は最大2.5倍まで。速すぎると保留が追いつかずオーバー入賞ばかりになる
      board.step(dt * Math.min(2.5, 1 / speedFactor()));
      boardView.draw();
      if (useBoard()) renderShotHint();
      } catch (e) {
        console.error(e);
      }
    };
    requestAnimationFrame(frame);
  }

  // 大当り1ラウンド：アタッカーを開き、10カウント（とその直後のオーバー入賞）か開放時間切れで閉じる。
  // 1カウントにつき15発の払い出し。盤面を使わないときは null を返して決まった出玉にする
  let roundHook = null;
  function bonusRound(onCount) {
    if (!useBoard()) return Promise.resolve(null);
    return new Promise((resolve) => {
      let count = 0;
      let paid = 0;
      let done = false;
      let closing = null;
      const finish = () => {
        if (done) return;
        done = true;
        board.attackerOpen = false;
        roundHook = null;
        clearTimeout(limit);
        clearTimeout(closing);
        resolve(paid);
      };
      roundHook = () => {
        count++;
        paid += S.attackerPay;
        onPayout(S.attackerPay);
        onCount(count, paid);
        if (count >= 10 && !closing) closing = setTimeout(finish, 250 * speedFactor());
      };
      board.attackerOpen = true;
      const limit = setTimeout(finish, 30000 * speedFactor());
    });
  }

  let lastHint = "";
  function renderShotHint() {
    const needRight = inBonus || state.mode === "rush";
    // 自動打ち分け：RUSH・BONUS中は右打ち、通常時は左打ちに切り替える
    if (state.settings.autoShot === "on" && (state.settings.shot === "right") !== needRight) setShot(needRight ? "right" : "left");
    const right = state.settings.shot === "right";
    const text = needRight && !right ? "右打ちしてください ▶" : !needRight && right && handleOn ? "◀ 通常時は左打ち" : tomeuchi ? "保留満タン・止め打ち中" : "";
    if (text !== lastHint) {
      lastHint = text;
      $("shotHint").textContent = text;
      $("shotHint").hidden = !text;
      // BONUS・チャージ中に左打ちのままだとアタッカーに入らないので、目立たせて振動でも知らせる
      const urgent = needRight && !right && inBonus;
      $("shotHint").classList.toggle("urgent", urgent);
      if (urgent) vibrate([120, 60, 120]);
    }
  }

  // 左打ち／右打ち。強さはそれぞれ開発者タブで調整できる
  function setShot(shot) {
    state.settings.shot = shot;
    board.strength = shot === "right" ? state.settings.rightStrength : state.settings.leftStrength;
    $("leftShot").setAttribute("aria-pressed", String(shot === "left"));
    $("rightShot").setAttribute("aria-pressed", String(shot === "right"));
    save();
  }

  function fireBalls(n) {
    for (let i = 0; i < n; i++) {
      if (state.balls <= 0) rent();
      state.balls--;
      state.fired++;
      state.usedBalls++;
      if (Math.random() < entryProb()) addHold();
    }
  }

  // 演出の名目時間ぶん打ち出す（変動中にも保留が貯まる）
  function onTime(ms) {
    if (useBoard() || !handleOn || state.mode !== "normal" || inBonus || state.completed) return;
    fireAcc += (ms / 60000) * S.firePerMin;
    const n = Math.floor(fireAcc);
    fireAcc -= n;
    if (n) {
      fireBalls(n);
      scheduleRender();
    }
  }

  async function fireUntilEntry() {
    let fired = 0;
    while (!state.holds.length && handleOn && fired < 3000) {
      fireBalls(1);
      fired++;
    }
    scheduleRender();
    await sleep(Math.min(700, 120 + fired * 18) * speedFactor());
  }

  function topUpRushHolds() {
    while (state.rushHolds.length < S.holdMax) {
      const hold = engine.makeHold("rush", state.custom, takeForce("rush"));
      hold.shown = hold.reveal === "entry" ? hold.color : null;
      state.rushHolds.push(hold);
      renderHolds();
      stage.entry(state.rushHolds.length - 1, hold);
    }
  }

  // ---------------- 変動 ----------------

  async function spinNormal() {
    const hold = state.holds.shift();
    current = hold;
    state.spins++;
    state.sinceBonus++;
    renderHolds();
    renderCounters();
    // 先バレした保留が後ろに控えている間は、実機の先バレ専用ムービーと同じく予告なしですぐ止める
    const waiting = !hold.senbare && hold.result.kind === "miss" && state.holds.some((h) => h.senbare);
    const sc = waiting ? engine.quietScenario(hold) : engine.normalScenario(hold, state.custom);
    if (hold.senbare) sc.steps.unshift({ t: "card", id: "touga", title: "先バレ", text: "当該変動", color: "gold" });
    await stage.play(sc.steps, { short: state.holds.length >= 3, real: state.settings.speed === "real", holds: state.holds.length });
    current = null;
    if (hold.result.kind === "hit") await bonusNormal(hold, sc.digits);
    else if (hold.result.kind === "charge") await chargeHit(hold);
    afterSpin();
  }

  async function spinRush() {
    if (!useBoard()) topUpRushHolds();
    const hold = state.rushHolds.shift();
    current = hold;
    state.stLeft--;
    state.rushSpins++;
    renderHolds();
    renderStatus();
    const sc = engine.rushScenario(hold, state.custom);
    await stage.play(sc.steps, { short: true, real: state.settings.speed === "real", rush: true });
    current = null;
    if (hold.result.kind === "hit") {
      const used = S.stSpins - state.stLeft;
      state.rushHits++;
      state.chain++;
      const got = await runBonus(engine.bonusSteps(hold.result, sc.digits, "rush", state.custom));
      state.chainBalls += got;
      state.stLeft = S.stSpins;
      state.maxChain = Math.max(state.maxChain, state.chain);
      addHistory({ type: "rush", label: `弾幕RUSH ${state.chain}連目${hold.result.big ? `（${S.labels.big}）` : ""}${hold.forcedDrop ? "（役物投下）" : ""}`, balls: got, at: used });
    } else if (state.stLeft <= 0) {
      await endRush();
    }
    afterSpin();
  }

  async function runBonus(steps) {
    inBonus = true;
    const before = state.totalOut;
    await stage.play(steps);
    inBonus = false;
    return state.totalOut - before;
  }

  async function bonusNormal(hold, digits) {
    state.hits++;
    const at = state.sinceBonus;
    state.sinceBonus = 0;
    const got = await runBonus(engine.bonusSteps(hold.result, digits, "normal", state.custom));
    const tag = hold.forcedDrop ? "（役物投下）" : "";
    addHistory({ type: hold.result.rush ? "rush" : "bonus", label: (hold.result.rush ? "異変解決BONUS → 弾幕RUSH" : "異変解決BONUS（RUSH非突入）") + tag, balls: got, at });
    if (hold.result.rush) enterRush(got);
    else stage.setMode("normal");
  }

  async function chargeHit(hold) {
    state.charges++;
    const at = state.sinceBonus;
    state.sinceBonus = 0;
    const got = await runBonus(engine.bonusSteps(hold.result, null, "normal", state.custom));
    addHistory({ type: hold.result.rush ? "rush" : "bonus", label: hold.result.rush ? "霊力チャージ → 昇格RUSH" : "霊力チャージ", balls: got, at });
    if (hold.result.rush) enterRush(got);
    else stage.setMode("normal");
  }

  function enterRush(firstBalls) {
    state.mode = "rush";
    state.stLeft = S.stSpins;
    state.chain = 1;
    state.chainBalls = firstBalls;
    state.maxChain = Math.max(state.maxChain, 1);
    state.rushEntries++;
    state.rushHolds = [];
    stage.setMode("rush");
    window.Sound.setTheme("rush");
    render();
  }

  // 役物投下ボタン：いま陰陽玉を落とす。実機の手落下と同じく確定ではなく、
  // 次に回る保留（なければ次の入賞）の当否を、落下の信頼度（通常音 約72%・低音/高音は濃厚）で決め直す
  let yakuPending = false;
  function yakumonoDrop() {
    window.Sound.unlock();
    const rush = state.mode === "rush";
    const list = rush ? state.rushHolds : state.holds;
    if (list.length && list[0].forcedDrop) return; // 次の変動にはもう落ちている
    let h = null;
    if (list.length) {
      h = engine.makeHold(rush ? "rush" : "normal", state.custom, { drop: true });
      h.shown = list[0].shown;
      list[0] = h;
      renderHolds();
    } else {
      yakuPending = true;
    }
    stage.drop(h && h.forcedDrop.sound === "high" ? "high" : h && h.forcedDrop.sound === "low" ? "low" : "normal", false, "yakumono");
    if (h) onLog(h.forcedDrop.info);
    showToast(list.length ? "役物落下！次の変動に注目" : "役物落下！次の入賞に注目");
    save();
  }

  // 開発者用：RUSHを強制的に終わらせる（変動中なら、その変動とBONUSが終わってから）
  let endRushRequested = false;
  function requestEndRush() {
    if (state.mode !== "rush") return;
    endRushRequested = true;
    if (!running) {
      running = true;
      endRush().finally(() => {
        running = false;
        afterSpin();
      });
    }
  }

  async function endRush() {
    endRushRequested = false;
    const line = D.SERIFU.rushEnd[Math.floor(Math.random() * D.SERIFU.rushEnd.length)];
    await stage.play([{ t: "rushEnd", chain: state.chain, balls: state.chainBalls }, { t: "serif", char: line[0], text: line[1], color: "white" }]);
    addHistory({ type: "end", label: `弾幕RUSH終了 ${state.chain}連`, balls: state.chainBalls, at: null });
    state.mode = "normal";
    state.stLeft = 0;
    state.chain = 0;
    state.chainBalls = 0;
    state.rushHolds = [];
    stage.setMode("normal");
    window.Sound.setTheme("normal");
  }

  function afterSpin() {
    const diff = state.balls - state.invested / (S.rent.yen / S.rent.balls);
    state.graph.push(Math.round(diff));
    if (state.graph.length > 3000) state.graph = state.graph.filter((_, i) => i % 2 === 0);
    save();
    render();
  }

  function onPayout(n) {
    state.balls += n;
    state.totalOut += n;
    if (state.totalOut >= S.complete && !state.completed) {
      state.completed = true;
      setHandle(false);
      showComplete();
    }
    scheduleRender();
  }

  function addHistory(item) {
    state.history.unshift({ ...item, spin: state.spins });
    if (state.history.length > 200) state.history.length = 200;
  }

  async function loop() {
    if (running) return;
    running = true;
    try {
      while (!state.completed && !pendingReset) {
        if (state.mode === "rush" && endRushRequested) {
          await endRush();
          afterSpin();
        } else if (state.mode === "rush") {
          if (!handleOn && !state.rushHolds.length) break;
          if (useBoard() && !state.rushHolds.length) await waitEntry();
          else await spinRush();
        } else if (!state.holds.length) {
          if (!handleOn) break;
          if (useBoard()) await waitEntry();
          else await fireUntilEntry();
        } else {
          await spinNormal();
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      running = false;
      if (pendingReset) doReset();
      render();
    }
  }

  // ---------------- 操作 ----------------

  function setHandle(on) {
    handleOn = on;
    if (on) {
      window.Sound.unlock();
      hideHint();
      if (state.completed) return;
      loop();
    }
    renderControls();
  }

  function press(src) {
    window.Sound.unlock();
    if (!stage.input(src)) window.Sound.play("press");
  }

  function vibrate(pattern) {
    if (state.settings.vibe !== "on") return;
    try { navigator.vibrate && navigator.vibrate(pattern); } catch {}
  }

  function hideHint() {
    const n = document.querySelector(".start-hint");
    if (n) n.remove();
    started = true;
  }

  function showComplete() {
    stage.overlay(`コンプリート<small>出玉が${fmt(S.complete)}発に達したため遊技終了です。データタブからリセットできます。</small>`, "complete");
  }

  // ---------------- 表示 ----------------

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderCounters();
      renderControls();
    });
  }

  function render() {
    renderHolds();
    renderStatus();
    renderCounters();
    renderControls();
    renderHistory();
    renderLog();
    renderGraph();
  }

  function renderHolds() {
    const list = state.mode === "rush" ? state.rushHolds : state.holds;
    stage.renderHolds(current, list);
    // 先バレ演出中：先バレした保留の変動（当該変動）まであと何回か
    const k = state.mode === "normal" ? state.holds.findIndex((h) => h.senbare) : -1;
    stage.senbareBanner(k >= 0 ? k + 1 : current && current.senbare && state.mode === "normal" ? 0 : -1);
  }

  function renderStatus() {
    if (state.mode === "rush") {
      stage.setStatus(`<span class="chip rush">弾幕RUSH ${state.chain}連</span><span class="chip st">残り${state.stLeft}</span>`);
    } else {
      stage.setStatus(`<span class="chip">通常</span><span class="chip st">${state.sinceBonus}</span>`);
    }
    // ミドル以外のときは、いまのスペックを液晶に出す
    if (S.key !== "middle") stage.setStatus(`<span class="chip spec">${S.short}</span>${document.querySelector(".status").innerHTML}`);
    if (devActive()) stage.setStatus(`<span class="chip dev">DEV</span>${document.querySelector(".status").innerHTML}`);
  }

  // ---------------- 開発者モード ----------------
  // 陰陽玉落下・先バレの信頼度と出現割合をアプリ上で書き換える。
  // engine はデータのオブジェクトをそのまま読むので、値を書き換えれば次の抽選から反映される。

  // p はその演出の母数での大当り確率（出現頻度の計算用）。null は大当り時だけ出る演出。
  function devGroups() {
    const P = engine.P;
    const list = [];
    for (const k of Object.keys(D.SENBARE)) {
      list.push({ key: `senbare.${k}`, title: `先陰陽玉落下（${D.CUSTOMS.senbare.choices[k]}）`, group: D.SENBARE[k], p: P.spin, unit: "保留" });
    }
    list.push({ key: "hand", title: "陰陽玉落下（変動中）", group: D.NORMAL_YOKOKU.find((g) => g.id === "hand"), p: P.spin, unit: "回転" });
    list.push({ key: "sakura", title: "西行妖 開花予告（陰陽玉弱落下）", group: D.NORMAL_YOKOKU.find((g) => g.id === "sakura"), p: P.spin, unit: "回転" });
    list.push({ key: "spDrop", title: "SP発展時の陰陽玉落下", group: D.NORMAL_SP_YOKOKU.find((g) => g.id === "spDrop"), p: P.sp, unit: "SPリーチ" });
    list.push({ key: "revive", title: "復活演出", group: D.NORMAL_REVIVE, p: P.sp, unit: "SPリーチ" });
    list.push({ key: "reviveRush", title: "復活演出（RUSH中）", group: D.RUSH_REVIVE, p: P.rushSp, unit: "SPリーチ" });
    const seen = new Set();
    for (const r of [...D.NORMAL_REACH.options, ...D.RUSH_REACH.options]) {
      for (const g of r.subs || []) {
        if (seen.has(g)) continue;
        if (g.id === "drop") {
          seen.add(g);
          list.push({ key: `drop.${r.id}`, title: `${r.kind === "chara" ? "キャラリーチ（共通）" : r.label}の陰陽玉落下`, group: g, p: r.rel, unit: "リーチ" });
        } else if (g.id === "yakuTiming") {
          seen.add(g);
          list.push({ key: "yakuTiming", title: "デバイス時の陰陽玉落下（全SP共通）", group: g, p: null, unit: "" });
        }
      }
    }
    return list;
  }

  let devDefaults = null;
  const devKey = (d, o) => `${d.key}:${o.id}`;

  // 開発者モードの初期値（信頼度はミドルでの値。甘デジなどではここから自動で上がる）
  function snapshotDevDefaults() {
    devDefaults = { rush6000: S.rush6000Rate };
    for (const d of devGroups()) for (const o of d.group.options) devDefaults[devKey(d, o)] = { rel: engine.baseOf(o), share: o.share };
  }

  // スペック（ミドル・99ver.・甘デジ）を当てはめる
  function applySpec() {
    const key = D.SPECS[state.settings.spec] ? state.settings.spec : "middle";
    Object.assign(S, D.SPECS[key], { key });
    devDefaults.rush6000 = D.SPECS[key].rush6000Rate;
    if (state.mode === "rush") state.stLeft = Math.min(state.stLeft, S.stSpins);
    const b = $("specBtn");
    if (b) {
      b.textContent = S.short;
      b.dataset.spec = key;
      b.setAttribute("aria-label", `スペック：${S.label}（押すと切り替え）`);
    }
  }

  // 等価ボーダー（1000円あたりの回転数）。RUSH中・保留のロス分として少し上乗せする
  function border() {
    const c = 1 - Math.pow(1 - S.rushProb, S.stSpins);
    const per = S.payout.rush3000 * (1 - S.rush6000Rate) + S.payout.rush6000 * S.rush6000Rate;
    const rush = (c / (1 - c)) * per;
    const e = S.hitProb * (S.payout.bonus10R + S.hitRushRate * rush) + S.chargeProb * (S.payout.charge2R + S.chargeRushRate * rush);
    return (S.rent.balls / e) * 1.045;
  }

  // スペックを切り替えたら、まだ回っていない保留も新しい確率で引き直す（先バレ・役物投下した保留はそのまま）
  function redrawHolds() {
    const fresh = (h, mode) => {
      if (h.senbare || h.forcedDrop) return h;
      const n = engine.makeHold(mode, state.custom);
      n.shown = null;
      return n;
    };
    state.holds = state.holds.map((h) => fresh(h, "normal"));
    state.rushHolds = state.rushHolds.map((h) => fresh(h, "rush"));
    renderHolds();
  }

  function setSpec(key) {
    if (!D.SPECS[key] || key === state.settings.spec) return;
    state.settings.spec = key;
    applyDev();
    redrawHolds();
    save();
    render();
    showToast(`${D.SPECS[key].label}に切り替えました`);
    if (!$("menu").hidden) renderMenu();
  }

  let toastTimer = null;
  function showToast(text) {
    const t = $("toast");
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  function applyDev() {
    applySpec();
    for (const d of devGroups()) {
      for (const o of d.group.options) {
        const v = state.dev.overrides[devKey(d, o)] || devDefaults[devKey(d, o)];
        engine.setBase(o, v.rel);
        o.share = v.share;
      }
    }
    S.rush6000Rate = state.dev.rush6000 ?? devDefaults.rush6000;
    engine.recalc();
  }

  const devActive = () =>
    Object.keys(state.dev.overrides).length > 0 || state.dev.rush6000 != null || state.dev.force !== "none" || state.dev.senbare !== "off";

  // 次に入賞する保留の結果・先バレを固定する（1回だけ、先バレは毎回も可）
  function takeForce(mode) {
    if (yakuPending) {
      yakuPending = false;
      return { kind: null, senbare: false, drop: true };
    }
    const kind = state.dev.force !== "none" ? state.dev.force : null;
    const senbare = mode === "normal" && state.dev.senbare !== "off";
    if (!kind && !senbare) return null;
    if (kind) state.dev.force = "none";
    if (senbare && state.dev.senbare === "once") state.dev.senbare = "off";
    save();
    if (!$("menu").hidden && tab === "dev") renderMenu();
    return { kind, senbare };
  }

  // ハズレ時の出現率（engine と同じ式）と、母数あたりの出現頻度
  const missRate = (o, p) => (o.rel >= 1 ? 0 : (o.share * p * (1 - o.rel)) / (o.rel * (1 - p)));
  function devFreq(o, d) {
    if (d.p == null) return `当たりの${+(o.share * 100).toFixed(1)}%`;
    const per = d.p * o.share + (1 - d.p) * missRate(o, d.p);
    if (per <= 0) return "出ない";
    const n = 1 / per;
    return `約1/${n >= 100 ? fmt(n) : n.toFixed(1)}${d.unit}`;
  }
  function devWarn(d) {
    const hit = d.group.options.reduce((a, o) => a + o.share, 0);
    const miss = d.p == null ? 0 : d.group.options.reduce((a, o) => a + missRate(o, d.p), 0);
    const w = [];
    if (hit > 1) w.push("当たり時の合計が100%を超えているので、比率で配分されます。");
    if (miss > 1) w.push("ハズレ時に出る割合が100%を超えるので、実際の信頼度は設定より高くなります。");
    return w.join("");
  }

  function renderDev() {
    let body = `<p class="note">陰陽玉落下と先バレの出方を変えられます。<b>信頼度</b>はその演出が出たときの大当り率、<b>当たり時</b>は大当りのうち何%でその演出が出るか。ハズレ時の出方はこの2つから自動で決まり、右端にだいたいの出現頻度（いまのスペックでの値）が出ます。変更すると画面右上に DEV と表示されます。</p>`;
    if (S.key !== "middle") body += `<p class="note">いまは<b>${S.label}</b>です。信頼度の入力欄はライトミドルでの値で、甘デジでは実機の甘デジ版と同じく「ハズレ時の出方はそのまま・当たりやすくなった分だけ信頼度が上がる」ので、入力欄の下にいまのスペックでの信頼度を出しています。</p>`;
    body += field("次の入賞を固定（1回）", "次に入賞した保留1つの結果を固定する。RUSH中はハズレ以外が大当りになる。",
      seg("dev.force", { none: "なし", rushHit: "大当り→RUSH", hit: "大当り→通常", charge: "チャージ", miss: "ハズレ" }, state.dev.force));
    body += field("先バレを強制", "保留入賞時に陰陽玉を必ず落とす（先バレのカスタムがOFFでも落ちる）。当否は落ちた先バレの信頼度どおりに決まり、EXなら必ず大当り。",
      seg("dev.senbare", { off: "OFF", once: "次の1回", always: "毎回" }, state.dev.senbare));
    body += field("陰陽玉を今すぐ落とす", "役物を落とす演出だけを出す。抽選結果には関係しない。当たりにしたいときは「次の入賞を固定」と組み合わせる。音の差し替えは「サウンド」タブ。",
      `<div class="drop-btns"><button type="button" data-drop="normal">通常音</button><button type="button" data-drop="low">低音</button><button type="button" data-drop="high">高音</button><button type="button" data-drop="weak">弱落下</button></div>`);
    body += field("RUSHを強制終了", "弾幕RUSH中に押すと、今の変動（とBONUS）が終わったところでRUSHを終える。", `<button type="button" class="btn-danger" data-endrush ${state.mode === "rush" ? "" : "disabled"}>${state.mode === "rush" ? "RUSHを今すぐ終わらせる" : "RUSH中だけ押せます"}</button>`);
    body += field("メイン画面に役物投下ボタン", "PUSHとレバーの横に「役物投下」ボタンと、RUSH中は「RUSH終了」ボタンを出す（初期ON）。役物投下を押すと陰陽玉が落ちて、次の変動（保留がなければ次の入賞）の当否が実機の手落下と同じ信頼度（通常音 約72%・低音/高音は濃厚・RUSH中は大当り）で決まる。ボタンで出た大当りは履歴に「（役物投下）」と付く。", seg("dev.dropBtn", { off: "OFF", on: "ON" }, state.dev.dropBtn));
    for (const d of devGroups()) {
      const changed = d.group.options.some((o) => state.dev.overrides[devKey(d, o)]);
      const rows = d.group.options.map((o) => {
        const k = devKey(d, o);
        return `<tr><th>${o.label}${o.rushOnly ? "<br><small>RUSH直行のみ</small>" : ""}</th>
          <td><input class="num-in" type="number" inputmode="decimal" min="0.1" max="100" step="0.1" data-dev="${k}" data-field="rel" value="${+(engine.baseOf(o) * 100).toFixed(2)}" ${devDefaults[k] && devDefaults[k].rel >= 1 ? 'disabled title="確定演出なので100%固定"' : ""} aria-label="${o.label}の信頼度（%・ミドル基準）">${S.key !== "middle" && Math.abs(o.rel - engine.baseOf(o)) > 1e-6 ? `<small class="now-rel">${S.short}で${+(o.rel * 100).toFixed(1)}%</small>` : ""}</td>
          <td><input class="num-in" type="number" inputmode="decimal" min="0" max="100" step="0.1" data-dev="${k}" data-field="share" value="${+(o.share * 100).toFixed(2)}" aria-label="${o.label}の当たり時の出現割合（%）"></td>
          <td class="freq">${devFreq(o, d)}</td></tr>`;
      }).join("");
      const warn = devWarn(d);
      body += `<details class="dev-group" ${d.key.startsWith("senbare") || d.key === "hand" ? "open" : ""}>
        <summary>${d.title}${changed ? ' <span class="chip dev">変更中</span>' : ""}</summary>
        <div class="table-wrap"><table class="spec dev-table"><thead><tr><th>演出</th><th>信頼度%</th><th>当たり時%</th><th>出現</th></tr></thead><tbody>${rows}</tbody></table></div>
        ${warn ? `<p class="warn">${warn}</p>` : ""}</details>`;
    }
    const big = state.dev.rush6000 ?? devDefaults.rush6000;
    body += field("ハンドルの強さ（物理盤面）", "左打ち・右打ちを選んだときの打ち出しの強さ（0〜100）。左打ちは35〜55あたりで、玉が盤面の上まで上がってから左側に落ちる。",
      `<div class="drop-btns" style="grid-template-columns:auto 1fr auto 1fr;align-items:center">左<input class="num-in" type="number" min="0" max="100" step="1" data-strength="leftStrength" value="${state.settings.leftStrength}" aria-label="左打ちの強さ">右<input class="num-in" type="number" min="0" max="100" step="1" data-strength="rightStrength" value="${state.settings.rightStrength}" aria-label="右打ちの強さ"></div>`);
    body += field("ヘソ釘の開き（物理盤面）", "大きいほどヘソで弾かれにくく、よく回る。標準は2.25（約20回転/1000円）。", `<input id="hesoRange" class="range" type="range" min="0.5" max="2.5" step="0.25" value="${state.settings.hesoOpen}">`, `<b id="hesoVal">${state.settings.hesoOpen}</b>`);
    body += field(`夢想封印MAX（${S.labels.big}）の割合`, `RUSH中の大当りのうち、BONUS中に陰陽玉が落ちて${S.labels.big}になる割合（スペックごとの標準は${Math.round(devDefaults.rush6000 * 100)}%）。`,
      `<input class="num-in wide" type="number" inputmode="decimal" min="0" max="100" step="0.5" data-dev="rush6000" value="${+(big * 100).toFixed(2)}" aria-label="6000発の割合（%）">`, `<b>${+(big * 100).toFixed(1)}%</b>`);
    body += `<div class="field"><button type="button" class="btn-danger" id="devReset">すべて元の値に戻す</button></div>`;
    return body;
  }

  // ---------------- 立ち絵・背景の取り込み ----------------

  function artSlots() {
    const slots = Object.entries(D.CHARS).map(([k, c]) => {
      const d = D.DIGIT_CHARS.indexOf(k);
      return { key: `chara:${k}`, char: k, name: c.name, sub: d > 0 ? `図柄${d}・リーチ・カットイン` : "リーチ・予告" };
    });
    for (const [k, v] of Object.entries(D.STAGES)) slots.push({ key: `bg:${k}`, name: `背景：${v.name}`, sub: k === "shrine" ? "通常時" : "背景移行" });
    slots.push({ key: "scene:all", name: "集合絵", sub: "宴会予告（全員集合）・RUSH突入で全面に出る" });
    return slots;
  }

  // 取り込める効果音。種類ごとの音がないときは共通の音、それもなければ標準の音が鳴る
  // main: サウンドタブの上に大きく出すもの
  const SOUND_SLOTS = [
    { name: "yakumono", label: "役物投下ボタンの音", sub: "メイン画面の「役物 投下」ボタン。ないときは陰陽玉落下の音", main: true,
      tries: [["normal", "役物を落としてみる"]], trySound: "yakumono" },
    { name: "senbare", label: "先バレの音", sub: "保留入賞時の落下（低音・高音もこの音）。ないときは陰陽玉落下の音", main: true,
      tries: [["normal", "先バレ"], ["low", "先バレ（低音）"], ["high", "先バレ（高音）"]], trySound: "senbare" },
    { name: "drop", label: "陰陽玉落下（共通）", sub: "変動中・リーチ中の落下。種類ごとの音がないときに使う" },
    { name: "drop:normal", label: "陰陽玉落下（通常音）", sub: "変動中・リーチ中の通常の落下" },
    { name: "drop:low", label: "陰陽玉落下（低音・濃厚）", sub: "低音の落下" },
    { name: "drop:high", label: "陰陽玉落下（高音・濃厚）", sub: "高音の落下・デバイス時の落下" },
    { name: "weakDrop", label: "陰陽玉の弱落下", sub: "西行妖の開花予告など" },
    { name: "senbare:low", label: "先バレ（低音・濃厚）だけ", sub: "ないときは「先バレの音」" },
    { name: "senbare:high", label: "先バレ（高音・濃厚）だけ", sub: "ないときは「先バレの音」" },
    { name: "kyuin", label: "大当り", sub: "図柄がそろったとき" },
    { name: "rushIn", label: "RUSH突入", sub: "弾幕RUSH突入・継続" },
  ];

  // 役物投下・先バレで選べる内蔵の音
  const SOUND_PRESETS = { std: "標準", pokyun: "ポキュン", kyuin: "キュイン", don: "ドン", kiin: "キーン", piron: "ピロリン" };
  const PRESET_SETTING = { yakumono: "presetYakumono", senbare: "presetSenbare" };
  let soundMsg = null; // 取り込みの結果 { key, text, ok }

  function loadCustomSounds() {
    for (const sl of SOUND_SLOTS) window.Sound.setCustom(sl.name, window.GensouAssets.blob(`sound:${sl.name}`));
  }

  function renderArt() {
    const A = window.GensouAssets;
    let body = `<p class="note">キャラの立ち絵や背景を、この端末の画像から取り込めます。取り込んだ画像はこのブラウザの中だけに保存され、ほかの人には見えません。<br><b>フリー素材でも、使う前に各素材の利用規約を確認してください。</b>クレジット表記が必要なもの、再配布が禁止のもの、ギャンブル・パチンコ系での使用を禁止しているものがあります。立ち絵は背景が透過したPNGがきれいに出ます。</p>`;
    if (window.GensouCloud.canStoreArt()) body += `<p class="note">取り込んだ素材は claude.ai のアカウントにも保存されるので、アプリを閉じても消えません。</p>`;
    else if (!A.persistent()) body += `<p class="warn">この環境では画像を保存できないため、ページを閉じると取り込んだ画像は消えます。</p>`;
    body += artSlots().map((sl) => {
      const u = A.url(sl.key);
      const thumb = u ? `<img src="${u}" alt="">` : sl.char ? window.GensouStage.crestSVG(sl.char) : "";
      return `<div class="asset-row"><div class="thumb">${thumb}</div>
        <div class="name">${sl.name}<small>${sl.sub}</small></div>
        <div class="acts"><label class="btn">${u ? "変更" : "画像を選ぶ"}<input type="file" accept="image/*" data-asset="${sl.key}" aria-label="${sl.name}の画像"></label>
        ${u ? `<button type="button" data-asset-del="${sl.key}" aria-label="${sl.name}の画像を削除">削除</button>` : ""}</div></div>`;
    }).join("");
    body += `<p class="note">効果音（役物投下・先バレなど）の差し替えは「サウンド」タブからできます。</p>`;
    return body;
  }

  function soundRow(sl) {
    const key = `sound:${sl.name}`;
    const has = !!window.GensouAssets.blob(key);
    const msg = soundMsg && soundMsg.key === key ? `<p class="${soundMsg.ok ? "ok-msg" : "warn"}" role="status">${soundMsg.text}</p>` : "";
    const ps = PRESET_SETTING[sl.name];
    const presets = ps ? `<div class="preset"><span>内蔵の音から選ぶ${has ? "（取り込んだ音が優先）" : ""}</span>${seg(`settings.${ps}`, SOUND_PRESETS, state.settings[ps])}</div>` : "";
    return `<div class="asset-row${sl.main ? " main-sound" : ""}"><div class="thumb"><span aria-hidden="true">${has ? "♪" : "—"}</span></div>
      <div class="name">${sl.label}<small>${has ? `<b class="custom-on">取り込んだ音</b>` : ps && state.settings[ps] !== "std" ? `<b class="custom-on">内蔵：${SOUND_PRESETS[state.settings[ps]]}</b>` : "標準の音"}・${sl.sub}</small></div>
      <div class="acts"><button type="button" data-preview="${sl.name}" aria-label="${sl.label}を試し聴き">▶</button>
      <label class="btn pick">${has ? "変更" : "ファイル"}<input type="file" data-asset="${key}" aria-label="${sl.label}のファイルを選ぶ"></label>
      ${has ? `<button type="button" data-asset-del="${key}" aria-label="${sl.label}を標準に戻す">戻す</button>` : ""}</div></div>
      ${msg}${presets}
      ${sl.tries ? `<div class="drop-btns try-btns">${sl.tries.map(([k, t]) => `<button type="button" data-try="${k}" data-try-sound="${sl.trySound}">${t}</button>`).join("")}</div>` : ""}`;
  }

  function renderSound() {
    let body = `<p class="note">「内蔵の音から選ぶ」でボタンを押すだけで音が変わります。自分の音にしたいときは「ファイル」から、mp3・m4a・wav などの音声か、<b>音の入った動画</b>（写真アプリの動画でもOK）を選んでください。頭の無音は自動で詰め、長いものは8秒で切り、音量はほかの効果音にそろえます。<b>▶</b>で音だけ、下のボタンで実際に液晶に陰陽玉を落として確認できます（抽選には関係しません）。</p>`;
    if (window.GensouCloud.canStoreArt()) body += `<p class="note">取り込んだ音は claude.ai のアカウントにも保存されるので、アプリを閉じても消えません。</p>`;
    else if (!window.GensouAssets.persistent()) body += `<p class="warn">この環境では音を保存できないため、ページを閉じると取り込んだ音は消えます。</p>`;
    body += `<h3 class="art-head">役物投下・先バレ</h3>`;
    body += SOUND_SLOTS.filter((sl) => sl.main).map(soundRow).join("");
    body += `<details class="dev-group"><summary>ほかの効果音・種類ごとの音</summary>
      <p class="note">音を探す順番：種類ごとの音 → その場面の音 → 陰陽玉落下（共通）→ 標準の音。</p>
      ${SOUND_SLOTS.filter((sl) => !sl.main).map(soundRow).join("")}</details>`;
    return body;
  }

  async function onArtFile(el) {
    const file = el.files && el.files[0];
    const key = el.dataset.asset;
    if (!file) return;
    let blob = file;
    if (key.startsWith("sound:")) {
      soundMsg = { key, text: "読み込み中…", ok: true };
      renderMenu();
      const conv = await window.Sound.convert(file);
      if (!conv) {
        soundMsg = { key, text: `「${file.name || "ファイル"}」は音として読めませんでした。mp3・m4a・wav か、音の入った動画を選んでください。`, ok: false };
        return renderMenu();
      }
      blob = conv.blob;
      soundMsg = { key, text: `取り込みました（${conv.seconds.toFixed(1)}秒）。`, ok: true };
    }
    await window.GensouAssets.put(key, blob);
    loadCustomSounds();
    stage.refreshArt();
    renderMenu();
    if (key.startsWith("sound:")) window.Sound.preview(key.slice(6));
    const stored = await window.GensouCloud.putArt(key, blob);
    if (key.startsWith("sound:") && soundMsg && soundMsg.key === key) {
      if (stored) soundMsg.text += "アカウントにも保存したので、閉じても消えません。";
      else if (window.GensouCloud.isReady()) { soundMsg.text += "アカウントへの保存に失敗したので、この端末だけで使えます。"; soundMsg.ok = false; }
      if (!$("menu").hidden && tab === "sound") renderMenu();
    }
  }

  function onDevInput(el) {
    const k = el.dataset.dev;
    let v = parseFloat(el.value);
    if (!Number.isFinite(v)) return renderMenu();
    if (k === "rush6000") {
      v = Math.min(100, Math.max(0, v)) / 100;
      state.dev.rush6000 = v === devDefaults.rush6000 ? null : v;
    } else {
      const field = el.dataset.field;
      v = field === "rel" ? Math.min(100, Math.max(0.1, v)) / 100 : Math.min(100, Math.max(0, v)) / 100;
      const [gk, oid] = [k.slice(0, k.lastIndexOf(":")), k.slice(k.lastIndexOf(":") + 1)];
      const d = devGroups().find((x) => x.key === gk);
      const o = d && d.group.options.find((x) => x.id === oid);
      if (!o) return;
      // 信頼度の入力欄はミドル基準の値（甘デジではそこから自動で上がる）
      const def = devDefaults[k];
      if (field === "rel" && def.rel >= 1) return renderMenu(); // 確定演出（EX・復活など）は100%固定
      const next = { rel: field === "rel" ? v : engine.baseOf(o), share: field === "share" ? v : o.share };
      if (Math.abs(next.rel - def.rel) < 1e-9 && Math.abs(next.share - def.share) < 1e-9) delete state.dev.overrides[k];
      else state.dev.overrides[k] = next;
    }
    applyDev();
    save();
    renderStatus();
    renderMenu();
  }

  function renderCounters() {
    const yenPerBall = S.rent.yen / S.rent.balls;
    const balance = state.balls * yenPerBall - state.invested;
    const firstHits = state.hits + state.charges;
    const rate = state.usedBalls ? state.spins / (state.usedBalls / S.rent.balls) : 0;
    $("cBalls").textContent = fmt(state.balls);
    const bal = $("cBalance");
    bal.textContent = `${balance >= 0 ? "+" : ""}${fmt(balance)}円`;
    bal.className = balance >= 0 ? "plus" : "minus";
    $("cInvest").textContent = `${fmt(state.invested)}円`;
    $("cNow").textContent = state.mode === "rush" ? `ST ${state.stLeft}` : fmt(state.sinceBonus);
    $("cTotal").textContent = fmt(state.spins);
    $("cHits").textContent = `${firstHits}回`;
    $("cProb").textContent = firstHits ? `1/${(state.spins / firstHits).toFixed(1)}` : "—";
    $("cRush").textContent = `${state.rushEntries}回`;
    $("cMax").textContent = `${state.maxChain}連`;
    $("cRate").textContent = rate ? rate.toFixed(1) : "—";
    $("cOut").textContent = fmt(state.totalOut);
    $("cRushRate").textContent = firstHits ? `${Math.round((state.rushEntries / firstHits) * 100)}%` : "—";
  }

  function renderControls() {
    const devBtns = state.dev.dropBtn === "on";
    $("rushEndBtn").hidden = !(devBtns && state.mode === "rush");
    const hb = $("handleBtn");
    hb.classList.toggle("on", handleOn);
    hb.setAttribute("aria-pressed", String(handleOn));
    hb.querySelector(".lbl").textContent = handleOn ? (state.mode === "rush" ? "右打ち中" : "打ち出し中") : "打ち出し停止";
  }

  function relText(rel) {
    if (rel == null) return "";
    if (rel >= 1) return "濃厚";
    if (rel < 0.01) return "1%未満";
    return `${Math.round(rel * 100)}%`;
  }
  function relClass(rel) {
    if (rel >= 1) return "r4";
    if (rel >= 0.6) return "r3";
    if (rel >= 0.3) return "r2";
    if (rel >= 0.1) return "r1";
    return "r0";
  }

  function onLog(info) {
    if (!info) return;
    state.log.unshift({ group: info.group, label: info.label, rel: info.rel, spin: state.mode === "rush" ? `R${state.rushSpins}` : state.spins });
    if (state.log.length > 60) state.log.length = 60;
    renderLog();
  }

  function renderLog() {
    const wrap = $("logPanel");
    wrap.hidden = state.settings.showRel !== "on";
    if (wrap.hidden) return;
    const ul = $("log");
    if (!state.log.length) {
      ul.innerHTML = `<li class="empty">回すと、出た演出と信頼度がここに並びます</li>`;
      return;
    }
    ul.innerHTML = state.log
      .slice(0, 40)
      .map((l) => `<li><span class="l">${l.group}<br><b>${l.label}</b></span><span class="r"><span class="rel ${relClass(l.rel)}">${relText(l.rel)}</span><br>${l.spin}</span></li>`)
      .join("");
  }

  function renderHistory() {
    const ul = $("history");
    if (!state.history.length) {
      ul.innerHTML = `<li class="empty">まだ大当りはありません</li>`;
      return;
    }
    ul.innerHTML = state.history
      .slice(0, 100)
      .map((x) => `<li><span class="l"><span class="tag ${x.type}">${x.label}</span></span><span class="r">${fmt(x.balls)}発${x.at != null ? `<br>${fmt(x.at)}回転` : ""}</span></li>`)
      .join("");
  }

  function renderGraph() {
    const cv = $("graph");
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width, hgt = r.height;
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    const pts = state.graph;
    let min = Math.min(0, ...pts), max = Math.max(0, ...pts);
    if (max - min < 1000) { max += 500; min -= 500; }
    const padL = 46, padR = 10, padT = 10, padB = 18;
    const x = (i) => padL + (i / Math.max(1, pts.length - 1)) * (w - padL - padR);
    const y = (v) => padT + ((max - v) / (max - min)) * (hgt - padT - padB);
    g.clearRect(0, 0, w, hgt);
    g.font = `10px ${col("--font-ui")}`;
    g.fillStyle = col("--muted");
    g.strokeStyle = col("--line");
    g.lineWidth = 1;
    const stepRaw = (max - min) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(stepRaw)));
    const step = Math.ceil(stepRaw / mag) * mag;
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
      g.globalAlpha = v === 0 ? 1 : 0.5;
      g.beginPath(); g.moveTo(padL, y(v)); g.lineTo(w - padR, y(v)); g.stroke();
      g.globalAlpha = 1;
      g.fillText(`${v > 0 ? "+" : ""}${fmt(v + 0)}`, 4, y(v) + 3);
    }
    g.fillText(`${fmt(state.spins + state.rushSpins)}回転`, w - padR - 60, hgt - 4);
    const last = pts[pts.length - 1];
    const lineColor = last >= 0 ? col("--plus") : col("--minus");
    g.beginPath();
    pts.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
    g.strokeStyle = lineColor;
    g.lineWidth = 2;
    g.stroke();
    g.lineTo(x(pts.length - 1), y(0));
    g.lineTo(x(0), y(0));
    g.closePath();
    g.globalAlpha = 0.12;
    g.fillStyle = lineColor;
    g.fill();
    g.globalAlpha = 1;
    g.beginPath(); g.arc(x(pts.length - 1), y(last), 3.5, 0, 7); g.fillStyle = lineColor; g.fill();
  }

  // ---------------- メニュー ----------------

  let tab = "custom";

  function seg(name, choices, value) {
    return `<div class="seg" role="group">${Object.entries(choices)
      .map(([k, v]) => `<button type="button" data-set="${name}" data-val="${k}" aria-pressed="${String(k) === String(value)}">${v}</button>`)
      .join("")}</div>`;
  }

  function field(label, desc, control, extra = "") {
    return `<div class="field"><div class="label"><span>${label}</span>${extra}</div>${control}${desc ? `<div class="desc">${desc}</div>` : ""}</div>`;
  }

  function relTables(title, groups) {
    const rows = groups
      .map((g) => `<h3>${g.name}</h3><table class="spec"><tbody>${g.options.map((o) => `<tr><th>${o.label}</th><td><span class="rel ${relClass(o.rel)}">${relText(o.rel)}</span></td></tr>`).join("")}</tbody></table>`)
      .join("");
    return `<details class="rel-table"><summary>${title}</summary>${rows}</details>`;
  }

  function renderMenu() {
    const c = state.custom;
    const st = state.settings;
    let body = "";
    if (tab === "custom") {
      body = Object.entries(D.CUSTOMS).map(([k, v]) => field(v.name, v.desc, seg(`custom.${k}`, v.choices, c[k]))).join("");
      body += field("左打ち・右打ちを自動で切り替え", "ONにすると、RUSH・BONUS中は右打ち、通常時は左打ちに自動で切り替わる。OFFなら盤面の下のボタンで自分で切り替える。", seg("settings.autoShot", { on: "ON", off: "OFF" }, st.autoShot));
      body += field("弾幕RUSH 演出モード", D.RUSH_MODES[c.rushMode].desc, seg("custom.rushMode", Object.fromEntries(Object.entries(D.RUSH_MODES).map(([k, v]) => [k, v.name])), c.rushMode));
      body += field("RUSH突入チャレンジ", D.CHALLENGES[c.challenge].desc, seg("custom.challenge", Object.fromEntries(Object.entries(D.CHALLENGES).map(([k, v]) => [k, v.name])), c.challenge));
    } else if (tab === "settings") {
      body = field("玉の物理演算（盤面）", "ONにすると、盤面に玉を打って、ヘソに入った玉だけが回転になる。ハンドルの強さで回り方が変わる。OFFにすると下の回転率どおりに回る。", seg("settings.board", { on: "ON", off: "OFF" }, st.board));
      body += field("回転率（1000円あたり）", `ヘソへの入賞しやすさ。いまのスペック（${S.label}）の等価ボーダーは約${border().toFixed(1)}回転。保留が満タンのときの入賞は無駄になるので、実測はこれより少し下がる。`,
        `<input id="rateRange" class="range" type="range" min="12" max="26" step="0.5" value="${st.rate}">`, `<b id="rateVal">${st.rate}回転</b>`).replace("ヘソへの入賞しやすさ。", "物理盤面がOFFのときのヘソへの入賞しやすさ。");
      body += field("演出スピード", "「実機」は実際の台に近い時間で動く。保留が少ないとハズレ変動は約7秒、保留3個以上で約2.5秒に短縮。大当りはアタッカーに10個入るごとに1ラウンドが終わる。速くしても、物理盤面の玉の動きと打ち出しは最大2.5倍まで。", seg("settings.speed", SPEED_LABEL, st.speed));
      body += field("止め打ち", "ONにすると、保留が4個たまっているあいだは打ち出しを自動で止める（実機の止め打ちと同じ）。保留満タンのときにヘソに入った玉は回転にならないので、玉のむだを減らせる。BONUS中は止めない。", seg("settings.tomeuchi", { on: "ON", off: "OFF" }, st.tomeuchi));
      body += field("自動PUSH", "ONにすると、PUSHや八卦炉レバーの指示をすぐ自動で消化する。OFFでも数秒待てば自動で進む。", seg("settings.autoPush", { off: "OFF", on: "ON" }, st.autoPush));
      body += field("サウンド", "", seg("settings.sound", { on: "ON", off: "OFF" }, st.sound));
      body += field("BGM", "オリジナルの短いループ曲", seg("settings.bgm", { on: "ON", off: "OFF" }, st.bgm));
      body += field("音量", "", `<input id="volRange" class="range" type="range" min="0" max="1" step="0.05" value="${st.volume}">`);
      body += field("バイブ", "対応している端末（主にAndroid）で、役物落下やレバブルのときに振動する。", seg("settings.vibe", { on: "ON", off: "OFF" }, st.vibe));
      body += field("信頼度を表示", "出た演出と信頼度を「演出ログ」に表示する。", seg("settings.showRel", { on: "ON", off: "OFF" }, st.showRel));
    } else if (tab === "dev") {
      body = renderDev();
    } else if (tab === "sound") {
      body = renderSound();
    } else if (tab === "art") {
      body = renderArt();
    } else if (tab === "spec") {
      const cont = 1 - Math.pow(1 - S.rushProb, S.stSpins);
      const total = S.hitProb + S.chargeProb;
      const entry = (S.hitRushRate * S.hitProb + S.chargeRushRate * S.chargeProb) / S.hitProb;
      body = field("スペック", S.desc + " 画面右上のボタンでも切り替えられる。", seg("settings.spec", Object.fromEntries(Object.entries(D.SPECS).map(([k, v]) => [k, v.label])), state.settings.spec));
      body += `<div class="table-wrap"><table class="spec"><tbody>
        <tr><th>タイプ</th><td>${S.key === "ama" ? "甘デジ・ST機（初当り後ST100%）" : `1種2種混合機・${S.key === "middle" ? "ライトミドル" : "甘デジ"}（LT搭載）`}</td></tr>
        <tr><th>大当り確率</th><td>${S.chargeProb ? `図柄揃い 1/${(1 / S.hitProb).toFixed(1)}・霊力チャージ 1/${(1 / S.chargeProb).toFixed(1)}<br>合算 ` : ""}1/${(1 / total).toFixed(1)}</td></tr>
        <tr><th>RUSH突入率</th><td>${S.hitRushRate >= 1 ? "100%（初当り後すべて）" : `約${Math.round(entry * 100)}%（チャージ昇格を含む）`}</td></tr>
        <tr><th>弾幕RUSH</th><td>1/${(1 / S.rushProb).toFixed(1)}・ST${S.stSpins}回転<br>継続率 約${Math.round(cont * 100)}%</td></tr>
        <tr><th>出玉（実獲得）</th><td>異変解決BONUS ${S.rounds.bonus}R 約${fmt(S.payout.bonus10R)}発${S.chargeProb ? `<br>霊力チャージ 2R 約${fmt(S.payout.charge2R)}発` : ""}<br>RUSH中 ${S.rounds.rush}R 約${fmt(S.payout.rush3000)}発（${Math.round(S.rush6000Rate * 100)}%で${S.rounds.rush + S.rounds.big}R 約${fmt(S.payout.rush6000)}発）</td></tr>
        <tr><th>賞球・カウント</th><td>1&amp;5&amp;${S.attackerPay}・10カウント</td></tr>
        <tr><th>コンプリート</th><td>出玉${fmt(S.complete)}発で遊技終了</td></tr>
        <tr><th>等価ボーダー</th><td>約${border().toFixed(1)}回転／1000円</td></tr>
      </tbody></table></div>
      <p class="note">スペックと演出の信頼度は e東京喰種（2025）の解析値に合わせています。演出は当否を先に決めてから選ぶので、表の信頼度はシミュレーションでもそのまま再現されます。</p>`;
      body += relTables("通常時の保留・先読み・先バレ", [D.NORMAL_HOLD, ...D.NORMAL_PREREAD, D.SENBARE.s40, D.SENBARE.s90, D.SENBARE.ex, D.LEVER_BURU.off, D.LEVER_BURU.on, D.IMPACT.off]);
      body += relTables("通常時の予告", [...D.NORMAL_YOKOKU, D.KYOUKI_FAIL, ...D.NORMAL_PRE_REACH, ...D.NORMAL_SP_YOKOKU]);
      body += relTables("通常時のリーチ", [D.NORMAL_REACH]);
      body += relTables("弾幕RUSH中", [D.RUSH_HOLD, ...D.RUSH_PREREAD, ...D.RUSH_YOKOKU, ...D.RUSH_SP_YOKOKU, D.RUSH_REACH, D.RENDA]);
      body += relTables("BONUS中の裏ボタン（RUSH突入率）", [D.BONUS_URA]);
    } else {
      const firstHits = state.hits + state.charges;
      body = `<table class="spec"><tbody>
        <tr><th>総回転（通常時）</th><td>${fmt(state.spins)}回転</td></tr>
        <tr><th>RUSH中の回転</th><td>${fmt(state.rushSpins)}回転</td></tr>
        <tr><th>初当り</th><td>${firstHits}回（図柄揃い${state.hits}・チャージ${state.charges}）</td></tr>
        <tr><th>RUSH突入</th><td>${state.rushEntries}回</td></tr>
        <tr><th>RUSH中の大当り</th><td>${state.rushHits}回</td></tr>
        <tr><th>総出玉</th><td>${fmt(state.totalOut)}発</td></tr>
        <tr><th>投資</th><td>${fmt(state.invested)}円</td></tr>
      </tbody></table>
      <p class="note">保存先：${cloudOn ? "claude.ai のアカウント（アプリを閉じても残ります）＋この端末" : "この端末のブラウザだけ（ブラウザのデータを消すと消えます）"}</p>
      <div class="field"><button type="button" class="btn-danger" id="resetBtn">データをリセット</button>
      <div class="desc">持ち玉・投資・履歴・グラフを消して最初からにします。カスタムと設定は残ります。</div></div>
      <p class="note">このアプリは東方Projectの二次創作として作ったオリジナルのパチンコシミュレーターです。上海アリス幻樂団とは関係ありません。キャラクターは文字と紋で表現し、原作の画像や音楽は使っていません。実際のお金は扱いません。</p>`;
    }
    $("menuBody").innerHTML = body;
    document.querySelectorAll("#menuTabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));

    const rr = $("rateRange");
    if (rr) rr.addEventListener("input", () => {
      state.settings.rate = +rr.value;
      $("rateVal").textContent = `${rr.value}回転`;
      save();
    });
    const vr = $("volRange");
    if (vr) vr.addEventListener("input", () => {
      state.settings.volume = +vr.value;
      window.Sound.setVolume(+vr.value);
      save();
    });
    const rb = $("resetBtn");
    if (rb) rb.addEventListener("click", () => openConfirm());
    const hr = $("hesoRange");
    if (hr) hr.addEventListener("input", () => {
      state.settings.hesoOpen = +hr.value;
      $("hesoVal").textContent = hr.value;
      board.setHeso(+hr.value);
      save();
    });
    const db = $("devReset");
    if (db) db.addEventListener("click", () => {
      state.dev = { ...DEFAULT_DEV };
      applyDev();
      save();
      renderStatus();
      renderMenu();
    });
  }

  function applySettings() {
    const st = state.settings;
    stage.setSpeed(SPEEDS[st.speed] || 1);
    stage.setAutoPush(st.autoPush === "on");
    window.Sound.setEnabled(st.sound === "on");
    window.Sound.setVolume(st.volume);
    window.Sound.setBgm(st.bgm === "on");
    if (S.key !== st.spec) { applyDev(); redrawHolds(); showToast(`${D.SPECS[st.spec].label}に切り替えました`); }
    window.Sound.setPreset("yakumono", st.presetYakumono);
    window.Sound.setPreset("senbare", st.presetSenbare);
    renderLog();
    renderStatus();
    $("shotSeg").hidden = !useBoard();
    const showDrop = state.dev.dropBtn === "on";
    $("dropBtn").hidden = !showDrop;
    document.querySelector(".controls").classList.toggle("has-drop", showDrop);
  }

  function openMenu() {
    $("menu").hidden = false;
    renderMenu();
  }
  function closeMenu() {
    $("menu").hidden = true;
  }

  function openConfirm() {
    $("confirm").hidden = false;
  }

  function doReset() {
    pendingReset = false;
    state = fresh(state.custom, state.settings, state.dev);
    current = null;
    document.querySelectorAll(".complete").forEach((n) => n.remove());
    stage.clearSpin();
    stage.setMode("normal");
    window.Sound.setTheme("normal");
    save();
    render();
    if (!$("menu").hidden) renderMenu();
  }

  function requestReset() {
    $("confirm").hidden = true;
    if (running) {
      pendingReset = true;
      setHandle(false);
    } else {
      doReset();
    }
  }

  // ---------------- 起動 ----------------

  function bind() {
    $("handleBtn").addEventListener("click", () => setHandle(!handleOn));
    $("pushBtn").addEventListener("click", () => press("button"));
    $("leverBtn").addEventListener("click", () => press("lever"));
    $("menuBtn").addEventListener("click", openMenu);
    $("menuClose").addEventListener("click", closeMenu);
    $("menu").addEventListener("click", (e) => {
      if (e.target === $("menu")) closeMenu();
      const b = e.target.closest("[data-set]");
      if (b) {
        const [scope, key] = b.dataset.set.split(".");
        state[scope][key] = b.dataset.val;
        if (key.startsWith("preset")) {
          window.Sound.setPreset(key === "presetYakumono" ? "yakumono" : "senbare", b.dataset.val);
          window.Sound.previewPreset(b.dataset.val);
        }
        save();
        applySettings();
        renderMenu();
      }
    });
    $("menu").addEventListener("change", (e) => {
      if (e.target.matches("[data-dev]")) onDevInput(e.target);
      else if (e.target.matches("[data-strength]")) {
        state.settings[e.target.dataset.strength] = Math.max(0, Math.min(100, +e.target.value || 0));
        setShot(state.settings.shot);
        renderMenu();
      }
      else if (e.target.matches("[data-asset]")) onArtFile(e.target);
    });
    $("menu").addEventListener("click", async (e) => {
      if (e.target.closest("[data-endrush]")) {
        requestEndRush();
        closeMenu();
      }
      const pv = e.target.closest("[data-preview]");
      if (pv) window.Sound.preview(pv.dataset.preview);
      const drop = e.target.closest("[data-drop]");
      if (drop) {
        window.Sound.unlock();
        const k = drop.dataset.drop;
        stage.drop(k === "weak" ? "normal" : k, k === "weak");
      }
      const tryBtn = e.target.closest("[data-try]");
      if (tryBtn) {
        window.Sound.unlock();
        stage.drop(tryBtn.dataset.try, false, tryBtn.dataset.trySound);
      }
      const del = e.target.closest("[data-asset-del]");
      if (del) {
        soundMsg = null;
        await window.GensouAssets.remove(del.dataset.assetDel);
        window.GensouCloud.removeArt(del.dataset.assetDel);
        loadCustomSounds();
        stage.refreshArt();
        renderMenu();
      }
    });
    $("leftShot").addEventListener("click", () => setShot("left"));
    $("rightShot").addEventListener("click", () => setShot("right"));
    $("rushEndBtn").addEventListener("click", requestEndRush);
    // スペック切り替え：ミドル → 99ver. → 甘デジ → ミドル …
    $("specBtn").addEventListener("click", () => {
      const keys = Object.keys(D.SPECS);
      setSpec(keys[(keys.indexOf(S.key) + 1) % keys.length]);
    });
    $("dropBtn").addEventListener("click", yakumonoDrop);
    $("menuTabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      tab = b.dataset.tab;
      soundMsg = null;
      renderMenu();
    });
    $("confirmYes").addEventListener("click", requestReset);
    $("confirmNo").addEventListener("click", () => ($("confirm").hidden = true));
    document.addEventListener("keydown", (e) => {
      if (e.target.closest("input, select, textarea")) return;
      if (e.key === " ") { e.preventDefault(); press("button"); }
      else if (e.key === "l" || e.key === "L") press("lever");
      else if (e.key === "h" || e.key === "H") setHandle(!handleOn);
      else if (e.key === "Escape") closeMenu();
    });
    window.addEventListener("resize", () => renderGraph());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && handleOn) setHandle(false);
      if (document.hidden) window.GensouCloud.flush();
    });
  }

  function start(data) {
    state = (data && data.state) || load() || fresh();
    state.dev = { ...DEFAULT_DEV, ...state.dev };
    startSavedAt = state.savedAt || 0;
    current = null;
    snapshotDevDefaults();
    applyDev();
    stage = window.GensouStage.createStage($("stage"), {
      onTime,
      onLog,
      onPayout,
      bonusRound,
      onVibrate: vibrate,
      onPrompt(kind) {
        $("pushBtn").classList.toggle("armed", kind === "button" || kind === "renda");
        $("leverBtn").classList.toggle("armed", kind === "lever");
      },
      onUra(on) {
        $("pushBtn").classList.toggle("armed", on);
      },
      onBuru() {
        const b = $("leverBtn");
        b.classList.remove("buru");
        void b.offsetWidth;
        b.classList.add("buru");
      },
      onActiveColor(color) {
        if (current) current.shown = color;
      },
    });
    stage.setMode(state.mode);
    if (state.mode === "rush") window.Sound.setTheme("rush");
    setupBoard();
    bind();
    setShot(state.settings.shot);
    applySettings();
    render();
    window.GensouAssets.init().then(() => {
      stage.refreshArt();
      loadCustomSounds();
      syncCloud();
    });
    if (state.completed) showComplete();
    else if (!started) stage.overlay(`<div class="t">e東方幻想弾幕録</div><div class="m">打ち出しで開始</div>`, "card tone-gold start-hint").style.cssText = "left:10%;right:10%;top:62%;z-index:7;pointer-events:none";
    requestAnimationFrame(() => renderGraph());

    const hot = window.claude && window.claude.hot;
    if (hot && hot.snapshot) hot.snapshot(() => ({ state }));
    window.gensouDebug = { stage, engine, get board() { return board; }, get state() { return state; } }; // テスト用
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    try {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    } catch {}
  }

  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
