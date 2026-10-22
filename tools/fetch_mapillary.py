"""(任意) Mapillary の道路写真から検出された物体を取得して data/<track_id>/mapillary.json に保存する。

使い方:
    MAPILLARY_TOKEN=MLY|xxxx python tools/fetch_mapillary.py config/honjo_chichibu.json

Mapillary はストリートビューのような道路写真の共有サービス (CC BY-SA)。写真から自動検出された
信号・街灯・電柱・速度制限 / 一時停止の標識の位置を使い、OSM に無い所を補う。
アクセストークンは https://www.mapillary.com/dashboard/developers でアプリを登録すると無料で発行される。
(Google ストリートビューは利用規約で地図データの作成に使うことが禁止されているので使わない)
"""
import argparse
import json
import os
import sys
from pathlib import Path

import requests

API = "https://graph.mapillary.com/map_features"
LIMIT = 2000
WANT = ("object--traffic-light", "object--street-light", "object--support--utility-pole",
        "regulatory--maximum-speed-limit", "regulatory--stop")


def query(bbox, token, depth=0):
    """bbox = (西, 南, 東, 北)。上限まで返ってきたら 4 分割して取り直す。"""
    r = requests.get(API, params={"access_token": token, "fields": "id,object_value,geometry",
                                  "bbox": ",".join(f"{v:.6f}" for v in bbox), "limit": LIMIT}, timeout=120)
    if r.status_code in (400, 500) and depth < 6:  # 範囲が広すぎる
        return split(bbox, token, depth)
    r.raise_for_status()
    data = r.json().get("data", [])
    if len(data) >= LIMIT and depth < 6:
        return split(bbox, token, depth)
    return data


def split(bbox, token, depth):
    w, s, e, n = bbox
    mx, my = (w + e) / 2, (s + n) / 2
    out = []
    for b in ((w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)):
        out += query(b, token, depth + 1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    ap.add_argument("--token", default=os.environ.get("MAPILLARY_TOKEN"))
    args = ap.parse_args()
    if not args.token:
        sys.exit("Mapillary のアクセストークンを MAPILLARY_TOKEN か --token で指定してください。")
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    out_dir = Path("data") / cfg["track_id"]
    out_dir.mkdir(parents=True, exist_ok=True)

    s, w, n, e = cfg["bbox"]
    step = 0.05
    feats, seen = [], set()
    rows, cols = int((n - s) / step) + 1, int((e - w) / step) + 1
    for i in range(rows):
        for j in range(cols):
            b = (w + j * step, s + i * step, min(w + (j + 1) * step, e), min(s + (i + 1) * step, n))
            print(f"Mapillary {i * cols + j + 1}/{rows * cols}")
            for f in query(b, args.token):
                val = f.get("object_value", "")
                if f["id"] in seen or not val.startswith(WANT):
                    continue
                seen.add(f["id"])
                lon, lat = f["geometry"]["coordinates"]
                feats.append({"value": val, "lat": lat, "lon": lon})
    (out_dir / "mapillary.json").write_text(json.dumps(feats, ensure_ascii=False), encoding="utf-8")
    kinds = {}
    for f in feats:
        k = f["value"].split("--")[1]
        kinds[k] = kinds.get(k, 0) + 1
    print(f"{len(feats)} 個 -> {out_dir / 'mapillary.json'}  {kinds}")


if __name__ == "__main__":
    main()
