# 釘配置図から盤面を作る

`app/board.js` の釘・レール・入賞口の位置は、実機の釘配置図（画像）から作っている。画像そのものはリポジトリに入れていない。

1. `python3 detect_nails.py 図.png 確認用.png nails.json 0.55` … 図の小さな丸（釘）を見本照合で探して、座標を書き出す
2. `python3 gen_board.py nails.json > geom.json` … 図の座標を盤面の座標（幅300）に一様な縮尺で写し、外枠・ワープ・ステージ・右の通路・アタッカー・電チュー・入賞口の位置もまとめる
3. geom.json の値を `app/board.js` の定数に入れる

`nails.json` はこの盤面で使っている読み取り結果。
