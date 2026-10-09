// 抽選と演出シナリオの生成。DOMには触らないので node からもテストできる。
//
// 演出は「当否を先に決めてから、当否ごとの出現率で選ぶ」方式。
// 大当り時の出現率 share をデータで決め、ハズレ時の出現率を
//   share * p * (1 - rel) / (rel * (1 - p))
// で逆算するので、各演出の信頼度は掲載値 rel と一致する（p はその演出の母数での大当り確率）。
(function (root) {
  function createEngine(D, rng = Math.random) {
    const S = D.SPEC;

    const shareNorm = (g) => (g.exhaustive ? g.options.reduce((s, o) => s + o.share, 0) : 1);

    function missWeight(o, p, norm) {
      if (o.missRate != null) return o.missRate;
      if (o.rel >= 1) return 0;
      return ((o.share / norm) * p * (1 - o.rel)) / (o.rel * (1 - p));
    }

    // 当否を条件とした母数ごとの大当り確率
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
    };

    // 当否 out = { hit, rush } に応じて group から1つ選ぶ。何も出ないときは null。
    function pick(group, out, p, rushRate = S.hitRushRate) {
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

    const pickP = (group, out, self) => pick(group, out, group.ctx === "self" ? self : P[group.ctx]);
    const info = (group, o) => ({ group: group.name, label: o.label, rel: o.rel });
    const rand = (n) => Math.floor(rng() * n);
    const choice = (arr) => arr[rand(arr.length)];

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

    // 入賞時に当否と保留の見た目（先読み）を決める
    function makeHold(mode, rushMode) {
      const result = mode === "rush" ? drawRush() : drawNormal();
      const out = { hit: result.kind === "hit", rush: result.rush };
      const hold = { result, color: null, reveal: "start", preread: null, notice: false };

      const holdGroup = mode === "rush" ? D.RUSH_HOLD : D.NORMAL_HOLD;
      const preGroup = mode === "rush" ? D.RUSH_PREREAD : D.NORMAL_PREREAD;
      const useEffects = mode === "normal" || rushMode === "default";

      if (useEffects) {
        const c = pick(holdGroup, out, P[holdGroup.ctx], mode === "rush" ? 1 : S.hitRushRate);
        if (c) {
          hold.color = c.color;
          hold.breakTo = c.breakTo || null;
          hold.colorInfo = info(holdGroup, c);
          hold.reveal = c.color === "chain" || rng() < 0.5 ? "entry" : "start";
        }
        const pr = pick(preGroup, out, P[preGroup.ctx], mode === "rush" ? 1 : S.hitRushRate);
        if (pr) hold.preread = { id: pr.id, info: info(preGroup, pr) };
      }
      if (mode === "rush" && rushMode === "rize" && out.hit && rng() < 0.6) hold.notice = true;
      return hold;
    }

    // ---------------- 図柄 ----------------

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
        const off = ((d - 1 + (rng() < 0.5 ? 1 : 8)) % 9) + 1; // 前後ハズレ
        return [d, off, d];
      }
      const a = 1 + rand(9);
      let b = 1 + rand(9);
      if (a === b) b = (b % 9) + 1;
      return [a, 1 + rand(9), b];
    }

    // ---------------- 通常時シナリオ ----------------

    const TELOP = {
      white: "まだ終わらせない",
      red: "ここで決める…！",
      gold: "これが僕の答えだ",
    };

    function subsOf(reach, out) {
      const picked = {};
      for (const g of reach.subs || []) {
        const o = pickP(g, out, reach.rel);
        if (o) picked[g.id] = { o, info: info(g, o) };
      }
      return picked;
    }

    function deviceSteps(subs, out) {
      const dev = subs.device ? "vcon" : "button";
      const timing = subs.yakuTiming ? subs.yakuTiming.o.id : null;
      const steps = [];
      steps.push({ t: "device", device: dev, info: subs.device ? subs.device.info : null, handAt: timing });
      if (timing === "kyusai") steps.push({ t: "fakeEnd" }, { t: "hand", sound: "high", info: subs.yakuTiming.info });
      return steps;
    }

    function colorStep(t, subs, key, text) {
      const s = subs[key];
      const color = s ? s.o.color : "white";
      return { t, color, text: text || TELOP[color], info: s ? s.info : null };
    }

    function reachSteps(reach, out) {
      const subs = subsOf(reach, out);
      const steps = [];
      const sp = [];
      if (reach.sp) {
        for (const g of D.NORMAL_SP_YOKOKU) {
          const o = pickP(g, out);
          if (o) sp.push({ t: "card", id: g.id, title: g.name, text: o.label, color: o.color, info: info(g, o) });
        }
      }
      const title = (color) => ({ t: "reach", id: reach.id, kind: reach.kind, label: reach.label, color, info: { group: "リーチ", label: reach.label, rel: reach.rel } });

      switch (reach.kind) {
        case "normal":
          steps.push({ t: "wait", ms: 1800 });
          break;
        case "chara":
          steps.push(title("white"), colorStep("telop", subs, "telop"));
          if (subs.drop) steps.push({ t: "hand", sound: "normal", info: subs.drop.info });
          steps.push({ t: "wait", ms: 1200 });
          break;
        case "long":
          steps.push(title("white"), colorStep("telop", subs, "telop"));
          if (subs.rize) steps.push({ t: "card", id: "rize", title: "リゼ登場", text: "", color: "red", info: subs.rize.info });
          steps.push({ t: "wait", ms: 1500 });
          break;
        case "battle":
          steps.push({ t: "wait", ms: 900 }, title(subs.title ? subs.title.o.color : "white"), colorStep("telop", subs, "telop"));
          if (subs.lamp) steps.push({ t: "lamp", info: subs.lamp.info });
          if (subs.drop) steps.push({ t: "hand", sound: "normal", info: subs.drop.info });
          if (subs.strong) steps.push({ t: "card", id: "strong", title: "彼岸花役物 作動", text: "強ルートへ", color: "red", info: subs.strong.info });
          steps.push(...sp, colorStep("cutin", subs, "cutin", reach.label.replace(/^.* /, "")), ...deviceSteps(subs, out));
          break;
        case "episode":
          steps.push(title(subs.title ? subs.title.o.color : "white"), colorStep("telop", subs, "telop"));
          steps.push(...sp, colorStep("cutin", subs, "cutin", "金木"), ...deviceSteps(subs, out));
          break;
        case "climax":
          steps.push({ t: "card", id: "kakugo", title: "覚悟の証明", text: "喰種クライマックスリーチへ", color: "red", info: null });
          steps.push(title("red"), colorStep("card", subs, "yubipoki", "指ポキ"), colorStep("telop", subs, "monologue"));
          steps.push(...sp, colorStep("cutin", subs, "cutin", "金木"), ...deviceSteps(subs, out));
          break;
        case "fukoroshi":
          steps.push({ t: "fakeEnd" }, { t: "card", id: "fukoroshiAori", title: "……", text: "まだ終わらない", color: "white", info: null });
          steps.push(title("white"), ...sp, ...deviceSteps(subs, out));
          break;
        case "hankakuja":
          steps.push(title("red"), ...sp, ...deviceSteps(subs, out));
          break;
        case "zenkaiten":
          steps.push({ t: "zenkaiten", info: { group: "リーチ", label: "全回転", rel: 1 } });
          break;
      }
      return steps;
    }

    function normalScenario(hold) {
      const result = hold.result;
      const out = { hit: result.kind === "hit", rush: result.rush };
      const steps = [];

      if (hold.color && hold.reveal === "start") steps.push({ t: "holdChange", color: hold.color, info: hold.colorInfo });
      if (hold.breakTo) steps.push({ t: "chainBreak", color: hold.breakTo, info: hold.colorInfo });

      for (const g of D.NORMAL_YOKOKU) {
        const o = pickP(g, out);
        if (!o) continue;
        const i = info(g, o);
        if (g.id === "logo") steps.push({ t: "logo", color: o.color, info: i });
        else if (g.id === "giji") steps.push({ t: "giji", n: o.n, rize: !!o.rize, kaneki: !!o.kaneki, info: i });
        else if (g.id === "haikei") steps.push({ t: "bg", bg: o.bg, label: o.label, info: i });
        else if (g.id === "hand") steps.push({ t: "hand", sound: o.sound, info: i });
        else if (g.id === "mask") steps.push({ t: "mask", step: o.step, color: o.color, text: o.label, info: i });
        else steps.push({ t: "card", id: g.id, title: g.name, text: o.label, color: o.color, info: i });
      }

      const reach = pick(D.NORMAL_REACH, out, P.spin);

      if (reach) {
        for (const g of D.NORMAL_PRE_REACH) {
          const o = pickP(g, out);
          if (!o) continue;
          const i = info(g, o);
          if (g.id === "nakama") steps.push({ t: "card", id: g.id, title: g.name, text: o.label, color: o.color, info: i });
          else if (g.id === "jason") steps.push({ t: "jason", color: o.color, info: i });
          else steps.push({ t: "zone", device: o.device, info: i });
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

      if (reach && reach.kind === "hankakuja") {
        steps.push({ t: "kyouki", success: true, info: { group: "狂気の時予告", label: "テンパイ成功", rel: 0.81 } });
      } else if (!reach && result.kind === "miss" && rng() < D.KYOUKI_FAIL.missRate) {
        steps.push({ t: "kyouki", success: false, info: { group: D.KYOUKI_FAIL.name, label: "テンパイ失敗", rel: D.KYOUKI_FAIL.rel } });
      }

      if (!reach || reach.kind !== "zenkaiten") steps.push({ t: "reels", digits, reach: !!reach });
      if (reach) steps.push(...reachSteps(reach, out));
      steps.push({ t: "final", digits, hit: out.hit, charge: result.kind === "charge" });
      return { steps, reach, result };
    }

    // ---------------- RUSH中シナリオ ----------------

    function rushReachSteps(reach, out) {
      const subs = subsOf(reach, out);
      const steps = [];
      const title = (color) => ({ t: "reach", id: reach.id, kind: reach.kind, label: reach.label, color, info: { group: "リーチ", label: reach.label, rel: reach.rel } });
      const card = (key, ttl, text, color) =>
        subs[key] ? [{ t: "card", id: key, title: ttl, text, color, info: subs[key].info }] : [];

      const sp = [];
      if (reach.sp) {
        for (const g of D.RUSH_SP_YOKOKU) {
          const o = pickP(g, out);
          if (o) sp.push({ t: "card", id: g.id, title: g.name, text: o.label, color: o.color, info: info(g, o) });
        }
      }

      switch (reach.kind) {
        case "normal":
          steps.push({ t: "wait", ms: 1200 });
          break;
        case "shunkan":
          steps.push(title("red"), ...sp, ...card("ketsui", "金木決意", "", "red"), ...deviceSteps(subs, out));
          break;
        case "ghoulBattle":
          steps.push(title("red"), ...card("music", "楽曲変化", "", "gold"), ...sp, ...card("gabure", "画ブレ", "", "red"));
          steps.push({ t: "card", id: "attack", title: "攻撃", text: subs.attack ? "一撃" : "連打", color: subs.attack ? "red" : "white", info: subs.attack ? subs.attack.info : null });
          steps.push(...deviceSteps(subs, out));
          break;
        case "amon":
          steps.push(title(subs.title ? "gold" : "red"), ...sp);
          steps.push({ t: "card", id: "sensei", title: "最終煽り", text: subs.sensei ? "金木の先制攻撃" : "亜門の先制攻撃", color: subs.sensei ? "gold" : "white", info: subs.sensei ? subs.sensei.info : null });
          steps.push(...deviceSteps(subs, out));
          break;
        case "kyuushutsu":
          steps.push(title("white"), ...sp, ...card("light", "集光エフェクト", "大", "gold"), ...card("countdown", "カウントダウン", "", "gold"), ...deviceSteps(subs, out));
          break;
        case "ooguli":
          steps.push(title("red"), ...sp, ...card("higanbana", "彼岸花", "", "red"));
          steps.push({ t: "card", id: "aura", title: "最終オーラ", text: subs.aura ? subs.aura.o.label : "紫", color: subs.aura ? subs.aura.o.color : "purple", info: subs.aura ? subs.aura.info : null });
          steps.push(...deviceSteps(subs, out));
          break;
        case "ranbu":
          steps.push(title("red"), ...sp, ...card("allHit", "提示図柄", "全て大当り図柄", "gold"), colorStep("cutin", subs, "cutin", "金木"), ...deviceSteps(subs, out));
          break;
        case "hoshoku":
          steps.push(title("red"), ...sp, ...deviceSteps(subs, out));
          break;
        case "zenkaiten":
          steps.push({ t: "zenkaiten", info: { group: "リーチ", label: "全回転", rel: 1 } });
          break;
      }
      return steps;
    }

    function rushScenario(hold, rushMode) {
      const result = hold.result;
      const out = { hit: result.kind === "hit", rush: true };
      const steps = [];
      let digits;
      let reach = null;

      if (rushMode === "default") {
        if (hold.color && hold.reveal === "start") steps.push({ t: "holdChange", color: hold.color, info: hold.colorInfo });
        for (const g of D.RUSH_YOKOKU) {
          const o = pickP(g, out);
          if (!o) continue;
          const i = info(g, o);
          if (g.id === "bundan") steps.push({ t: "bundan", n: o.n, info: i });
          else steps.push({ t: "card", id: g.id, title: g.name, text: o.word || o.label, color: o.color, info: i });
        }
        reach = pick(D.RUSH_REACH, out, P.rushSpin, 1);
      } else if (rushMode === "totsugeki") {
        if (out.hit) steps.push({ t: "hand", sound: "high", notice: "突激", info: { group: "突激モード", label: "役物落下", rel: 1 } });
      } else if (rushMode === "rize") {
        if (out.hit) steps.push({ t: "notice", text: "リゼ襲来", info: { group: "リゼ襲来モード", label: hold.notice ? "入賞時告知" : "変動時告知", rel: 1 } });
      } else if (rushMode === "tsukiyama") {
        const o = pick(D.TSUKIYAMA_BUTTON, out, P.rushSpin, 1);
        if (o) steps.push({ t: "zekkyou", n: o.n, hit: out.hit, info: info(D.TSUKIYAMA_BUTTON, o) });
        else if (out.hit) steps.push({ t: "notice", text: "絶叫", info: { group: "月山絶叫モード", label: "告知", rel: 1 } });
      }

      if (out.hit) {
        const d = reach && reach.kind === "zenkaiten" ? 7 : 1 + rand(9);
        digits = [d, d, d];
      } else {
        digits = missDigits(reach);
      }
      if (!reach || reach.kind !== "zenkaiten") steps.push({ t: "reels", digits, reach: !!reach, fast: rushMode !== "default" });
      if (reach) steps.push(...rushReachSteps(reach, out));
      steps.push({ t: "final", digits, hit: out.hit, charge: false });
      return { steps, reach, result };
    }

    // ---------------- 大当り後 ----------------

    function bonusSteps(result, digits, mode, challenge) {
      const steps = [];
      if (mode === "rush") {
        steps.push({ t: "bonus", title: "HYPER喰種BONUS 3000", rounds: 20, payout: S.payout.rush3000 });
        if (result.big) {
          steps.push({ t: "hand", sound: "low", notice: "喰MAX", info: { group: "BONUS中", label: "喰MAXハンド作動（6000）", rel: 1 } });
          steps.push({ t: "bonus", title: "HYPER喰種BONUS 6000", rounds: 20, payout: S.payout.rush6000 - S.payout.rush3000 });
        }
        steps.push({ t: "rushContinue" });
        return steps;
      }
      if (result.kind === "charge") {
        steps.push({ t: "charge", payout: S.payout.charge2R, promote: result.rush });
        return steps;
      }
      steps.push({ t: "bonus", title: "HYPER喰種BONUS", rounds: 10, payout: S.payout.bonus10R });
      if (digits[0] === 7) {
        steps.push({ t: "rushResult", success: true, text: "7図柄 RUSH確定" });
      } else if (challenge === "amon") {
        const serif = result.rush && rng() < 0.2;
        steps.push({ t: "challenge", kind: "amon", serif, device: result.rush && rng() < 0.15 ? "vcon" : "button" });
        steps.push({ t: "rushResult", success: result.rush });
      } else {
        let at = null;
        if (result.rush) {
          const r = rng();
          at = r < 0.55 ? 2 + rand(32) : r < 0.75 ? 1 : r < 0.92 ? 0 : -1; // -1 は失敗後復活
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
