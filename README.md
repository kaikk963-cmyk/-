# アセコル 日本再現マップ ツールキット

Assetto Corsa (アセコル) 用に、日本の実在の道路を再現したトラックを作るためのツール群です。

- **道路の形** … OpenStreetMap (OSM)
- **標高・地形** … 国土地理院 標高タイル (5m / 10m メッシュ)
- **出力** … Blender 用メッシュ → FBX → KsEditor で `.kn5` 化

```
config/*.json ──► fetch_osm.py ─┐
                 fetch_dem.py ──┼─► build_track.py ─► Blender (import_to_blender.py) ─► FBX ─► KsEditor ─► .kn5
                                └─ data/<id>/          out/<id>/build/                                     out/<id>/<id>/
```

## 必要なもの

- Python 3.10+ (`pip install -r requirements.txt`)
- [Blender](https://www.blender.org/) 3.6 以降
- KsEditor (Assetto Corsa SDK。Steam の「ツール」から `Assetto Corsa SDK` をインストール)
- 任意: Custom Shaders Patch / Content Manager (動作確認・AI ライン作成が楽)

## 使い方

### 1. 場所を決めて config を作る

`config/hakone_turnpike.json` (箱根ターンパイク) をコピーして編集します。

| 項目 | 説明 |
| --- | --- |
| `track_id` | フォルダ名・kn5 名 (半角英数字と `_`) |
| `bbox` | `[南端緯度, 西端経度, 北端緯度, 東端経度]`。Google マップ等で確認 |
| `route.name_regex` | コースにする道路名 (正規表現)。`name` / `name:ja` / `name:en` / `ref` を検索 |
| `route.highway` | 対象にする道路種別 (`primary`, `secondary` …) |
| `route.way_ids` | OSM の way ID を直接指定する場合 (指定すると上の条件は無視) |
| `road_width` / `shoulder_width` | 車道幅 / 路肩幅 [m] |
| `elevation_smooth_m` | 路面の高さをならす距離。凸凹する場合は大きく |
| `terrain.cell_m` | 地形メッシュの細かさ [m] |
| `reverse` | 走行方向を逆にする |
| `pit_boxes` | ピット数 = 同時出走台数 |

条件に合う道路のうち **一番長くつながる 1 本** が自動でコースになります (上下線が分かれている道路も片側だけ選ばれます)。

### 2. データ取得

```bash
python tools/fetch_osm.py config/hakone_turnpike.json   # 範囲内の道路名一覧も表示される
python tools/fetch_dem.py config/hakone_turnpike.json
```

Overpass API に繋がらない場合は [openstreetmap.org/export](https://www.openstreetmap.org/export) で範囲を `.osm` として保存し、
`python tools/fetch_osm.py config/xxx.json --osm-file map.osm` で読み込めます。

### 3. メッシュ生成

```bash
python tools/build_track.py config/hakone_turnpike.json
```

生成されるオブジェクト (名前の頭の数字 + キーワードで AC が物理面を判定します):

| オブジェクト | 内容 |
| --- | --- |
| `1ROAD` | 車道 |
| `2SHOULDER_L` / `3SHOULDER_R` | 路肩 (surfaces.ini の `SHOULDER`) |
| `1WALL_L` / `2WALL_R` | ガードレール (高さ 0.85m のコリジョン壁) |
| `1GRASS_00`… | 地形 (65,535 頂点制限に合わせて分割) |
| `AC_PIT_n` / `AC_START_n` / `AC_HOTLAP_START_0` | スポーン位置 |
| `AC_TIME_0_L/R`, `AC_TIME_1_L/R` | 計測ライン |
| `AC_AB_START_L/R`, `AC_AB_FINISH_L/R` | 片道 (A→B) コース用スタート / ゴール |

### 4. Blender で FBX 化

```bash
blender -b -P blender/import_to_blender.py -- out/hakone_turnpike/build
```

`out/hakone_turnpike/build/` に `track.blend` と `hakone_turnpike.fbx` ができます。
建物や木、標識などを足したい場合は `track.blend` を開いて編集し、FBX を書き出し直してください
(書き出し設定: 前方 `-Z` / 上 `Y` / 適用スケーリング `FBX単位スケール`)。

### 5. KsEditor で kn5 化

1. KsEditor で `hakone_turnpike.fbx` を開く (テクスチャは同じ場所の `texture/` から読まれる)
2. マテリアルのシェーダーを設定 (目安: すべて `ksPerPixel`。ガードレールは両面表示にしたいなら `ksPerPixelAT` など)
3. 物理面 (`1ROAD` など) にチェックが入っていることを確認
4. `File > Save kn5` で `out/hakone_turnpike/hakone_turnpike/hakone_turnpike.kn5` に保存

### 6. ゲームに入れる

`out/hakone_turnpike/hakone_turnpike/` フォルダごと
`steamapps/common/assettocorsa/content/tracks/` にコピーします。

```
hakone_turnpike/
├── hakone_turnpike.kn5
├── map.png
├── data/  map.ini, surfaces.ini
└── ui/    ui_track.json, outline.png  (preview.png は自分でスクショを置く)
```

**AI ライン** は自動生成できないので、ゲーム内で 1 周 (1 本) 走って記録します
(Content Manager / CSP の AI ライン記録機能、またはデベロッパーアプリ)。`ai/fast_lane.ai` が無くても練習走行はできます。

## 広域マップ (フリーローム) モード

1 本のコースではなく、ある地域の道路網をまるごと走れるマップを作ります。
例: `config/honjo_chichibu.json` (埼玉県 本庄市〜秩父郡 皆野・長瀞・小鹿野・東秩父・横瀬、約 24km × 35km)

![長瀞上空](docs/preview_nagatoro.jpg)
![皆野の道路](docs/preview_minano.jpg)

![本庄駅周辺](docs/preview_honjo.jpg)
![長瀞の町](docs/preview_town.jpg)
![本庄の道路 (電柱・電線)](docs/preview_street.jpg)

生成結果の目安 (この例): 道路 1,557 km / 建物 27.4 万棟 / 木 15 万本 / 信号 1,434 / 電柱 2.1 万本 /
ガードレール 82 km、合計約 1,170 万頂点。生成に約 8 分 + Blender 1 分 (初回はダウンロード込みでさらに 30 分ほど)。

```bash
python tools/fetch_osm.py       config/honjo_chichibu.json   # 道路・建物・信号など (OSM)
python tools/fetch_dem.py       config/honjo_chichibu.json   # 標高
python tools/fetch_buildings.py config/honjo_chichibu.json   # 建物 (地理院ベクトルタイル。OSM に無い建物を補う)
MAPILLARY_TOKEN=MLY|xxxx python tools/fetch_mapillary.py config/honjo_chichibu.json   # 任意
python tools/build_region.py    config/honjo_chichibu.json
blender -b -P blender/import_to_blender.py -- out/honjo_chichibu/build
```

| 項目 | 説明 |
| --- | --- |
| `highway` | 入れる道路の種別。`unclassified` (市町村道) や `residential` を足すと細い道も入るが重くなる |
| `start` | スポーン位置 (緯度経度)。近くの道路にピットとグリッドが並ぶ |
| `terrain.cell_m` | 地形の細かさ。広域なので 20m 程度 (小さくすると頂点数が急増) |
| `terrain.chunk_cells` | 地形を何マスごとに分けるか。1 チャンクに航空写真 1 枚 |
| `photo.zoom` / `photo.tex_size` | 航空写真の解像度。17 / 2048 にすると綺麗だがダウンロードと容量が 4 倍 |
| `buildings.max_distance_from_road` | 道路からこの距離 [m] 以内の建物だけ置く (遠くまで置くと重い) |
| `trees.spacing_m` / `band_m` / `max_count` | 木の間隔、道路からの距離の範囲 [m]、本数の上限 |
| `details.*` | 歩道・ガードレール・街灯・標識・電柱をそれぞれ ON/OFF |

### 入るもの

| もの | 情報源 | 内容 |
| --- | --- | --- |
| 道路 | OSM | 交差点ごとに区間に分け、交差点の高さを共有 (段差なし)。車線数・一方通行・追越し禁止から白線 / 黄色線を描き分け |
| 橋・トンネル | OSM | 橋は両端を結んで欄干付き。トンネルは**山に穴を開けない** (中に入ると空が見える) |
| 地形 | 地理院 標高 + 航空写真 | 道路の周りは道路の高さに合わせて削る / 盛る |
| 建物 | OSM + 地理院ベクトルタイル | 形はそのまま、高さは階数タグか種類から。小さい長方形の家は切妻の瓦屋根 |
| 木 | 地理院 航空写真 | 道路から見える帯の中で、写真が濃い緑の所に杉 / 広葉樹 |
| 歩道 | OSM `sidewalk=*` | 高さ 15cm の縁石付き (OSM に描かれている所だけ) |
| ガードレール | 地形 + OSM | 路肩の外が 3m 以上落ち込む所 (山道の谷側) と OSM の `barrier=guard_rail` に白いガードレール |
| 信号 | OSM (+ Mapillary) | 日本式の横型 3 灯を両方向に |
| 電柱・電線 | OSM / Mapillary / 自動 | 位置が分かればそこに、無ければ町の中の道路の片側に 35m おき |
| 標識 | OSM `maxspeed`・`highway=stop` (+ Mapillary) | 速度制限と止まれ |
| 街灯 | OSM / Mapillary | 位置が分かる所だけ |

Google ストリートビューは利用規約で地図データの作成に使うことが禁止されているので使いません。
道路写真からの情報が欲しいときは、オープンライセンスの [Mapillary](https://www.mapillary.com/) を使います
(`tools/fetch_mapillary.py`、無料のアクセストークンが必要)。

### 出力と KsEditor での設定

広域モードは重くなるので 3 つの FBX に分けて書き出し、`models.ini` でまとめて読み込みます。

| FBX | 中身 | 物理 |
| --- | --- | --- |
| `<id>.fbx` | 地形・道路・歩道・ガードレール・スタート位置 | あり |
| `<id>_objects.fbx` | 建物・電柱・電線・信号・標識 | なし (見た目だけ) |
| `<id>_trees.fbx` | 木 | なし |

それぞれ KsEditor で同じ名前の `.kn5` にしてトラックフォルダに入れてください。
マテリアル `tree`・`guardrail_jp`・`signs` は透明部分があるので、シェーダーを **ksPerPixelAT** にします。

## うまくいかないとき

- **車が逆向きに出てくる** → `blender/import_to_blender.py` の `FLIP_START_DIRECTION = True` にして再実行
- **路面がガタガタ** → `elevation_smooth_m` を 60〜100 に
- **地形が道路を突き抜ける / 崖が不自然** → `terrain.cell_m` を小さく、`terrain.corridor_m` を大きく
- **違う道が選ばれる** → `fetch_osm.py` が表示する道路名を見て `name_regex` を調整、または `way_ids` で直接指定
  (way ID は openstreetmap.org で道路をクリックすると分かります)
- **頂点が多すぎて重い** → `terrain.cell_m` / `terrain.margin_m` を調整

## ライセンス・出典表記

配布する場合は以下の表記が必要です。

- 道路・建物データ: © OpenStreetMap contributors (ODbL)
- 標高・航空写真・建物: 国土地理院 (標高タイル / 全国最新写真 (シームレス) / ベクトルタイル)
- Mapillary を使った場合: © Mapillary (CC BY-SA)
