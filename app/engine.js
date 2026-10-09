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
      if (o.rel >= 1) return 0;
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

    const nc = contextProbs(S.hitProb, D.NORMAL_REACH);
    const rc = contextProbs(S.rushProb, D.RUSH_REACH);
    const P = {
      spin: S.hitProb, reach: nc.reach, sp: nc.sp,
      rushSpin: S.rushProb, rushSp: rc.sp,
      bonus: S.hitRushRate,
    };

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
      const out = rush ? { hit: result.kind === "hit", rush: true } : outOf(result);
      const hold = {
        id: ++holdSeq, mode, result,
        color: null, colorInfo: null, reveal: "start", breakTo: null,
        preread: [], senbare: null, ura: false, notice: false,
      };
      const minRel = D.SAKIYOMI_MIN_REL[rush ? "rush" : "normal"][custom.sakiyomi] ?? 0;
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
          hold.ura = result.kind === "hit" && result.rush && rng() < D.URA_BUTTON_RATE;
        }
      }

      if (!rush && force && force.senbare && !hold.senbare) {
        const g = D.SENBARE[custom.senbare] || D.SENBARE.s40;
        const s = out.hit ? pick(g, out, P.spin, S.hitRushRate) || g.options[0] : g.options[0];
        hold.senbare = { sound: s.sound, info: { group: `${g.name}（強制）`, label: s.label, rel: s.rel } };
        hold.ura = result.kind === "hit" && result.rush && rng() < D.URA_BUTTON_RATE;
      }

      if (rush && custom.rushMode === "shurai" && out.hit && rng() < 0.6) hold.notice = true;
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

    const TELOP = { white: "まだ終わらせない", red: "ここで決めるわ…！", gold: "異変はここで終わりよ" };

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

    function colorStep(t, subs, key, text) {
      const s = subs[key];
      const color = s ? s.o.color : "white";
      return { t, color, text: text || TELOP[color], info: s ? s.info : null };
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
        else steps.push({ t: "card", id: g.id, title: g.name, text: o.label, color: o.color, info: i });
      }
      return steps;
    }

    function normalReachSteps(reach, out) {
      const subs = subsOf(reach, out);
      const sp = reach.sp ? spCards(D.NORMAL_SP_YOKOKU, out) : [];
      const drop = sp.filter((s) => s.t === "hand");
      const cards = sp.filter((s) => s.t !== "hand");
      const steps = [];

      switch (reach.kind) {
        case "normal":
          steps.push({ t: "wait", ms: 1600 });
          break;
        case "chara":
          steps.push(reachTitle(reach, "white"), colorStep("telop", subs, "telop"));
          if (subs.drop) steps.push({ t: "hand", sound: "normal", info: subs.drop.info });
          steps.push({ t: "wait", ms: 1000 });
          break;
        case "long":
          steps.push(reachTitle(reach, "white"), colorStep("telop", subs, "telop"));
          if (subs.yukari) steps.push({ t: "card", id: "yukariToujou", char: "yukari", title: "紫 登場", text: "あら、面白そうね", color: "purple", info: subs.yukari.info });
          steps.push({ t: "wait", ms: 1300 });
          break;
        case "battle":
          steps.push({ t: "wait", ms: 700 }, ...drop, reachTitle(reach, subs.title ? subs.title.o.color : "white"), colorStep("telop", subs, "telop"));
          if (subs.lamp) steps.push({ t: "lamp", info: subs.lamp.info });
          if (subs.drop) steps.push({ t: "hand", sound: "normal", info: subs.drop.info });
          if (subs.strong) steps.push({ t: "sakura", id: "strong", text: "強ルートへ", info: subs.strong.info });
          steps.push(...cards, colorStep("cutin", subs, "cutin", `${D.CHARS.reimu.spell}`), ...deviceSteps(subs));
          break;
        case "episode":
          steps.push(...drop, reachTitle(reach, subs.title ? subs.title.o.color : "white"), colorStep("telop", subs, "telop"));
          steps.push(...cards, colorStep("cutin", subs, "cutin", D.CHARS.reimu.spell), ...deviceSteps(subs));
          break;
        case "climax":
          steps.push({ t: "card", id: "hakurei", char: "reimu", title: "博麗の巫女", text: "弾幕クライマックスへ", color: "red", info: null });
          steps.push(...drop, reachTitle(reach, "red"));
          steps.push(colorStep("declare", subs, "declare", D.CHARS[reach.char].spell));
          steps.push(colorStep("telop", subs, "monologue"));
          steps.push(...cards, colorStep("cutin", subs, "cutin", "霊符「夢想封印」"), ...deviceSteps(subs));
          break;
        case "revive":
          steps.push({ t: "fakeEnd" }, { t: "sukima", text: "まだ終わりじゃないわ" });
          steps.push(...drop, reachTitle(reach, "purple"), ...cards, ...deviceSteps(subs));
          break;
        case "kinki":
          steps.push(...drop, reachTitle(reach, "red"), ...cards, ...deviceSteps(subs));
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
          steps.push(reachTitle(reach, "red"), ...sp, ...card("kesshin", "霊夢の決意", "一瞬で決める", "red", "reimu"), ...deviceSteps(subs));
          break;
        case "danmaku":
          steps.push(reachTitle(reach, "red"), ...card("music", "楽曲変化", "♪", "gold"), ...sp, ...card("gabure", "画ブレ", "", "red"));
          steps.push({ t: "card", id: "attack", title: "攻撃", text: subs.attack ? "スペルカード一撃" : "弾幕連打", color: subs.attack ? "red" : "white", info: subs.attack ? subs.attack.info : null });
          steps.push(...deviceSteps(subs));
          break;
        case "kessen":
          steps.push(reachTitle(reach, subs.title ? "gold" : "red"), ...sp);
          steps.push({ t: "card", id: "sensei", char: subs.sensei ? "reimu" : "flandre", title: "最終煽り", text: subs.sensei ? "霊夢の先制攻撃" : "フランの先制攻撃", color: subs.sensei ? "gold" : "white", info: subs.sensei ? subs.sensei.info : null });
          steps.push(...deviceSteps(subs));
          break;
        case "kyuushutsu":
          steps.push(reachTitle(reach, "white"), ...sp, ...card("light", "集光エフェクト", "大", "gold"), ...card("countdown", "カウントダウン", "3・2・1", "gold"), ...deviceSteps(subs));
          break;
        case "kimagure":
          steps.push(reachTitle(reach, "red"), ...sp);
          if (subs.sakura) steps.push({ t: "sakura", id: "kimagure", text: "", info: subs.sakura.info });
          steps.push({ t: "card", id: "aura", char: "remilia", title: "最終オーラ", text: subs.aura ? subs.aura.o.label : "紫", color: subs.aura ? subs.aura.o.color : "purple", info: subs.aura ? subs.aura.info : null });
          steps.push(...deviceSteps(subs));
          break;
        case "ranbu":
          steps.push(reachTitle(reach, "red"), ...sp, ...card("allHit", "提示図柄", "全て大当り図柄", "gold"), colorStep("cutin", subs, "cutin", D.CHARS.reimu.spell), ...deviceSteps(subs));
          break;
        case "sukima":
          steps.push(reachTitle(reach, "purple"), ...sp, ...deviceSteps(subs));
          break;
        case "zenkaiten":
          break;
      }
      return steps;
    }

    // ---------------- 通常時シナリオ ----------------

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
          case "sakura": steps.push({ t: "sakura", id: o.id, drop: !!o.drop, text: "西行妖が咲く…", info: i }); break;
          case "giji": steps.push({ t: "giji", n: o.n, yukari: !!o.yukari, reimu: !!o.reimu, info: i }); break;
          case "su": steps.push({ t: "su", step: o.step, color: o.color, char: o.char, info: i }); break;
          case "tokitome": steps.push({ t: "tokitome", color: o.color, info: i }); break;
          case "mono": steps.push({ t: "mono", color: o.color, info: i }); break;
          case "haikei": steps.push({ t: "bg", bg: o.bg, info: i }); break;
          case "hand": steps.push({ t: "hand", sound: o.sound, info: i }); break;
          default: steps.push({ t: "card", id: g.id, title: g.name, text: o.label, color: o.color, info: i });
        }
      }

      const reach = pick(D.NORMAL_REACH, out, P.spin, S.hitRushRate);

      if (reach) {
        for (const g of D.NORMAL_PRE_REACH) {
          const o = pickCtx(g, out);
          if (!o) continue;
          const i = info(g, o);
          if (g.id === "cirno") steps.push({ t: "cirno", color: o.color, info: i });
          else if (g.id === "zone") steps.push({ t: "zone", device: o.device, info: i });
          else steps.push({ t: "card", id: g.id, char: o.id === "marisa" ? "marisa" : null, title: g.name, text: o.id === "marisa" ? "霊夢なら大丈夫だぜ！" : "がんばれー！", color: o.color, info: i });
        }
      }

      let digits;
      if (result.kind === "hit") {
        const d = hitDigit(result, reach);
        digits = [d, d, d];
      } else if (result.kind === "charge") {
        digits = missDigits(null);
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
      if (reach) steps.push(...normalReachSteps(reach, out));
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
      if (reach) steps.push(...rushReachSteps(reach, out));
      steps.push({ t: "final", digits, hit: out.hit, charge: false });
      return { steps, reach, digits };
    }

    // ---------------- 大当り後 ----------------

    function bonusSteps(result, digits, mode, custom) {
      const steps = [];
      if (mode === "rush") {
        steps.push({ t: "bonus", title: "異変解決BONUS", sub: "3000", rounds: 20, payout: S.payout.rush3000 });
        if (result.big) {
          steps.push({ t: "hand", sound: "low", notice: "夢想封印MAX", info: { group: "BONUS中", label: "夢想封印MAX（6000）", rel: 1 } });
          steps.push({ t: "bonus", title: "夢想封印MAX", sub: "6000", rounds: 20, payout: S.payout.rush6000 - S.payout.rush3000 });
        }
        steps.push({ t: "rushContinue" });
        return steps;
      }
      if (result.kind === "charge") {
        steps.push({ t: "charge", payout: S.payout.charge2R, promote: result.rush });
        return steps;
      }

      const uo = pick(D.BONUS_URA, { hit: result.rush, rush: result.rush }, P.bonus, 1);
      const ura = uo ? { color: uo.color, info: info(D.BONUS_URA, uo) } : { color: "white", info: null };
      steps.push({ t: "bonus", title: "異変解決BONUS", sub: "10R", rounds: 10, payout: S.payout.bonus10R, ura });

      if (digits[0] === 7) {
        steps.push({ t: "rushResult", success: true, text: "霊夢図柄 RUSH確定" });
      } else if ((custom.challenge || "koumakan") === "koumakan") {
        const serif = result.rush && rng() < 0.2;
        steps.push({ t: "challenge", kind: "koumakan", serif, device: result.rush && rng() < 0.15 ? "lever" : "button" });
        steps.push({ t: "rushResult", success: result.rush });
      } else {
        let at = null;
        if (result.rush) {
          const r = rng();
          at = r < 0.55 ? 2 + rand(32) : r < 0.75 ? 1 : r < 0.92 ? 0 : -1; // -1 は失敗後の復活
        }
        steps.push({ t: "challenge", kind: "ippatsu", at });
        steps.push({ t: "rushResult", success: result.rush });
      }
      return steps;
    }

    return { P, pick, drawNormal, drawRush, makeHold, normalScenario, rushScenario, bonusSteps };
  }

  if (typeof module !== "undefined") module.exports = { createEngine };
  else root.createEngine = createEngine;
})(this);
