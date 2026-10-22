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

生成結果の目安 (この例): 道路 1,557 km / 橋 595 / 地形 3.8M 頂点 / 航空写真 234 枚 (約 440MB の PNG)、
生成に約 10 分 (初回はダウンロード込み)。

```bash
python tools/fetch_osm.py  config/honjo_chichibu.json
python tools/fetch_dem.py  config/honjo_chichibu.json
python tools/build_region.py config/honjo_chichibu.json
blender -b -P blender/import_to_blender.py -- out/honjo_chichibu/build
```

| 項目 | 説明 |
| --- | --- |
| `highway` | 入れる道路の種別。`unclassified` (市町村道) や `residential` を足すと細い道も入るが重くなる |
| `start` | スポーン位置 (緯度経度)。近くの道路にピットとグリッドが並ぶ |
| `terrain.cell_m` | 地形の細かさ。広域なので 20m 程度 (小さくすると頂点数が急増) |
| `terrain.chunk_cells` | 地形を何マスごとに分けるか。1 チャンクに航空写真 1 枚 |
| `photo.zoom` / `photo.tex_size` | 航空写真の解像度。17 / 2048 にすると綺麗だがダウンロードと容量が 4 倍 |

- 道路は交差点ごとに区間に分け、交差点の高さを共有するので段差ができません
- 橋 (`bridge=*`) は地形に沿わせず両端を結び、欄干の壁を付けます
- トンネル (`tunnel=*`) も両端を直線で結びますが、**山に穴は開けません** (中に入ると空が見えます)
- 地形には国土地理院の航空写真 (全国最新写真・シームレス) を貼ります
- 信号・建物・木・白線の車線分けはまだありません

## うまくいかないとき

- **車が逆向きに出てくる** → `blender/import_to_blender.py` の `FLIP_START_DIRECTION = True` にして再実行
- **路面がガタガタ** → `elevation_smooth_m` を 60〜100 に
- **地形が道路を突き抜ける / 崖が不自然** → `terrain.cell_m` を小さく、`terrain.corridor_m` を大きく
- **違う道が選ばれる** → `fetch_osm.py` が表示する道路名を見て `name_regex` を調整、または `way_ids` で直接指定
  (way ID は openstreetmap.org で道路をクリックすると分かります)
- **頂点が多すぎて重い** → `terrain.cell_m` / `terrain.margin_m` を調整

## ライセンス・出典表記

配布する場合は以下の表記が必要です。

- 道路データ: © OpenStreetMap contributors (ODbL)
- 標高データ: 国土地理院 標高タイル
