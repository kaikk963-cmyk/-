# OpenTaiko（TJAPlayer3系）の Android ビルド

[OpenTaiko](https://github.com/0auBSQ/OpenTaiko)（TJAPlayer3-Develop-ReWrite の後継・MIT ライセンス）を
Android 用 APK にビルドする仕組みです。OpenTaiko にはすでに Android 版のコード（`OpenTaiko.Android`）が
入っていますが、上流のビルド手順は Windows（PowerShell）専用なので、Linux / GitHub Actions 用に作り直しています。

- `opentaiko-android/build.sh` … ビルドスクリプト（ソース取得 → BASS・FFmpeg 取得 → APK 作成）
- `.github/workflows/opentaiko-android.yml` … GitHub Actions でビルドし、APK を Releases に置く

### APK の入手

スマホのブラウザでこのリンクを開くと、最新版の APK（約 580MB）が直接ダウンロードされます（GitHub ログイン不要）:

https://github.com/kaikk963-cmyk/-/releases/latest/download/OpenTaiko-android-arm64.apk

過去の版はリポジトリの **Releases** ページにあります。

### 端末での使い方

- 初回起動時にゲームデータ（約 600MB）を展開するので、空き容量は 1.5GB 以上あると安心です。
- 曲は同梱されていません。初回起動時に公式サウンドトラックのダウンロードを提案されます。
  自分の譜面は `Android/data/com.opentaiko.OpenTaiko/files/Songs/` に置きます（USB 接続で見えます）。
- 操作はタッチ（画面の太鼓エリア：中央がドン、左右がカッ）または外付けキーボード。

### 主な設定（build.sh の環境変数）

| 変数 | 既定 | 内容 |
|---|---|---|
| `OPENTAIKO_REF` | 検証済みの固定コミット | ビルドする OpenTaiko のバージョン |
| `ABIS` | `arm64` | `arm64`＝実機専用（小さい） / `all`＝エミュレータ用 x86_64 も含む |

音声ライブラリ BASS（un4seen.com）は非商用なら無料のライセンスです。個人利用の範囲で使ってください。

---

# ネームプレートエディタ（Android）

TJAPlayer3-Develop-ReWrite で使う `NamePlate.json` を、Android 上で作成・編集するアプリです。
Windows 用ツール「NamePlate to JSON」（作者: 東方好きのren君 / touhou-renren 様）と同じ形式の JSON を出力します。

> 本アプリは研究・個人利用を目的とした **非公式の再実装** です。元ツールのコードや画像は含んでいません。
> 元ツールの作者様とは関係ありませんので、本アプリについて元作者様へ問い合わせないでください。

## できること

- 1P / 2P それぞれの「名前」「称号」「称号の種類（木・金・紫）」「段位」「段位背景の種類（白・金・虹）」「金合格」を入力
- プレビュー表示（`NamePlate.png` を選ぶと実際の画像で表示。未選択時は簡易表示）
- `NamePlate.json` として保存（元ツールと同じ形式：2スペースインデント・CRLF・UTF-8）
- 既存の `NamePlate.json` の読み込み
- 入力内容と選んだ画像は次回起動時も復元

文字の表示位置は目安です。元ツールのプレビューは文字を描画しないため、ゲーム内の見た目とは多少ずれます。

## 使い方

1. APK をインストールして起動
2. （任意）「プレビュー用の NamePlate.png を選ぶ」で、手元の `NamePlate.png` を選択
3. 1P / 2P タブで内容を入力
4. 「ネームプレートをJSONに変換して保存」で `NamePlate.json` を保存
5. 保存したファイルを TJAPlayer3-Develop-ReWrite の `NamePlate.json` と置き換える

## 出力される JSON

```json
{
  "name": ["1P の名前", "2P の名前"],
  "title": ["1P の称号", "2P の称号"],
  "dan": ["1P の段位", "2P の段位"],
  "danGold": [false, false],
  "danType": [0, 0],
  "titleType": [0, 0]
}
```

`danType`: 0=白, 1=金, 2=虹 ／ `titleType`: 0=木, 1=金, 2=紫（実際の出力は1要素ごとに改行されます）

## ビルド

- JDK 17 以上と Android SDK（API 35）が必要です
- `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`
- release ビルドも個人利用向けにデバッグ鍵で署名しています（そのままインストール可能）
- GitHub に push すると Actions でビルドされ、Artifacts から APK をダウンロードできます
