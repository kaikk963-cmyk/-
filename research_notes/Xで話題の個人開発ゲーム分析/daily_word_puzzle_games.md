# デイリー型・言葉/パズル系・絵文字シェア型ブラウザミニゲーム(2026年、日本のXを中心に)

調査日: 2026-10-20。WebSearch/WebFetchで約20回調査。注意: 日本語メディア(AUTOMATON、ねとらぼ、ITmedia、Togetter)で「2026年にXでバズった日本語デイリーゲーム」を直接扱った記事は検索で見つからなかった。2026年の日本語作品で一次記事まで確認できたのは主に『いちばん遠い言葉』(電ファミ)だけ。

## Q1. 日本語Wordle派生(ことのはたんご等)の2026年の状況と、新しく話題になった日本語デイリーゲーム

### Takeaway
ことのはたんごは現在も1日1問で稼働している。シェア形式は画像・絵文字・リンク・多SNSと、派生作の中でも最も充実している。ただし、2026年にXで再びバズったことを示す記事は見つからなかった。2026年に新しく話題になった日本語の「デイリー型」言葉ゲームも、報道ベースでは確認できなかった(未確認)。

### Cited Findings
- **ことのはたんご**(作者: Rikito Ohnishi / X: @plum_chloride、GitHub: plumchloride、ページ表記は©2024)
  - ルール: ひらがな5文字の名詞を10回以内で当てる。答えは辞書から乱数で日替わり生成され、全員共通。1日1回だけ挑戦できる。
  - 補助機能: メモモード(○×)、次の問題までのカウントダウン、前日の答え、全体統計(正答率・完了率・平均回数)。
  - シェア形式: 「画像履歴」「残り候補数(画像または絵文字)」「リンクのみ」を選べる。共有先はコピー、X、LINE、Share API、Bluesky、Misskey、タイッツー。リンクの設定も選べる。
  - 使用辞書: UniDic-cwj 3.1.0、分類語彙表増補改訂版。
  - 出典: [ことのはたんご](https://plum-chloride.jp/kotonoha-tango/index.html)
- **その他の日本語Wordle派生**(いずれも2022年前後の作品。2026年の動向は未確認)
  - わーどる: ひらがな5文字を6回以内で当てる。お題はJMdictなどから採用。[GitHub](https://github.com/skytomo221/waadoru)
  - Kotobade Asobou: 4文字版。[サイト](https://taximanli.github.io/kotobade-asobou/)
  - WORDLE ja: [サイト](https://aseruneko.github.io/WORDLEja/)
  - ポケモンWordle: [サイト](https://wordle.mega-yadoran.jp/)
  - iPhoneアプリ「ワード日本語」(@Wordle_Japan): 2022年3月リリース。[X](https://x.com/wordle_japan)
- **本家Wordle周辺**: 90以上の言語で遊べるハブサイトがある([wordle.global](https://wordle.global/en))。NBCがWordle原作のゲームショーを制作中で、2027年放送予定とされる([Wikipedia: Wordle (TV show)](https://en.wikipedia.org/wiki/Wordle_(TV_show)))。
- **参考(デイリー型ではないが2026年10月に日本のXで流行したブラウザゲーム)**
  - 『80億分の1』: 2026年10月5日公開。Jin Hwi-eus氏がAIを活用して開発し、Jin's Earthが運営。国連・世界銀行・WHOの統計で「どこかの国に生まれた誰かの人生」を体験する。
  - 拡散の経緯: 堀井雄二氏がXでプレイ結果を共有したことで注目された。フォロワー作品として『1.2億分の1』(日本版、県別出生率)、『5万人のゲームクリエイター人生』、『人間に生まれる確率』(人間になる確率は約1/1,011億、線虫が約86%)が次々に登場した。
  - 出典: [Game*Spark 2026/10/19](https://gamespark.jp/article/2026/10/19/173793.html)
- **言葉ゲームの公式ブラウザ版**: 「ワードウルフ」の原作者公認ブラウザ版が2026年8月20日に公開された(インストール・登録不要、無料)。ただし人狼系の会話ゲームで、デイリー型ではない。[PR TIMES](https://prtimes.jp/main/html/rd/p/000000024.000108704.html)

### Inferences
- 日本語Wordle派生のブームは2022年がピークで、2026年は定番として定着した段階と思われる(推測。利用者数のデータは見つからなかった)。
- ことのはたんごの「残り候補数」シェアは、答えを伏せたまま難易度を伝えられる。日本語の文字種の多さに合わせた独自の工夫と言える。
- 2026年の日本のXでのバズは、「毎日1問」型より「1回遊んで結果をシェアする診断/シミュレーション型」(80億分の1、いちばん遠い言葉)に寄っていた可能性がある。

### Gaps
- ことのはたんごの2026年の利用者数や、X上の言及量は確認できなかった。
- 「2026年に新しく話題になった日本語のデイリー型(毎日1問)ゲーム」は、報道記事では特定できなかった。X内の検索が必要。

## Q2. 言葉の距離・連想・しりとり・大喜利・AI判定の言葉ゲームで日本で話題になったもの

### Takeaway
2026年の代表例は、unityroomの個人作品『いちばん遠い言葉』(2026/7/19公開)。埋め込みベクトルのcos類似度を「km」で表示し、結果をシェアしたくなる形にした点が注目された。同じ作者系列のAI判定ゲーム『私はAIです。』(2026/6/27)もある。

### Cited Findings
- **『いちばん遠い言葉』**
  - 作者・公開: 個人開発者「再発明された車輪」(X: @the_wheel_2024)が、2026年7月19日にunityroomで無料公開。PCとスマホで遊べる。
  - ゲーム性: お題の言葉に対して、できるだけ関係のない言葉を入力する。関連性は「言葉の距離(km)」として表示され、遠いほど高評価。
  - モード: 「ノーマル」(お題からの遠さを競う)と「エンドレス」(直前より遠い言葉を連続で入力)。ランキングには1000km超の回答者もいる。
  - 告知: 作者はXで「猫」→「伝説の剣」が52kmという例を示して告知した。
  - 技術: AIモデルで言葉をベクトル化し、ベクトル同士の近さ(cos類似度)から距離を算出している。
  - 出典: [電ファミニコゲーマー 2026/7/20](https://news.denfaminicogamer.jp/news/260719i)、[ゲーム本体(unityroom)](https://unityroom.com/games/word-distance)、[作者の作品置き場](https://beginne28949926.com/games/)
- **『私はAIです。』**
  - 2026年6月27日公開(unityroom、スマホ対応)。質問に答えながら、人間だとバレないようにする。
  - 回答はブラウザ上で動く「監査AI」が判定する。Transformers.jsとONNXモデルでSLMをブラウザ内実行しており、過去作『わん・もあ・とーくん2』と同じ方式。
  - コメント欄では攻略法の話題が出ている。
  - 出典: [unityroom](https://unityroom.com/games/i-am-ai)(作者の作品置き場は上記と同じとみられるが、同一作者かどうかは未確認)
- **先行例**
  - Semantris(Google、2018): AIが連想の関連性を判定する単語ゲーム。[ITmedia](https://www.itmedia.co.jp/news/articles/2209/03/news022.html)
  - Semantle: 意味の近さで正解の単語を当てるデイリーゲーム(Wordle派生)。[Wikipedia](https://en.wikipedia.org/wiki/Semantle)

### Inferences
- 『いちばん遠い言葉』はSemantleを反転させた発想(近づくのではなく遠ざかる)と言える。「○○から××まで52km」という1行で説明できる結果は、絵文字グリッドの代わりになるシェアの単位として機能している。
- ブラウザ内でのLLM/埋め込み実行(Transformers.js)によってサーバー費用がかからず、個人開発でもAI判定ゲームを無料公開しやすくなっている。

### Gaps
- 『いちばん遠い言葉』のプレイ数、告知ポストのインプレッション、Togetterまとめの有無は未確認。
- 大喜利AI判定やしりとり系で2026年に話題になった作品は見つからなかった。

## Q3. 日替わりパズル(地理当て、画像当て、数当て、ゴルフ、推理)で2026年に流行したもの

### Takeaway
2026年の新作で報道まで確認できたのは、海外産の『putt.day』(日替わりミニゴルフ、2026/5/13開始)。推理系では『Clues by Sam』(2025年5月開始)が2026年初頭に1日5万人超のプレイヤーに達した。日本産の日替わりパズルで2026年に流行したものは確認できなかった。

### Cited Findings
- 2026年版の「Wordle代替」まとめ記事には、Squeezy、Krillion Unlimited、Queens Ultimateなどが挙がっている。ただしアフィリエイト系のリスト記事で、話題性を示すデータはない。[crosswordle](https://crosswordle.com/blog/wordle-alternatives)、[wordga](https://wordga.com/blog/games-like-wordle)
- 日本の日替わり系: 「10パズル迷路」(個人開発、日替わり出題)があるが、公開は数年前。[Zenn](https://zenn.dev/shiro46/articles/b0b1fc8151ff36)
- 日本の日替わり系: Puzzlega.meの1日1問クロスワードやスペリングビー。[Puzzlega.me](https://puzzlega.me/release_crossword/)
- 2026年の流行は確認できない。

### Inferences
- 2026年は、言葉以外のジャンル(ゴルフ、論理推理)に「Wordle型の日替わり+スコア共有」を移植した作品が海外で目立った。

### Gaps
- 地理当て(Worldle系)、画像当て、数当てで2026年に新しく流行した作品は特定できなかった。日本のX上での流行状況も未確認。

## Q4. putt.day、Clues By Sam、Tweetcraftの詳細とバズ理由

### Takeaway
putt.dayは「Wordleのミニゴルフ版」で、毎日1ホール、ローカルのストリーク、アーカイブを備える。Clues by Samは推測を禁止した論理パズルで、絵文字グリッドで共有する。Tweetcraftはデイリー型ではなく、「X上のリンク1つで同じワールドに入れるマルチプレイ・マイクラ風ゲーム」で、告知ポストは740万ビューを超えた。

### Cited Findings
- **putt.day**
  - 作者・素材: ell.dev。ミニゴルフのモデルはKenney製(CC0)。検索スニペットによる情報で、ell.devの公式ページは未確認。[検索スニペット元: InGameNews(現在410)](https://ingamenews.com/2026/06/puttday-is-daily-minigolf-fix-you-need.html)
  - 開始日: 最初のコースは2026年5月13日で、以降毎日新しいホールが追加される。[Dexerto 2026/9/9](https://www.dexerto.com/gaming/this-addictive-browser-game-is-the-minigolf-version-of-wordle-3407294/)
  - ゲーム性: 少ない打数でカップインを目指す。ホールは大型で、par13〜14のものもある。坂・障害物・ボールを引き寄せる磁石がある。水に落ちると直前の位置に戻り、その打数もカウントされる。[Dexerto](https://www.dexerto.com/gaming/this-addictive-browser-game-is-the-minigolf-version-of-wordle-3407294/)
  - 操作: クリックしてドラッグし、パワーと方向を決める。モバイルはタッチ操作に対応し、カメラの回転・ズームもできる。[Dexerto](https://www.dexerto.com/gaming/this-addictive-browser-game-is-the-minigolf-version-of-wordle-3407294/)、InGameNews(スニペット)
  - 継続性: リプレイでスコア更新ができ、過去約2か月分のアーカイブを遊べる(Dexertoは「100ホール以上」と記載)。ログイン不要で、ストリークとスコアはブラウザのローカル保存のため、データを消すと失われる。InGameNews(スニペット)、[Dexerto](https://www.dexerto.com/gaming/this-addictive-browser-game-is-the-minigolf-version-of-wordle-3407294/)
  - 別版: CrazyGames版は2026年7月リリースと表記され、30ホール+Endlessモードを収録。[CrazyGames](https://www.crazygames.com/game/putt-day)
  - シェア形式: Dexertoの記事には記載がなく、未確認。
  - バズ理由: Dexertoは「Wordleを毎日遊ぶ何百万人のうち、言葉よりゴルフ派の人向け」と位置づけ、見出しで「addictive」と評している。具体的な数値は記事にない。[Dexerto](https://www.dexerto.com/gaming/this-addictive-browser-game-is-the-minigolf-version-of-wordle-3407294/)
- **Clues by Sam**
  - 作者: フィンランドのJohannes Ahvenniemi(Ad Artis Oy)。[Wikipedia(削除提案中、取得時は404)](https://en.wikipedia.org/wiki/Clues_By_Sam)、[Aftermath](https://aftermath.site/clues-by-sam-wordle-daily-puzzle-game/)
  - 開始・規模: 2025年5月にデイリー化。2026年初頭に1日5万人超がプレイ(開発者のLinkedIn投稿でも確認されたと検索要約にある)。[Wikipedia](https://en.wikipedia.org/wiki/Clues_By_Sam)
  - 盤面: 登場人物(職業付き)を「無実/犯人」に分類する。盤面のサイズは情報源で食い違う。Wikipedia系の要約は4×5・20人、[Aftermath](https://aftermath.site/clues-by-sam-wordle-daily-puzzle-game/)は5×5。
  - ゲーム性: 最初は手がかり1つから始まり、正しく判定するたびに新しい手がかりが出る。推測では進めない設計で、提示された情報から論理的に導けない判定はポップアップで拒否される。ヒント機能はあり、メモ機能はない。更新はNY時間の深夜0時。[Aftermath](https://aftermath.site/clues-by-sam-wordle-daily-puzzle-game/)、[公式ヘルプ](https://cluesbysam.com/help/827da9815a12)
  - シェア: Wordle風の絵文字グリッドをコピーできる。色分けは、黄=ヒント1回、橙=ヒント2回、黄土色=ミスあり。所要時間も付き、5分未満なら秒まで表示される。Instagram向けの画像出力もある。「Share progress」で途中状態のリンクを共有できる。[公式ヘルプ](https://cluesbysam.com/help/827da9815a12)(検索要約による。2025年時点の仕様)
  - バズ理由: SAT風の言い回しで、知識ではなく推論だけで解ける。個人制作の手作り感がWordleを思わせ、毎日短時間で終わる。[Aftermath(Gita Jackson, 2025/7/29)](https://aftermath.site/clues-by-sam-wordle-daily-puzzle-game/)。Straight Dopeなどのフォーラムで毎日結果が投稿されている。[Straight Dope](https://boards.straightdope.com/t/clues-by-sam/1030350)
- **Tweetcraft**(2009年の同名WoW用ツイートツールとは別物)
  - 作者: X @jaivinwylde(jaivin)。告知文は「put the entire game of Minecraft inside twitter.. with WORKING multiplayer」。[tbreak 2026/10/8](https://tbreak.com/tweetcraft-minecraft-x-ai-multiplayer/)
  - 公開日: 2026年10月上旬。ixbt.gamesが10/7、tbreakが10/8に報道。正確な公開日は未確認。[ixbt.games](https://ixbt.games/en/news/2026/10/07/440921-brauzernyi-klon-minecraft-zapustili-vnutri-socseti-ilona-maska-on-podderzivaet-multipleer.html)
  - 仕組み: 実体はtweetcraft.jai.vinでホストされた独自のブラウザ製ブロックゲーム。ワールドを生成すると固有リンクが発行され、そのリンクをXに投稿すると、開いた全員が同じリアルタイムセッションに参加する。[tbreak](https://tbreak.com/tweetcraft-minecraft-x-ai-multiplayer/)
  - 操作: WASDで移動、スペースでジャンプ、左クリックで攻撃、右ドラッグでカメラ操作。インベントリとテキストチャットがある。[ixbt.games](https://ixbt.games/en/news/2026/10/07/440921-brauzernyi-klon-minecraft-zapustili-vnutri-socseti-ilona-maska-on-podderzivaet-multipleer.html)
  - 規模: 告知ポストは740万ビュー超(IGN経由)。[tbreak](https://tbreak.com/tweetcraft-minecraft-x-ai-multiplayer/)、[SpazioGames](https://www.spaziogames.it/notizie/minecraft-approda-su-x-ma-il-progetto-non-e-ufficiale)、[Applesfera](https://www.applesfera.com/juegos-ios/alguien-ha-creado-minecraft-que-se-puede-jugar-x-mejor-que-envidia-poco-al-original)。IGNの原記事は未確認。
  - AI利用: 作者はAIで開発したと述べているが、ツール名や手書きコードの割合は不明。[tbreak](https://tbreak.com/tweetcraft-minecraft-x-ai-multiplayer/)
  - 収益化: 暗号資産によるスポンサー枠を販売している(サーバーリスト上位、ワールドのスポンサー板、Block Dragonへのロゴ掲載)。[tbreak](https://tbreak.com/tweetcraft-minecraft-x-ai-multiplayer/)
  - 権利: Minecraftのアセットは不使用で、Mojang/Microsoftとは無関係と作者は表明している。両社のコメントはない。[tbreak](https://tbreak.com/tweetcraft-minecraft-x-ai-multiplayer/)

### Inferences
- 3作のバズ理由は次のように分けられる。putt.day=「Wordleの型を別ジャンルに移植」、Clues by Sam=「公平な推論(推測禁止)+絵文字シェア」、Tweetcraft=「Xの投稿そのものを入口にする(リンク=ワールド)+マイクラという強いフック+AI制作という話題性」。
- Tweetcraftはデイリー型ではなく、継続の仕組み(毎日1問、ストリーク)もない。参考枠として扱うのが適切。

### Gaps
- putt.dayの共有形式(絵文字か、スコアテキストか)、プレイヤー数、作者ell.devの公式情報は未確認。
- Clues by Samの2026年の最新プレイヤー数とシェア仕様の変更有無は未確認。
- Tweetcraftの正確な公開日とIGN原記事の本文は未確認。

## Q5. シェア形式の比較(絵文字、画像、URL)

### Takeaway
「絵文字グリッド(テキスト)」はWordle以来の定番で、Clues by Samやことのはたんごが採用している。それに加えて「画像出力」(ことのはたんご、Clues by Sam)、「途中状態・ワールドのURL」(Clues by SamのShare progress、Tweetcraftのワールドリンク)、「1行の数値結果」(いちばん遠い言葉のkm)へと多様化している。

### Cited Findings
- ことのはたんご: 画像履歴、残り候補数(画像または絵文字)、リンクから選べる。共有先はX/LINE/Bluesky/Misskey/タイッツー/Share APIで、文字数制限の厳しいタイッツー(約20字)向けの設定まである。[ことのはたんご](https://plum-chloride.jp/kotonoha-tango/index.html)
- Clues by Sam: 色付き絵文字グリッド+所要時間、Instagram向け画像、途中経過リンク。[公式ヘルプ](https://cluesbysam.com/help/827da9815a12)、[Aftermath](https://aftermath.site/clues-by-sam-wordle-daily-puzzle-game/)
- いちばん遠い言葉: 「お題→回答=距離km」の数値結果。作者の告知例は「猫→伝説の剣=52km」。[電ファミ](https://news.denfaminicogamer.jp/news/260719i)
- Tweetcraft: ワールドURLそのものが共有物で、クリックすると同じセッションに合流する。[tbreak](https://tbreak.com/tweetcraft-minecraft-x-ai-multiplayer/)
- putt.day: 共有形式は未確認。ストリークはローカル保存。InGameNews(スニペット)
- 80億分の1: 結果のスクショやテキストをXに投稿する形(堀井雄二氏の共有が契機)。ゲーム内のシェア機能の詳細は未確認。[Game*Spark](https://gamespark.jp/article/2026/10/19/173793.html)

### Inferences
- 絵文字シェアの利点は、ネタバレせずに達成度を比べられること。URLシェアの利点は、見た人をそのまま参加者に変えられること(Tweetcraftが典型)。数値1行シェアは大喜利性があり、回答そのものが面白さになる(いちばん遠い言葉)。
- 日本の作品はX以外(LINE、Misskey、Bluesky、タイッツー)への分散対応が進んでいる(ことのはたんご)。

### Gaps
- 各シェア形式の拡散効果(CTRやインプレッション)を比較した定量データは見つからなかった。
