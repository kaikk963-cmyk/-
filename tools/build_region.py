"""広域マップ (道路網 + 航空写真つき地形) を作る。1 本道のコースは build_track.py を使う。

使い方:
    python tools/fetch_osm.py config/honjo_chichibu.json
    python tools/fetch_dem.py config/honjo_chichibu.json
    python tools/build_region.py config/honjo_chichibu.json

build_track.py と同じく out/<track_id>/build/ に track.obj / markers.json / texture/ を、
out/<track_id>/<track_id>/ にトラックフォルダの雛形を書き出す。
地形の航空写真は地理院の「全国最新写真 (シームレス)」をチャンクごとに貼る。
"""
import argparse
import json
import math
import re
import shutil
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

from build_track import (MAX_VERTS, SURFACES_INI, DemSampler, Mesh, Projection, frames,
                         make_textures, resample, smooth, write_map, write_obj)
from fetch_dem import fetch_tiles
from kn5 import write_track_kn5s
from region_details import TerrainGrid, TriBucket, build_details, road_material

# 道路種別ごとの既定の幅 [m] と重なり順 (交差点で上に来る方が大きい)
ROAD_CLASSES = {
    "motorway": (9.0, 6), "trunk": (8.0, 5), "primary": (7.0, 4),
    "secondary": (6.5, 3), "tertiary": (5.5, 2), "unclassified": (4.5, 1), "residential": (4.0, 1),
    "living_street": (3.5, 1), "road": (4.0, 1), "service": (3.0, 0), "track": (2.8, 0),
}
LINK_WIDTH = 5.0


def road_class(tags):
    hw = tags.get("highway", "")
    base = hw[:-5] if hw.endswith("_link") else hw
    width, rank = ROAD_CLASSES.get(base, (4.0, 0))
    if hw.endswith("_link"):
        width, rank = LINK_WIDTH, rank - 0.5
    m = re.match(r"\s*([\d.]+)", tags.get("width", ""))
    if m and 3 <= float(m.group(1)) <= 25:
        width = float(m.group(1))
    elif tags.get("lanes", "").isdigit():
        lanes = int(tags["lanes"])
        width = lanes * 3.25 + (1.5 if base in ("motorway", "trunk") else 0.5)
    return width, rank


# --------------------------------------------------------------------------- 道路網

def load_segments(osm, cfg):
    """対象の道路を「交差点〜交差点」の区間に分割して返す。

    区間の端は必ず交差点か道の終わりなので、端の高さを共有すれば
    交差点で道路同士の高さがずれない。"""
    s, w, n, e = cfg["bbox"]
    nodes = {el["id"]: (el["lat"], el["lon"]) for el in osm["elements"] if el["type"] == "node"}
    inside = {k for k, (la, lo) in nodes.items() if s <= la <= n and w <= lo <= e}
    classes = set(cfg["highway"])
    ways = [el for el in osm["elements"] if el["type"] == "way"
            and el["tags"].get("highway") in classes and el["tags"].get("area") != "yes"]

    use = Counter()
    for wy in ways:
        nd = [k for k in wy["nodes"] if k in nodes]
        use.update(nd)
        use.update([nd[0], nd[-1]])  # 道の端も区間の切れ目にする

    segs = []
    for wy in ways:
        run = []
        for k in wy["nodes"] + [None]:
            if k is not None and k in inside:
                run.append(k)
                if use[k] > 1 and len(run) > 1:
                    segs.append({"nodes": run, "tags": wy["tags"], "way": wy["id"]})
                    run = [k]
            else:  # 範囲外に出たところで切る
                if len(run) > 1:
                    segs.append({"nodes": run, "tags": wy["tags"], "way": wy["id"]})
                run = []
    for sg in segs:
        sg["latlon"] = np.array([nodes[k] for k in sg["nodes"]])
    print(f"道路 {len(ways)} 本 -> 区間 {len(segs)} 個")
    return segs


def node_heights(segs, proj, dem):
    """区間の端点 (交差点) の高さ。DEM の細かい凸凹を拾わないよう周囲 8m を平均する。"""
    ends = {}
    for sg in segs:
        for k, ll in ((sg["nodes"][0], sg["latlon"][0]), (sg["nodes"][-1], sg["latlon"][-1])):
            ends[k] = ll
    keys = list(ends)
    ll = np.array([ends[k] for k in keys])
    x, y = proj.to_xy(ll[:, 0], ll[:, 1])
    offs = [(dx, dy) for dx in (-8, 0, 8) for dy in (-8, 0, 8)]
    hs = []
    for dx, dy in offs:
        la, lo = proj.to_latlon(x + dx, y + dy)
        hs.append(dem(la, lo))
    h = np.nanmean(np.array(hs), axis=0)
    return dict(zip(keys, h))


def build_segment_geometry(sg, proj, dem, zn, cfg):
    step = cfg["resample_step"]
    xy = np.column_stack(proj.to_xy(sg["latlon"][:, 0], sg["latlon"][:, 1]))
    c = resample(xy, step)
    if len(c) > 7:  # OSM の折れ線をならす。端は交差点に合わせて固定
        sm = smooth(c, max(int(12 / step), 1) | 1, False)
        sm[0], sm[-1] = c[0], c[-1]
        c = resample(sm, step)
    seg_s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))])
    z0, z1 = zn[sg["nodes"][0]], zn[sg["nodes"][-1]]
    t = seg_s / max(seg_s[-1], 1e-6)
    tags = sg["tags"]
    sg["bridge"] = tags.get("bridge", "no") not in ("no", "") or tags.get("man_made") == "bridge"
    sg["tunnel"] = tags.get("tunnel", "no") not in ("no", "")
    if sg["bridge"] or sg["tunnel"]:
        z = z0 + (z1 - z0) * t  # 橋・トンネルは地面に沿わせず両端を直線で結ぶ
    else:
        la, lo = proj.to_latlon(c[:, 0], c[:, 1])
        z = dem(la, lo)
        good = ~np.isnan(z)
        z = np.interp(seg_s, seg_s[good], z[good]) if good.any() else z0 + (z1 - z0) * t
        z = smooth(z, max(int(cfg["elevation_smooth_m"] / step), 1) | 1, False)
        z += (z0 - z[0]) * (1 - t) + (z1 - z[-1]) * t
    sg["center"], sg["z"], sg["s"] = c, z, seg_s
    sg["width"], sg["rank"] = road_class(tags)


class Bucket:
    """同じ名前・マテリアルのメッシュを、頂点数の上限ごとに分けてためる。"""

    def __init__(self, prefix, material):
        self.prefix, self.material, self.meshes = prefix, material, []

    def add(self, verts, uvs):
        rows, cols = verts.shape[:2]
        per = MAX_VERTS // cols
        for start in range(0, rows - 1, per - 1):
            v, uv = verts[start:start + per], uvs[start:start + per]
            if not self.meshes or self.meshes[-1].count + v.shape[0] * cols > MAX_VERTS:
                self.meshes.append(Mesh(f"{self.prefix}_{len(self.meshes):03d}", self.material))
            self.meshes[-1].add_grid(v, uv)


def grid_faces(rows, cols):
    idx = np.arange(rows * cols).reshape(rows, cols)
    a, b = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel()
    c, d = idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
    return np.vstack([np.stack([a, b, c], 1), np.stack([a, c, d], 1)])


def keep_points(c, z, tol=0.03, max_gap=12):
    """路面メッシュ用に、直線部分の点を間引いた添字 (3D の Douglas-Peucker)。
    max_gap 点以上は空けない (地形との段差やテクスチャの伸びを防ぐ)。"""
    p = np.column_stack([c, z])
    keep = np.zeros(len(p), dtype=bool)
    keep[[0, -1]] = True
    stack = [(0, len(p) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        d = p[b] - p[a]
        L = np.linalg.norm(d)
        rel = p[a + 1:b] - p[a]
        dist = np.linalg.norm(np.cross(rel, d), axis=1) / L if L > 1e-9 else np.linalg.norm(rel, axis=1)
        i = int(dist.argmax())
        if dist[i] > tol:
            k = a + 1 + i
        elif b - a > max_gap:
            k = (a + b) // 2
        else:
            continue
        keep[k] = True
        stack += [(a, k), (k, b)]
    return np.nonzero(keep)[0]


def build_roads(segs, z_base, tex_dir, chunk_of):
    """路面 (車線・中央線の入ったテクスチャ) と橋の欄干。場所ごとにメッシュを分ける。"""
    out, made = TriBucket(chunk_of), set()
    for i, sg in enumerate(segs):
        if len(sg["center"]) < 2:
            continue
        # 交差点で重なる面がちらつかないよう、格の高い道路をわずかに上げる
        sg["lift"] = 0.012 * sg["rank"] + 0.003 * (i % 3)
        _, left = frames(sg["center"], False)
        k = keep_points(sg["center"], sg["z"])
        c, s_, left = sg["center"][k], sg["s"][k], left[k]
        half = sg["width"] / 2
        zz = sg["z"][k] - z_base + sg["lift"]
        mid = c[len(c) // 2]
        for start in range(0, len(c) - 1, MAX_VERTS // 2 - 1):
            sl = slice(start, start + MAX_VERTS // 2)
            v = np.stack([np.column_stack([c[sl] + left[sl] * half, zz[sl]]),
                          np.column_stack([c[sl] - left[sl] * half, zz[sl]])], axis=1)
            uv = np.stack([np.column_stack([np.zeros_like(s_[sl]), s_[sl] / 10]),
                           np.column_stack([np.ones_like(s_[sl]), s_[sl] / 10])], axis=1)
            out.add("1ROAD", road_material(sg, tex_dir, made), mid[0], mid[1],
                    v.reshape(-1, 3), uv.reshape(-1, 2), grid_faces(len(v), 2))
        if sg["bridge"]:  # 橋には欄干 (コリジョン壁) を付ける
            for side in (1, -1):  # 面が道路の内側を向く順に並べる
                p = c + left * half * side
                lo_, hi_ = np.column_stack([p, zz - 0.05]), np.column_stack([p, zz + 1.0])
                v = np.stack((hi_, lo_) if side > 0 else (lo_, hi_), axis=1)
                uv = np.stack([np.column_stack([np.zeros_like(s_), s_ / 4]),
                               np.column_stack([np.ones_like(s_), s_ / 4])], axis=1)
                out.add("1WALL", "guardrail", mid[0], mid[1], v.reshape(-1, 3), uv.reshape(-1, 2),
                        grid_faces(len(v), 2))
    print(f"路面テクスチャ {len(made)} 種類 (車線数・幅ごと)")
    return out.all()


# --------------------------------------------------------------------------- 地形

def merc_px(lat, lon, z):
    n = 256 * 2 ** z
    return ((lon + 180.0) / 360.0 * n,
            (1.0 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2.0 * n)


def photo_texture(lat, lon, pcfg, cache_dir, out_path):
    """チャンクの範囲の航空写真を切り出して保存し、各頂点の UV を返す。"""
    z = pcfg["zoom"]
    px, py = merc_px(lat, lon, z)
    x0, x1, y0, y1 = px.min(), px.max(), py.min(), py.max()
    tx = range(int(x0 // 256), int(x1 // 256) + 1)
    ty = range(int(y0 // 256), int(y1 // 256) + 1)
    tiles = fetch_tiles(pcfg["layer"], z, tx, ty, cache_dir, ext="jpg")
    mosaic = Image.new("RGB", (len(tx) * 256, len(ty) * 256), (96, 110, 80))
    for (x, y), img in tiles.items():
        if img is not None:
            mosaic.paste(img.convert("RGB"), ((x - tx[0]) * 256, (y - ty[0]) * 256))
    ox, oy = tx[0] * 256, ty[0] * 256
    crop = mosaic.crop((int(x0 - ox), int(y0 - oy), int(math.ceil(x1 - ox)), int(math.ceil(y1 - oy))))
    size = pcfg["tex_size"]
    crop.resize((size, size), Image.LANCZOS).save(out_path)
    cx0, cy0 = int(x0 - ox) + ox, int(y0 - oy) + oy
    cw, ch = crop.size

    def uv(la, lo):  # 緯度経度 -> この写真の UV
        qx, qy = merc_px(la, lo, z)
        return (qx - cx0) / cw, 1.0 - (qy - cy0) / ch

    u, v = uv(lat, lon)
    return np.stack([u, v], axis=-1), uv


def build_terrain(cfg, proj, dem, segs, z_base, tex_dir):
    tc = cfg["terrain"]
    cell, corridor, chunk = tc["cell_m"], tc["corridor_m"], tc["chunk_cells"]
    s, w, n, e = cfg["bbox"]
    cx, cy = proj.to_xy(np.array([s, s, n, n]), np.array([w, e, w, e]))
    x0, x1, y0, y1 = cx.min(), cx.max(), cy.min(), cy.max()
    xs = np.arange(x0, x1 + cell, cell)
    ys = np.arange(y0, y1 + cell, cell)
    gx, gy = np.meshgrid(xs, ys)
    lat, lon = proj.to_latlon(gx, gy)
    print(f"地形: {len(xs)} x {len(ys)} 頂点 ({(x1 - x0) / 1000:.1f} km x {(y1 - y0) / 1000:.1f} km)")
    h = dem(lat.ravel(), lon.ravel()).reshape(gx.shape) - z_base
    h = np.where(np.isnan(h), np.nanmin(h), h)

    # 道路の周りを道路の高さに合わせて削る / 盛る (橋とトンネルの下はそのまま)
    dist = np.full(gx.shape, np.inf)
    rz = np.zeros(gx.shape)
    under = np.full(gx.shape, np.inf)
    r = int(math.ceil(corridor / cell)) + 1
    for sg in segs:
        if sg["bridge"] or sg["tunnel"]:
            continue
        stride = max(int(cell / 2 / cfg["resample_step"]), 1)
        idx = np.unique(np.r_[np.arange(0, len(sg["center"]), stride), len(sg["center"]) - 1])
        flat = sg["width"] / 2 + cell * 0.75
        for (px, py), pz in zip(sg["center"][idx], sg["z"][idx] - z_base):
            ix, iy = int((px - x0) / cell), int((py - y0) / cell)
            if not (-r <= ix < len(xs) + r and -r <= iy < len(ys) + r):
                continue
            sl = (slice(max(iy - r, 0), iy + r + 1), slice(max(ix - r, 0), ix + r + 1))
            d = np.hypot(gx[sl] - px, gy[sl] - py)
            better = d < dist[sl]
            dist[sl] = np.where(better, d, dist[sl])
            rz[sl] = np.where(better, pz, rz[sl])
            under[sl] = np.where(d <= flat, np.minimum(under[sl], pz), under[sl])
    near = np.isfinite(under)
    t = np.clip((dist - cell) / max(corridor - cell, 1e-3), 0, 1)
    t = t * t * (3 - 2 * t)
    blended = (rz - 0.3) * (1 - t) + h * t
    h = np.where(near, under - 0.3, blended)

    meshes, textures, photos = [], {}, {}
    rows = range(0, len(ys) - 1, chunk)
    cols = range(0, len(xs) - 1, chunk)
    total = len(rows) * len(cols)
    for ci, r0 in enumerate(rows):
        for cj, c0 in enumerate(cols):
            sl = (slice(r0, r0 + chunk + 1), slice(c0, c0 + chunk + 1))
            name = f"photo_{ci:02d}_{cj:02d}"
            print(f"\r航空写真 {ci * len(cols) + cj + 1}/{total}", end="", flush=True)
            uv, uv_fn = photo_texture(lat[sl], lon[sl], cfg["photo"], Path("data") / "photo_cache",
                                      tex_dir / f"{name}.png")
            m = Mesh(f"1GRASS_{ci:02d}_{cj:02d}", name)
            m.add_grid(np.stack([gx[sl], gy[sl], h[sl]], axis=2), uv)
            meshes.append(m)
            textures[name] = f"{name}.png"
            photos[(ci, cj)] = {"x0": xs[c0], "x1": xs[min(c0 + chunk, len(xs) - 1)],
                                "y0": ys[r0], "y1": ys[min(r0 + chunk, len(ys) - 1)],
                                "path": tex_dir / f"{name}.png", "uv": uv_fn}
    print()

    size = chunk * cell

    def chunk_of(x, y):
        return (min(max(int((y - y0) // size), 0), len(rows) - 1),
                min(max(int((x - x0) // size), 0), len(cols) - 1))

    return meshes, textures, TerrainGrid(x0, y0, cell, h), chunk_of, photos


# --------------------------------------------------------------------------- スタート位置

def place_markers(segs, proj, cfg, z_base):
    """config の start に一番近い、十分な長さのある道路区間にピットとグリッドを並べる。"""
    n_pit = cfg["pit_boxes"]
    rows = (n_pit + 1) // 2
    need = 10 + rows * 9 + 10 + rows * 8 + 25
    sx, sy = proj.to_xy(cfg["start"]["lat"], cfg["start"]["lon"])
    best = None
    for sg in segs:
        if sg["bridge"] or sg["tunnel"] or sg["s"][-1] < need or sg["rank"] < 1:
            continue  # 私道や林道にはスポーンさせない
        d = np.hypot(sg["center"][:, 0] - sx, sg["center"][:, 1] - sy)
        i = int(d.argmin())
        if best is None or d[i] < best[0]:
            best = (d[i], sg, i)
    if best is None:
        raise SystemExit("スタート位置を置ける道路がありません。start の位置を変えてください。")
    _, sg, i = best
    c, z, s_ = sg["center"], sg["z"] - z_base, sg["s"]
    tangent, left = frames(c, False)
    s0 = min(s_[i], s_[-1] - need)  # ここから need [m] 先までを使う
    name = sg["tags"].get("name", sg["tags"].get("ref", "名前なし"))
    print(f"スタート位置: {name} (指定地点から {best[0]:.0f} m)")
    half = sg["width"] / 2

    def at(dist, lateral=0.0, lift=0.5):
        k = int(np.clip(np.searchsorted(s_, s0 + dist), 0, len(s_) - 1))
        p = c[k] + left[k] * lateral
        return {"pos": [float(p[0]), float(p[1]), float(z[k] + lift)],
                "dir": [float(tangent[k][0]), float(tangent[k][1])]}

    m = {}
    for k in range(n_pit):  # 2 台ずつ横に並べる
        m[f"AC_PIT_{k}"] = at(10 + (k // 2) * 9, half * 0.45 * (1 if k % 2 else -1))
    grid0 = 10 + rows * 9 + 10
    for k in range(n_pit):
        m[f"AC_START_{k}"] = at(grid0 + (k // 2) * 8, half * 0.45 * (1 if k % 2 else -1))
    line = grid0 + rows * 8 + 15
    m["AC_HOTLAP_START_0"] = at(line - 10)
    for side, sign in (("L", 1), ("R", -1)):
        m[f"AC_TIME_0_{side}"] = at(line, (half + 1) * sign, 0)
        m[f"AC_TIME_1_{side}"] = at(need - 2, (half + 1) * sign, 0)
    return m


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    ap.add_argument("--obj", action="store_true", help="Blender で編集する用の track.obj も書き出す (大きい)")
    args = ap.parse_args()
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    tid = cfg["track_id"]
    data_dir = Path("data") / tid
    out = Path("out") / tid
    build, track_dir = out / "build", out / tid
    tex_dir = build / "texture"
    for d in (tex_dir, track_dir / "ui", track_dir / "data"):
        d.mkdir(parents=True, exist_ok=True)

    osm = json.loads((data_dir / "osm.json").read_text(encoding="utf-8"))
    dem = DemSampler([data_dir / f"dem_{l}.npz" for l in cfg["dem"]["layers"]
                      if (data_dir / f"dem_{l}.npz").exists()])
    s, w, n, e = cfg["bbox"]
    proj = Projection((s + n) / 2, (w + e) / 2)

    segs = load_segments(osm, cfg)
    zn = node_heights(segs, proj, dem)
    for sg in segs:
        build_segment_geometry(sg, proj, dem, zn, cfg)
    z_base = math.floor(min(sg["z"].min() for sg in segs)) - 5
    km = sum(sg["s"][-1] for sg in segs) / 1000
    print(f"道路の総延長 {km:.0f} km / 橋 {sum(sg['bridge'] for sg in segs)} / "
          f"トンネル {sum(sg['tunnel'] for sg in segs)} / 原点の標高 {z_base} m")

    terrain, textures, grid, chunk_of, photos = build_terrain(cfg, proj, dem, segs, z_base, tex_dir)
    meshes = build_roads(segs, z_base, tex_dir, chunk_of) + terrain
    meshes += build_details(cfg, proj, dem, segs, grid, chunk_of, photos, tex_dir, osm, data_dir, z_base)

    make_textures(tex_dir)
    if args.obj:
        write_obj(meshes, build / "track.obj", textures)
    markers = place_markers(segs, proj, cfg, z_base)
    (build / "markers.json").write_text(json.dumps(markers, indent=1), encoding="utf-8")

    (track_dir / "data" / "surfaces.ini").write_text(SURFACES_INI, encoding="utf-8")
    # 地形・道路 / 建物などの小物 / 木 を別々の kn5 にして、models.ini でまとめて読み込ませる
    write_track_kn5s(track_dir, tid, meshes, markers, tex_dir, textures)
    write_map([sg["center"] for sg in segs], track_dir, size=2048, width=3)
    ui = {
        "name": cfg["name"],
        "description": f"{cfg['name']} フリーロームマップ (OpenStreetMap + 国土地理院 標高タイル・航空写真 から生成)",
        "tags": ["japan", "freeroam", "touge"],
        "geotags": [f"{cfg['start']['lat']:.5f}", f"{cfg['start']['lon']:.5f}"],
        "country": cfg.get("country", "Japan"),
        "city": cfg.get("city", ""),
        "length": str(int(km * 1000)),
        "width": "",
        "pitboxes": str(cfg["pit_boxes"]),
        "run": "clockwise",
        "author": cfg.get("author", ""),
        "version": "0.1",
        "url": "",
    }
    (track_dir / "ui" / "ui_track.json").write_text(json.dumps(ui, ensure_ascii=False, indent=2), encoding="utf-8")
    shutil.copy(Path(args.config), build / "config.json")

    nverts = sum(m.count for m in meshes)
    print(f"メッシュ {len(meshes)} 個 / 頂点 {nverts:,}" + (f" -> {build / 'track.obj'}" if args.obj else ""))
    print(f"トラックフォルダ -> {track_dir}  (content/tracks/ にコピーすれば走れます)")
    if args.obj:
        print("Blender で編集する場合: blender -b -P blender/import_to_blender.py -- " + str(build))


if __name__ == "__main__":
    main()
