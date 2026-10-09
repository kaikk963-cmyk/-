(() => {
  const STORAGE_KEY = "ghoul-pachi-state-v1";
  const $ = (id) => document.getElementById(id);
  const reels = [$("r0"), $("r1"), $("r2")];

  const freshState = (specKey) => ({
    specKey,
    balls: 0,
    invested: 0,
    spins: 0,
    spinsSinceHit: 0,
    firstHits: 0,
    rushEntries: 0,
    mode: "normal",
    stLeft: 0,
    chain: 0,
    chainBalls: 0,
    history: [],
  });

  let state = load() || freshState("standard");
  let busy = false;
  let auto = false;
  let fast = false;

  const spec = () => SPECS[state.specKey];

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return s && SPECS[s.specKey] ? s : null;
    } catch {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  const rand = (n) => Math.floor(Math.random() * n);
  const sleep = (ms) => new Promise((r) => setTimeout(r, fast ? ms / 4 : ms));

  function pickPayout(table) {
    const total = table.reduce((sum, [, w]) => sum + w, 0);
    let r = Math.random() * total;
    for (const [balls, w] of table) {
      if ((r -= w) < 0) return balls;
    }
    return table[table.length - 1][0];
  }

  // 抽選。演出より先に結果を決める。
  function draw() {
    const s = spec();
    if (state.mode === "normal") {
      if (Math.random() >= 1 / s.normalProb) return { hit: false };
      return {
        hit: true,
        payout: pickPayout(s.firstPayouts),
        toRush: Math.random() < s.rushEntryRate,
      };
    }
    if (Math.random() >= 1 / s.rushProb) return { hit: false };
    return { hit: true, payout: pickPayout(s.rushPayouts), toRush: true };
  }

  function decideReels(result) {
    if (result.hit) {
      // RUSHに繋がる当たりは奇数図柄、それ以外は偶数図柄で揃える
      const pool = result.toRush ? [1, 3, 5, 7, 9] : [2, 4, 6, 8];
      const n = pool[rand(pool.length)];
      return { digits: [n, n, n], reach: true };
    }
    const reachRate = state.mode === "rush" ? 0.2 : 0.08;
    const a = 1 + rand(9);
    if (Math.random() < reachRate) {
      const c = ((a - 1 + 1 + rand(8)) % 9) + 1; // a 以外
      return { digits: [a, c, a], reach: true };
    }
    let b = 1 + rand(9);
    if (b === a) b = (b % 9) + 1;
    return { digits: [a, 1 + rand(9), b], reach: false };
  }

  async function animateReels({ digits, reach }, hit) {
    reels.forEach((el) => el.classList.remove("reach", "hit"));
    reels.forEach((el) => el.classList.add("spinning"));
    const timer = setInterval(() => {
      reels.forEach((el) => {
        if (el.classList.contains("spinning")) el.textContent = 1 + rand(9);
      });
    }, 50);

    const base = state.mode === "rush" ? 350 : 700;
    // 左 → 右 → 中 の順で停止
    for (const i of [0, 2]) {
      await sleep(base / 2);
      reels[i].classList.remove("spinning");
      reels[i].textContent = digits[i];
    }
    if (reach) {
      reels[0].classList.add("reach");
      reels[2].classList.add("reach");
      $("message").className = "message";
      $("message").textContent = "リーチ！";
      await sleep(hit ? 1800 : 1300);
    } else {
      await sleep(base / 2);
    }
    clearInterval(timer);
    reels[1].classList.remove("spinning");
    reels[1].textContent = digits[1];
    if (hit) reels.forEach((el) => el.classList.add("hit"));
  }

  function ensureBalls(cost) {
    while (state.balls < cost) {
      state.balls += RENT.balls;
      state.invested += RENT.yen;
    }
  }

  async function spin() {
    if (busy) return;
    busy = true;
    $("spinBtn").disabled = true;
    $("message").textContent = "";

    const s = spec();
    // RUSH中は電サポ中なので消費玉は無視する
    if (state.mode === "normal") {
      ensureBalls(s.ballsPerSpin);
      state.balls -= s.ballsPerSpin;
    }
    state.spins++;
    state.spinsSinceHit++;
    if (state.mode === "rush") state.stLeft--;
    render();

    const result = draw();
    await animateReels(decideReels(result), result.hit);

    if (result.hit) {
      await onHit(result);
    } else if (state.mode === "rush" && state.stLeft <= 0) {
      await endRush();
    }

    save();
    render();
    busy = false;
    $("spinBtn").disabled = false;
    if (auto) setTimeout(spin, fast ? 50 : 250);
  }

  async function onHit(result) {
    const wasNormal = state.mode === "normal";
    state.balls += result.payout;
    state.spinsSinceHit = 0;
    flash();

    if (wasNormal) {
      state.firstHits++;
      state.history.unshift({
        label: result.toRush ? "初当たり → RUSH" : "初当たり",
        balls: result.payout,
        at: state.spins,
      });
      setMessage(`大当たり！ +${result.payout}発`, true);
      await sleep(1200);
      if (result.toRush) {
        state.rushEntries++;
        state.mode = "rush";
        state.chain = 1;
        state.chainBalls = result.payout;
        state.stLeft = spec().stSpins;
        setMessage("喰種RUSH 突入！！", true);
        await sleep(1400);
      } else {
        setMessage("RUSH 非突入…", false);
        await sleep(1000);
      }
    } else {
      state.chain++;
      state.chainBalls += result.payout;
      state.stLeft = spec().stSpins;
      setMessage(`${state.chain}連！ +${result.payout}発`, true);
      await sleep(1000);
    }
  }

  async function endRush() {
    state.history.unshift({
      label: `RUSH終了 ${state.chain}連`,
      balls: state.chainBalls,
      at: state.spins,
    });
    setMessage(`RUSH終了 ${state.chain}連 / ${state.chainBalls}発`, false);
    state.mode = "normal";
    state.chain = 0;
    state.chainBalls = 0;
    state.stLeft = 0;
    render();
    await sleep(1500);
  }

  function setMessage(text, gold) {
    $("message").className = gold ? "message gold" : "message";
    $("message").textContent = text;
  }

  function flash() {
    const stage = $("stage");
    stage.classList.remove("flash");
    void stage.offsetWidth;
    stage.classList.add("flash");
  }

  const fmt = (n) => n.toLocaleString("ja-JP");

  function render() {
    const s = spec();
    const balance = state.balls * (RENT.yen / RENT.balls) - state.invested;
    $("balls").textContent = fmt(state.balls);
    $("invested").textContent = `${fmt(state.invested)}円`;
    $("balance").textContent = `${balance >= 0 ? "+" : ""}${fmt(balance)}円`;
    $("balance").className = balance >= 0 ? "plus" : "minus";
    $("spinsSinceHit").textContent = fmt(state.spinsSinceHit);
    $("spins").textContent = fmt(state.spins);
    $("firstHits").textContent = `${state.firstHits}回`;

    const rush = state.mode === "rush";
    $("stage").classList.toggle("rush", rush);
    $("modeLabel").textContent = rush ? `喰種RUSH ${state.chain}連中` : "通常";
    $("stInfo").textContent = rush ? `残り ${state.stLeft} / ${s.stSpins} 回転` : "";

    $("history").innerHTML = state.history
      .slice(0, 100)
      .map(
        (h) =>
          `<li><span class="tag">${h.label}</span><span>${fmt(h.balls)}発 / ${fmt(h.at)}回転目</span></li>`
      )
      .join("");

    const rushRate = state.firstHits ? Math.round((state.rushEntries / state.firstHits) * 100) : 0;
    const cont = 1 - Math.pow(1 - 1 / s.rushProb, s.stSpins);
    $("specDetail").textContent =
      `${s.name}\n` +
      `初当たり 1/${s.normalProb} ／ RUSH突入率 ${Math.round(s.rushEntryRate * 100)}%\n` +
      `RUSH 1/${s.rushProb}・ST${s.stSpins}回転（継続率 約${Math.round(cont * 100)}%）\n` +
      `実績RUSH突入率 ${rushRate}%（${state.rushEntries}/${state.firstHits}）\n` +
      `※数値は近似、出玉は仮の値です`;
  }

  function setupSpecSelect() {
    const sel = $("spec");
    sel.innerHTML = Object.entries(SPECS)
      .map(([key, s]) => `<option value="${key}">${s.name}</option>`)
      .join("");
    sel.value = state.specKey;
    sel.addEventListener("change", () => {
      if (busy || auto) {
        sel.value = state.specKey;
        return;
      }
      if (state.spins > 0 && !confirm("機種を変えるとデータがリセットされます。よろしいですか？")) {
        sel.value = state.specKey;
        return;
      }
      state = freshState(sel.value);
      save();
      render();
    });
  }

  $("spinBtn").addEventListener("click", spin);
  $("autoBtn").addEventListener("click", () => {
    auto = !auto;
    $("autoBtn").textContent = `オート ${auto ? "ON" : "OFF"}`;
    $("autoBtn").classList.toggle("on", auto);
    if (auto && !busy) spin();
  });
  $("fastBtn").addEventListener("click", () => {
    fast = !fast;
    $("fastBtn").textContent = `高速 ${fast ? "ON" : "OFF"}`;
    $("fastBtn").classList.toggle("on", fast);
  });
  $("menuBtn").addEventListener("click", () => $("menu").showModal());
  $("closeMenu").addEventListener("click", () => $("menu").close());
  $("resetBtn").addEventListener("click", () => {
    if (!confirm("データをリセットしますか？")) return;
    auto = false;
    $("autoBtn").textContent = "オート OFF";
    $("autoBtn").classList.remove("on");
    state = freshState(state.specKey);
    save();
    render();
    $("menu").close();
  });

  setupSpecSelect();
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
