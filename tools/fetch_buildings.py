"""国土地理院ベクトルタイルから建物の形を取得して data/<track_id>/buildings_gsi.json に保存する。

使い方:
    python tools/fetch_buildings.py config/honjo_chichibu.json

OSM は地域によって建物がほとんど描かれていないので、全国の建物 (基盤地図情報) が入っている
地理院ベクトルタイル (experimental_bvmap, z16) で補う。OSM にある建物はそちらを優先する。
出典表記: 「国土地理院ベクトルタイル」
"""
import argparse
import json
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import mapbox_vector_tile as mvt
import requests

URL = "https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf"
Z = 16


def tile_range(bbox):
    s, w, n, e = bbox
    n_ = 2 ** Z

    def tx(lon):
        return int((lon + 180) / 360 * n_)

    def ty(lat):
        return int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n_)

    return range(tx(w), tx(e) + 1), range(ty(n), ty(s) + 1)


def fetch(x, y, cache):
    path = cache / str(Z) / str(x) / f"{y}.pbf"
    if not path.exists():
        for attempt in range(4):
            try:
                r = requests.get(URL.format(z=Z, x=x, y=y), timeout=60)
                break
            except requests.RequestException:
                if attempt == 3:
                    raise
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content if r.ok else b"")
    data = path.read_bytes()
    return mvt.decode(data, default_options={"y_coord_down": True}) if data else {}


def clip_ring(ring, lo=0, hi=4096):
    """タイル外にはみ出した部分を切る (隣のタイルと重ならないように)。Sutherland-Hodgman 法。"""
    pts = ring
    for axis in (0, 1):
        for bound, keep in ((lo, lambda v: v >= lo), (hi, lambda v: v <= hi)):
            out = []
            for i, cur in enumerate(pts):
                prev = pts[i - 1]
                if keep(cur[axis]):
                    if not keep(prev[axis]):
                        out.append(_cross(prev, cur, axis, bound))
                    out.append(cur)
                elif keep(prev[axis]):
                    out.append(_cross(prev, cur, axis, bound))
            pts = out
            if not pts:
                return []
    return pts


def _cross(a, b, axis, bound):
    t = (bound - a[axis]) / (b[axis] - a[axis])
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]


def to_latlon(px, py, x, y):
    n_ = 2 ** Z
    lon = (x + px / 4096) / n_ * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / 4096) / n_))))
    return lat, lon


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    args = ap.parse_args()
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    out_dir = Path("data") / cfg["track_id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    xs, ys = tile_range(cfg["bbox"])
    keys = [(x, y) for y in ys for x in xs]
    print(f"地理院ベクトルタイル z{Z}: {len(keys)} タイル")
    cache = Path("data") / "bvmap_cache"
    with ThreadPoolExecutor(8) as ex:
        tiles = list(ex.map(lambda k: fetch(k[0], k[1], cache), keys))

    result = []
    for (x, y), layers in zip(keys, tiles):
        for f in layers.get("building", {}).get("features", []):
            g = f["geometry"]
            polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
            for poly in polys:
                ring = clip_ring(poly[0])  # 外周だけ使う (中庭は無視)
                if len(ring) >= 3:
                    result.append({"ft": f["properties"].get("ftCode", 3101),
                                   "ring": [to_latlon(px, py, x, y) for px, py in ring]})
    (out_dir / "buildings_gsi.json").write_text(json.dumps(result), encoding="utf-8")
    print(f"建物 {len(result)} 棟 -> {out_dir / 'buildings_gsi.json'}")


if __name__ == "__main__":
    main()
