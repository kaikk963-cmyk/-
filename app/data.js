// e東京喰種（2025年4月導入）のスペックと演出データ。
//
// rel   : 攻略サイト（1GEKI等）掲載の信頼度。1 は大当り濃厚。
// share : 大当り時にその演出が選ばれる割合（こちらで決めた仮定値）。
//         ハズレ時の出現率は rel と share から逆算するので、rel はシミュレーション上でも一致する。
// missRate : ハズレ専用の演出の出現率（rel を持たないもの）。
// rushOnly : RUSH直行の当たりでのみ出る演出（虹保留・全回転など）。
// ctx   : 信頼度の母数。spin=全変動 / reach=リーチ時 / sp=SPリーチ時 / self=親リーチ内。
(function (root) {
  const SPEC = {
    name: "e東京喰種",
    hitProb: 1 / 399.9,        // 図柄揃い（HYPER喰種BONUS）
    chargeProb: 1 / 399.9,     // 喰種チャージ
    hitRushRate: 0.5,          // 図柄揃い時のRUSH突入（BONUS中チャレンジ成功）
    chargeRushRate: 0.01,      // チャージからのRUSH昇格
    rushProb: 1 / 95.3,
    stSpins: 130,
    // 払い出しではなく実獲得（ラウンド中の打ち出し分を引いた値）
    payout: { bonus10R: 1400, charge2R: 280, rush3000: 2800, rush6000: 5600 },
    rush6000Rate: 0.03,
    firePerMin: 100,           // 1分あたりの発射数
    holdMax: 4,
    rent: { yen: 1000, balls: 250 },
  };

  const opt = (id, label, rel, share, extra) => Object.assign({ id, label, rel, share }, extra);

  // ---------------- 通常時 ----------------

  const NORMAL_HOLD = {
    id: "hold", name: "保留変化予告", ctx: "spin",
    options: [
      opt("blink", "点滅", 0.008, 0.01, { color: "blink" }),
      opt("blue", "青", 0.05, 0.22, { color: "blue" }),
      opt("green", "緑", 0.08, 0.14, { color: "green" }),
      opt("purple", "紫", 0.33, 0.14, { color: "purple" }),
      opt("red", "赤", 0.8, 0.2, { color: "red" }),
      opt("gold", "金", 0.9, 0.08, { color: "gold" }),
      opt("rainbow", "虹", 1, 0.02, { color: "rainbow", rushOnly: true }),
      opt("chain", "金木保留（鎖切れず）", 0.12, 0.04, { color: "chain" }),
      opt("chainBreak", "金木保留（鎖切れ）", 1, 0.03, { color: "chain", breakTo: "gold" }),
    ],
  };

  const NORMAL_PREREAD = {
    id: "gantai", name: "眼帯の喰種 保留変化", ctx: "spin",
    options: [
      opt("weak", "弱（赫子）", 0.16, 0.08),
      opt("strong", "強（噛み付き）", 0.8, 0.08),
    ],
  };

  // 変動中の予告。発生順に並べる。
  const NORMAL_YOKOKU = [
    {
      id: "logo", name: "変動開始ロゴフラッシュ", ctx: "spin",
      options: [opt("white", "通常", 0.08, 0.2, { color: "white" }), opt("red", "赤", 0.68, 0.12, { color: "red" })],
    },
    {
      id: "giji", name: "間違っているのはこの世界だ連続予告", ctx: "spin",
      options: [
        opt("x2", "2回", 0.02, 0.06, { n: 2 }),
        opt("x3", "3回", 0.33, 0.15, { n: 3 }),
        opt("x3rize", "3回＋リゼ出現", 0.5, 0.06, { n: 3, rize: true }),
        opt("kaneki", "即連続で金木出現", 1, 0.01, { n: 3, kaneki: true }),
      ],
    },
    {
      id: "kaiwa", name: "会話予告", ctx: "spin",
      options: [
        opt("white", "白セリフ", 0.005, 0.03, { color: "white" }),
        opt("red", "赤セリフ", 0.2, 0.06, { color: "red" }),
        opt("gold", "金セリフ", 0.55, 0.06, { color: "gold" }),
      ],
    },
    {
      id: "mask", name: "マスクSU予告", ctx: "spin",
      options: [
        opt("touka", "董香", 0.02, 0.015, { color: "white", step: 2 }),
        opt("tsukiyama", "月山", 0.02, 0.015, { color: "white", step: 2 }),
        opt("yamori", "ヤモリ", 0.02, 0.015, { color: "white", step: 2 }),
        opt("toukaR", "董香（赤）", 0.21, 0.03, { color: "red", step: 3 }),
        opt("tsukiyamaR", "月山（赤）", 0.21, 0.03, { color: "red", step: 3 }),
        opt("yamoriR", "ヤモリ（赤）", 0.21, 0.03, { color: "red", step: 3 }),
        opt("kanekiR", "金木（赤）", 0.28, 0.05, { color: "red", step: 4 }),
        opt("kanekiG", "金木（金）", 0.6, 0.06, { color: "gold", step: 4 }),
      ],
    },
    {
      id: "marvelous", name: "月山マーベラス予告", ctx: "spin",
      options: [
        opt("purple", "エフェクト紫", 0.1, 0.02, { color: "purple" }),
        opt("red", "エフェクト赤", 0.45, 0.03, { color: "red" }),
        opt("gold", "エフェクト金", 0.85, 0.03, { color: "gold" }),
      ],
    },
    {
      id: "haikei", name: "背景移行", ctx: "spin",
      options: [opt("matenrou", "摩天楼", 0.29, 0.1, { bg: "matenrou" }), opt("seishin", "精神世界", 0.78, 0.1, { bg: "seishin" })],
    },
    {
      id: "higekiShurai", name: "悲劇の襲来予告", ctx: "spin",
      options: [opt("normal", "通常", 0.33, 0.1, { color: "white" }), opt("strong", "強", 0.81, 0.08, { color: "red" })],
    },
    {
      id: "rizeKaisou", name: "リゼ回想予告", ctx: "spin",
      options: [opt("normal", "通常", 0.25, 0.06, { color: "white" }), opt("red", "赤", 0.8, 0.05, { color: "red" })],
    },
    {
      // 喰MAXクライマックスハンド落下（変動中の手役物落下）
      id: "hand", name: "喰MAXクライマックスハンド落下", ctx: "spin",
      options: [
        opt("normal", "通常音", 0.72, 0.18, { sound: "normal" }),
        opt("low", "低音", 1, 0.02, { sound: "low" }),
        opt("high", "高音", 1, 0.02, { sound: "high" }),
      ],
    },
  ];

  // リーチ前（リーチ成立が前提）
  const NORMAL_PRE_REACH = [
    {
      id: "nakama", name: "仲間への想い予告", ctx: "reach",
      options: [opt("general", "一般セリフ", 0.26, 0.06, { color: "white" }), opt("touka", "董香関連セリフ", 0.9, 0.05, { color: "gold" })],
    },
    {
      id: "jason", name: "ジェイソンルーレット", ctx: "reach",
      options: [opt("normal", "通常", 0.27, 0.06, { color: "white" }), opt("red", "赤", 0.7, 0.05, { color: "red" })],
    },
    {
      id: "zone", name: "喰種ZONE", ctx: "reach",
      options: [opt("button", "煽りボタン", 0.14, 0.01, { device: "button" }), opt("vcon", "煽りV-コントローラー", 0.8, 0.05, { device: "vcon" })],
    },
  ];

  // SPリーチ中
  const NORMAL_SP_YOKOKU = [
    { id: "higekida", name: "それはきっと、“悲劇”だ予告", ctx: "sp", options: [opt("on", "発生", 0.75, 0.1, { color: "red" })] },
    { id: "yuwaku", name: "誘惑のリゼ予告", ctx: "sp", options: [opt("on", "発生", 0.6, 0.08, { color: "red" })] },
    {
      id: "ketsui", name: "決意のマスク", ctx: "sp",
      options: [opt("mayowanai", "「僕はもう迷わない」", 0.73, 0.1, { color: "red" }), opt("kuushu", "「僕は喰種だ」", 1, 0.02, { color: "gold" })],
    },
  ];

  // ハズレ専用の煽り
  const KYOUKI_FAIL = { id: "kyouki", name: "狂気の時予告（テンパイ失敗）", missRate: 0.004, rel: 0.02 };

  // リーチ内のチャンスアップ
  const color3 = (id, name, red, gold) => ({
    id, name, ctx: "self",
    options: [opt("red", "赤", red, 0.3, { color: "red" }), opt("gold", "金", 1, 0.03, { color: "gold" })],
  });
  const deviceGroup = (rel = 1) => ({
    id: "device", name: "当落デバイス", ctx: "self",
    options: [opt("vcon", "V-コントローラー", rel, 0.08, { device: "vcon" })],
  });
  const yakumonoTiming = {
    id: "yakuTiming", name: "役物落下タイミング", ctx: "self",
    options: [
      opt("deviceAppear", "デバイス出現直後", 1, 0.02),
      opt("deviceOperate", "デバイス操作時", 1, 0.02),
      opt("kyusai", "即救済", 1, 0.01),
    ],
  };

  const battleSubs = (titleR, telopR, lampR, dropR, cutinR, strongR) => [
    color3("title", "タイトル色", titleR),
    color3("telop", "テロップ色", telopR),
    { id: "lamp", name: "手役物ランプ点灯", ctx: "self", options: [opt("on", "点灯", lampR, 0.35)] },
    { id: "drop", name: "手役物落下", ctx: "self", options: [opt("on", "落下", dropR, 0.25)] },
    { id: "strong", name: "強ルート分岐（彼岸花役物）", ctx: "self", options: [opt("on", "分岐", strongR, 0.5)] },
    color3("cutin", "カットイン色", cutinR),
    deviceGroup(),
    yakumonoTiming,
  ];
  const episodeSubs = (titleR, telopR, cutinR) => [
    color3("title", "タイトル色", titleR),
    color3("telop", "テロップ色", telopR),
    color3("cutin", "カットイン色", cutinR),
    deviceGroup(),
    yakumonoTiming,
  ];
  const climaxSubs = (bgR, monoR, cutinR) => [
    color3("yubipoki", "指ポキ背景", bgR),
    color3("monologue", "モノローグ色", monoR),
    color3("cutin", "カットイン色", cutinR),
    deviceGroup(),
    yakumonoTiming,
  ];
  const charaSubs = [
    { id: "telop", name: "テロップ色", ctx: "self", options: [opt("red", "赤", 0.28, 0.3, { color: "red" })] },
    { id: "drop", name: "手役物落下", ctx: "self", options: [opt("on", "落下", 0.71, 0.3)] },
  ];
  const longSubs = (goldR) => [
    { id: "telop", name: "テロップ色", ctx: "self", options: [opt("gold", "金", goldR, 0.2, { color: "gold" })] },
    { id: "rize", name: "リゼ登場", ctx: "self", options: [opt("on", "登場", 0.52, 0.35)] },
  ];

  const NORMAL_REACH = {
    id: "reach", name: "リーチ", ctx: "spin", exhaustive: true,
    options: [
      opt("normal", "ノーマルリーチ", 0.002, 0.02, { kind: "normal" }),
      opt("uta", "キャラリーチ ウタ", 0.02, 0.006, { kind: "chara", subs: charaSubs }),
      opt("tencho", "キャラリーチ 店長", 0.02, 0.006, { kind: "chara", subs: charaSubs }),
      opt("touka", "キャラリーチ 董香", 0.03, 0.009, { kind: "chara", subs: charaSubs }),
      opt("kattou", "ロングリーチ 葛藤", 0.04, 0.01, { kind: "long", subs: longSubs(0.9) }),
      opt("ue", "ロングリーチ 飢え", 0.14, 0.03, { kind: "long", subs: longSubs(0.93) }),
      opt("scrapper", "バトルSPリーチ スクラッパー", 0.22, 0.07, { kind: "battle", sp: true, subs: battleSubs(0.37, 0.37, 0.5, 0.7, 0.56, 0.7) }),
      opt("tsukiyama", "バトルSPリーチ 月山", 0.25, 0.08, { kind: "battle", sp: true, subs: battleSubs(0.41, 0.45, 0.54, 0.82, 0.62, 0.7) }),
      opt("nishio", "バトルSPリーチ 西尾", 0.32, 0.09, { kind: "battle", sp: true, subs: battleSubs(0.46, 0.48, 0.75, 0.95, 0.65, 0.71) }),
      opt("family", "エピソードリーチ 家族", 0.51, 0.16, { kind: "episode", sp: true, subs: episodeSubs(0.65, 0.65, 0.78) }),
      opt("kyouteki", "エピソードリーチ 強敵", 0.9, 0.1, { kind: "episode", sp: true, subs: episodeSubs(0.92, 0.93, 0.95) }),
      opt("cxYamori", "喰種クライマックスリーチ ヤモリ", 0.73, 0.12, { kind: "climax", sp: true, subs: climaxSubs(0.86, 0.89, 0.88) }),
      opt("cxAmon", "喰種クライマックスリーチ 亜門", 0.93, 0.08, { kind: "climax", sp: true, subs: climaxSubs(0.95, 0.95, 0.95) }),
      opt("fukoroshi", "不殺の梟", 0.52, 0.05, { kind: "fukoroshi", sp: true, subs: [deviceGroup(), yakumonoTiming] }),
      opt("hankakuja", "半赫者SP", 0.81, 0.06, { kind: "hankakuja", sp: true, subs: [deviceGroup(), yakumonoTiming] }),
      opt("zenkaiten", "全回転", 1, 0.006, { kind: "zenkaiten", sp: true, rushOnly: true }),
    ],
  };

  // ---------------- RUSH中 ----------------

  const RUSH_HOLD = {
    id: "hold", name: "保留変化予告（RUSH）", ctx: "rushSpin",
    options: [
      opt("blink", "点滅", 0.07, 0.05, { color: "blink" }),
      opt("blue", "青", 0.33, 0.15, { color: "blue" }),
      opt("green", "緑", 0.55, 0.15, { color: "green" }),
      opt("red", "赤", 0.95, 0.15, { color: "red" }),
      opt("rainbow", "虹", 1, 0.03, { color: "rainbow" }),
    ],
  };

  const RUSH_PREREAD = {
    id: "mukade", name: "百足先読み予告", ctx: "rushSpin",
    options: [opt("normal", "通常", 0.04, 0.03), opt("reverse", "逆向き", 0.86, 0.04)],
  };

  const RUSH_YOKOKU = [
    {
      id: "bokuha", name: "僕は！予告", ctx: "rushSpin",
      options: [opt("white", "通常", 0.06, 0.05, { color: "white" }), opt("red", "赤", 0.69, 0.04, { color: "red" }), opt("gold", "金", 1, 0.01, { color: "gold" })],
    },
    {
      id: "dive", name: "金木ダイブ予告", ctx: "rushSpin",
      options: [opt("white", "通常", 0.06, 0.05, { color: "white" }), opt("red", "赤", 0.78, 0.04, { color: "red" })],
    },
    {
      id: "kakumoji", name: "赫文字予告", ctx: "rushSpin",
      options: [
        opt("kagune", "赫子", 0.52, 0.08, { color: "white", word: "赫子" }),
        opt("kakugan", "赫眼", 0.85, 0.08, { color: "red", word: "赫眼" }),
        opt("hankakuja", "半赫者", 1, 0.02, { color: "gold", word: "半赫者" }),
      ],
    },
    {
      id: "bundan", name: "図柄分断予告", ctx: "rushSpin",
      options: [opt("two", "赫子2本", 0.23, 0.06, { n: 2 }), opt("four", "赫子4本", 0.75, 0.06, { n: 4 })],
    },
    {
      id: "gantaiRiyuu", name: "眼帯と呼ばれる理由", ctx: "rushSpin",
      options: [opt("white", "通常", 0.63, 0.06, { color: "white" }), opt("red", "赤", 1, 0.01, { color: "red" })],
    },
    {
      id: "fukurou", name: "トリプルSレート梟", ctx: "rushSpin",
      options: [opt("white", "通常", 0.04, 0.02, { color: "white" }), opt("gold", "金", 1, 0.01, { color: "gold" })],
    },
    {
      id: "sakuteki", name: "索敵テンパイ予告", ctx: "rushSpin",
      options: [opt("white", "通常", 0.32, 0.15, { color: "white" }), opt("red", "赤", 0.89, 0.08, { color: "red" })],
    },
  ];

  const RUSH_SP_YOKOKU = [
    {
      id: "kakugan", name: "赫眼煽り", ctx: "rushSp",
      options: [opt("on", "赫眼発動", 0.86, 0.5, { color: "red" }), opt("higanbana", "彼岸花役物", 1, 0.08, { color: "gold" })],
    },
  ];

  const shunkanSubs = (ketsuiR) => [
    { id: "ketsui", name: "金木決意", ctx: "self", options: [opt("on", "あり", ketsuiR, 0.35)] },
    deviceGroup(),
    yakumonoTiming,
  ];
  const ghoulBattleSubs = (gabureR, ichigekiR) => [
    { id: "music", name: "楽曲変化", ctx: "self", options: [opt("on", "あり", 1, 0.05)] },
    { id: "gabure", name: "画ブレ", ctx: "self", options: [opt("on", "あり", gabureR, 0.3)] },
    { id: "attack", name: "攻撃パターン", ctx: "self", options: [opt("ichigeki", "一撃", ichigekiR, 0.45)] },
    deviceGroup(),
    yakumonoTiming,
  ];

  const RUSH_REACH = {
    id: "reach", name: "リーチ", ctx: "rushSpin", exhaustive: true,
    options: [
      opt("normal", "ノーマルリーチ", 0.02, 0.1, { kind: "normal" }),
      opt("shachi", "瞬間決着 鯱", 0.35, 0.08, { kind: "shunkan", sp: true, subs: shunkanSubs(0.85) }),
      opt("yamori", "瞬間決着 ヤモリ", 0.39, 0.08, { kind: "shunkan", sp: true, subs: shunkanSubs(0.87) }),
      opt("ayato", "瞬間決着 絢都", 0.56, 0.08, { kind: "shunkan", sp: true, subs: shunkanSubs(0.89) }),
      opt("kuronashi", "瞬間決着 クロナ＆ナシロ", 0.85, 0.07, { kind: "shunkan", sp: true, subs: shunkanSubs(0.92) }),
      opt("btYamori", "喰種バトル ヤモリ", 0.45, 0.1, { kind: "ghoulBattle", sp: true, subs: ghoulBattleSubs(0.85, 0.75) }),
      opt("btAyato", "喰種バトル 絢都", 0.64, 0.1, { kind: "ghoulBattle", sp: true, subs: ghoulBattleSubs(0.92, 0.85) }),
      opt("amon", "亜門決戦", 0.86, 0.1, {
        kind: "amon", sp: true,
        subs: [
          { id: "title", name: "タイトル色", ctx: "self", options: [opt("gold", "金", 1, 0.08, { color: "gold" })] },
          { id: "sensei", name: "最終煽り先制攻撃", ctx: "self", options: [opt("kaneki", "金木", 1, 0.15)] },
          deviceGroup(), yakumonoTiming,
        ],
      }),
      opt("kyuushutsu", "救出リーチ", 0.42, 0.06, {
        kind: "kyuushutsu", sp: true,
        subs: [
          { id: "light", name: "集光エフェクト", ctx: "self", options: [opt("big", "大きい", 1, 0.08)] },
          { id: "countdown", name: "カウントダウン", ctx: "self", options: [opt("on", "あり", 1, 0.08)] },
          deviceGroup(), yakumonoTiming,
        ],
      }),
      opt("ooguli", "大喰いの気まぐれ", 0.71, 0.08, {
        kind: "ooguli", sp: true,
        subs: [
          { id: "higanbana", name: "彼岸花", ctx: "self", options: [opt("on", "あり", 0.86, 0.4)] },
          {
            id: "aura", name: "最終オーラ", ctx: "self",
            options: [opt("red", "赤", 0.8, 0.45, { color: "red" }), opt("rainbow", "虹", 1, 0.1, { color: "rainbow" })],
          },
          deviceGroup(), yakumonoTiming,
        ],
      }),
      opt("ranbu", "乱舞リーチ", 0.55, 0.06, {
        kind: "ranbu", sp: true,
        subs: [
          { id: "allHit", name: "全て大当り図柄", ctx: "self", options: [opt("on", "全て大当り図柄", 1, 0.1)] },
          color3("cutin", "カットイン色", 0.9),
          deviceGroup(), yakumonoTiming,
        ],
      }),
      opt("hoshoku", "捕食リーチ", 0.86, 0.1, { kind: "hoshoku", sp: true, subs: [deviceGroup(), yakumonoTiming] }),
      opt("zenkaiten", "全回転", 1, 0.01, { kind: "zenkaiten", sp: true }),
    ],
  };

  // RUSH中の演出モード
  const RUSH_MODES = {
    default: { name: "デフォルト", desc: "いろいろな演出が楽しめる基本モード" },
    totsugeki: { name: "突激", desc: "役物が落下すれば大当り" },
    rize: { name: "リゼ襲来", desc: "保留入賞時に告知が出れば大当り" },
    tsukiyama: { name: "月山絶叫", desc: "ボタンを押して告知が出れば大当り" },
  };

  const TSUKIYAMA_BUTTON = {
    id: "zekkyou", name: "月山絶叫告知（ボタン回数）", ctx: "rushSpin",
    options: [
      opt("b1", "1回", 1, 0.12, { n: 1 }),
      opt("b5", "5回", 0.2, 0.15, { n: 5 }),
      opt("b10", "10回", 0.1, 0.1, { n: 10 }),
      opt("b20", "20回", 0.13, 0.15, { n: 20 }),
      opt("b30", "30回", 0.24, 0.25, { n: 30 }),
      opt("b77", "77回", 1, 0.05, { n: 77 }),
    ],
  };

  // HYPER喰種BONUS中のRUSH突入チャレンジ
  const CHALLENGES = {
    amon: { name: "亜門突破チャレンジ" },
    ippatsu: { name: "一発告知チャレンジ" },
  };

  const data = {
    SPEC,
    NORMAL_HOLD, NORMAL_PREREAD, NORMAL_YOKOKU, NORMAL_PRE_REACH, NORMAL_SP_YOKOKU, NORMAL_REACH, KYOUKI_FAIL,
    RUSH_HOLD, RUSH_PREREAD, RUSH_YOKOKU, RUSH_SP_YOKOKU, RUSH_REACH, RUSH_MODES, TSUKIYAMA_BUTTON,
    CHALLENGES,
  };

  if (typeof module !== "undefined") module.exports = data;
  else root.GHOUL_DATA = data;
})(this);
