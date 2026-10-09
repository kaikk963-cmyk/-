// 台の進行（打ち出し・保留・BONUS・RUSH）と、データカウンター・メニューの表示。
(function () {
  const D = window.GENSOU_DATA;
  const S = D.SPEC;
  const engine = window.createEngine(D);
  const KEY = "gensou-danmaku-v1";
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString("ja-JP");

  const DEFAULT_CUSTOM = { senbare: "s40", sakiyomi: "osusume", leverBuru: "off", impact: "off", rushMode: "default", challenge: "koumakan" };
  const DEFAULT_SETTINGS = { rate: 18, speed: "normal", autoPush: "off", sound: "on", bgm: "off", volume: 0.7, vibe: "on", showRel: "on" };
  const SPEEDS = { slow: 1.35, normal: 1, fast: 0.5, turbo: 0.2 };
  const SPEED_LABEL = { slow: "ゆっくり", normal: "標準", fast: "高速", turbo: "爆速" };

  function fresh(custom, settings) {
    return {
      v: 1,
      balls: 0, invested: 0, totalOut: 0, usedBalls: 0,
      spins: 0, sinceBonus: 0, rushSpins: 0,
      hits: 0, charges: 0, rushEntries: 0, rushHits: 0,
      mode: "normal", stLeft: 0, chain: 0, chainBalls: 0, maxChain: 0,
      holds: [], rushHolds: [],
      history: [], graph: [0], log: [],
      completed: false,
      custom: { ...DEFAULT_CUSTOM, ...custom },
      settings: { ...DEFAULT_SETTINGS, ...settings },
    };
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (!s || s.v !== 1) return null;
      s.custom = { ...DEFAULT_CUSTOM, ...s.custom };
      s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
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
    const hold = engine.makeHold("normal", state.custom);
    hold.shown = hold.reveal === "entry" ? hold.color : null;
    state.holds.push(hold);
    renderHolds();
    stage.entry(state.holds.length - 1, hold);
  }

  function fireBalls(n) {
    for (let i = 0; i < n; i++) {
      if (state.balls <= 0) rent();
      state.balls--;
      state.usedBalls++;
      if (Math.random() < entryProb()) addHold();
    }
  }

  // 演出の名目時間ぶん打ち出す（変動中にも保留が貯まる）
  function onTime(ms) {
    if (!handleOn || state.mode !== "normal" || inBonus || state.completed) return;
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
      const hold = engine.makeHold("rush", state.custom);
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
    topUpRushHolds();
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
    await stage.play([{ t: "rushEnd", chain: state.chain, balls: state.chainBalls }]);
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
          await spinRush();
        } else if (!state.holds.length) {
          if (!handleOn) break;
          await fireUntilEntry();
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
      body += field("弾幕RUSH 演出モード", D.RUSH_MODES[c.rushMode].desc, seg("custom.rushMode", Object.fromEntries(Object.entries(D.RUSH_MODES).map(([k, v]) => [k, v.name])), c.rushMode));
      body += field("RUSH突入チャレンジ", D.CHALLENGES[c.challenge].desc, seg("custom.challenge", Object.fromEntries(Object.entries(D.CHALLENGES).map(([k, v]) => [k, v.name])), c.challenge));
    } else if (tab === "settings") {
      body = field("回転率（1000円あたり）", "ヘソへの入賞しやすさ。等価交換のボーダーは約17.4回転。保留が満タンのときの入賞は無駄になるので、実測はこれより少し下がる。",
        `<input id="rateRange" class="range" type="range" min="12" max="26" step="0.5" value="${st.rate}">`, `<b id="rateVal">${st.rate}回転</b>`);
      body += field("演出スピード", "", seg("settings.speed", SPEED_LABEL, st.speed));
      body += field("自動PUSH", "ONにすると、PUSHや八卦炉レバーの指示をすぐ自動で消化する。OFFでも数秒待てば自動で進む。", seg("settings.autoPush", { off: "OFF", on: "ON" }, st.autoPush));
      body += field("サウンド", "", seg("settings.sound", { on: "ON", off: "OFF" }, st.sound));
      body += field("BGM", "オリジナルの短いループ曲", seg("settings.bgm", { on: "ON", off: "OFF" }, st.bgm));
      body += field("音量", "", `<input id="volRange" class="range" type="range" min="0" max="1" step="0.05" value="${st.volume}">`);
      body += field("バイブ", "対応している端末（主にAndroid）で、役物落下やレバブルのときに振動する。", seg("settings.vibe", { on: "ON", off: "OFF" }, st.vibe));
      body += field("信頼度を表示", "出た演出と信頼度を「演出ログ」に表示する。", seg("settings.showRel", { on: "ON", off: "OFF" }, st.showRel));
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
  }

  function applySettings() {
    const st = state.settings;
    stage.setSpeed(SPEEDS[st.speed] || 1);
    stage.setAutoPush(st.autoPush === "on");
    window.Sound.setEnabled(st.sound === "on");
    window.Sound.setVolume(st.volume);
    window.Sound.setBgm(st.bgm === "on");
    renderLog();
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
    state = fresh(state.custom, state.settings);
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
    current = null;
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
    bind();
    applySettings();
    render();
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
