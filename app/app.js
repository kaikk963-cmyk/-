// 台の進行（打ち出し・保留・BONUS・RUSH）と、データカウンター・メニューの表示。
(function () {
  const D = window.GENSOU_DATA;
  const S = D.SPEC;
  const engine = window.createEngine(D);
  const KEY = "gensou-danmaku-v1";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString("ja-JP");

  const DEFAULT_CUSTOM = { senbare: "s40", sakiyomi: "osusume", leverBuru: "off", impact: "off", rushMode: "default", challenge: "koumakan" };
  const DEFAULT_SETTINGS = { boardV: 3, board: "on", shot: "left", autoShot: "on", leftStrength: 20, rightStrength: 90, hesoOpen: 1.5, rate: 18, speed: "normal", autoPush: "off", sound: "on", bgm: "off", volume: 0.7, vibe: "on", showRel: "on" };
  const SPEEDS = { slow: 1.35, normal: 1, fast: 0.5, turbo: 0.2 };
  const SPEED_LABEL = { slow: "ゆっくり", normal: "標準", fast: "高速", turbo: "爆速" };
  const DEFAULT_DEV = { overrides: {}, force: "none", senbare: "off", rush6000: null, dropBtn: "off" };

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
      custom: { ...DEFAULT_CUSTOM, ...custom },
      settings: { ...DEFAULT_SETTINGS, ...settings },
      dev: { ...DEFAULT_DEV, ...dev },
    };
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (!s || s.v !== 1) return null;
      s.custom = { ...DEFAULT_CUSTOM, ...s.custom };
      s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
      // 盤面を液晶埋め込み型に作り直したので、打ち出しの強さと命釘は新しい初期値に戻す
      if (s.settings.boardV !== DEFAULT_SETTINGS.boardV) {
        for (const k of ["boardV", "leftStrength", "rightStrength", "hesoOpen"]) s.settings[k] = DEFAULT_SETTINGS[k];
      }
      s.dev = { ...DEFAULT_DEV, ...s.dev };
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
  let running = false;
  let handleOn = false;
  let current = null;
  let fireAcc = 0;
  let inBonus = false;
  let pendingReset = false;
  let started = false;

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
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
    if (state.holds.length >= S.holdMax) return; // オーバー入賞（保留が満タン）
    const hold = engine.makeHold("normal", state.custom, takeForce("normal"));
    hold.shown = hold.reveal === "entry" ? hold.color : null;
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
    board = new B.Board({
      hesoOpen: state.settings.hesoOpen,
      handlers: {
        onFire() {
          if (inBonus) return true; // BONUS中の打ち出しは払い出しに含めて計算済み
          if (state.balls <= 0) rent();
          state.balls--;
          state.fired++;
          if (state.mode === "normal") state.usedBalls++;
          scheduleRender();
          return true;
        },
        onHeso() {
          if (inBonus) return;
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
        onPocket(n) {
          if (inBonus) return;
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
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      // 盤面は常に描く（物理演算OFFのときは玉を打たない）
      board.firing = useBoard() && handleOn && !state.completed;
      board.mode = inBonus ? "bonus" : state.mode;
      board.step(dt / speedFactor());
      boardView.draw();
      if (useBoard()) renderShotHint();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  let lastHint = "";
  function renderShotHint() {
    const needRight = inBonus || state.mode === "rush";
    // 自動打ち分け：RUSH・BONUS中は右打ち、通常時は左打ちに切り替える
    if (state.settings.autoShot === "on" && (state.settings.shot === "right") !== needRight) setShot(needRight ? "right" : "left");
    const right = state.settings.shot === "right";
    const text = needRight && !right ? "右打ちしてください ▶" : !needRight && right && handleOn ? "◀ 通常時は左打ち" : "";
    if (text !== lastHint) {
      lastHint = text;
      $("shotHint").textContent = text;
      $("shotHint").hidden = !text;
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
    const sc = engine.normalScenario(hold, state.custom);
    await stage.play(sc.steps, { short: state.holds.length >= 3 });
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
    await stage.play(sc.steps, { short: true });
    current = null;
    if (hold.result.kind === "hit") {
      const used = S.stSpins - state.stLeft;
      state.rushHits++;
      state.chain++;
      const got = await runBonus(engine.bonusSteps(hold.result, sc.digits, "rush", state.custom));
      state.chainBalls += got;
      state.stLeft = S.stSpins;
      state.maxChain = Math.max(state.maxChain, state.chain);
      addHistory({ type: "rush", label: `弾幕RUSH ${state.chain}連目${hold.result.big ? "（6000）" : ""}`, balls: got, at: used });
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
    addHistory({ type: hold.result.rush ? "rush" : "bonus", label: hold.result.rush ? "異変解決BONUS → 弾幕RUSH" : "異変解決BONUS（RUSH非突入）", balls: got, at });
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

  async function endRush() {
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
        if (state.mode === "rush") {
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
  }

  function renderStatus() {
    if (state.mode === "rush") {
      stage.setStatus(`<span class="chip rush">弾幕RUSH ${state.chain}連</span><span class="chip st">残り${state.stLeft}</span>`);
    } else {
      stage.setStatus(`<span class="chip">通常</span><span class="chip st">${state.sinceBonus}</span>`);
    }
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

  function snapshotDevDefaults() {
    devDefaults = { rush6000: S.rush6000Rate };
    for (const d of devGroups()) for (const o of d.group.options) devDefaults[devKey(d, o)] = { rel: o.rel, share: o.share };
  }

  function applyDev() {
    for (const d of devGroups()) {
      for (const o of d.group.options) {
        const v = state.dev.overrides[devKey(d, o)] || devDefaults[devKey(d, o)];
        o.rel = v.rel;
        o.share = v.share;
      }
    }
    S.rush6000Rate = state.dev.rush6000 ?? devDefaults.rush6000;
  }

  const devActive = () =>
    Object.keys(state.dev.overrides).length > 0 || state.dev.rush6000 != null || state.dev.force !== "none" || state.dev.senbare !== "off";

  // 次に入賞する保留の結果・先バレを固定する（1回だけ、先バレは毎回も可）
  function takeForce(mode) {
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
    let body = `<p class="note">陰陽玉落下と先バレの出方を変えられます。<b>信頼度</b>はその演出が出たときの大当り率、<b>当たり時</b>は大当りのうち何%でその演出が出るか。ハズレ時の出方はこの2つから自動で決まり、右端にだいたいの出現頻度が出ます。変更すると画面右上に DEV と表示されます。</p>`;
    body += field("次の入賞を固定（1回）", "次に入賞した保留1つの結果を固定する。RUSH中はハズレ以外が大当りになる。",
      seg("dev.force", { none: "なし", rushHit: "大当り→RUSH", hit: "大当り→通常", charge: "チャージ", miss: "ハズレ" }, state.dev.force));
    body += field("先バレを強制", "保留入賞時に陰陽玉を必ず落とす（先バレのカスタムがOFFでも落ちる）。",
      seg("dev.senbare", { off: "OFF", once: "次の1回", always: "毎回" }, state.dev.senbare));
    body += field("陰陽玉を今すぐ落とす", "役物を落とす演出だけを出す。抽選結果には関係しない。当たりにしたいときは「次の入賞を固定」と組み合わせる。",
      `<div class="drop-btns"><button type="button" data-drop="normal">通常音</button><button type="button" data-drop="low">低音</button><button type="button" data-drop="high">高音</button><button type="button" data-drop="weak">弱落下</button></div>`);
    body += field("メイン画面に落下ボタン", "PUSHとレバーの横に「役物投下」ボタンを出す。", seg("dev.dropBtn", { off: "OFF", on: "ON" }, state.dev.dropBtn));
    for (const d of devGroups()) {
      const changed = d.group.options.some((o) => state.dev.overrides[devKey(d, o)]);
      const rows = d.group.options.map((o) => {
        const k = devKey(d, o);
        return `<tr><th>${o.label}${o.rushOnly ? "<br><small>RUSH直行のみ</small>" : ""}</th>
          <td><input class="num-in" type="number" inputmode="decimal" min="0.1" max="100" step="0.1" data-dev="${k}" data-field="rel" value="${+(o.rel * 100).toFixed(2)}" aria-label="${o.label}の信頼度（%）"></td>
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
    body += field("ハンドルの強さ（物理盤面）", "左打ち・右打ちを選んだときの打ち出しの強さ（0〜100）。左打ちは15〜20あたりがよく回る。",
      `<div class="drop-btns" style="grid-template-columns:auto 1fr auto 1fr;align-items:center">左<input class="num-in" type="number" min="0" max="100" step="1" data-strength="leftStrength" value="${state.settings.leftStrength}" aria-label="左打ちの強さ">右<input class="num-in" type="number" min="0" max="100" step="1" data-strength="rightStrength" value="${state.settings.rightStrength}" aria-label="右打ちの強さ"></div>`);
    body += field("ヘソ釘の開き（物理盤面）", "大きいほどヘソに入りやすい。標準は1.5。", `<input id="hesoRange" class="range" type="range" min="1" max="4" step="0.25" value="${state.settings.hesoOpen}">`, `<b id="hesoVal">${state.settings.hesoOpen}</b>`);
    body += field("夢想封印MAX（6000発）の割合", "RUSH中の大当りのうち、BONUS中に陰陽玉が落ちて6000発になる割合。",
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
    return slots;
  }

  const SOUND_SLOTS = [
    { name: "senbare", label: "先バレ（陰陽玉落下）の音", sub: "保留入賞時に陰陽玉が落ちたとき" },
    { name: "drop", label: "陰陽玉落下の音", sub: "変動中・リーチ中・復活で落ちたとき" },
    { name: "kyuin", label: "大当りの音", sub: "図柄がそろったとき" },
    { name: "rushIn", label: "RUSH突入の音", sub: "弾幕RUSH突入・継続" },
  ];

  function loadCustomSounds() {
    for (const sl of SOUND_SLOTS) window.Sound.setCustom(sl.name, window.GensouAssets.blob(`sound:${sl.name}`));
  }

  function renderArt() {
    const A = window.GensouAssets;
    let body = `<p class="note">キャラの立ち絵や背景を、この端末の画像から取り込めます。取り込んだ画像はこのブラウザの中だけに保存され、ほかの人には見えません。<br><b>フリー素材でも、使う前に各素材の利用規約を確認してください。</b>クレジット表記が必要なもの、再配布が禁止のもの、ギャンブル・パチンコ系での使用を禁止しているものがあります。立ち絵は背景が透過したPNGがきれいに出ます。</p>`;
    if (!A.persistent()) body += `<p class="warn">この環境では画像を保存できないため、ページを閉じると取り込んだ画像は消えます。</p>`;
    body += artSlots().map((sl) => {
      const u = A.url(sl.key);
      const thumb = u ? `<img src="${u}" alt="">` : sl.char ? window.GensouStage.crestSVG(sl.char) : "";
      return `<div class="asset-row"><div class="thumb">${thumb}</div>
        <div class="name">${sl.name}<small>${sl.sub}</small></div>
        <div class="acts"><label class="btn">${u ? "変更" : "画像を選ぶ"}<input type="file" accept="image/*" data-asset="${sl.key}" aria-label="${sl.name}の画像"></label>
        ${u ? `<button type="button" data-asset-del="${sl.key}" aria-label="${sl.name}の画像を削除">削除</button>` : ""}</div></div>`;
    }).join("");
    body += `<h3 class="art-head">効果音</h3><p class="note">音声ファイル（mp3など）を取り込むと、その場面の効果音が差し替わります。音量は自動でほかの効果音にそろえます。</p>`;
    body += SOUND_SLOTS.map((sl) => {
      const key = `sound:${sl.name}`;
      const has = !!A.blob(key);
      return `<div class="asset-row"><div class="thumb"><span aria-hidden="true">${has ? "♪" : "—"}</span></div>
        <div class="name">${sl.label}<small>${has ? "取り込んだ音" : "標準の音"}・${sl.sub}</small></div>
        <div class="acts"><button type="button" data-preview="${sl.name}" aria-label="${sl.label}を試し聴き">▶</button>
        <label class="btn">${has ? "変更" : "音を選ぶ"}<input type="file" accept="audio/*" data-asset="${key}" aria-label="${sl.label}のファイル"></label>
        ${has ? `<button type="button" data-asset-del="${key}" aria-label="${sl.label}を標準に戻す">戻す</button>` : ""}</div></div>`;
    }).join("");
    return body;
  }

  async function onArtFile(el) {
    const file = el.files && el.files[0];
    if (!file) return;
    await window.GensouAssets.put(el.dataset.asset, file);
    loadCustomSounds();
    stage.refreshArt();
    renderMenu();
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
      const next = { rel: o.rel, share: o.share, [field]: v };
      const def = devDefaults[k];
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
      body += field("回転率（1000円あたり）", "ヘソへの入賞しやすさ。等価交換のボーダーは約17.4回転。保留が満タンのときの入賞は無駄になるので、実測はこれより少し下がる。",
        `<input id="rateRange" class="range" type="range" min="12" max="26" step="0.5" value="${st.rate}">`, `<b id="rateVal">${st.rate}回転</b>`).replace("ヘソへの入賞しやすさ。", "物理盤面がOFFのときのヘソへの入賞しやすさ。");
      body += field("演出スピード", "", seg("settings.speed", SPEED_LABEL, st.speed));
      body += field("自動PUSH", "ONにすると、PUSHや八卦炉レバーの指示をすぐ自動で消化する。OFFでも数秒待てば自動で進む。", seg("settings.autoPush", { off: "OFF", on: "ON" }, st.autoPush));
      body += field("サウンド", "", seg("settings.sound", { on: "ON", off: "OFF" }, st.sound));
      body += field("BGM", "オリジナルの短いループ曲", seg("settings.bgm", { on: "ON", off: "OFF" }, st.bgm));
      body += field("音量", "", `<input id="volRange" class="range" type="range" min="0" max="1" step="0.05" value="${st.volume}">`);
      body += field("バイブ", "対応している端末（主にAndroid）で、役物落下やレバブルのときに振動する。", seg("settings.vibe", { on: "ON", off: "OFF" }, st.vibe));
      body += field("信頼度を表示", "出た演出と信頼度を「演出ログ」に表示する。", seg("settings.showRel", { on: "ON", off: "OFF" }, st.showRel));
    } else if (tab === "dev") {
      body = renderDev();
    } else if (tab === "art") {
      body = renderArt();
    } else if (tab === "spec") {
      const cont = 1 - Math.pow(1 - S.rushProb, S.stSpins);
      body = `<div class="table-wrap"><table class="spec"><tbody>
        <tr><th>タイプ</th><td>1種2種混合機・ライトミドル（LT搭載）</td></tr>
        <tr><th>大当り確率</th><td>図柄揃い 1/${(1 / S.hitProb).toFixed(1)}・霊力チャージ 1/${(1 / S.chargeProb).toFixed(1)}<br>合算 1/${(1 / (S.hitProb + S.chargeProb)).toFixed(1)}</td></tr>
        <tr><th>RUSH突入率</th><td>約${Math.round((S.hitRushRate * S.hitProb + S.chargeRushRate * S.chargeProb) / S.hitProb * 100)}%（チャージ昇格を含む）</td></tr>
        <tr><th>弾幕RUSH</th><td>1/${(1 / S.rushProb).toFixed(1)}・ST${S.stSpins}回転<br>継続率 約${Math.round(cont * 100)}%</td></tr>
        <tr><th>出玉（実獲得）</th><td>異変解決BONUS 10R 約${fmt(S.payout.bonus10R)}発<br>霊力チャージ 2R 約${fmt(S.payout.charge2R)}発<br>RUSH中 ALL約${fmt(S.payout.rush3000)}発（${Math.round(S.rush6000Rate * 100)}%で約${fmt(S.payout.rush6000)}発）</td></tr>
        <tr><th>賞球・カウント</th><td>1&amp;5&amp;15・10カウント</td></tr>
        <tr><th>コンプリート</th><td>出玉${fmt(S.complete)}発で遊技終了</td></tr>
        <tr><th>等価ボーダー</th><td>約17.4回転／1000円</td></tr>
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
      const pv = e.target.closest("[data-preview]");
      if (pv) window.Sound.preview(pv.dataset.preview, "normal");
      const drop = e.target.closest("[data-drop]");
      if (drop) {
        window.Sound.unlock();
        const k = drop.dataset.drop;
        stage.drop(k === "weak" ? "normal" : k, k === "weak");
      }
      const del = e.target.closest("[data-asset-del]");
      if (del) {
        await window.GensouAssets.remove(del.dataset.assetDel);
        loadCustomSounds();
        stage.refreshArt();
        renderMenu();
      }
    });
    $("leftShot").addEventListener("click", () => setShot("left"));
    $("rightShot").addEventListener("click", () => setShot("right"));
    $("dropBtn").addEventListener("click", () => {
      window.Sound.unlock();
      stage.drop("normal");
    });
    $("menuTabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      tab = b.dataset.tab;
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
    });
  }

  function start(data) {
    state = (data && data.state) || load() || fresh();
    state.dev = { ...DEFAULT_DEV, ...state.dev };
    current = null;
    snapshotDevDefaults();
    applyDev();
    stage = window.GensouStage.createStage($("stage"), {
      onTime,
      onLog,
      onPayout,
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
    });
    if (state.completed) showComplete();
    else if (!started) stage.overlay(`<div class="t">e東方幻想弾幕録</div><div class="m">打ち出しで開始</div>`, "card tone-gold start-hint").style.cssText = "left:10%;right:10%;top:62%;z-index:7;pointer-events:none";
    requestAnimationFrame(() => renderGraph());

    const hot = window.claude && window.claude.hot;
    if (hot && hot.snapshot) hot.snapshot(() => ({ state }));
    window.gensouDebug = { stage, engine }; // テスト用
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
