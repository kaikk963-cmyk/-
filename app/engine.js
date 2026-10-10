// 抽選と演出シナリオの生成。DOMには触らないので node からもテストできる。
//
// 演出は「当否を先に決めてから、当否ごとの出現率で選ぶ」方式。
// 大当り時の出現率 share をデータで決め、ハズレ時の出現率を
//   share * p * (1 - rel) / (rel * (1 - p))
// で逆算するので、各演出の信頼度はデータの rel と一致する（p はその演出の母数での大当り確率）。
(function (root) {
  function createEngine(D, rng = Math.random) {
    const S = D.SPEC;

    const shareNorm = (g) => (g.exhaustive ? g.options.reduce((s, o) => s + o.share, 0) : 1);

    function missWeight(o, p, norm) {
      if (o.missRate != null) return o.missRate;
      if (o.rel >= 1 || p >= 1) return 0;
      return ((o.share / norm) * p * (1 - o.rel)) / (o.rel * (1 - p));
    }

    // リーチ時・SPリーチ時を母数にしたときの大当り確率
    function contextProbs(p, reachGroup) {
      const norm = shareNorm(reachGroup);
      let missAll = 0, missSp = 0, hitSp = 0;
      for (const o of reachGroup.options) {
        const m = missWeight(o, p, norm);
        missAll += m;
        if (o.sp) {
          missSp += m;
          hitSp += o.share / norm;
        }
      }
      return {
        reach: p / (p + (1 - p) * missAll),
        sp: (p * hitSp) / (p * hitSp + (1 - p) * missSp),
      };
    }

    // ---- スペックごとの信頼度 ----
    // データの rel はライトミドル（SPECS.middle）での値。甘デジなどで大当り確率が変わっても
    // ハズレ時の演出の出方は変えず、実機の甘デジ版と同じく信頼度のほうが上がるようにする。
    // 当否のオッズ（p/(1-p)）が何倍になったかを、各演出のオッズに掛ける。
    const BASE = (D.SPECS && D.SPECS.middle) || { ...S };
    const baseRel = new Map(); // 演出 → ミドルでの信頼度
    const family = new Map();  // 演出グループ → normal / rush / bonus
    function walk(v, fam, seen = new Set()) {
      if (!v || typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) return v.forEach((x) => walk(x, fam, seen));
      if (Array.isArray(v.options) && v.ctx) {
        if (!family.has(v)) family.set(v, fam);
        for (const o of v.options) {
          if (!baseRel.has(o)) baseRel.set(o, o.rel);
          if (o.subs) walk(o.subs, fam, seen);
        }
        return;
      }
      for (const x of Object.values(v)) walk(x, fam, seen);
    }
    for (const [k, v] of Object.entries(D)) {
      if (k === "SPEC" || k === "SPECS") continue;
      walk(v, k.startsWith("RUSH_") || k === "RENDA" ? "rush" : k === "BONUS_URA" ? "bonus" : "normal");
    }
    const odds = (p) => p / (1 - p);
    function factor(fam) {
      if (fam === "rush") return odds(S.rushProb) / odds(BASE.rushProb);
      if (fam === "bonus") return S.hitRushRate >= 1 ? 1 : odds(S.hitRushRate) / odds(BASE.hitRushRate);
      return odds(S.hitProb) / odds(BASE.hitProb);
    }
    function scaleRel(rel, f) {
      if (!(rel > 0 && rel < 1) || f === 1) return rel;
      const od = (rel / (1 - rel)) * f;
      return od / (1 + od);
    }
    // 開発者モード用：表示中の信頼度 ⇔ ミドルでの信頼度
    const toBase = (group, rel) => scaleRel(rel, 1 / factor(family.get(group) || "normal"));
    const setBase = (o, rel) => baseRel.set(o, rel);
    const baseOf = (o) => (baseRel.has(o) ? baseRel.get(o) : o.rel);

    // スペックの切り替えや開発者モードで確率・演出の出方が変わったら recalc() で計算し直す
    const P = {};
    function recalc() {
      for (const [g, fam] of family) {
        const f = factor(fam);
        for (const o of g.options) o.rel = scaleRel(baseOf(o), f);
      }
      const nc = contextProbs(S.hitProb, D.NORMAL_REACH);
      const rc = contextProbs(S.rushProb, D.RUSH_REACH);
      Object.assign(P, {
        spin: S.hitProb, reach: nc.reach, sp: nc.sp,
        rushSpin: S.rushProb, rushSp: rc.sp,
        bonus: S.hitRushRate,
      });
    }
    recalc();

    // 当否 out = { hit, rush } に応じて group から1つ選ぶ。何も出ないときは null。
    // rushRate は rushOnly の演出を当たりの中でどれだけ寄せるかの補正（RUSH中は 1）。
    function pick(group, out, p, rushRate) {
      const norm = shareNorm(group);
      let ws;
      if (out.hit) {
        ws = group.options.map((o) => (o.rushOnly ? (out.rush ? o.share / rushRate : 0) : o.share));
        const sum = ws.reduce((s, w) => s + w, 0);
        if (group.exhaustive || sum > 1) ws = ws.map((w) => w / sum);
      } else {
        ws = group.options.map((o) => missWeight(o, p, norm));
        const sum = ws.reduce((s, w) => s + w, 0);
        if (sum > 1) ws = ws.map((w) => w / sum);
      }
      let r = rng();
      for (let i = 0; i < ws.length; i++) {
        if ((r -= ws[i]) < 0) return group.options[i];
      }
      return null;
    }

    const rushRateOf = (ctx) => (ctx === "rushSpin" || ctx === "rushSp" ? 1 : S.hitRushRate);
    const pickCtx = (group, out, selfP) =>
      pick(group, out, group.ctx === "self" ? selfP : P[group.ctx], rushRateOf(group.ctx));
    const info = (group, o) => ({ group: group.name, label: o.label, rel: o.rel });
    const rand = (n) => Math.floor(rng() * n);
    const choice = (arr) => arr[rand(arr.length)];
    const outOf = (result) => ({ hit: result.kind === "hit", rush: result.rush });

    // ---------------- 抽選 ----------------

    function drawNormal() {
      const r = rng();
      if (r < S.hitProb) return { kind: "hit", rush: rng() < S.hitRushRate };
      if (r < S.hitProb + S.chargeProb) return { kind: "charge", rush: rng() < S.chargeRushRate };
      return { kind: "miss", rush: false };
    }

    function drawRush() {
      if (rng() < S.rushProb) return { kind: "hit", rush: true, big: rng() < S.rush6000Rate };
      return { kind: "miss", rush: false };
    }

    let holdSeq = 0;

    // 入賞時に当否と、保留の見た目・先読み・先バレを決める
    // force は開発者モード用： { kind: "rushHit"|"hit"|"charge"|"miss", senbare: true }
    const FORCED = {
      rushHit: () => ({ kind: "hit", rush: true, big: rng() < S.rush6000Rate }),
      hit: () => ({ kind: "hit", rush: false, big: false }),
      charge: () => ({ kind: "charge", rush: false }),
      miss: () => ({ kind: "miss", rush: false }),
    };

    function makeHold(mode, custom, force = null) {
      const rush = mode === "rush";
      let result = rush ? drawRush() : drawNormal();
      if (force && FORCED[force.kind]) {
        result = FORCED[force.kind]();
        if (rush && result.kind !== "miss") result = { kind: "hit", rush: true, big: rng() < S.rush6000Rate };
      }
      // 役物投下ボタン：変動中の陰陽玉落下（実機の手落下）を1回起こし、その信頼度どおりに当否を決め直す
      // （通常音 約72%、低音・高音は大当り濃厚。RUSH中は落下すれば大当り）
      let forcedDrop = null;
      if (force && force.drop) {
        if (rush) {
          result = { kind: "hit", rush: true, big: rng() < S.rush6000Rate };
          forcedDrop = { sound: "high", info: { group: "役物投下ボタン（RUSH中）", label: "陰陽玉落下", rel: 1 } };
        } else {
          const g = D.NORMAL_YOKOKU.find((x) => x.id === "hand");
          let r = rng() * g.options.reduce((a, o) => a + o.share, 0);
          const o = g.options.find((x) => (r -= x.share) < 0) || g.options[0];
          result = rng() < o.rel ? { kind: "hit", rush: rng() < S.hitRushRate } : { kind: "miss", rush: false };
          forcedDrop = { sound: o.sound, info: { group: "役物投下ボタン", label: o.label, rel: o.rel } };
        }
      }
      // 先バレの強制：先に出す先バレを決めて、その信頼度どおりに当否を決め直す（EXなら必ず大当り）
      let forcedSen = null;
      if (!rush && force && force.senbare) {
        const g = D.SENBARE[custom.senbare] || D.SENBARE.s40;
        let r = rng() * g.options.reduce((a, o) => a + o.share, 0);
        forcedSen = g.options.find((o) => (r -= o.share) < 0) || g.options[0];
        if (!FORCED[force.kind]) {
          result = rng() < forcedSen.rel ? { kind: "hit", rush: forcedSen.rushOnly ? true : rng() < S.hitRushRate } : { kind: "miss", rush: false };
        } else if (result.kind === "hit" ? forcedSen.rushOnly && !result.rush : forcedSen.rel >= 1) {
          forcedSen = g.options.find((o) => !o.rushOnly && o.rel < 1) || null; // 結果の固定と食い違う先バレは出さない
        }
      }
      const out = rush ? { hit: result.kind === "hit", rush: true } : outOf(result);
      const hold = {
        id: ++holdSeq, mode, result,
        color: null, colorInfo: null, reveal: "start", breakTo: null,
        preread: [], senbare: null, ura: false, notice: false,
      };
      // 先バレONのときは実機と同じく入賞時の先読み（保留変化・先読み予告）は出ない
      const senbareOn = !rush && custom.senbare && custom.senbare !== "off";
      const minRel = senbareOn ? Infinity : D.SAKIYOMI_MIN_REL[rush ? "rush" : "normal"][custom.sakiyomi] ?? 0;
      const effects = !rush || custom.rushMode === "default";

      if (effects) {
        const holdGroup = rush ? D.RUSH_HOLD : D.NORMAL_HOLD;
        const c = pickCtx(holdGroup, out);
        if (c) {
          hold.color = c.color;
          hold.breakTo = c.breakTo || null;
          hold.colorInfo = info(holdGroup, c);
          const visible = c.rel >= minRel;
          if (visible && (c.color === "seal" || custom.sakiyomi !== "osusume" || rng() < 0.5)) hold.reveal = "entry";
        }
        hold.preread = [];
        for (const g of rush ? D.RUSH_PREREAD : D.NORMAL_PREREAD) {
          const pr = pickCtx(g, out);
          if (pr && pr.rel >= minRel) hold.preread.push({ group: g.id, id: pr.id, label: pr.label, info: info(g, pr) });
        }
      }

      if (!rush && custom.senbare && custom.senbare !== "off") {
        const g = D.SENBARE[custom.senbare];
        const s = pickCtx(g, out);
        if (s) {
          hold.senbare = { sound: s.sound, info: { group: `${g.name}（${D.CUSTOMS.senbare.choices[custom.senbare]}）`, label: s.label, rel: s.rel } };
          hold.ura = result.kind === "hit" && result.rush && S.hitRushRate < 1 && rng() < D.URA_BUTTON_RATE;
        }
      }

      if (forcedSen) {
        const g = D.SENBARE[custom.senbare] || D.SENBARE.s40;
        hold.senbare = { sound: forcedSen.sound, info: { group: `${g.name}（強制）`, label: forcedSen.label, rel: forcedSen.rel } };
        hold.ura = result.kind === "hit" && result.rush && S.hitRushRate < 1 && rng() < D.URA_BUTTON_RATE;
      }

      if (rush && custom.rushMode === "shurai" && out.hit && rng() < 0.6) hold.notice = true;
      if (forcedDrop) hold.forcedDrop = forcedDrop;
      return hold;
    }

    // ---------------- 図柄 ----------------

    // RUSH直行の当たり：7・2・6が出やすい。7はテンパイした時点でRUSH濃厚。
    const RUSH_DIGITS = [7, 7, 7, 7, 2, 2, 2, 6, 6, 6, 1, 3, 4, 5, 8, 9];
    const NORMAL_DIGITS = [1, 3, 4, 5, 8, 9];

    function hitDigit(result, reach) {
      if (reach && reach.kind === "zenkaiten") return 7;
      if (result.kind === "hit" && result.rush) return choice(RUSH_DIGITS);
      return choice(NORMAL_DIGITS);
    }

    function missDigits(reach) {
      if (reach) {
        const d = choice([1, 2, 3, 4, 5, 6, 8, 9]); // 7テンパイはRUSH濃厚なのでハズレでは出さない
        const off = ((d - 1 + (rng() < 0.5 ? 1 : 8)) % 9) + 1; // 1コマずれ
        return [d, off, d];
      }
      const a = 1 + rand(9);
      let b = 1 + rand(9);
      if (a === b) b = (b % 9) + 1;
      return [a, 1 + rand(9), b];
    }

    // ---------------- リーチの組み立て ----------------

    const L = D.SERIFU;
    // セリフ step。char のキャラが話す
    const serif = (pair, color = "white", inf = null) => ({ t: "serif", char: pair[0], text: pair[1], color, info: inf });
    const introOf = (reach) => (reach.char && L.intro[reach.char] ? [serif([reach.char, choice(L.intro[reach.char])])] : []);

    // リーチ内のチャンスアップ。信頼度はリーチごとに違うので、名前にリーチ名を付けて区別する。
    function subsOf(reach, out) {
      const picked = {};
      for (const g of reach.subs || []) {
        const o = pickCtx(g, out, reach.rel);
        if (o) picked[g.id] = { o, info: { group: `${reach.label}／${g.name}`, label: o.label, rel: o.rel } };
      }
      return picked;
    }

    function deviceSteps(subs) {
      const timing = subs.yakuTiming ? subs.yakuTiming.o.id : null;
      const steps = [{
        t: "device",
        device: subs.device ? "lever" : "button",
        info: subs.device ? subs.device.info : null,
        handAt: timing === "deviceAppear" || timing === "deviceOperate" ? timing : null,
        handInfo: subs.yakuTiming ? subs.yakuTiming.info : null,
      }];
      if (timing === "kyusai") steps.push({ t: "fakeEnd" }, { t: "hand", sound: "high", info: subs.yakuTiming.info });
      return steps;
    }

    function colorStep(t, subs, key, text, pool = L.telop) {
      const s = subs[key];
      const color = s ? s.o.color : "white";
      return { t, color, text: text || choice(pool[color] || pool.white), info: s ? s.info : null };
    }

    const reachTitle = (reach, color) => ({
      t: "reach", id: reach.id, kind: reach.kind, char: reach.char || null, label: reach.label, color,
      info: { group: "リーチ", label: reach.label, rel: reach.rel },
    });

    function spCards(groups, out) {
      const steps = [];
      for (const g of groups) {
        const o = pickCtx(g, out);
        if (!o) continue;
        const i = info(g, o);
        if (g.id === "spDrop") steps.push({ t: "hand", sound: "normal", timing: o.id, info: i });
        else if (g.id === "lastSpell") steps.push({ t: "lastSpell", word: o.id === "word" ? "LAST WORD" : "LAST SPELL", color: o.color, info: i });
        else steps.push({ t: "card", id: g.id, title: g.name, text: o.label, color: o.color, info: i });
      }
      return steps;
    }

    // 先バレ（先手役物落下）カスタムがONのときは、実機と同じく役物は入賞時に落ちるので、変動中には落ちない
    // （デバイスと同時の落下は大当り濃厚なのでそのまま）
    const dropMovedToEntry = (custom) => !!custom && !!custom.senbare && custom.senbare !== "off";

    function normalReachSteps(reach, out, custom) {
      const noDrop = dropMovedToEntry(custom);
      const subs = subsOf(reach, out);
      if (noDrop) delete subs.drop;
      const sp = reach.sp ? spCards(D.NORMAL_SP_YOKOKU, out).filter((s) => !(noDrop && s.t === "hand")) : [];
      const drop = sp.filter((s) => s.t === "hand");
      const cards = sp.filter((s) => s.t !== "hand");
      const steps = [];

      switch (reach.kind) {
        case "normal":
          steps.push({ t: "wait", ms: 1600 });
          break;
        case "chara":
          steps.push(reachTitle(reach, "white"), ...introOf(reach), colorStep("telop", subs, "telop"));
          if (subs.drop) steps.push({ t: "hand", sound: "normal", info: subs.drop.info });
          steps.push({ t: "wait", ms: 1000 });
          break;
        case "long":
          steps.push(reachTitle(reach, "white"), ...introOf(reach), colorStep("telop", subs, "telop"));
          if (subs.yukari) steps.push({ t: "card", id: "yukariToujou", char: "yukari", title: "紫 登場", text: "あら、面白そうね", color: "purple", info: subs.yukari.info });
          steps.push({ t: "wait", ms: 1300 });
          break;
        case "battle":
          steps.push({ t: "wait", ms: 700 }, ...drop, reachTitle(reach, subs.title ? subs.title.o.color : "white"), ...introOf(reach), colorStep("telop", subs, "telop"));
          if (subs.lamp) steps.push({ t: "lamp", info: subs.lamp.info });
          if (subs.drop) steps.push({ t: "hand", sound: "normal", info: subs.drop.info });
          if (subs.strong) steps.push({ t: "sakura", id: "strong", text: "強ルートへ", info: subs.strong.info });
          steps.push(...cards, colorStep("cutin", subs, "cutin", `${D.CHARS.reimu.spell}`), ...deviceSteps(subs));
          break;
        case "episode": {
          // 原作の異変をなぞる章立てのストーリーパート（タイトル色が熱いと最後の章も熱い色になる）
          const titleColor = subs.title ? subs.title.o.color : "white";
          const story = L.story[reach.id];
          steps.push(...drop, reachTitle(reach, titleColor));
          if (story) steps.push({ t: "story", bg: story.bg, chapters: story.chapters, color: titleColor });
          if (reach.id === "shunsetsu") {
            const haru = subs.haru;
            steps.push({ t: "haru", level: haru ? haru.o.id : "gobu", color: haru ? haru.o.color : "white", info: haru ? haru.info : null });
          }
          steps.push(...introOf(reach), colorStep("telop", subs, "telop"));
          steps.push(...cards, colorStep("cutin", subs, "cutin", D.CHARS.reimu.spell), ...deviceSteps(subs));
          break;
        }
        case "climax":
          steps.push({ t: "card", id: "hakurei", char: "reimu", title: "博麗の巫女", text: "弾幕クライマックスへ", color: "red", info: null });
          steps.push(...drop, reachTitle(reach, "red"), ...introOf(reach));
          steps.push(colorStep("declare", subs, "declare", D.CHARS[reach.char].spell));
          steps.push(colorStep("telop", subs, "monologue", null, L.monologue));
          steps.push(...cards, colorStep("cutin", subs, "cutin", "霊符「夢想封印」"), ...deviceSteps(subs));
          break;
        case "revive":
          steps.push({ t: "fakeEnd" }, { t: "sukima", text: "まだ終わりじゃないわ" });
          steps.push(...drop, reachTitle(reach, "purple"), ...introOf(reach), ...cards, ...deviceSteps(subs));
          break;
        case "kinki":
          steps.push(...drop, reachTitle(reach, "red"), ...introOf(reach), ...cards, ...deviceSteps(subs));
          break;
        case "zenkaiten":
          break;
      }
      return steps;
    }

    function rushReachSteps(reach, out) {
      const subs = subsOf(reach, out);
      const sp = reach.sp ? spCards(D.RUSH_SP_YOKOKU, out) : [];
      const steps = [];
      const card = (key, title, text, color, char) =>
        subs[key] ? [{ t: "card", id: key, title, text, color, char, info: subs[key].info }] : [];

      switch (reach.kind) {
        case "normal":
          steps.push({ t: "wait", ms: 1000 });
          break;
        case "shunkan":
          steps.push(reachTitle(reach, "red"), ...introOf(reach), ...sp, ...card("kesshin", "霊夢の決意", "一瞬で決める", "red", "reimu"), ...deviceSteps(subs));
          break;
        case "danmaku":
          steps.push(reachTitle(reach, "red"), ...introOf(reach), ...card("music", "楽曲変化", "♪", "gold"), ...sp, ...card("gabure", "画ブレ", "", "red"));
          steps.push({ t: "card", id: "attack", title: "攻撃", text: subs.attack ? "スペルカード一撃" : "弾幕連打", color: subs.attack ? "red" : "white", info: subs.attack ? subs.attack.info : null });
          steps.push(...deviceSteps(subs));
          break;
        case "kessen":
          steps.push(reachTitle(reach, subs.title ? "gold" : "red"), ...introOf(reach), ...sp);
          steps.push({ t: "card", id: "sensei", char: subs.sensei ? "reimu" : "flandre", title: "最終煽り", text: subs.sensei ? "霊夢の先制攻撃" : "フランの先制攻撃", color: subs.sensei ? "gold" : "white", info: subs.sensei ? subs.sensei.info : null });
          steps.push(...deviceSteps(subs));
          break;
        case "kyuushutsu":
          steps.push(reachTitle(reach, "white"), ...introOf(reach), ...sp, ...card("light", "集光エフェクト", "大", "gold"), ...card("countdown", "カウントダウン", "3・2・1", "gold"), ...deviceSteps(subs));
          break;
        case "kimagure":
          steps.push(reachTitle(reach, "red"), ...introOf(reach), ...sp);
          if (subs.sakura) steps.push({ t: "sakura", id: "kimagure", text: "", info: subs.sakura.info });
          steps.push({ t: "card", id: "aura", char: "remilia", title: "最終オーラ", text: subs.aura ? subs.aura.o.label : "紫", color: subs.aura ? subs.aura.o.color : "purple", info: subs.aura ? subs.aura.info : null });
          steps.push(...deviceSteps(subs));
          break;
        case "ranbu":
          steps.push(reachTitle(reach, "red"), ...sp, ...card("allHit", "提示図柄", "全て大当り図柄", "gold"), colorStep("cutin", subs, "cutin", D.CHARS.reimu.spell), ...deviceSteps(subs));
          break;
        case "sukima":
          steps.push(reachTitle(reach, "purple"), ...introOf(reach), ...sp, ...deviceSteps(subs));
          break;
        case "zenkaiten":
          break;
      }
      return steps;
    }

    // 復活演出。紫SP（もともと復活型）・全回転・即救済がすでにあるときは出さない。
    function reviveSteps(group, reach, out, digits, steps) {
      if (!reach.sp || reach.kind === "revive" || reach.kind === "zenkaiten") return [];
      if (steps.some((s) => s.t === "fakeEnd")) return [];
      const o = pickCtx(group, out);
      if (!o) return [];
      return [{ t: "revive", id: o.id, hit: out.hit, stopAt: out.hit ? null : digits[1], line: choice(L.revive[o.id] || L.revive.aori), info: info(group, o) }];
    }

    // ---------------- 通常時シナリオ ----------------

    // ハズレのリーチを、ハズレ時の出現率の比で1つ選ぶ（必ずどれかを返す）
    function pickMissReach() {
      const g = D.NORMAL_REACH;
      const norm = shareNorm(g);
      const ws = g.options.map((o) => missWeight(o, P.spin, norm));
      let r = rng() * ws.reduce((a, w) => a + w, 0);
      for (let i = 0; i < ws.length; i++) if ((r -= ws[i]) < 0) return g.options[i];
      return g.options[0];
    }

    // 先バレした保留より前の変動（先バレ演出中）。予告もリーチもなく、すぐにハズレで止まる
    function quietScenario(hold) {
      const digits = missDigits(null);
      return { steps: [{ t: "reels", digits, reach: false, quick: true }, { t: "final", digits, hit: false, charge: false }], reach: null, digits };
    }

    function normalScenario(hold, custom) {
      const result = hold.result;
      const out = outOf(result);
      const steps = [];

      if (hold.color && hold.reveal === "start") steps.push({ t: "holdChange", color: hold.color, info: hold.colorInfo });
      if (hold.breakTo) steps.push({ t: "sealBreak", color: hold.breakTo, info: hold.colorInfo });

      const imp = pickCtx(D.IMPACT[custom.impact] || D.IMPACT.off, out);
      if (imp) steps.push({ t: "impact", info: info(D.IMPACT.off, imp) });

      const lbGroup = D.LEVER_BURU[custom.leverBuru] || D.LEVER_BURU.off;
      const lb = pickCtx(lbGroup, out);
      if (lb) steps.push({ t: "leverBuru", color: lb.color, info: { group: `${lbGroup.name}（${custom.leverBuru === "on" ? "ON" : "OFF"}）`, label: lb.label, rel: lb.rel } });

      for (const g of D.NORMAL_YOKOKU) {
        const o = pickCtx(g, out);
        if (!o) continue;
        const i = info(g, o);
        switch (g.id) {
          case "logo": steps.push({ t: "logo", color: o.color, info: i }); break;
          case "sakura": steps.push({ t: "sakura", id: o.id, drop: !!o.drop && !dropMovedToEntry(custom), text: "西行妖が咲く…", info: i }); break;
          case "giji": steps.push({ t: "giji", n: o.n, yukari: !!o.yukari, reimu: !!o.reimu, info: i }); break;
          case "su": steps.push({ t: "su", step: o.step, color: o.color, char: o.char, info: i }); break;
          case "tokitome": steps.push({ t: "tokitome", color: o.color, info: i }); break;
          case "mono": steps.push({ t: "mono", color: o.color, info: i }); break;
          case "haikei": steps.push({ t: "bg", bg: o.bg, info: i }); break;
          case "hand": if (!hold.forcedDrop && !dropMovedToEntry(custom)) steps.push({ t: "hand", sound: o.sound, info: i }); break;
          case "bunbun": steps.push({ t: "bunbun", color: o.color, headline: o.headline, info: i }); break;
          case "saisen": steps.push({ t: "saisen", item: o.item, color: o.color, line: choice(L.saisen[o.item]), info: i }); break;
          case "hud": steps.push({ t: "hud", word: o.word, color: o.color, info: i }); break;
          case "enkaiYokoku": steps.push({ t: "enkai", n: o.n, color: o.color, line: choice(L.enkai[o.color]), info: i }); break;
          case "monban": steps.push({ t: "monban", wake: o.wake, color: o.color, info: i }); break;
          case "lily": steps.push({ t: "lily", text: o.text, color: o.color, info: i }); break;
          case "kaiwa": {
            const [a, b] = choice(L.kaiwa[o.color] || L.kaiwa.white);
            steps.push(serif(a, "white", i), serif(b, o.color));
            break;
          }
          default: steps.push({ t: "card", id: g.id, title: g.name, text: o.label, color: o.color, info: i });
        }
      }

      let reach = pick(D.NORMAL_REACH, out, P.spin, S.hitRushRate);
      // 先バレした保留は、ハズレでも必ずリーチまでは発展する（実機と同じく先バレからの素ハズレはない）
      if (!reach && (hold.senbare || hold.forcedDrop) && !out.hit) reach = pickMissReach();

      if (reach) {
        for (const g of D.NORMAL_PRE_REACH) {
          const o = pickCtx(g, out);
          if (!o) continue;
          const i = info(g, o);
          if (g.id === "cirno") steps.push({ t: "cirno", color: o.color, info: i });
          else if (g.id === "zone") steps.push({ t: "zone", device: o.device, info: i });
          else steps.push(serif(choice(o.id === "marisa" ? L.seien.marisa : L.seien.general), o.color, i));
        }
      }

      let digits;
      if (result.kind === "hit") {
        const d = hitDigit(result, reach);
        digits = [d, d, d];
      } else if (result.kind === "charge") {
        digits = missDigits(reach); // リーチ後にチャージで止まることもある
        digits[1] = "C";
      } else {
        digits = missDigits(reach);
      }

      if (reach && reach.kind === "kinki") {
        steps.push({ t: "kyouki", success: true, info: { group: D.KYOUKI_FAIL.name, label: "テンパイ成功（禁忌SPへ）", rel: reach.rel } });
      } else {
        const kf = pickCtx(D.KYOUKI_FAIL, out);
        if (kf) steps.push({ t: "kyouki", success: false, info: info(D.KYOUKI_FAIL, kf) });
      }

      if (reach && reach.kind === "zenkaiten") steps.push({ t: "zenkaiten", info: { group: "リーチ", label: "全回転", rel: 1 } });
      else steps.push({ t: "reels", digits, reach: !!reach });
      if (reach) {
        steps.push(...normalReachSteps(reach, out, custom));
        steps.push(...reviveSteps(D.NORMAL_REVIVE, reach, out, digits, steps));
      }
      steps.push({ t: "final", digits, hit: out.hit, charge: result.kind === "charge" });
      return { steps, reach, digits };
    }

    // ---------------- 弾幕RUSH中シナリオ ----------------

    function rushScenario(hold, custom) {
      const result = hold.result;
      const out = { hit: result.kind === "hit", rush: true };
      const steps = [];
      let reach = null;
      const mode = custom.rushMode || "default";

      if (mode === "default") {
        if (hold.color && hold.reveal === "start") steps.push({ t: "holdChange", color: hold.color, info: hold.colorInfo });
        for (const g of D.RUSH_YOKOKU) {
          const o = pickCtx(g, out);
          if (!o) continue;
          const i = info(g, o);
          if (g.id === "leverBuruRush") steps.push({ t: "leverBuru", color: "red", info: i });
          else if (g.id === "bundan") steps.push({ t: "bundan", n: o.n, info: i });
          else if (g.id === "spellMoji") steps.push({ t: "spellMoji", word: o.word, color: o.color, info: i });
          else if (g.id === "getSpell") steps.push({ t: "hud", word: o.word, color: o.color, info: i });
          else if (g.id === "world") steps.push({ t: "tokitome", color: o.color, world: true, info: i });
          else steps.push({ t: "card", id: g.id, title: g.name, text: o.label, color: o.color, char: g.id === "watashi" || g.id === "miko" ? "reimu" : g.id === "dive" ? "marisa" : g.id === "saikyou" ? "cirno" : null, info: i });
        }
        reach = pick(D.RUSH_REACH, out, P.rushSpin, 1);
      } else if (mode === "totsugeki") {
        if (out.hit) steps.push({ t: "hand", sound: "high", notice: "突撃！", info: { group: "陰陽玉突撃モード", label: "陰陽玉落下", rel: 1 } });
      } else if (mode === "shurai") {
        if (out.hit) steps.push({ t: "notice", text: "フラン襲来", char: "flandre", info: { group: "フラン襲来モード", label: hold.notice ? "入賞時告知" : "変動時告知", rel: 1 } });
      } else if (mode === "renda") {
        const o = pickCtx(D.RENDA, out);
        if (o) steps.push({ t: "renda", n: o.n, hit: out.hit, info: info(D.RENDA, o) });
        else if (out.hit) steps.push({ t: "notice", text: "マスタースパーク", char: "marisa", info: { group: "マスパ連打モード", label: "告知", rel: 1 } });
      }

      let digits;
      if (out.hit) {
        const d = reach && reach.kind === "zenkaiten" ? 7 : 1 + rand(9);
        digits = [d, d, d];
      } else {
        digits = missDigits(reach);
      }
      if (reach && reach.kind === "zenkaiten") steps.push({ t: "zenkaiten", info: { group: "リーチ", label: "全回転", rel: 1 } });
      else steps.push({ t: "reels", digits, reach: !!reach, quick: mode !== "default" });
      if (reach) {
        steps.push(...rushReachSteps(reach, out));
        steps.push(...reviveSteps(D.RUSH_REVIVE, reach, out, digits, steps));
      }
      steps.push({ t: "final", digits, hit: out.hit, charge: false });
      return { steps, reach, digits };
    }

    // ---------------- 大当り後 ----------------

    function bonusSteps(result, digits, mode, custom) {
      const steps = [];
      if (mode === "rush") {
        steps.push({ t: "bonus", title: "異変解決BONUS", sub: S.labels.rush, rounds: S.rounds.rush, payout: S.payout.rush3000 });
        if (result.big) {
          steps.push({ t: "hand", sound: "low", notice: "夢想封印MAX", info: { group: "BONUS中", label: `夢想封印MAX（${S.labels.big}）`, rel: 1 } });
          steps.push({ t: "bonus", title: "夢想封印MAX", sub: S.labels.big, rounds: S.rounds.big, payout: S.payout.rush6000 - S.payout.rush3000 });
        }
        steps.push({ t: "rushContinue" }, serif(choice(L.rushContinue)));
        return steps;
      }
      if (result.kind === "charge") {
        // 門番突破：昇格なら7割は突破で、残りは突破失敗のあと最後の陰陽玉落下で逆転
        const mode = custom.chargeMode === "ippatsu" ? "ippatsu" : "toppa";
        const toppaWin = mode === "toppa" && result.rush && rng() < 0.7;
        steps.push({ t: "charge", payout: S.payout.charge2R, promote: result.rush, mode, toppaWin, lines: { start: choice(L.toppa.start), end: choice(toppaWin ? L.toppa.win : L.toppa.lose) } }, serif(choice(result.rush ? L.promote : L.charge)));
        return steps;
      }

      // 初当りがすべてRUSH（ST）直行のスペックでは、裏ボタンも突入チャレンジもない
      const direct = S.hitRushRate >= 1;
      const uo = direct ? null : pick(D.BONUS_URA, { hit: result.rush, rush: result.rush }, P.bonus, 1);
      const ura = direct ? null : uo ? { color: uo.color, info: info(D.BONUS_URA, uo) } : { color: "white", info: null };
      steps.push({ t: "bonus", title: "異変解決BONUS", sub: `${S.rounds.bonus}R`, rounds: S.rounds.bonus, payout: S.payout.bonus10R, ura }, serif(choice(L.bonus)));

      if (direct) {
        steps.push({ t: "rushResult", success: true, text: "弾幕RUSH 突入" }, serif(choice(L.rushIn), "gold"));
      } else if (digits[0] === 7) {
        steps.push({ t: "rushResult", success: true, text: "霊夢図柄 RUSH確定" }, serif(choice(L.rushIn), "gold"));
      } else if ((custom.challenge || "koumakan") === "koumakan") {
        const reimuLine = result.rush && rng() < 0.2;
        steps.push(serif(choice(L.koumakan), "red"));
        steps.push({ t: "challenge", kind: "koumakan", serif: reimuLine, device: result.rush && rng() < 0.15 ? "lever" : "button" });
        steps.push({ t: "rushResult", success: result.rush }, serif(choice(result.rush ? L.rushIn : L.rushFail), result.rush ? "gold" : "white"));
      } else {
        let at = null;
        if (result.rush) {
          const r = rng();
          at = r < 0.55 ? 2 + rand(32) : r < 0.75 ? 1 : r < 0.92 ? 0 : -1; // -1 は失敗後の復活
        }
        steps.push({ t: "challenge", kind: "ippatsu", at });
        steps.push({ t: "rushResult", success: result.rush }, serif(choice(result.rush ? L.rushIn : L.rushFail), result.rush ? "gold" : "white"));
      }
      return steps;
    }

    return { P, recalc, toBase, setBase, baseOf, pick, drawNormal, drawRush, makeHold, normalScenario, quietScenario, rushScenario, bonusSteps };
  }

  if (typeof module !== "undefined") module.exports = { createEngine };
  else root.createEngine = createEngine;
})(this);
