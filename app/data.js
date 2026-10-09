// e東方幻想弾幕録 のスペックと演出データ。
// 東方Projectの二次創作として作ったオリジナル機。スペックと演出の信頼度は e東京喰種（2025）に合わせている。
//
// rel      : 信頼度（その演出が出たときの大当り率）。1 は大当り濃厚。
// share    : 大当り時にその演出が選ばれる割合（仮定値）。
//            ハズレ時の出現率は rel と share から逆算するので、信頼度はシミュレーション上でも rel と一致する。
// missRate : ハズレ専用の演出の出現率。
// rushOnly : RUSH直行の当たりでのみ出る演出。
// ctx      : 信頼度の母数。spin=全変動 / reach=リーチ時 / sp=SPリーチ時 / self=親リーチ内 / bonus=BONUS中のRUSH突入率。
(function (root) {
  // 台のスペック。ボタンひとつで切り替えられる（演出の信頼度は確率に合わせて自動で保たれる）
  // payout は払い出しではなく実獲得（ラウンド中の打ち出し分を引いた値）。物理盤面ではアタッカー入賞で実際に払い出す。
  const SPECS = {
    middle: {
      label: "ライトミドル", short: "ミドル",
      desc: "e東京喰種と同じ仕様。図柄揃い＋霊力チャージ 合算1/199.9、RUSH 継続率約75%、RUSH中は約3000発。",
      hitProb: 1 / 399.9,        // 図柄揃い（異変解決BONUS）
      chargeProb: 1 / 399.9,     // 霊力チャージ（合算 1/199.9）
      hitRushRate: 0.5,          // 図柄揃い時のRUSH突入（BONUS中のチャレンジ成功）
      chargeRushRate: 0.01,      // チャージからのRUSH昇格
      rushProb: 1 / 95.3,
      stSpins: 130,
      attackerPay: 15,           // 1カウントあたりの賞球
      rounds: { bonus: 10, rush: 20, big: 20 },
      payout: { bonus10R: 1400, charge2R: 280, rush3000: 2800, rush6000: 5600 },
      rush6000Rate: 0.03,
      labels: { rush: "3000", big: "6000" },
    },
    ama99: {
      label: "甘デジ 99ver.", short: "99ver.",
      desc: "この台の甘デジ版。仕組みはそのまま（図柄揃い＋チャージ・RUSH突入チャレンジ）で、合算1/99.9、RUSH 継続率約73%、RUSH中は約1000発。",
      hitProb: 1 / 149.9,
      chargeProb: 1 / 299.9,     // 合算 1/99.9
      hitRushRate: 0.5,
      chargeRushRate: 0.01,
      rushProb: 1 / 49.9,
      stSpins: 64,
      attackerPay: 10,
      rounds: { bonus: 10, rush: 10, big: 10 },
      payout: { bonus10R: 930, charge2R: 185, rush3000: 930, rush6000: 1860 },
      rush6000Rate: 0.03,
      labels: { rush: "1000", big: "2000" },
    },
    ama: {
      label: "普通の甘デジ", short: "甘デジ",
      desc: "昔ながらの甘デジ。1/99.9で、当たればすべてST（1/39.9・40回転、継続率約64%）に突入。ST中の当りは半分が10R（4R＋上乗せ6R）。",
      hitProb: 1 / 99.9,
      chargeProb: 0,
      hitRushRate: 1,            // 初当り後は必ずST
      chargeRushRate: 0,
      rushProb: 1 / 39.9,
      stSpins: 40,
      attackerPay: 10,
      rounds: { bonus: 4, rush: 4, big: 6 },
      payout: { bonus10R: 370, charge2R: 0, rush3000: 370, rush6000: 930 },
      rush6000Rate: 0.5,
      labels: { rush: "4R", big: "10R" },
    },
  };

  const SPEC = {
    name: "e東方幻想弾幕録",
    key: "middle",
    ...SPECS.middle,
    firePerMin: 100,
    holdMax: 4,
    rent: { yen: 1000, balls: 250 },
    complete: 95000,           // コンプリート機能（出玉の上限）
  };

  // キャラクター。絵は使わず、色とエンブレムで表す。
  const CHARS = {
    reimu: { name: "博麗霊夢", short: "霊夢", color: "#e8313f", sub: "#ffffff", emblem: "yinyang", spell: "霊符「夢想封印」" },
    marisa: { name: "霧雨魔理沙", short: "魔理沙", color: "#f4c430", sub: "#20202a", emblem: "star", spell: "恋符「マスタースパーク」" },
    sakuya: { name: "十六夜咲夜", short: "咲夜", color: "#9fb4d8", sub: "#eef3fb", emblem: "clock", spell: "幻世「ザ・ワールド」" },
    remilia: { name: "レミリア・スカーレット", short: "レミリア", color: "#d0193f", sub: "#3b1030", emblem: "bat", spell: "神槍「スピア・ザ・グングニル」" },
    flandre: { name: "フランドール・スカーレット", short: "フラン", color: "#ff5a7a", sub: "#f6d23c", emblem: "crystal", spell: "禁忌「レーヴァテイン」" },
    patchouli: { name: "パチュリー・ノーレッジ", short: "パチュリー", color: "#b07ce0", sub: "#f2e2ff", emblem: "moon", spell: "日符「ロイヤルフレア」" },
    meiling: { name: "紅美鈴", short: "美鈴", color: "#3fae6f", sub: "#ef5050", emblem: "dragon", spell: "彩符「極彩颱風」" },
    cirno: { name: "チルノ", short: "チルノ", color: "#62cdf5", sub: "#ffffff", emblem: "ice", spell: "凍符「パーフェクトフリーズ」" },
    rumia: { name: "ルーミア", short: "ルーミア", color: "#e9cc4c", sub: "#15121f", emblem: "dark", spell: "夜符「ナイトバード」" },
    youmu: { name: "魂魄妖夢", short: "妖夢", color: "#8fd1a2", sub: "#ffffff", emblem: "phantom", spell: "人符「現世斬」" },
    yuyuko: { name: "西行寺幽々子", short: "幽々子", color: "#f39ac0", sub: "#86cdf2", emblem: "butterfly", spell: "「反魂蝶 -八分咲-」" },
    yukari: { name: "八雲紫", short: "紫", color: "#9a5ef0", sub: "#f6ecff", emblem: "gap", spell: "紫奥義「弾幕結界」" },
    sanae: { name: "東風谷早苗", short: "早苗", color: "#4fbf86", sub: "#3f78e0", emblem: "frog", spell: "秘術「グレイソーマタージ」" },
    aya: { name: "射命丸文", short: "文", color: "#c9443b", sub: "#1f1f26", emblem: "feather", spell: "「幻想風靡」" },
  };

  // 図柄 1〜9。7（霊夢）がプレミア図柄。
  const DIGIT_CHARS = [null, "rumia", "meiling", "patchouli", "sakuya", "remilia", "flandre", "reimu", "marisa", "cirno"];

  const STAGES = {
    shrine: { name: "博麗神社", tone: "shrine" },
    koumakan: { name: "紅魔館", tone: "koumakan" },
    meikai: { name: "冥界", tone: "meikai" },
  };

  const opt = (id, label, rel, share, extra) => Object.assign({ id, label, rel, share }, extra);
  const group = (id, name, ctx, options, extra) => Object.assign({ id, name, ctx, options }, extra);

  // ---------------- カスタム ----------------

  const CUSTOMS = {
    senbare: {
      name: "先陰陽玉落下（先バレ）",
      choices: { off: "OFF", s40: "40%", s90: "90%", ex: "EX" },
      desc: "保留入賞時に陰陽玉役物が落下。40%・90%は落下時の信頼度、EXは落下すれば大当り＋RUSH濃厚。落下した保留は陰陽玉の保留になり、その変動（当該変動）まで先バレ演出が続く。ONにすると入賞時の先読みは出ない。落下後にPUSHで裏ボタン。",
    },
    sakiyomi: {
      name: "先読み",
      choices: { none: "なし", osusume: "オススメ", chance: "チャンス", atsu: "熱" },
      desc: "保留入賞時の先読みの出方。チャンス／熱は信頼度の高い先読みだけが出る。",
    },
    leverBuru: {
      name: "レバブル",
      choices: { off: "OFF", on: "ON" },
      desc: "ONにすると八卦炉レバーの振動（レバブル）が出やすくなる。",
    },
    impact: {
      name: "インパクトフラッシュ",
      choices: { off: "OFF", on: "ON" },
      desc: "発生すれば大当り＋RUSH濃厚。ONで発生率アップ。",
    },
  };

  // 先バレ（保留入賞時の陰陽玉落下）。カスタムごとに信頼度と占有率が変わる。
  const senbareGroup = (rel, share, rushOnly) =>
    group("senbare", "先陰陽玉落下", "spin", [
      opt("normal", "落下（通常音）", rel, share, { sound: "normal", rushOnly }),
      opt("low", "落下（低音）", 1, 0.03, { sound: "low", rushOnly }),
      opt("high", "落下（高音）", 1, 0.03, { sound: "high", rushOnly }),
    ]);
  // 実機（e東京喰種の先役モノ落下）に合わせた占有率：40%・90%は大当りの約9割が先バレから、
  // EXは「中程度」＝RUSH直行の大当りのほとんど（全大当りの約45%）。発生率は40%で約1/180、90%で約1/400。
  const SENBARE = {
    s40: senbareGroup(0.4, 0.86, false),
    s90: senbareGroup(0.9, 0.84, false),
    ex: senbareGroup(1, 0.39, true),
  };
  const URA_BUTTON_RATE = 0.5; // 先バレしたRUSH直行の当たりのうち、裏ボタンが成功する割合

  const LEVER_BURU = {
    off: group("leverBuru", "レバブル", "spin", [
      opt("white", "白", 0.75, 0.08, { color: "white" }),
      opt("red", "赤", 0.95, 0.04, { color: "red" }),
      opt("rainbow", "虹", 1, 0.02, { color: "rainbow" }),
    ]),
    on: group("leverBuru", "レバブル", "spin", [
      opt("white", "白", 0.9, 0.2, { color: "white" }),
      opt("red", "赤", 0.95, 0.06, { color: "red" }),
      opt("rainbow", "虹", 1, 0.03, { color: "rainbow" }),
    ]),
  };

  const IMPACT = {
    off: group("impact", "インパクトフラッシュ", "spin", [opt("on", "発生", 1, 0.03, { rushOnly: true })]),
    on: group("impact", "インパクトフラッシュ", "spin", [opt("on", "発生", 1, 0.1, { rushOnly: true })]),
  };

  // 先読みカスタムごとに、入賞時に見せてよい信頼度の下限
  const SAKIYOMI_MIN_REL = {
    normal: { none: Infinity, osusume: 0, chance: 0.2, atsu: 0.9 },
    rush: { none: Infinity, osusume: 0, chance: 0.5, atsu: 1 },
  };

  // ---------------- 通常時 ----------------

  const NORMAL_HOLD = group("hold", "保留変化予告", "spin", [
    opt("blink", "点滅", 0.008, 0.01, { color: "blink" }),
    opt("blue", "青", 0.05, 0.22, { color: "blue" }),
    opt("green", "緑", 0.08, 0.14, { color: "green" }),
    opt("purple", "紫", 0.33, 0.14, { color: "purple" }),
    opt("red", "赤", 0.8, 0.2, { color: "red" }),
    opt("gold", "金", 0.9, 0.08, { color: "gold" }),
    opt("rainbow", "虹", 1, 0.02, { color: "rainbow", rushOnly: true }),
    opt("seal", "封印保留（封印解けず）", 0.12, 0.04, { color: "seal" }),
    opt("sealBreak", "封印保留（封印解放）", 1, 0.03, { color: "seal", breakTo: "gold" }),
  ]);

  // 先読み（保留入賞時）。複数同時に出ることもある。
  const NORMAL_PREREAD = [
    group("sukimaSaki", "スキマ先読み", "spin", [
      opt("weak", "弱（リボン）", 0.16, 0.08),
      opt("strong", "強（スキマ全開）", 0.8, 0.08),
    ]),
    group("kedama", "毛玉先読み", "spin", [
      opt("few", "毛玉が横切る", 0.01, 0.05),
      opt("many", "毛玉の大群", 0.3, 0.04),
    ]),
    // 冥界の人魂（妖々夢）。妖夢の半霊がまざると熱い
    group("hitodama", "人魂先読み", "spin", [
      opt("few", "人魂がただよう", 0.02, 0.04),
      opt("many", "人魂の群れ", 0.4, 0.025),
      opt("hanrei", "半霊がまざる", 0.75, 0.01),
    ]),
  ];

  // 変動中の予告（発生順）
  const NORMAL_YOKOKU = [
    group("logo", "変動開始ロゴフラッシュ", "spin", [
      opt("white", "白", 0.08, 0.2, { color: "white" }),
      opt("red", "赤", 0.68, 0.12, { color: "red" }),
    ]),
    group("sakura", "西行妖 開花予告", "spin", [
      opt("su3", "SU3で開花", 0.2, 0.05),
      opt("su3drop", "SU3＋陰陽玉弱落下", 0.35, 0.07, { drop: true }),
      opt("startDrop", "変動開始＋陰陽玉弱落下", 0.66, 0.07, { drop: true }),
    ]),
    group("giji", "「異変は終わらない」連続予告", "spin", [
      opt("x2", "2回", 0.02, 0.06, { n: 2 }),
      opt("x3", "3回", 0.33, 0.15, { n: 3 }),
      opt("x3yukari", "3回＋紫出現", 0.5, 0.06, { n: 3, yukari: true }),
      opt("reimu", "即連続で霊夢出現", 1, 0.01, { n: 3, reimu: true }),
    ]),
    group("kaiwa", "会話予告", "spin", [
      opt("white", "白セリフ", 0.005, 0.03, { color: "white" }),
      opt("red", "赤セリフ", 0.2, 0.06, { color: "red" }),
      opt("gold", "金セリフ", 0.55, 0.06, { color: "gold" }),
    ]),
    group("su", "スペルカードSU予告", "spin", [
      opt("meiling", "美鈴", 0.02, 0.015, { color: "white", step: 2, char: "meiling" }),
      opt("patchouli", "パチュリー", 0.02, 0.015, { color: "white", step: 2, char: "patchouli" }),
      opt("sakuya", "咲夜", 0.02, 0.015, { color: "white", step: 2, char: "sakuya" }),
      opt("meilingR", "美鈴（赤）", 0.21, 0.03, { color: "red", step: 3, char: "meiling" }),
      opt("patchouliR", "パチュリー（赤）", 0.21, 0.03, { color: "red", step: 3, char: "patchouli" }),
      opt("sakuyaR", "咲夜（赤）", 0.21, 0.03, { color: "red", step: 3, char: "sakuya" }),
      opt("reimuR", "霊夢（赤）", 0.28, 0.05, { color: "red", step: 4, char: "reimu" }),
      opt("reimuG", "霊夢（金）", 0.6, 0.06, { color: "gold", step: 4, char: "reimu" }),
    ]),
    group("tokitome", "咲夜の時止め予告", "spin", [
      opt("purple", "エフェクト紫", 0.1, 0.02, { color: "purple" }),
      opt("red", "エフェクト赤", 0.45, 0.03, { color: "red" }),
      opt("gold", "エフェクト金", 0.85, 0.03, { color: "gold" }),
    ]),
    group("mono", "モノクロの異変", "spin", [
      opt("normal", "通常", 0.05, 0.03, { color: "white" }),
      opt("strong", "強", 0.28, 0.03, { color: "red" }),
    ]),
    group("haikei", "背景移行", "spin", [
      opt("koumakan", "紅魔館", 0.29, 0.1, { bg: "koumakan" }),
      opt("meikai", "冥界", 0.78, 0.1, { bg: "meikai" }),
    ]),
    group("kougiri", "紅霧異変予告", "spin", [
      opt("normal", "通常", 0.33, 0.1, { color: "white" }),
      opt("strong", "強", 0.81, 0.08, { color: "red" }),
    ]),
    group("engi", "幻想郷縁起予告", "spin", [
      opt("normal", "通常", 0.25, 0.06, { color: "white" }),
      opt("red", "赤", 0.8, 0.05, { color: "red" }),
    ]),
    // 以下、原作の設定から作った予告（中身の文章はすべてオリジナル）
    // 射命丸文の「文々。新聞」。見出しが号外なら熱い
    group("bunbun", "「文々。新聞」号外予告", "spin", [
      opt("white", "白見出し", 0.03, 0.05, { color: "white", headline: "博麗神社の賽銭箱、本日も空" }),
      opt("red", "赤見出し", 0.32, 0.06, { color: "red", headline: "幻想郷上空に謎の紅い霧" }),
      opt("gold", "号外", 0.82, 0.03, { color: "gold", headline: "号外！博麗の巫女、異変解決へ" }),
    ]),
    // 博麗神社の賽銭箱。いつも空なのが原作のお約束
    group("saisen", "賽銭箱予告", "spin", [
      opt("coin", "一円玉", 0.02, 0.04, { color: "white", item: "coin" }),
      opt("satsu", "お札", 0.3, 0.05, { color: "red", item: "satsu" }),
      opt("senryo", "千両箱", 0.88, 0.02, { color: "gold", item: "senryo" }),
    ]),
    // 原作シューティングの画面表示（グレイズ・エクステンド・スペルカードボーナス）
    group("hud", "弾幕HUD予告", "spin", [
      opt("graze", "GRAZE", 0.04, 0.05, { color: "white", word: "GRAZE" }),
      opt("extend", "Extend!!", 0.42, 0.05, { color: "red", word: "Extend!!" }),
      opt("bonus", "Spell Card Bonus!!", 0.9, 0.03, { color: "gold", word: "Spell Card Bonus!!" }),
    ]),
    // 博麗神社の宴会（萃夢想）。集まる人数が多いほど熱い
    group("enkaiYokoku", "宴会予告", "spin", [
      opt("n3", "3人", 0.03, 0.04, { color: "white", n: 3 }),
      opt("n6", "6人", 0.3, 0.05, { color: "red", n: 6 }),
      opt("all", "全員集合", 0.8, 0.03, { color: "gold", n: 9 }),
    ]),
    // 春を告げる妖精リリーホワイト（妖々夢）。春の濃さで期待度が変わる
    group("lily", "「春ですよー」予告", "spin", [
      opt("white", "春ですよー", 0.05, 0.04, { color: "white", text: "春ですよー" }),
      opt("pink", "春ですよーーっ！！", 0.5, 0.04, { color: "red", text: "春ですよーーっ！！" }),
    ]),
    // 紅魔館の門番・美鈴。居眠り→咲夜のナイフで起こされるのが定番
    group("monban", "門番予告", "spin", [
      opt("sleep", "居眠り", 0.01, 0.02, { color: "white", wake: "none" }),
      opt("wake", "飛び起きる", 0.25, 0.03, { color: "red", wake: "self" }),
      opt("knife", "咲夜のナイフで起床", 0.7, 0.02, { color: "gold", wake: "knife" }),
    ]),
    group("hand", "陰陽玉落下（変動中）", "spin", [
      opt("normal", "通常音", 0.72, 0.4, { sound: "normal" }),
      opt("low", "低音", 1, 0.04, { sound: "low" }),
      opt("high", "高音", 1, 0.04, { sound: "high" }),
    ]),
  ];

  // リーチ前（リーチ成立が前提）
  const NORMAL_PRE_REACH = [
    group("seien", "仲間の声援予告", "reach", [
      opt("general", "一般セリフ", 0.26, 0.06, { color: "white" }),
      opt("marisa", "魔理沙のセリフ", 0.9, 0.05, { color: "gold" }),
    ]),
    group("cirno", "チルノルーレット", "reach", [
      opt("normal", "通常", 0.27, 0.06, { color: "white" }),
      opt("red", "赤", 0.7, 0.05, { color: "red" }),
    ]),
    group("zone", "弾幕ZONE", "reach", [
      opt("button", "煽りボタン", 0.14, 0.01, { device: "button" }),
      opt("lever", "煽り八卦炉レバー", 0.8, 0.05, { device: "lever" }),
    ]),
  ];

  // SPリーチ中
  const NORMAL_SP_YOKOKU = [
    group("spDrop", "SP発展時 陰陽玉落下", "sp", [
      opt("normal", "通常タイミング", 0.76, 0.3),
      opt("early", "少し早い", 0.64, 0.16),
      opt("veryEarly", "かなり早い", 1, 0.04),
    ]),
    group("ihen", "「これは異変よ」予告", "sp", [opt("on", "発生", 0.75, 0.1, { color: "red" })]),
    group("sukimaSasoi", "スキマからの誘い", "sp", [opt("on", "発生", 0.6, 0.08, { color: "purple" })]),
    group("kesshin", "霊夢の決意", "sp", [
      opt("kaiketsu", "「異変は私が解決する」", 0.73, 0.1, { color: "red" }),
      opt("hakurei", "「博麗の巫女を舐めないで」", 1, 0.02, { color: "gold" }),
    ]),
    // 原作のボス戦の最後の大技（ラストスペル）／永夜抄のラストワード
    group("lastSpell", "ラストスペル予告", "sp", [
      opt("last", "LAST SPELL", 0.78, 0.1, { color: "red" }),
      opt("word", "LAST WORD", 1, 0.02, { color: "gold" }),
    ]),
  ];

  // 「495年の狂気」予告のテンパイ失敗（成功は禁忌SPへの発展としてリーチ側で扱う）
  const KYOUKI_FAIL = group("kyoukiFail", "「495年の狂気」予告", "spin", [opt("fail", "テンパイ失敗", 0.02, 0.005)]);

  // リーチ内のチャンスアップ
  const color3 = (id, name, red) =>
    group(id, name, "self", [opt("red", "赤", red, 0.3, { color: "red" }), opt("gold", "金", 1, 0.03, { color: "gold" })]);
  const deviceGroup = () => group("device", "当落デバイス", "self", [opt("lever", "八卦炉レバー", 1, 0.08, { device: "lever" })]);
  const yakuTiming = group("yakuTiming", "陰陽玉落下タイミング", "self", [
    opt("deviceAppear", "デバイス出現直後", 1, 0.02),
    opt("deviceOperate", "デバイス操作時", 1, 0.02),
    opt("kyusai", "即救済", 1, 0.01),
  ]);

  const battleSubs = (titleR, telopR, lampR, dropR, cutinR, strongR) => [
    color3("title", "タイトル色", titleR),
    color3("telop", "テロップ色", telopR),
    group("lamp", "陰陽玉ランプ点灯", "self", [opt("on", "点灯", lampR, 0.35)]),
    group("drop", "陰陽玉落下", "self", [opt("on", "落下", dropR, 0.45)]),
    group("strong", "強ルート分岐（桜役物）", "self", [opt("on", "分岐", strongR, 0.5)]),
    color3("cutin", "カットイン色", cutinR),
    deviceGroup(),
    yakuTiming,
  ];
  const episodeSubs = (titleR, telopR, cutinR) => [
    color3("title", "タイトル色", titleR),
    color3("telop", "テロップ色", telopR),
    color3("cutin", "カットイン色", cutinR),
    deviceGroup(),
    yakuTiming,
  ];
  const climaxSubs = (bgR, monoR, cutinR) => [
    color3("declare", "スペル宣言背景", bgR),
    color3("monologue", "モノローグ色", monoR),
    color3("cutin", "カットイン色", cutinR),
    deviceGroup(),
    yakuTiming,
  ];
  const charaSubs = [
    group("telop", "テロップ色", "self", [opt("red", "赤", 0.28, 0.3, { color: "red" })]),
    group("drop", "陰陽玉落下", "self", [opt("on", "落下", 0.71, 0.45)]),
  ];
  const longSubs = (goldR) => [
    group("telop", "テロップ色", "self", [opt("gold", "金", goldR, 0.2, { color: "gold" })]),
    group("yukari", "紫登場", "self", [opt("on", "登場", 0.52, 0.35)]),
  ];

  const NORMAL_REACH = group("reach", "リーチ", "spin", [
    opt("normal", "ノーマルリーチ", 0.002, 0.02, { kind: "normal" }),
    opt("sanae", "キャラリーチ 早苗", 0.02, 0.006, { kind: "chara", char: "sanae", subs: charaSubs }),
    opt("aya", "キャラリーチ 文", 0.02, 0.006, { kind: "chara", char: "aya", subs: charaSubs }),
    opt("marisa", "キャラリーチ 魔理沙", 0.03, 0.009, { kind: "chara", char: "marisa", subs: charaSubs }),
    opt("engawa", "ロングリーチ 神社の縁側", 0.04, 0.01, { kind: "long", char: "reimu", subs: longSubs(0.9) }),
    opt("akaikiri", "ロングリーチ 紅い霧", 0.14, 0.03, { kind: "long", char: "remilia", subs: longSubs(0.93) }),
    opt("vsRumia", "バトルSPリーチ vsルーミア", 0.22, 0.07, { kind: "battle", char: "rumia", sp: true, subs: battleSubs(0.37, 0.37, 0.5, 0.7, 0.56, 0.7) }),
    opt("vsCirno", "バトルSPリーチ vsチルノ", 0.25, 0.08, { kind: "battle", char: "cirno", sp: true, subs: battleSubs(0.41, 0.45, 0.54, 0.82, 0.62, 0.7) }),
    opt("vsMeiling", "バトルSPリーチ vs美鈴", 0.32, 0.09, { kind: "battle", char: "meiling", sp: true, subs: battleSubs(0.46, 0.48, 0.75, 0.95, 0.65, 0.71) }),
    opt("enkai", "エピソードリーチ 宴会", 0.51, 0.16, { kind: "episode", char: "marisa", sp: true, subs: episodeSubs(0.65, 0.65, 0.78) }),
    opt("kouma", "エピソードリーチ 紅霧異変", 0.9, 0.1, { kind: "episode", char: "remilia", sp: true, subs: episodeSubs(0.92, 0.93, 0.95) }),
    opt("shunsetsu", "エピソードリーチ 春雪異変", 0.75, 0.09, { kind: "episode", char: "yuyuko", sp: true, subs: [
      // 妖々夢の「春度」。集めた春でゲージが埋まり、満開なら大当り濃厚
      group("haru", "春度ゲージ", "self", [opt("hachi", "八分咲き", 0.85, 0.4, { color: "red" }), opt("mankai", "満開", 1, 0.12, { color: "gold" })]),
      ...episodeSubs(0.8, 0.82, 0.88),
    ] }),
    opt("cxSakuya", "弾幕クライマックスリーチ vs咲夜", 0.73, 0.12, { kind: "climax", char: "sakuya", sp: true, subs: climaxSubs(0.86, 0.89, 0.88) }),
    opt("cxRemilia", "弾幕クライマックスリーチ vsレミリア", 0.93, 0.08, { kind: "climax", char: "remilia", sp: true, subs: climaxSubs(0.95, 0.95, 0.95) }),
    opt("yukariSp", "八雲紫SP", 0.52, 0.05, { kind: "revive", char: "yukari", sp: true, subs: [deviceGroup(), yakuTiming] }),
    opt("kinki", "禁忌SP フランドール", 0.81, 0.06, { kind: "kinki", char: "flandre", sp: true, subs: [deviceGroup(), yakuTiming] }),
    opt("zenkaiten", "全回転", 1, 0.006, { kind: "zenkaiten", sp: true, rushOnly: true }),
  ], { exhaustive: true });

  // ---------------- 弾幕RUSH中 ----------------

  const RUSH_HOLD = group("hold", "保留変化予告（RUSH）", "rushSpin", [
    opt("blink", "点滅", 0.07, 0.05, { color: "blink" }),
    opt("blue", "青", 0.33, 0.15, { color: "blue" }),
    opt("green", "緑", 0.55, 0.15, { color: "green" }),
    opt("red", "赤", 0.95, 0.15, { color: "red" }),
    opt("rainbow", "虹", 1, 0.03, { color: "rainbow" }),
  ]);

  const RUSH_PREREAD = [
    group("batSaki", "蝙蝠先読み", "rushSpin", [
      opt("normal", "通常", 0.04, 0.03),
      opt("red", "紅い蝙蝠", 0.86, 0.04),
    ]),
  ];

  const RUSH_YOKOKU = [
    group("leverBuruRush", "レバブル（RUSH）", "rushSpin", [opt("on", "発生", 1, 0.03, { color: "red" })]),
    group("watashi", "「私が！」予告", "rushSpin", [
      opt("white", "白", 0.06, 0.05, { color: "white" }),
      opt("red", "赤", 0.69, 0.04, { color: "red" }),
      opt("gold", "金", 1, 0.01, { color: "gold" }),
    ]),
    group("dive", "魔理沙の箒ダイブ予告", "rushSpin", [
      opt("white", "白", 0.06, 0.05, { color: "white" }),
      opt("red", "赤", 0.78, 0.04, { color: "red" }),
    ]),
    group("spellMoji", "スペル文字予告", "rushSpin", [
      opt("reifu", "「霊符」", 0.52, 0.08, { color: "white", word: "霊符" }),
      opt("shinrei", "「神霊」", 0.85, 0.08, { color: "red", word: "神霊" }),
      opt("musou", "「夢想天生」", 1, 0.02, { color: "gold", word: "夢想天生" }),
    ]),
    group("bundan", "弾幕分断予告", "rushSpin", [
      opt("two", "レーザー2本", 0.23, 0.06, { n: 2 }),
      opt("four", "レーザー4本", 0.75, 0.06, { n: 4 }),
    ]),
    group("miko", "「楽園の素敵な巫女」予告", "rushSpin", [
      opt("white", "白", 0.63, 0.06, { color: "white" }),
      opt("red", "赤", 1, 0.01, { color: "red" }),
    ]),
    group("saikyou", "「最強の妖精」予告", "rushSpin", [
      opt("white", "白", 0.04, 0.02, { color: "white" }),
      opt("gold", "金", 1, 0.01, { color: "gold" }),
    ]),
    group("tansaku", "探索テンパイ予告", "rushSpin", [
      opt("white", "白", 0.32, 0.15, { color: "white" }),
      opt("red", "赤", 0.89, 0.08, { color: "red" }),
    ]),
    group("getSpell", "スペルカード取得予告", "rushSpin", [
      opt("get", "Get Spell Card", 0.45, 0.05, { color: "white", word: "Get Spell Card" }),
      opt("bonus", "Get Spell Card Bonus!!", 1, 0.015, { color: "gold", word: "Get Spell Card Bonus!!" }),
    ]),
    group("world", "「ザ・ワールド」予告", "rushSpin", [
      opt("red", "時が止まる", 0.72, 0.03, { color: "red" }),
    ]),
  ];

  // 復活演出（SPリーチがいったんハズレで止まったあと）。復活すれば大当り濃厚。
  const NORMAL_REVIVE = group("revive", "復活演出", "sp", [
    opt("aori", "復活煽り", 1, 0.06),
    opt("drop", "陰陽玉落下で即復活", 1, 0.04),
    opt("sukima", "スキマから復活", 1, 0.03),
  ]);
  const RUSH_REVIVE = group("reviveRush", "復活演出（RUSH）", "rushSp", [
    opt("aori", "復活煽り", 1, 0.08),
    opt("drop", "陰陽玉落下で即復活", 1, 0.05),
  ]);

  const RUSH_SP_YOKOKU = [
    group("akame", "紅い瞳煽り", "rushSp", [
      opt("on", "紅い瞳発動", 0.86, 0.5, { color: "red" }),
      opt("sakura", "桜役物 開花", 1, 0.08, { color: "gold" }),
    ]),
  ];

  const shunkanSubs = (ketsuiR) => [group("kesshin", "霊夢決意", "self", [opt("on", "あり", ketsuiR, 0.35)]), deviceGroup(), yakuTiming];
  const danmakuBattleSubs = (gabureR, ichigekiR) => [
    group("music", "楽曲変化", "self", [opt("on", "あり", 1, 0.05)]),
    group("gabure", "画ブレ", "self", [opt("on", "あり", gabureR, 0.3)]),
    group("attack", "攻撃パターン", "self", [opt("ichigeki", "スペルカード一撃", ichigekiR, 0.45)]),
    deviceGroup(),
    yakuTiming,
  ];

  const RUSH_REACH = group("reach", "リーチ", "rushSpin", [
    opt("normal", "ノーマルリーチ", 0.02, 0.1, { kind: "normal" }),
    opt("skRumia", "瞬間決着 vsルーミア", 0.35, 0.08, { kind: "shunkan", char: "rumia", sp: true, subs: shunkanSubs(0.85) }),
    opt("skCirno", "瞬間決着 vsチルノ", 0.39, 0.08, { kind: "shunkan", char: "cirno", sp: true, subs: shunkanSubs(0.87) }),
    opt("skYoumu", "瞬間決着 vs妖夢", 0.56, 0.08, { kind: "shunkan", char: "youmu", sp: true, subs: shunkanSubs(0.89) }),
    opt("skYuyuko", "瞬間決着 vs幽々子", 0.85, 0.07, { kind: "shunkan", char: "yuyuko", sp: true, subs: shunkanSubs(0.92) }),
    opt("btSakuya", "弾幕バトル vs咲夜", 0.45, 0.1, { kind: "danmaku", char: "sakuya", sp: true, subs: danmakuBattleSubs(0.85, 0.75) }),
    opt("btRemilia", "弾幕バトル vsレミリア", 0.64, 0.1, { kind: "danmaku", char: "remilia", sp: true, subs: danmakuBattleSubs(0.92, 0.85) }),
    opt("flanKessen", "フランドール決戦", 0.86, 0.1, {
      kind: "kessen", char: "flandre", sp: true,
      subs: [
        group("title", "タイトル色", "self", [opt("gold", "金", 1, 0.08, { color: "gold" })]),
        group("sensei", "最終煽り先制攻撃", "self", [opt("reimu", "霊夢", 1, 0.15)]),
        deviceGroup(), yakuTiming,
      ],
    }),
    opt("kyuushutsu", "魔理沙救出リーチ", 0.42, 0.06, {
      kind: "kyuushutsu", char: "marisa", sp: true,
      subs: [
        group("light", "集光エフェクト", "self", [opt("big", "大きい", 1, 0.08)]),
        group("countdown", "カウントダウン", "self", [opt("on", "あり", 1, 0.08)]),
        deviceGroup(), yakuTiming,
      ],
    }),
    opt("kimagure", "吸血鬼の気まぐれ", 0.71, 0.08, {
      kind: "kimagure", char: "remilia", sp: true,
      subs: [
        group("sakura", "桜役物", "self", [opt("on", "あり", 0.86, 0.4)]),
        group("aura", "最終オーラ", "self", [
          opt("red", "赤", 0.8, 0.45, { color: "red" }),
          opt("rainbow", "虹", 1, 0.1, { color: "rainbow" }),
        ]),
        deviceGroup(), yakuTiming,
      ],
    }),
    opt("ranbu", "弾幕乱舞リーチ", 0.55, 0.06, {
      kind: "ranbu", char: "reimu", sp: true,
      subs: [
        group("allHit", "全て大当り図柄", "self", [opt("on", "全て大当り図柄", 1, 0.1)]),
        color3("cutin", "カットイン色", 0.9),
        deviceGroup(), yakuTiming,
      ],
    }),
    opt("sukimaOkuri", "スキマ送りリーチ", 0.86, 0.1, { kind: "sukima", char: "yukari", sp: true, subs: [deviceGroup(), yakuTiming] }),
    opt("zenkaiten", "全回転", 1, 0.01, { kind: "zenkaiten", sp: true }),
  ], { exhaustive: true });

  // 弾幕RUSH中の演出モード
  const RUSH_MODES = {
    default: { name: "デフォルト", desc: "いろいろな演出が楽しめる基本モード" },
    totsugeki: { name: "陰陽玉突撃", desc: "陰陽玉が落下すれば大当り" },
    shurai: { name: "フラン襲来", desc: "保留入賞時か変動開始時に告知が出れば大当り" },
    renda: { name: "マスパ連打", desc: "PUSHを連打して告知が出れば大当り" },
  };

  const RENDA = group("renda", "マスパ連打（ボタン回数）", "rushSpin", [
    opt("b1", "1回", 1, 0.12, { n: 1 }),
    opt("b5", "5回", 0.2, 0.15, { n: 5 }),
    opt("b10", "10回", 0.1, 0.1, { n: 10 }),
    opt("b20", "20回", 0.13, 0.15, { n: 20 }),
    opt("b30", "30回", 0.24, 0.25, { n: 30 }),
    opt("b77", "77回", 1, 0.05, { n: 77 }),
  ]);

  // 異変解決BONUS中のRUSH突入チャレンジ
  const CHALLENGES = {
    koumakan: { name: "紅魔館突破チャレンジ", desc: "最後にPUSH。霊夢のセリフが出ればRUSH濃厚" },
    ippatsu: { name: "一発告知チャレンジ", desc: "カウントダウン中に告知が出ればRUSH" },
  };

  // BONUS中の裏ボタン（PUSHでロゴ色が変わる）。rel はRUSH突入率。
  const BONUS_URA = group("bonusUra", "BONUS中 裏ボタン（ロゴ色）", "bonus", [
    opt("blue", "青", 0.95, 0.15, { color: "blue" }),
    opt("green", "緑", 0.2, 0.1, { color: "green" }),
    opt("purple", "紫", 0.4, 0.25, { color: "purple" }),
    opt("red", "赤", 0.7, 0.4, { color: "red" }),
  ]);

  // ---------------- セリフ（すべてオリジナル） ----------------
  // [話すキャラ, セリフ]。会話予告は2人のかけあい。

  const SERIFU = {
    kaiwa: {
      white: [
        [["marisa", "よう霊夢、今日も暇そうだな"], ["reimu", "暇じゃないわよ。お茶を飲んでるの"]],
        [["reimu", "賽銭箱、今日も空っぽね……"], ["marisa", "いつものことだぜ"]],
        [["cirno", "霊夢！あたいと勝負しろ！"], ["reimu", "はいはい、また今度ね"]],
        [["sanae", "霊夢さん、お参りに来ましたよ"], ["reimu", "あら珍しい。お賽銭も置いていきなさい"]],
        [["aya", "今日の幻想郷は平和ですねぇ"], ["reimu", "記事にならなくて残念だったわね"]],
        [["rumia", "そーなのかー"], ["reimu", "……何が？"]],
        [["patchouli", "図書館の本、また減ってるわ"], ["marisa", "借りてるだけだぜ。死ぬまでな"]],
      ],
      red: [
        [["marisa", "おい霊夢、空が紅いぜ"], ["reimu", "……異変ね。行くわよ"]],
        [["sakuya", "お嬢様がお待ちですわ"], ["reimu", "上等じゃない。案内しなさい"]],
        [["yukari", "今夜の幻想郷は、少し騒がしいわね"], ["reimu", "あんたが言うと嫌な予感しかしないわ"]],
        [["flandre", "ねえ、お姉様より強いの？"], ["reimu", "試してみる？"]],
        [["youmu", "幽々子様のために、春を集めているんです"], ["reimu", "どうりで寒いわけね"]],
        [["meiling", "……はっ！寝てません、寝てませんよ！"], ["sakuya", "あとでお話がありますわ"]],
      ],
      gold: [
        [["marisa", "霊夢、ここは任せたぜ！"], ["reimu", "ええ。この異変、ここで終わらせる！"]],
        [["remilia", "運命は、もう決まっているのよ"], ["reimu", "だったら、その運命ごと撃ち抜くわ"]],
        [["yuyuko", "西行妖が咲いたら、きっと素敵よ"], ["reimu", "咲かせないわ。絶対に"]],
        [["yukari", "準備はいいかしら、博麗の巫女"], ["reimu", "いつでもいいわよ。全部まとめて片付ける"]],
      ],
    },
    // リーチ発展時の相手（味方）のひとこと
    intro: {
      rumia: ["おなかすいたー。そこの人間、おいしそう", "まっくらなところで遊ぼうよー"],
      cirno: ["あたいの氷で、カチコチにしてやる！", "今日こそあたいが勝つんだから！"],
      meiling: ["ここから先は、一歩も通しませんよ", "門番の意地、見せてあげます！"],
      sakuya: ["お嬢様の邪魔はさせませんわ", "あなたの時間は、もう私のものですわ"],
      remilia: ["こんなに紅い夜だもの。楽しませてもらうわ", "跪きなさい。今ならまだ許してあげる"],
      flandre: ["ねえ、いっしょに遊ぼ？すぐ壊れないでね", "きゃはは！まだ遊べるよね？"],
      yukari: ["ふふ、少しだけ手を貸してあげるわ", "境界の向こうから、こんにちは"],
      youmu: ["この剣で、ここは通しません", "半人前でも、負けるつもりはありません"],
      yuyuko: ["あらあら、元気な巫女さんねぇ", "お腹いっぱい、遊んであげるわ"],
      marisa: ["ここは私に任せな、派手にいくぜ！", "霊夢、後ろは見なくていいぜ"],
      sanae: ["奇跡を起こしてみせます！", "霊夢さん、今日は負けませんよ！"],
      aya: ["これはスクープの予感ですね！", "いい顔、一枚いただきます！"],
      reimu: ["さっさと終わらせて帰るわよ", "今日の私は、ちょっと本気よ"],
    },
    // 霊夢の返し（テロップ）。色で信頼度が変わる
    telop: {
      white: ["面倒だけど、行くしかないわね", "まだ本気じゃないわよ", "避けて、撃つ。それだけよ"],
      red: ["ここで決めるわ！", "もう逃がさないわよ", "この弾幕、見切った！"],
      gold: ["異変は、ここで終わりよ！", "博麗の巫女を舐めないで！", "全部まとめて、封印する！"],
    },
    // 弾幕クライマックスのモノローグ
    monologue: {
      white: ["……強い。でも、負けられない", "深呼吸。いつもどおりに"],
      red: ["ここを越えれば、異変は終わる", "見える……弾の隙間が"],
      gold: ["負ける気がしないわ", "今なら、何だって避けられる"],
    },
    seien: {
      general: [["sanae", "霊夢さん、ファイトです！"], ["aya", "いい写真、撮らせてくださいね！"], ["cirno", "あたいの次に強いんだから、勝てよ！"], ["meiling", "がんばってくださーい！"]],
      marisa: [["marisa", "霊夢なら大丈夫だぜ！"], ["marisa", "ぶちかませ、霊夢！"]],
    },
    revive: {
      aori: [["reimu", "……まだよ。まだ終わってない"]],
      drop: [["reimu", "甘いわね！"]],
      sukima: [["yukari", "まだ終わらせないわ"]],
    },
    bonus: [["reimu", "異変解決、ね。さっさと片付けるわ"], ["marisa", "やったな霊夢！"]],
    rushIn: [["reimu", "ここからが本番よ！"], ["marisa", "弾幕ラッシュの始まりだぜ！"]],
    rushFail: [["reimu", "……今日はここまでね"], ["marisa", "惜しかったな。次いこうぜ"]],
    rushContinue: [["reimu", "まだまだいけるわ！"], ["marisa", "止まらないぜ！"], ["sakuya", "お見事ですわ"], ["remilia", "面白いわね、もっと見せなさい"]],
    rushEnd: [["reimu", "ふう、いい弾幕だったわ"], ["marisa", "楽しかったぜ、またやろうな"]],
    charge: [["reimu", "霊力補給、っと"]],
    promote: [["yukari", "ふふ、おまけよ"]],
    koumakan: [["remilia", "この館を抜けられるかしら？"]],
    // 賽銭箱予告の霊夢の反応
    saisen: {
      coin: [["reimu", "……一円。気持ちだけ受け取っておくわ"], ["reimu", "チャリン、ね。ないよりはマシよ"]],
      satsu: [["reimu", "お札！？今日はいい日になりそうね"], ["reimu", "ちょっと待って、誰がこんなに？"]],
      senryo: [["reimu", "せ、千両箱……！？これは異変より大事件よ"], ["reimu", "これで神社の屋根が直せるわ！"]],
    },
    // 宴会予告
    enkai: {
      white: [["marisa", "今夜も宴会だぜ！"], ["reimu", "……で、片付けは誰がするの？"]],
      red: [["yuyuko", "あら、おいしそうな匂いがするわね"], ["sakuya", "お嬢様のお席をご用意しますわ"]],
      gold: [["yukari", "ふふ、みんな萃まったわね"], ["remilia", "今夜は特別に、最後まで付き合ってあげる"]],
    },
    // エピソードリーチのストーリーパート（原作の異変の流れをなぞる。文章はオリジナル）
    story: {
      enkai: {
        bg: "shrine",
        chapters: [["reimu", "三日おきに、なぜか宴会が開かれる"], ["marisa", "宴会のたびに、妙な霧が萃まってくるぜ"], ["yukari", "宴の主は……霧の中にいるわ"]],
      },
      kouma: {
        bg: "koumakan",
        chapters: [["reimu", "幻想郷が、紅い霧に覆われた"], ["meiling", "湖の向こうの館へようこそ。通しませんけど"], ["remilia", "紅い月の下で、館の主が待っている"]],
      },
      shunsetsu: {
        bg: "meikai",
        chapters: [["reimu", "五月なのに、雪が止まない"], ["youmu", "集めた春は、冥界へ運ばせてもらいます"], ["yuyuko", "西行妖を、満開にしてみたいのよ"]],
      },
    },
  };

  const data = {
    SPEC, CHARS, DIGIT_CHARS, STAGES, CUSTOMS,
    SENBARE, URA_BUTTON_RATE, LEVER_BURU, IMPACT, SAKIYOMI_MIN_REL,
    NORMAL_HOLD, NORMAL_PREREAD, NORMAL_YOKOKU, NORMAL_PRE_REACH, NORMAL_SP_YOKOKU, NORMAL_REACH, KYOUKI_FAIL,
    NORMAL_REVIVE, RUSH_REVIVE,
    RUSH_HOLD, RUSH_PREREAD, RUSH_YOKOKU, RUSH_SP_YOKOKU, RUSH_REACH, RUSH_MODES, RENDA,
    CHALLENGES, BONUS_URA, SERIFU, SPECS,
  };

  if (typeof module !== "undefined") module.exports = data;
  else root.GENSOU_DATA = data;
})(this);
