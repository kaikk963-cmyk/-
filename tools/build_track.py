"""OSM の道路 + 地理院の標高から、Assetto Corsa 用のメッシュとトラックフォルダ一式を作る。

使い方:
    python tools/build_track.py config/hakone_turnpike.json

出力 (out/<track_id>/):
    build/track.obj, track.mtl, texture/*.png   -> Blender に読み込む素材
    build/markers.json                          -> AC_START / AC_PIT などのダミー位置
    <track_id>/                                 -> content/tracks/ に置くフォルダの雛形
        ui/ui_track.json, ui/outline.png, map.png, data/map.ini, data/surfaces.ini

座標系: X = 東, Y = 北, Z = 上 (Blender と同じ)。原点はルートの中心。
OBJ は慣例どおり Y-up (x, z, -y) で書き出すので、Blender のデフォルト設定で読み込めば元に戻る。
"""
import argparse
import heapq
import json
import math
import re
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

EARTH_R = 6_378_137.0
MAX_VERTS = 60_000  # kn5 は 1 メッシュ 65535 頂点まで


# --------------------------------------------------------------------------- 入力

class DemSampler:
    """fetch_dem.py が保存したモザイクから緯度経度で標高をバイリニア補間する。
    複数レイヤーがあれば先頭から順に使い、欠損 (NaN) を次のレイヤーで埋める。"""

    def __init__(self, paths):
        self.layers = []
        for p in paths:
            d = np.load(p)
            self.layers.append((d["heights"], int(d["zoom"]), int(d["tile_x0"]), int(d["tile_y0"])))
        if not self.layers:
            raise SystemExit("DEM がありません。先に tools/fetch_dem.py を実行してください。")

    @staticmethod
    def _sample(layer, lat, lon):
        h, z, tx0, ty0 = layer
        n = 2 ** z
        px = ((lon + 180.0) / 360.0 * n - tx0) * 256 - 0.5
        py = ((1.0 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2.0 * n - ty0) * 256 - 0.5
        x0 = np.clip(np.floor(px).astype(int), 0, h.shape[1] - 2)
        y0 = np.clip(np.floor(py).astype(int), 0, h.shape[0] - 2)
        fx = np.clip(px - x0, 0, 1)
        fy = np.clip(py - y0, 0, 1)
        top = h[y0, x0] * (1 - fx) + h[y0, x0 + 1] * fx
        bot = h[y0 + 1, x0] * (1 - fx) + h[y0 + 1, x0 + 1] * fx
        return top * (1 - fy) + bot * fy

    def __call__(self, lat, lon):
        out = np.full(np.shape(lat), np.nan)
        for layer in self.layers:
            miss = np.isnan(out)
            if not miss.any():
                break
            out[miss] = self._sample(layer, lat[miss], lon[miss])
        if np.isnan(out).all():
            raise SystemExit("範囲内に標高データがありません。")
        return out


class Projection:
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = math.radians(1) * EARTH_R * math.cos(math.radians(lat0))
        self.ky = math.radians(1) * EARTH_R

    def to_xy(self, lat, lon):
        return (np.asarray(lon) - self.lon0) * self.kx, (np.asarray(lat) - self.lat0) * self.ky

    def to_latlon(self, x, y):
        return np.asarray(y) / self.ky + self.lat0, np.asarray(x) / self.kx + self.lon0


def select_route(osm, rcfg):
    """条件に合う way をグラフにし、その中で最も長い経路 (直径) を 1 本のルートにする。
    上下線が分かれた道路でも片側だけが選ばれる。"""
    nodes = {e["id"]: (e["lat"], e["lon"]) for e in osm["elements"] if e["type"] == "node"}
    ways = [e for e in osm["elements"] if e["type"] == "way"]
    ids = set(rcfg.get("way_ids") or [])
    pat = re.compile(rcfg["name_regex"]) if rcfg.get("name_regex") else None
    hw = set(rcfg.get("highway") or [])

    def match(w):
        if ids:
            return w["id"] in ids
        t = w.get("tags", {})
        if "highway" not in t:
            return False
        if hw and t.get("highway") not in hw:
            return False
        if pat:
            text = " ".join(t.get(k, "") for k in ("name", "name:ja", "name:en", "ref", "official_name"))
            return bool(pat.search(text))
        return True

    sel = [w for w in ways if match(w)]
    if not sel:
        raise SystemExit("route の条件に合う道路がありません。fetch_osm.py が表示した道路名を参考に config を直してください。")
    print(f"ルート候補: {len(sel)} 本の way")

    graph = defaultdict(list)
    for w in sel:
        nd = [n for n in w["nodes"] if n in nodes]
        for a, b in zip(nd, nd[1:]):
            (la, lo), (lb, lob) = nodes[a], nodes[b]
            d = math.hypot((lob - lo) * math.cos(math.radians(la)), lb - la) * 111_320
            graph[a].append((b, d))
            graph[b].append((a, d))

    def dijkstra(src):
        dist, prev = {src: 0.0}, {}
        pq = [(0.0, src)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist[u]:
                continue
            for v, w in graph[u]:
                nd_ = d + w
                if nd_ < dist.get(v, math.inf):
                    dist[v], prev[v] = nd_, u
                    heapq.heappush(pq, (nd_, v))
        far = max(dist, key=dist.get)
        return far, dist, prev

    # 最大の連結成分から始めるため、ノード数の多い成分を探す
    seen, best = set(), None
    for n in graph:
        if n in seen:
            continue
        _, dist, _ = dijkstra(n)
        seen |= dist.keys()
        if best is None or len(dist) > len(best):
            best = dist
    a, _, _ = dijkstra(next(iter(best)))
    b, dist, prev = dijkstra(a)
    path = [b]
    while path[-1] != a:
        path.append(prev[path[-1]])
    print(f"ルート長 (OSM): {dist[b] / 1000:.2f} km")
    return np.array([nodes[n] for n in path])


# --------------------------------------------------------------------------- 形状

def resample(pts, step):
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    n = max(int(s[-1] / step), 2)
    t = np.linspace(0, s[-1], n + 1)
    return np.stack([np.interp(t, s, pts[:, i]) for i in range(pts.shape[1])], axis=1)


def smooth(values, window, closed):
    if window <= 1:
        return values
    k = np.ones(window) / window
    pad = window // 2
    if closed:
        v = np.concatenate([values[-pad:], values, values[:pad]])
    else:
        v = np.concatenate([np.repeat(values[:1], pad, 0), values, np.repeat(values[-1:], pad, 0)])
    if values.ndim == 1:
        return np.convolve(v, k, mode="same")[pad:pad + len(values)]
    return np.stack([np.convolve(v[:, i], k, mode="same")[pad:pad + len(values)]
                     for i in range(values.shape[1])], axis=1)


def frames(xy, closed):
    if closed:
        t = np.roll(xy, -1, 0) - np.roll(xy, 1, 0)
    else:
        t = np.gradient(xy, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    left = np.stack([-t[:, 1], t[:, 0]], axis=1)
    return t, left


class Mesh:
    def __init__(self, name, material):
        self.name, self.material = name, material
        self.v, self.uv, self.f = [], [], []
        self.count = 0

    def add_grid(self, verts, uvs):
        """verts: (rows, cols, 3) を四角形格子として追加 (法線が上/内側を向く順序)。"""
        rows, cols = verts.shape[:2]
        idx = self.count + np.arange(rows * cols).reshape(rows, cols)
        self.v.append(verts.reshape(-1, 3))
        self.uv.append(uvs.reshape(-1, 2))
        a, b = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel()
        c, d = idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
        self.f.append(np.stack([a, b, c], 1))
        self.f.append(np.stack([a, c, d], 1))
        self.count += rows * cols


def ribbon(name, material, center, left, z, off0, off1, uv_width, closed, extra_z=(0.0, 0.0)):
    """センターラインから left 方向に off0..off1 [m] の帯を作り、MAX_VERTS ごとに分割する。"""
    xy0 = center + left * off0
    xy1 = center + left * off1
    v = np.stack([np.column_stack([xy0, z + extra_z[0]]), np.column_stack([xy1, z + extra_z[1]])], axis=1)
    seglen = np.linalg.norm(np.diff(center, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seglen)])
    uv = np.stack([np.column_stack([np.zeros_like(s), s / uv_width]),
                   np.column_stack([np.ones_like(s), s / uv_width])], axis=1)
    if closed:
        v = np.concatenate([v, v[:1]])
        last = s[-1] + np.linalg.norm(center[0] - center[-1])
        uv = np.concatenate([uv, [[[0, last / uv_width], [1, last / uv_width]]]])
    meshes, rows_per = [], MAX_VERTS // 2
    for i, start in enumerate(range(0, len(v) - 1, rows_per - 1)):
        m = Mesh(f"{name}_{i:02d}" if len(v) > rows_per else name, material)
        m.add_grid(v[start:start + rows_per], uv[start:start + rows_per])
        meshes.append(m)
    return meshes


def build_terrain(cfg, proj, dem, center, road_z, z_base, half_total):
    tc = cfg["terrain"]
    cell, margin, corridor = tc["cell_m"], tc["margin_m"], tc["corridor_m"]
    x0, y0 = center.min(0) - margin
    x1, y1 = center.max(0) + margin
    xs = np.arange(x0, x1 + cell, cell)
    ys = np.arange(y0, y1 + cell, cell)
    gx, gy = np.meshgrid(xs, ys)
    lat, lon = proj.to_latlon(gx, gy)
    h = dem(lat.ravel(), lon.ravel()).reshape(gx.shape) - z_base
    h = np.where(np.isnan(h), np.nanmin(h), h)

    # ルート周辺のセルに「最寄りの道路点までの距離」と「その道路の高さ」をラスタライズ
    dist = np.full(gx.shape, np.inf)
    rz = np.zeros(gx.shape)
    # 道路直下の地形は、半径 flat 内を通る道路の最低点に合わせる。
    # 急勾配やつづら折りでも、格子の頂点が路面より上に出ないようにするため
    under = np.full(gx.shape, np.inf)
    flat = half_total + cell * 0.75
    r = int(math.ceil(corridor / cell)) + 1
    for (px, py), pz in zip(center, road_z):
        ix, iy = int((px - x0) / cell), int((py - y0) / cell)
        sl = (slice(max(iy - r, 0), iy + r + 1), slice(max(ix - r, 0), ix + r + 1))
        d = np.hypot(gx[sl] - px, gy[sl] - py)
        better = d < dist[sl]
        dist[sl] = np.where(better, d, dist[sl])
        rz[sl] = np.where(better, pz, rz[sl])
        under[sl] = np.where(d <= flat, np.minimum(under[sl], pz), under[sl])

    # 道路の下は少し沈め、corridor まで滑らかに元の地形へ戻す (切土・盛土)
    t = np.clip((dist - flat) / max(corridor - flat, 1e-3), 0, 1)
    t = t * t * (3 - 2 * t)
    h = np.where(dist <= flat, under - 0.3, (rz - 0.3) * (1 - t) + h * t)

    verts = np.stack([gx, gy, h], axis=2)
    uvs = np.stack([gx / 20.0, gy / 20.0], axis=2)
    meshes, rows_per = [], max(MAX_VERTS // len(xs), 2)
    if len(xs) > MAX_VERTS // 2:
        raise SystemExit("地形が広すぎます。terrain.cell_m を大きくしてください。")
    for i, start in enumerate(range(0, len(ys) - 1, rows_per - 1)):
        m = Mesh(f"1GRASS_{i:02d}", "grass")
        m.add_grid(verts[start:start + rows_per], uvs[start:start + rows_per])
        meshes.append(m)
    return meshes


# --------------------------------------------------------------------------- 出力

def write_obj(meshes, path, textures=None):
    """textures: {マテリアル名: texture/ 内のファイル名}。省略時は <マテリアル名>.png。"""
    mtl = path.with_suffix(".mtl")
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"mtllib {mtl.name}\n")
        vo = 1
        for m in meshes:
            v, uv, fc = np.concatenate(m.v), np.concatenate(m.uv), np.concatenate(m.f) + vo
            f.write(f"o {m.name}\nusemtl {m.material}\n")
            # Y-up: (x, z, -y)
            np.savetxt(f, np.column_stack([v[:, 0], v[:, 2], -v[:, 1]]), fmt="v %.3f %.3f %.3f")
            np.savetxt(f, uv, fmt="vt %.4f %.4f")
            np.savetxt(f, np.column_stack([fc, fc]).reshape(-1, 2, 3).transpose(0, 2, 1).reshape(-1, 6),
                       fmt="f %d/%d %d/%d %d/%d")
            vo += len(v)
    with open(mtl, "w", encoding="utf-8") as f:
        for name in dict.fromkeys(m.material for m in meshes):
            tex = (textures or {}).get(name, f"{name}.png")
            f.write(f"newmtl {name}\nKd 1 1 1\nmap_Kd texture/{tex}\n\n")


def make_textures(tex_dir):
    tex_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(1)

    def noise(base, amp, size=512, blur=0):
        n = rng.normal(0, 1, (size, size, 1))
        img = np.clip(np.array(base) + n * amp, 0, 255).astype(np.uint8)
        im = Image.fromarray(img)
        return im.filter(ImageFilter.GaussianBlur(blur)) if blur else im

    asphalt = noise((70, 70, 72), 12)
    d = ImageDraw.Draw(asphalt)  # 白線 (外側) と中央線
    d.rectangle([8, 0, 20, 511], fill=(225, 225, 225))
    d.rectangle([491, 0, 503, 511], fill=(225, 225, 225))
    d.rectangle([250, 0, 261, 511], fill=(230, 200, 60))
    asphalt.save(tex_dir / "asphalt.png")
    noise((95, 92, 85), 18).save(tex_dir / "shoulder.png")
    noise((70, 105, 50), 20, blur=1).save(tex_dir / "grass.png")
    noise((185, 188, 190), 6).save(tex_dir / "guardrail.png")


SURFACES_INI = """[SURFACE_0]
KEY=ROAD
FRICTION=0.98
DAMPING=0
WAV=
WAV_PITCH=0
FF_EFFECT=NULL
DIRT_ADDITIVE=0
IS_VALID_TRACK=1
BLACK_FLAG_TIME=0
SIN_HEIGHT=0
SIN_LENGTH=0
IS_PITLANE=0
VIBRATION_GAIN=0
VIBRATION_LENGTH=0

[SURFACE_1]
KEY=GRASS
FRICTION=0.60
DAMPING=0.1
WAV=grass.wav
WAV_PITCH=0
FF_EFFECT=1
DIRT_ADDITIVE=1
IS_VALID_TRACK=0
BLACK_FLAG_TIME=0
SIN_HEIGHT=0.03
SIN_LENGTH=0.5
IS_PITLANE=0
VIBRATION_GAIN=0.2
VIBRATION_LENGTH=0.6

[SURFACE_2]
KEY=SHOULDER
FRICTION=0.85
DAMPING=0
WAV=
WAV_PITCH=0
FF_EFFECT=NULL
DIRT_ADDITIVE=0.3
IS_VALID_TRACK=1
BLACK_FLAG_TIME=0
SIN_HEIGHT=0
SIN_LENGTH=0
IS_PITLANE=0
VIBRATION_GAIN=0.1
VIBRATION_LENGTH=0.3

[SURFACE_3]
KEY=SIDEWALK
FRICTION=0.90
DAMPING=0
WAV=
WAV_PITCH=0
FF_EFFECT=NULL
DIRT_ADDITIVE=0
IS_VALID_TRACK=1
BLACK_FLAG_TIME=0
SIN_HEIGHT=0
SIN_LENGTH=0
IS_PITLANE=0
VIBRATION_GAIN=0
VIBRATION_LENGTH=0

[SURFACE_4]
KEY=WALL
FRICTION=0.30
DAMPING=0
WAV=
WAV_PITCH=0
FF_EFFECT=NULL
DIRT_ADDITIVE=0
IS_VALID_TRACK=0
BLACK_FLAG_TIME=0
SIN_HEIGHT=0
SIN_LENGTH=0
IS_PITLANE=0
VIBRATION_GAIN=0
VIBRATION_LENGTH=0
"""


def write_map(lines, track_dir, size=1024, margin=20, width=8):
    """lines: XY 折れ線のリスト。AC 座標では x = 東, z = -北。"""
    allp = np.concatenate(lines)
    ax, az = allp[:, 0], -allp[:, 1]
    span = max(np.ptp(ax), np.ptp(az))
    scale = span / (size - 2 * margin)  # m / px
    w = int(np.ptp(ax) / scale) + 2 * margin
    h = int(np.ptp(az) / scale) + 2 * margin
    xoff = -ax.min() + margin * scale
    zoff = -az.min() + margin * scale
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for line in lines:
        px = (line[:, 0] + xoff) / scale
        pz = (-line[:, 1] + zoff) / scale
        draw.line(list(zip(px, pz)), fill=(255, 255, 255, 255), width=width, joint="curve")
    img.save(track_dir / "map.png")
    img.save(track_dir / "ui" / "outline.png")
    (track_dir / "data" / "map.ini").write_text(
        "[PARAMETERS]\n"
        f"WIDTH={w}\nHEIGHT={h}\nMARGIN={margin}\nSCALE_FACTOR={scale:.6f}\n"
        f"X_OFFSET={xoff:.3f}\nZ_OFFSET={zoff:.3f}\nDRAWING_SIZE=10\n", encoding="utf-8")


def place_markers(center, tangent, left, z, s, cfg, closed):
    """スタート / ピット / 計測ラインのダミー位置 (Blender 座標) を決める。"""
    half = cfg["road_width"] / 2
    n_pit = cfg["pit_boxes"]

    def at(dist, lateral=0.0, lift=0.5):
        i = int(np.clip(np.searchsorted(s, dist), 0, len(s) - 1))
        p = center[i] + left[i] * lateral
        return {"pos": [float(p[0]), float(p[1]), float(z[i] + lift)],
                "dir": [float(tangent[i][0]), float(tangent[i][1])]}

    m = {}
    # ピット (=練習走行のスポーン位置) → グリッド → スタートライン の順に並べる
    for k in range(n_pit):
        m[f"AC_PIT_{k}"] = at(10 + k * 9, half * 0.45 * (1 if k % 2 else -1))
    grid0 = 10 + n_pit * 9 + 10
    for k in range(n_pit):
        m[f"AC_START_{k}"] = at(grid0 + k * 8, half * 0.45 * (1 if k % 2 else -1))
    line = grid0 + n_pit * 8 + 15
    hot = max(line - 30, 0)
    m["AC_HOTLAP_START_0"] = at(hot)
    finish = (s[-1] - 15) if not closed else line
    if line + 100 > finish and not closed:
        raise SystemExit("ルートが短すぎてスタート位置を置けません。pit_boxes を減らしてください。")
    for side, sign in (("L", 1), ("R", -1)):
        lat = (half + cfg["shoulder_width"] + 1) * sign
        m[f"AC_TIME_0_{side}"] = at(line, lat, 0)
        if closed:
            mid = line + s[-1] / 2
            m[f"AC_TIME_1_{side}"] = at(mid if mid < s[-1] else mid - s[-1], lat, 0)
        else:
            m[f"AC_TIME_1_{side}"] = at(finish, lat, 0)
            m[f"AC_AB_START_{side}"] = at(line, lat, 0)
            m[f"AC_AB_FINISH_{side}"] = at(finish, lat, 0)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    args = ap.parse_args()
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    tid = cfg["track_id"]
    data_dir = Path("data") / tid
    out = Path("out") / tid
    build, track_dir = out / "build", out / tid
    for d in (build, track_dir / "ui", track_dir / "data"):
        d.mkdir(parents=True, exist_ok=True)

    osm = json.loads((data_dir / "osm.json").read_text(encoding="utf-8"))
    dem = DemSampler([data_dir / f"dem_{l}.npz" for l in cfg["dem"]["layers"]
                      if (data_dir / f"dem_{l}.npz").exists()])

    latlon = select_route(osm, cfg["route"])
    if cfg.get("reverse"):
        latlon = latlon[::-1]
    proj = Projection(latlon[:, 0].mean(), latlon[:, 1].mean())
    xy = np.column_stack(proj.to_xy(latlon[:, 0], latlon[:, 1]))
    closed = np.linalg.norm(xy[0] - xy[-1]) < 30
    step = cfg["resample_step"]

    # OSM のカクカクした折れ線をならしてから等間隔に打ち直す
    center = resample(xy, step)
    center = smooth(center, max(int(12 / step), 1) | 1, closed)
    center = resample(center, step)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(center, axis=0), axis=1))])

    lat, lon = proj.to_latlon(center[:, 0], center[:, 1])
    z = dem(lat, lon)
    good = ~np.isnan(z)
    z = np.interp(s, s[good], z[good])
    z = smooth(z, max(int(cfg["elevation_smooth_m"] / step), 1) | 1, closed)
    z_base = math.floor(z.min())  # 標高をそのまま使うと数百 m 浮くので、ルート最低点を 0 付近にする
    z -= z_base

    tangent, left = frames(center, closed)
    half, sh = cfg["road_width"] / 2, cfg["shoulder_width"]
    print(f"コース長: {s[-1] / 1000:.2f} km / 標高差: {z.max() - z.min():.0f} m / "
          f"{'周回' if closed else 'A→B (片道)'} / 原点の標高 {z_base} m")

    meshes = []
    meshes += ribbon("1ROAD", "asphalt", center, left, z, half, -half, cfg["road_width"] * 2, closed)
    meshes += ribbon("2SHOULDER_L", "shoulder", center, left, z, half + sh, half, 4, closed, (-0.05, 0))
    meshes += ribbon("3SHOULDER_R", "shoulder", center, left, z, -half, -half - sh, 4, closed, (0, -0.05))
    # ガードレール (コリジョン兼見た目)。両側に高さ 0.85m の壁、面は道路側を向く
    meshes += ribbon("1WALL_L", "guardrail", center, left, z - 0.05,
                     half + sh, half + sh, 4, closed, (0.85, 0.0))
    meshes += ribbon("2WALL_R", "guardrail", center, left, z - 0.05,
                     -half - sh, -half - sh, 4, closed, (0.0, 0.85))
    meshes += build_terrain(cfg, proj, dem, center, z, z_base, half + sh)

    write_obj(meshes, build / "track.obj")
    make_textures(build / "texture")
    markers = place_markers(center, tangent, left, z, s, cfg, closed)
    (build / "markers.json").write_text(json.dumps(markers, indent=1), encoding="utf-8")

    (track_dir / "data" / "surfaces.ini").write_text(SURFACES_INI, encoding="utf-8")
    write_map([center], track_dir)
    ui = {
        "name": cfg["name"],
        "description": f"{cfg['name']} (OpenStreetMap + 国土地理院 標高タイル から生成)",
        "tags": ["japan", "touge" if not closed else "circuit", "a2b" if not closed else "loop"],
        "geotags": [f"{latlon[0][0]:.5f}", f"{latlon[0][1]:.5f}"],
        "country": cfg.get("country", "Japan"),
        "city": cfg.get("city", ""),
        "length": str(int(s[-1])),
        "width": str(cfg["road_width"]),
        "pitboxes": str(cfg["pit_boxes"]),
        "run": "clockwise",
        "author": cfg.get("author", ""),
        "version": "0.1",
        "url": "",
    }
    (track_dir / "ui" / "ui_track.json").write_text(json.dumps(ui, ensure_ascii=False, indent=2), encoding="utf-8")
    shutil.copy(Path(args.config), build / "config.json")

    nverts = sum(m.count for m in meshes)
    print(f"メッシュ {len(meshes)} 個 / 頂点 {nverts:,} -> {build / 'track.obj'}")
    print(f"トラックフォルダ雛形 -> {track_dir}")
    print("次: blender -b -P blender/import_to_blender.py -- " + str(build))


if __name__ == "__main__":
    main()
