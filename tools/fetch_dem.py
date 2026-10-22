"""国土地理院の標高タイル (PNG) を取得して data/<track_id>/dem_<layer>.npz に保存する。

使い方:
    python tools/fetch_dem.py config/hakone_turnpike.json

標高タイルの仕様: https://maps.gsi.go.jp/development/demtile.html
出典表記: 「国土地理院 標高タイル」を利用したことを配布時に明記すること。
"""
import argparse
import io
import json
import math
from pathlib import Path

import numpy as np
import requests
from PIL import Image

GSI_URL = "https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{x}/{y}.png"
MAX_ZOOM = {"dem5a_png": 15, "dem5b_png": 15, "dem5c_png": 15, "dem_png": 14}
TILE = 256


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def decode_png(img):
    """RGB -> 標高[m]。無効値 (128,0,0) と透明部分は NaN。"""
    a = np.asarray(img.convert("RGBA"), dtype=np.int64)
    x = a[..., 0] * 65536 + a[..., 1] * 256 + a[..., 2]
    h = np.where(x < 2 ** 23, x, x - 2 ** 24).astype(np.float64) * 0.01
    h[(x == 2 ** 23) | (a[..., 3] == 0)] = np.nan
    return h


def fetch_tile(layer, z, x, y, cache_dir):
    path = cache_dir / layer / str(z) / str(x) / f"{y}.png"
    if path.exists():
        return Image.open(path)
    r = requests.get(GSI_URL.format(layer=layer, z=z, x=x, y=y), timeout=60)
    if r.status_code == 404:  # データの無いタイル (海など)
        return None
    r.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(r.content)
    return Image.open(io.BytesIO(r.content))


def fetch_layer(layer, zoom, bbox, cache_dir):
    s, w, n, e = bbox
    z = min(zoom, MAX_ZOOM.get(layer, zoom))
    x0, y0 = lonlat_to_tile(w, n, z)
    x1, y1 = lonlat_to_tile(e, s, z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    mosaic = np.full(((ty1 - ty0 + 1) * TILE, (tx1 - tx0 + 1) * TILE), np.nan)
    count = (tx1 - tx0 + 1) * (ty1 - ty0 + 1)
    print(f"{layer} z{z}: {count} タイル")
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            img = fetch_tile(layer, z, tx, ty, cache_dir)
            if img is None:
                continue
            oy, ox = (ty - ty0) * TILE, (tx - tx0) * TILE
            mosaic[oy:oy + TILE, ox:ox + TILE] = decode_png(img)
    return {"heights": mosaic, "zoom": z, "tile_x0": tx0, "tile_y0": ty0}


def expand_bbox(bbox, margin_m):
    s, w, n, e = bbox
    dlat = margin_m / 111_320.0
    dlon = margin_m / (111_320.0 * math.cos(math.radians((s + n) / 2)))
    return [s - dlat, w - dlon, n + dlat, e + dlon]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    out_dir = Path("data") / cfg["track_id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    bbox = expand_bbox(cfg["bbox"], cfg["terrain"]["margin_m"] + 100)

    for layer in cfg["dem"]["layers"]:
        d = fetch_layer(layer, cfg["dem"]["zoom"], bbox, Path("data") / "dem_cache")
        np.savez_compressed(out_dir / f"dem_{layer}.npz", **d)
        valid = np.isfinite(d["heights"]).mean() * 100
        print(f"  -> {out_dir / f'dem_{layer}.npz'} (有効データ {valid:.0f}%)")


if __name__ == "__main__":
    main()
