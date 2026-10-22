"""広域マップの細部: 建物・木・車線・歩道・信号・電柱・街灯・標識・ガードレール。

build_region.py から呼ばれる。座標は build_region と同じ (X = 東, Y = 北, Z = 上, 原点の標高 = z_base)。
情報源:
    OpenStreetMap   建物の形と階数 / 車線数・一方通行・歩道・制限速度 / 信号・街灯・電柱・一時停止の位置
    地理院 航空写真 木が生えている場所 (緑の濃さで判定)
    Mapillary       (任意) 道路写真から検出された信号・街灯・電柱・標識。tools/fetch_mapillary.py で取得
"""
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

import mapbox_earcut as earcut
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from build_track import MAX_VERTS, Mesh, frames

RNG_SEED = 7


# --------------------------------------------------------------------------- メッシュ

class TriBucket:
    """(名前, マテリアル, 地形チャンク) ごとに三角形をためる。
    AC は 1 メッシュ単位で描画を省くので、場所ごとに分けておくと軽くなる。"""

    def __init__(self, chunk_of):
        self.chunk_of = chunk_of
        self.meshes = {}

    def add(self, prefix, material, x, y, verts, uvs, faces):
        ci, cj = self.chunk_of(x, y)
        key = (prefix, material, ci, cj)
        lst = self.meshes.setdefault(key, [])
        if not lst or lst[-1].count + len(verts) > MAX_VERTS:
            lst.append(Mesh(f"{prefix}_{ci:02d}_{cj:02d}_{len(lst)}", material))
        m = lst[-1]
        m.v.append(np.asarray(verts, dtype=np.float64))
        m.uv.append(np.asarray(uvs, dtype=np.float64))
        m.f.append(np.asarray(faces) + m.count)
        m.count += len(verts)

    def all(self):
        return [m for lst in self.meshes.values() for m in lst]


BOX_FACES = [  # 外から見て反時計回り
    [(1, 1, -1), (-1, 1, -1), (-1, 1, 1), (1, 1, 1)],      # +y (正面)
    [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)],  # -y
    [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)],      # +x
    [(-1, 1, -1), (-1, -1, -1), (-1, -1, 1), (-1, 1, 1)],  # -x
    [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)],      # +z
    [(-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, -1)],  # -z
]


def box(center, size, front, uv_front=(0, 0, 1, 1), uv_other=(0, 0, 1, 1)):
    """front (2D 単位ベクトル) の方向を正面 (+y) に向けた直方体。"""
    fx, fy = front
    rx, ry = fy, -fx  # 正面から見て右ではなく、ローカル +x
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    v, uv, f = [], [], []
    for k, face in enumerate(BOX_FACES):
        u0, v0, u1, v1 = uv_front if k == 0 else uv_other
        base = len(v)
        for (a, b, c), (uu, vv) in zip(face, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
            lx, ly = a * hx, b * hy
            v.append((center[0] + rx * lx + fx * ly, center[1] + ry * lx + fy * ly, center[2] + c * hz))
            uv.append((uu, vv))
        f += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
    return v, uv, f


def box8(center, size, front):
    """テクスチャの要らない直方体 (頂点を共有して 8 頂点)。"""
    fx, fy = front
    rx, ry = fy, -fx
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    v = [(center[0] + rx * a * hx + fx * b * hy, center[1] + ry * a * hx + fy * b * hy, center[2] + c * hz)
         for c in (-1, 1) for b in (-1, 1) for a in (-1, 1)]
    f = []
    for face in BOX_FACES:  # 頂点番号 = (c > 0) * 4 + (b > 0) * 2 + (a > 0)
        q = [(c > 0) * 4 + (b > 0) * 2 + (a > 0) for a, b, c in face]
        f += [(q[0], q[1], q[2]), (q[0], q[2], q[3])]
    return v, [(0.5, 0.5)] * 8, f


def prism(x, y, z0, height, radius, sides=6, uv=(0, 0, 1, 1)):
    """電柱などの多角柱 (側面のみ)。"""
    a = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    ring = np.column_stack([x + radius * np.cos(a), y + radius * np.sin(a)])
    v = np.vstack([np.column_stack([ring, np.full(sides, z0)]),
                   np.column_stack([ring, np.full(sides, z0 + height)])])
    u0, v0, u1, v1 = uv
    uvs = np.column_stack([np.tile(np.linspace(u0, u1, sides), 2), np.repeat([v0, v1], sides)])
    f = []
    for i in range(sides):
        j = (i + 1) % sides
        f += [(i, j, sides + j), (i, sides + j, sides + i)]
    return v, uvs, f


def double_quad(p0, p1, z0, z1, uv=(0, 0, 1, 1)):
    """両面から見える縦の板 (木のビルボードや標識の板)。"""
    u0, v0, u1, v1 = uv
    v = [(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z1), (p0[0], p0[1], z1)]
    uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    return v, uvs, [(0, 1, 2), (0, 2, 3), (0, 2, 1), (0, 3, 2)]


# --------------------------------------------------------------------------- 地面の高さ・マスク

class TerrainGrid:
    def __init__(self, x0, y0, cell, h):
        self.x0, self.y0, self.cell, self.h = x0, y0, cell, h

    def height(self, x, y):
        fx = np.clip((np.asarray(x) - self.x0) / self.cell, 0, self.h.shape[1] - 1.001)
        fy = np.clip((np.asarray(y) - self.y0) / self.cell, 0, self.h.shape[0] - 1.001)
        ix, iy = fx.astype(int), fy.astype(int)
        tx, ty = fx - ix, fy - iy
        h = self.h
        return ((h[iy, ix] * (1 - tx) + h[iy, ix + 1] * tx) * (1 - ty)
                + (h[iy + 1, ix] * (1 - tx) + h[iy + 1, ix + 1] * tx) * ty)


class Mask:
    """地域全体を res [m] の画像として扱い、道路や建物を塗って占有判定に使う。"""

    def __init__(self, x0, y0, x1, y1, res=3.0):
        self.x0, self.y1, self.res = x0, y1, res
        self.img = Image.new("L", (int((x1 - x0) / res) + 1, int((y1 - y0) / res) + 1), 0)
        self.draw = ImageDraw.Draw(self.img)
        self._arr = None

    def px(self, xy):
        return [((x - self.x0) / self.res, (self.y1 - y) / self.res) for x, y in xy]

    def line(self, xy, width_m):
        self.draw.line(self.px(xy), fill=255, width=max(int(round(width_m / self.res)), 1))
        self._arr = None

    def polygon(self, xy):
        self.draw.polygon(self.px(xy), fill=255)
        self._arr = None

    def dilated(self, m):
        """m [m] 太らせたマスク。大きく太らせるときは解像度を落として速くする。"""
        f = max(1, int(m / (3 * self.res)))
        img = self.img.reduce(f) if f > 1 else self.img
        img = img.point(lambda v: 255 if v else 0)
        k = int(math.ceil(m / (self.res * f)))
        if k:
            img = img.filter(ImageFilter.MaxFilter(2 * k + 1))
        out = Mask.__new__(Mask)
        out.x0, out.y1, out.res, out._arr = self.x0, self.y1, self.res * f, None
        out.img, out.draw = img, ImageDraw.Draw(img)
        return out

    def __call__(self, x, y):
        if self._arr is None:
            self._arr = np.asarray(self.img) > 0
        a = self._arr
        ix = np.clip(((np.asarray(x) - self.x0) / self.res).astype(int), 0, a.shape[1] - 1)
        iy = np.clip(((self.y1 - np.asarray(y)) / self.res).astype(int), 0, a.shape[0] - 1)
        return a[iy, ix]


class RoadIndex:
    """一番近い道路の点を探す (信号や標識の向きを決めるため)。"""

    def __init__(self, segs, cell=25.0):
        self.cell, self.segs = cell, segs
        self.grid = defaultdict(list)
        for si, sg in enumerate(segs):
            for pi, (x, y) in enumerate(sg["center"]):
                self.grid[(int(x // cell), int(y // cell))].append((si, pi))

    def nearest(self, x, y, max_r=3):
        cx, cy = int(x // self.cell), int(y // self.cell)
        best = None
        for r in range(max_r + 1):
            for gx in range(cx - r, cx + r + 1):
                for gy in range(cy - r, cy + r + 1):
                    if max(abs(gx - cx), abs(gy - cy)) != r:
                        continue
                    for si, pi in self.grid.get((gx, gy), ()):
                        px, py = self.segs[si]["center"][pi]
                        d = (px - x) ** 2 + (py - y) ** 2
                        if best is None or d < best[0]:
                            best = (d, si, pi)
            if best is not None and r >= 1:
                break
        return None if best is None else (math.sqrt(best[0]), best[1], best[2])


# --------------------------------------------------------------------------- テクスチャ

def _noise(rng, size, base, amp, blur=0):
    n = rng.normal(0, 1, (size[1], size[0], 1))
    img = Image.fromarray(np.clip(np.array(base, dtype=float) + n * amp, 0, 255).astype(np.uint8))
    return img.filter(ImageFilter.GaussianBlur(blur)) if blur else img


def _font(size):
    for name in ("DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "arialbd.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def make_detail_textures(tex_dir):
    rng = np.random.default_rng(RNG_SEED)
    S = 256

    # 外壁 (1 枚 = 幅 4m x 1 階 3m)。窓の配置で家・マンション・店・工場を描き分ける
    def facade(name, wall, window, style):
        img = _noise(rng, (S, S), wall, 6)
        d = ImageDraw.Draw(img)
        if style == "house":
            d.rectangle([40, 70, 120, 170], fill=window)
            d.rectangle([150, 90, 220, 150], fill=window)
            d.line([(40, 120), (120, 120)], fill=wall, width=3)
        elif style == "apartment":
            d.rectangle([20, 60, 150, 190], fill=window)
            d.rectangle([170, 60, 236, 230], fill=(90, 90, 95))  # 玄関ドア
            d.rectangle([10, 195, 160, 205], fill=(200, 200, 200))  # ベランダ
        elif style == "shop":
            d.rectangle([10, 40, 246, 200], fill=window)
            d.rectangle([0, 0, 255, 30], fill=(170, 60, 50))
        elif style == "industrial":
            for x in range(0, S, 16):
                d.line([(x, 0), (x, S)], fill=tuple(int(c * 0.85) for c in wall), width=3)
            d.rectangle([180, 40, 230, 80], fill=window)
        img.save(tex_dir / f"{name}.png")

    facade("wall_house1", (226, 220, 205), (70, 85, 100), "house")
    facade("wall_house2", (196, 182, 160), (70, 85, 100), "house")
    facade("wall_house3", (170, 172, 175), (60, 75, 92), "house")
    facade("wall_apartment", (210, 208, 200), (80, 100, 120), "apartment")
    facade("wall_shop", (200, 196, 188), (110, 135, 150), "shop")
    facade("wall_industrial", (175, 182, 186), (80, 95, 110), "industrial")

    def roof(name, base, stripes):
        img = _noise(rng, (S, S), base, 8)
        d = ImageDraw.Draw(img)
        for y in range(0, S, stripes):
            d.line([(0, y), (S, y)], fill=tuple(int(c * 0.75) for c in base), width=2)
        img.save(tex_dir / f"{name}.png")

    roof("roof_tile", (70, 75, 85), 16)       # 瓦
    roof("roof_tile2", (110, 60, 50), 16)     # 赤茶の瓦
    roof("roof_flat", (150, 150, 145), 64)    # 陸屋根
    roof("roof_metal", (90, 110, 120), 12)    # トタン

    _noise(rng, (S, S), (150, 150, 146), 10).save(tex_dir / "concrete.png")
    _noise(rng, (S, S), (120, 122, 125), 6).save(tex_dir / "metal.png")
    sidewalk = _noise(rng, (S, S), (165, 160, 152), 10)
    d = ImageDraw.Draw(sidewalk)
    for y in range(0, S, 64):
        d.line([(0, y), (S, y)], fill=(130, 126, 120), width=2)
    sidewalk.save(tex_dir / "sidewalk.png")

    # 信号 (日本の横型 3 灯: 青・黄・赤)。右 1/4 は筐体の色
    sig = Image.new("RGB", (512, 128), (60, 62, 60))
    d = ImageDraw.Draw(sig)
    for k, col in enumerate([(40, 200, 170), (90, 80, 30), (90, 30, 30)]):
        cx = 64 + k * 112
        d.ellipse([cx - 44, 20, cx + 44, 108], fill=(20, 20, 20))
        d.ellipse([cx - 36, 28, cx + 36, 100], fill=col)
    sig.save(tex_dir / "signal.png")

    # 白いガードレール (ビーム + 支柱)。下は透明なのでアルファテストのシェーダーを使う
    gr = Image.new("RGBA", (256, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(gr)
    d.rectangle([0, 8, 255, 52], fill=(235, 235, 232, 255))
    d.line([(0, 30), (255, 30)], fill=(190, 190, 188, 255), width=6)
    for x in (30, 158):
        d.rectangle([x, 8, x + 12, 127], fill=(225, 225, 222, 255))
    gr.save(tex_dir / "guardrail_jp.png")

    # 電線
    Image.new("RGB", (16, 16), (30, 30, 30)).save(tex_dir / "wire.png")

    # 標識 (256px x 8 枠): 制限速度 20,30,40,50,60,80,100 と 止まれ
    signs = Image.new("RGBA", (2048, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(signs)
    font = _font(110)
    for k, sp in enumerate(SPEEDS):
        x = k * 256
        d.ellipse([x + 8, 8, x + 248, 248], fill=(200, 30, 40, 255))
        d.ellipse([x + 34, 34, x + 222, 222], fill=(245, 245, 245, 255))
        txt = str(sp)
        tw = d.textlength(txt, font=font)
        d.text((x + 128 - tw / 2, 60), txt, fill=(20, 60, 160, 255), font=font)
    x = 7 * 256  # 止まれ (逆三角)
    d.polygon([(x + 8, 20), (x + 248, 20), (x + 128, 236)], fill=(245, 245, 245, 255))
    d.polygon([(x + 26, 30), (x + 230, 30), (x + 128, 214)], fill=(200, 30, 40, 255))
    sf = _font(44)
    tw = d.textlength("STOP", font=sf)
    d.text((x + 128 - tw / 2, 60), "STOP", fill=(245, 245, 245, 255), font=sf)
    signs.save(tex_dir / "signs.png")

    # 木 (左: 杉 / 右: 広葉樹)
    tree = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    d = ImageDraw.Draw(tree)
    d.rectangle([122, 380, 134, 511], fill=(80, 60, 45, 255))
    for k in range(9):  # 杉は三角を重ねる
        top = 10 + k * 40
        wdt = 20 + k * 11
        g = int(70 + rng.integers(-10, 10))
        d.polygon([(128, top), (128 - wdt, top + 90), (128 + wdt, top + 90)], fill=(30, g, 40, 255))
    d.rectangle([376, 330, 392, 511], fill=(90, 70, 50, 255))
    d.ellipse([272, 60, 496, 380], fill=(45, 95, 40, 255))  # 広葉樹: 丸い樹冠に葉の塊を重ねる
    for _ in range(160):
        a, r0 = rng.uniform(0, 2 * np.pi), rng.uniform(0, 1) ** 0.5
        cx, cy = 384 + np.cos(a) * r0 * 95, 220 + np.sin(a) * r0 * 140
        r = rng.uniform(14, 26)
        g = int(rng.uniform(85, 135))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(40 + g // 6, g, 40, 255))
    tree.save(tex_dir / "tree.png")


SPEEDS = [20, 30, 40, 50, 60, 80, 100]


def sign_uv(kind):
    k = 7 if kind == "stop" else SPEEDS.index(kind)
    return (k / 8 + 0.002, 0.0, (k + 1) / 8 - 0.002, 1.0)


# --------------------------------------------------------------------------- 車線

def lane_layout(sg):
    """(進行方向の車線数, 反対方向の車線数, 中央線の種類)。日本は左側通行。"""
    t = sg["tags"]
    oneway = t.get("oneway") in ("yes", "1", "true") or t.get("highway") in ("motorway", "motorway_link")
    lanes = int(t["lanes"]) if t.get("lanes", "").isdigit() else None
    if oneway:
        return (lanes or (2 if t.get("highway") == "motorway" else 1)), 0, "none"
    if lanes is None:
        lanes = 2 if sg["width"] >= 5.5 else 1
    if lanes <= 1:
        return 1, 0, "none"  # 中央線の無い狭い道
    fwd = lanes - lanes // 2
    if t.get("overtaking") == "no" or lanes >= 4:
        center = "yellow"
    else:
        center = "white_dashed"
    return fwd, lanes // 2, center


def road_material(sg, tex_dir, made):
    """車線構成と幅に合わせた路面テクスチャを作り (なければ)、マテリアル名を返す。
    テクスチャの u は道路の左端 (進行方向の左) から右端、v は 10m で 1 周。"""
    fwd, bwd, center = lane_layout(sg)
    width = round(sg["width"] * 2) / 2
    name = f"road_{fwd}_{bwd}_{center}_{width:g}".replace(".", "p")
    if name in made:
        return name
    W, H = 256, 512
    ppm = W / width
    rng = np.random.default_rng(abs(hash(name)) % 2 ** 32)
    img = _noise(rng, (W, H), (72, 72, 74), 10)
    d = ImageDraw.Draw(img)
    white, yellow = (225, 225, 220), (230, 180, 40)
    lw = max(int(0.15 * ppm), 2)

    def solid(u, col):
        d.rectangle([u - lw / 2, 0, u + lw / 2, H], fill=col)

    def dashed(u, col):
        d.rectangle([u - lw / 2, 0, u + lw / 2, H / 2], fill=col)  # 5m 引いて 5m 空ける

    edge = 0.3 * ppm
    solid(edge, white)
    solid(W - edge, white)
    lanes = fwd + bwd
    lane_w = (W - 2 * edge) / lanes
    for k in range(1, lanes):
        u = edge + k * lane_w
        if bwd and k == fwd:
            if center == "yellow":
                solid(u, yellow)
            else:
                dashed(u, white)
        else:
            dashed(u, white)
    img.save(tex_dir / f"{name}.png")
    made.add(name)
    return name


# --------------------------------------------------------------------------- 本体

def build_details(cfg, proj, dem, segs, grid, chunk_of, photos, tex_dir, osm, data_dir, z_base):
    dcfg = cfg.get("details", {})
    rng = np.random.default_rng(RNG_SEED)
    make_detail_textures(tex_dir)
    out = TriBucket(chunk_of)
    x0, y0 = grid.x0, grid.y0
    x1 = x0 + (grid.h.shape[1] - 1) * grid.cell
    y1 = y0 + (grid.h.shape[0] - 1) * grid.cell

    for sg in segs:  # 歩道の幅 (OSM に sidewalk があるときだけ)
        has = sg["tags"].get("sidewalk", "") in ("both", "left", "right", "yes")
        m = re.match(r"[\d.]+", sg["tags"].get("sidewalk:width", ""))
        sg["sidewalk_w"] = (float(m.group(0)) if m else 2.0) if has and dcfg.get("sidewalks", True) else 0.0

    def inside(x, y):
        return x0 <= x <= x1 and y0 <= y <= y1

    road_mask = Mask(x0, y0, x1, y1)
    for sg in segs:
        if not sg["tunnel"]:
            road_mask.line(sg["center"], sg["width"] + 2 * sg.get("sidewalk_w", 0) + 1.0)
    index = RoadIndex(segs)

    ends = Counter()
    for sg in segs:
        ends.update([sg["nodes"][0], sg["nodes"][-1]])
    for sg in segs:
        sg["j0"], sg["j1"] = ends[sg["nodes"][0]] >= 3, ends[sg["nodes"][-1]] >= 3

    nodes = {e["id"]: e for e in osm["elements"] if e["type"] == "node"}
    stats = Counter()

    if dcfg.get("sidewalks", True):
        stats["歩道 (区間)"] = build_sidewalks(segs, out, z_base)
    if dcfg.get("guardrails", True):
        stats["ガードレール (m)"] = build_guardrails(segs, out, proj, dem, z_base, grid, osm, nodes)

    town = Mask(x0, y0, x1, y1, res=10.0)
    buildings = []
    if cfg.get("buildings", {}).get("enabled", True):
        buildings = build_buildings(cfg, proj, osm, nodes, grid, road_mask, out, rng, town, inside,
                                    data_dir, (x0, y0, x1, y1))
        stats["建物"] = len(buildings)
    for e in osm["elements"]:  # 住宅街の細い道も「町」の目印にする
        if e["type"] == "way" and e["tags"].get("highway") in ("residential", "living_street"):
            ll = [(nodes[k]["lat"], nodes[k]["lon"]) for k in e["nodes"] if k in nodes]
            if len(ll) >= 2:
                ll = np.array(ll)
                town.line(np.column_stack(proj.to_xy(ll[:, 0], ll[:, 1])), 10)
    town = town.dilated(40)

    points = collect_points(osm, nodes, proj, data_dir)
    for k in points:
        points[k] = [p for p in points[k] if inside(p[0], p[1])]
    stats.update(build_signals(points["signal"], segs, index, out, grid))
    if dcfg.get("street_lamps", True):
        stats["街灯"] = build_lamps(points["lamp"], segs, index, out, grid)
    if dcfg.get("speed_signs", True):
        stats["標識"] = build_signs(segs, points, index, out, grid, z_base)
    if dcfg.get("utility_poles", True):
        stats["電柱"] = build_poles(segs, points["pole"], town, out, grid, z_base, x0, y0, x1, y1)

    if cfg.get("trees", {}).get("enabled", True):
        bld_mask = Mask(x0, y0, x1, y1)
        for poly in buildings:
            bld_mask.polygon(poly)
        stats["木"] = build_trees(cfg, segs, grid, photos, road_mask, bld_mask, proj, out, rng, z_base)

    print("細部:", " / ".join(f"{k} {v:,}" for k, v in stats.items()))
    return out.all()


# --------------------------------------------------------------------------- 歩道

def build_sidewalks(segs, out, z_base):
    """OSM の sidewalk=both/left/right に高さ 15cm の歩道を付ける。交差点の手前で切る。"""
    count = 0
    for sg in segs:
        side = sg["tags"].get("sidewalk", "")
        sides = {"both": (1, -1), "left": (1,), "right": (-1,), "yes": (1, -1)}.get(side, ())
        if not sides or sg["tunnel"] or sg["s"][-1] < 20:
            continue
        sw = sg["sidewalk_w"]
        s_ = sg["s"]
        a = 8.0 if sg["j0"] else 0.0
        b = s_[-1] - (8.0 if sg["j1"] else 0.0)
        keep = (s_ >= a) & (s_ <= b)
        if keep.sum() < 2:
            continue
        c, z = sg["center"][keep], sg["z"][keep] - z_base + sg["lift"]
        ss = s_[keep]
        _, left = frames(sg["center"], False)
        left = left[keep]
        half = sg["width"] / 2
        for sd in sides:
            if sd > 0:
                offs, dz = (half + sw, half, half), (0.15, 0.15, 0.0)
            else:
                offs, dz = (-half, -half, -half - sw), (0.0, 0.15, 0.15)
            cols = [np.column_stack([c + left * (o * 1.0), z + h]) for o, h in zip(offs, dz)]
            verts = np.stack(cols, axis=1)
            uv = np.stack([np.column_stack([np.full_like(ss, u), ss / 4]) for u in (0, 0.5, 1)], axis=1)
            rows, ncol = verts.shape[:2]
            idx = np.arange(rows * ncol).reshape(rows, ncol)
            a_, b_ = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel()
            c_, d_ = idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
            faces = np.vstack([np.stack([a_, b_, c_], 1), np.stack([a_, c_, d_], 1)])
            mid = c[len(c) // 2]
            out.add("1SIDEWALK", "sidewalk", mid[0], mid[1], verts.reshape(-1, 3), uv.reshape(-1, 2), faces)
        count += 1
    return count


# --------------------------------------------------------------------------- ガードレール

def _runs(flag, min_len):
    """True が min_len 以上続く区間 [(i0, i1), ...]。"""
    runs, start = [], None
    for i, f in enumerate(np.r_[flag, False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if i - start >= min_len:
                runs.append((start, i))
            start = None
    return runs


def _strip(out, prefix, material, p, z, z_lo, z_hi, ss, facing_left):
    """折れ線 p に沿った縦の帯。facing_left なら進行方向の左を向く。"""
    lo, hi = np.column_stack([p, z + z_lo]), np.column_stack([p, z + z_hi])
    pair = (lo, hi) if facing_left else (hi, lo)
    verts = np.stack(pair, axis=1)
    uv = np.stack([np.column_stack([ss / 4, np.zeros_like(ss)]), np.column_stack([ss / 4, np.ones_like(ss)])], axis=1)
    if not facing_left:
        uv = uv[:, ::-1]
    rows = len(p)
    idx = np.arange(rows * 2).reshape(rows, 2)
    a, b, c, d = idx[:-1, 0], idx[:-1, 1], idx[1:, 1], idx[1:, 0]
    faces = np.vstack([np.stack([a, b, c], 1), np.stack([a, c, d], 1)])
    mid = p[len(p) // 2]
    out.add(prefix, material, mid[0], mid[1], verts.reshape(-1, 3), uv.reshape(-1, 2), faces)


def build_guardrails(segs, out, proj, dem, z_base, grid, osm, nodes):
    """路肩の外が 3m 以上落ち込んでいる所 (山道の谷側) と、OSM の barrier=guard_rail に白いガードレール。"""
    total = 0.0
    for sg in segs:
        if sg["bridge"] or sg["tunnel"] or sg["rank"] < 1 or len(sg["center"]) < 6:
            continue
        c, s_ = sg["center"], sg["s"]
        z = sg["z"] - z_base + sg["lift"]
        _, left = frames(c, False)
        half = sg["width"] / 2 + sg.get("sidewalk_w", 0)
        for sd in (1, -1):
            drops = []
            for off in (6.0, 12.0):  # 元の地形 (削る前) が道路よりどれだけ低いか
                p = c + left * sd * (half + off)
                la, lo = proj.to_latlon(p[:, 0], p[:, 1])
                drops.append(z - (dem(la, lo) - z_base))
            need = np.minimum(drops[0], drops[1]) > 3.0
            need &= (s_ > (10 if sg["j0"] else 0)) & (s_ < s_[-1] - (10 if sg["j1"] else 0))
            for i0, i1 in _runs(need, 6):
                p = c[i0:i1] + left[i0:i1] * sd * (half + 0.4)
                _strip(out, "1WALL_GR", "guardrail_jp", p, z[i0:i1], 0.0, 0.85, s_[i0:i1], facing_left=sd < 0)
                total += s_[i1 - 1] - s_[i0]
    for e in osm["elements"]:  # OSM に描かれているガードレール
        if e["type"] != "way" or e["tags"].get("barrier") != "guard_rail":
            continue
        ll = np.array([(nodes[k]["lat"], nodes[k]["lon"]) for k in e["nodes"] if k in nodes])
        if len(ll) < 2:
            continue
        p = np.column_stack(proj.to_xy(ll[:, 0], ll[:, 1]))
        ss = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
        z = grid.height(p[:, 0], p[:, 1]) + 0.3
        for facing in (True, False):  # どちら側から見えるか分からないので両面
            _strip(out, "1WALL_GR", "guardrail_jp", p, z, 0.0, 0.85, ss, facing)
        total += ss[-1]
    return int(total)


# --------------------------------------------------------------------------- 建物

BUILDING_HEIGHTS = {"house": 6.0, "detached": 6.0, "residential": 7.0, "apartments": 12.0,
                    "commercial": 9.0, "retail": 7.0, "industrial": 9.0, "warehouse": 8.0,
                    "garage": 3.0, "shed": 3.0, "temple": 9.0, "shrine": 6.0, "school": 12.0,
                    "hospital": 15.0, "farm_auxiliary": 4.5, "greenhouse": 3.5}


def _signed_area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def _is_rect(p):
    if len(p) != 4:
        return False
    for i in range(4):
        a, b, c = p[i - 1], p[i], p[(i + 1) % 4]
        u, v = a - b, c - b
        cos = abs(np.dot(u, v)) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9)
        if cos > 0.26:  # 90 度 ± 15 度
            return False
    return True


GSI_BUILDING_TAGS = {  # 地理院の建物種別 (ftCode) -> OSM 風のタグ
    3101: {"building": "yes"},                                   # 普通建物
    3102: {"building": "yes", "building:levels": "3"},           # 堅ろう建物
    3103: {"building": "apartments", "building:levels": "10"},   # 高層建物
}


def build_buildings(cfg, proj, osm, nodes, grid, road_mask, out, rng, town, inside, data_dir, extent):
    """OSM の建物を優先し、OSM に無い所は地理院ベクトルタイルの建物で埋める。"""
    bcfg = cfg.get("buildings", {})
    near = road_mask.dilated(bcfg.get("max_distance_from_road", 100))
    osm_mask = Mask(*extent)
    polys = []

    def place(bid, tags, ll, from_osm):
        p = np.column_stack(proj.to_xy(ll[:, 0], ll[:, 1]))
        area = _signed_area(p)
        if area < 0:
            p, area = p[::-1], -area  # 反時計回りにそろえる
        if not 12 <= area <= 60000:
            return
        p = simplify_ring(p)
        cx, cy = p.mean(axis=0)
        if not inside(cx, cy) or not near(cx, cy) or road_mask(cx, cy) or road_mask(p[:, 0], p[:, 1]).mean() > 0.4:
            return
        if not from_osm and osm_mask(cx, cy):
            return  # OSM に同じ建物がある
        build_one_building({"id": bid, "tags": tags}, p, area, grid, out, rng)
        if from_osm:
            osm_mask.polygon(p)
        town.polygon(p)
        polys.append(p)

    for e in osm["elements"]:
        if e["type"] != "way" or "building" not in e["tags"]:
            continue
        nd = e["nodes"][:-1] if e["nodes"][0] == e["nodes"][-1] else e["nodes"]
        ll = np.array([(nodes[k]["lat"], nodes[k]["lon"]) for k in nd if k in nodes])
        if len(ll) >= 3:
            place(e["id"], e["tags"], ll, True)
    n_osm = len(polys)

    gsi = data_dir / "buildings_gsi.json"
    if gsi.exists():
        for i, b in enumerate(json.loads(gsi.read_text(encoding="utf-8"))):
            ll = np.array(b["ring"])
            if len(ll) > 3 and np.allclose(ll[0], ll[-1]):
                ll = ll[:-1]
            place(10 ** 12 + i, GSI_BUILDING_TAGS.get(b["ft"], GSI_BUILDING_TAGS[3101]), ll, False)
        print(f"建物: OSM {n_osm} 棟 + 地理院 {len(polys) - n_osm} 棟")
    else:
        print("建物: OSM のみ (tools/fetch_buildings.py を実行すると地理院の建物で補えます)")
    return polys


def simplify_ring(p, tol=0.3):
    """ほぼ一直線に並んだ頂点を間引く (地理院の建物は細かい頂点が多いので)。"""
    p = list(p)
    changed = True
    while changed and len(p) > 3:
        changed = False
        for i in range(len(p)):
            a, b, c = np.asarray(p[i - 1]), np.asarray(p[i]), np.asarray(p[(i + 1) % len(p)])
            ac = c - a
            L = np.linalg.norm(ac)
            if L < 1e-6 or abs(ac[0] * (b - a)[1] - ac[1] * (b - a)[0]) / L < tol:
                del p[i]
                changed = True
                break
    return np.array(p)


def build_one_building(e, p, area, grid, out, rng):
    t = e["tags"]
    kind = t.get("building", "yes")
    m = re.match(r"[\d.]+", t.get("height", ""))
    levels = t.get("building:levels", "")
    if m:
        height = float(m.group(0))
    elif levels.isdigit():
        height = int(levels) * 3.0 + 0.5
    else:
        height = BUILDING_HEIGHTS.get(kind, 3.0 if area < 30 else 6.0 if area < 250 else 9.0 if area < 1500 else 8.0)
    if kind in ("apartments", "school", "hospital") or height >= 10:
        wall, roof = "wall_apartment", "roof_flat"
    elif kind in ("commercial", "retail") or t.get("shop"):
        wall, roof = "wall_shop", "roof_flat"
    elif kind in ("industrial", "warehouse", "factory", "farm_auxiliary", "greenhouse") or area > 1500:
        wall, roof = "wall_industrial", "roof_metal"
    else:
        h = e["id"] % 3
        wall, roof = f"wall_house{h + 1}", ("roof_tile2" if e["id"] % 5 == 0 else "roof_tile")
    gz = grid.height(p[:, 0], p[:, 1])
    z0, top = gz.min() - 0.3, gz.max() + height
    n = len(p)
    q = np.roll(p, -1, axis=0)
    # 壁 (1 辺 1 枚。角で頂点を分けて、壁ごとに平らな陰影にする)。テクスチャは幅 4m x 高さ 3m で繰り返す
    lens = np.linalg.norm(q - p, axis=1)
    u_end = np.cumsum(lens) / 4
    u_start = u_end - lens / 4
    vh = (top - z0) / 3
    verts = np.concatenate([np.column_stack([p, np.full(n, z0)]), np.column_stack([q, np.full(n, z0)]),
                            np.column_stack([q, np.full(n, top)]), np.column_stack([p, np.full(n, top)])])
    uvs = np.concatenate([np.column_stack([u_start, np.zeros(n)]), np.column_stack([u_end, np.zeros(n)]),
                          np.column_stack([u_end, np.full(n, vh)]), np.column_stack([u_start, np.full(n, vh)])])
    i = np.arange(n)
    faces = np.vstack([np.stack([i, i + n, i + 2 * n], 1), np.stack([i, i + 2 * n, i + 3 * n], 1)])
    cx, cy = p.mean(axis=0)
    out.add("bld_wall", wall, cx, cy, verts, uvs, faces)

    if roof.startswith("roof_tile") and _is_rect(p) and area < 400:
        # 切妻屋根: 長い辺に沿って棟を通す
        a, b, c, d = p
        if np.linalg.norm(b - a) < np.linalg.norm(c - b):
            a, b, c, d = b, c, d, a
        short = np.linalg.norm(c - b)
        rh = float(np.clip(short * 0.3, 1.0, 3.0))
        rb, ra = (b + c) / 2, (d + a) / 2
        P = lambda xy, z: (xy[0], xy[1], z)  # noqa: E731
        v = [P(a, top), P(b, top), P(rb, top + rh), P(ra, top + rh),
             P(c, top), P(d, top), P(ra, top + rh), P(rb, top + rh)]
        ln = np.linalg.norm(b - a) / 4
        sl = math.hypot(short / 2, rh) / 4
        uv = [(0, 0), (ln, 0), (ln, sl), (0, sl)] * 2
        out.add("bld_roof", roof, cx, cy, v, uv, [(0, 1, 2), (0, 2, 3), (4, 5, 6), (4, 6, 7)])
        gv = [P(b, top), P(c, top), P(rb, top + rh), P(d, top), P(a, top), P(ra, top + rh)]
        guv = [(0, vh), (short / 4, vh), (short / 8, vh + rh / 3)] * 2
        out.add("bld_wall", wall, cx, cy, gv, guv, [(0, 1, 2), (3, 4, 5)])
    else:
        tri = earcut.triangulate_float64(p, np.array([n], dtype=np.uint32)).reshape(-1, 3)
        v = np.column_stack([p, np.full(n, top)])
        e1, e2 = p[tri[:, 1]] - p[tri[:, 0]], p[tri[:, 2]] - p[tri[:, 0]]
        flip = (e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]) < 0
        tri[flip] = tri[flip][:, [0, 2, 1]]  # 上向きにそろえる
        out.add("bld_roof", roof, cx, cy, v, p / 4, tri)


# --------------------------------------------------------------------------- 点で置くもの

def collect_points(osm, nodes, proj, data_dir):
    """OSM と Mapillary の点データを種類ごとに集める。"""
    pts = defaultdict(list)

    def add(kind, lat, lon, extra=None):
        x, y = proj.to_xy(lat, lon)
        pts[kind].append((float(x), float(y), extra))

    for e in nodes.values():
        t = e.get("tags", {})
        hw = t.get("highway")
        if hw == "traffic_signals":
            add("signal", e["lat"], e["lon"], e["id"])
        elif hw == "street_lamp":
            add("lamp", e["lat"], e["lon"])
        elif hw == "stop":
            add("stop", e["lat"], e["lon"], e["id"])
        if t.get("power") == "pole":
            add("pole", e["lat"], e["lon"])

    mp = data_dir / "mapillary.json"
    if mp.exists():
        feats = json.loads(mp.read_text(encoding="utf-8"))
        n0 = sum(len(v) for v in pts.values())
        for f in feats:
            val = f["value"]
            if val.startswith("object--traffic-light"):
                add("signal", f["lat"], f["lon"])
            elif val == "object--street-light":
                add("lamp", f["lat"], f["lon"])
            elif val == "object--support--utility-pole":
                add("pole", f["lat"], f["lon"])
            elif val.startswith("regulatory--stop"):
                add("stop", f["lat"], f["lon"])
            else:
                m = re.match(r"regulatory--maximum-speed-limit-(\d+)", val)
                if m and int(m.group(1)) in SPEEDS:
                    add("speed", f["lat"], f["lon"], int(m.group(1)))
        print(f"Mapillary から {sum(len(v) for v in pts.values()) - n0} 個の物体を追加")
    return pts


def _edge_place(sg, pi, side, extra=0.6):
    """区間 sg の点 pi で、道路の side 側 (1=左, -1=右) の路肩の位置。"""
    t, left = frames(sg["center"][max(pi - 1, 0):pi + 2], False)
    k = min(1, len(t) - 1) if pi > 0 else 0
    off = sg["width"] / 2 + sg.get("sidewalk_w", 0) + extra
    return sg["center"][pi] + left[k] * side * off, t[k], left[k]


def build_signals(signals, segs, index, out, grid):
    """日本式の横型信号: 路肩の柱から道路の上に腕を出し、その先に信号機。
    交差点 (OSM の信号ノード) の両方向に 1 基ずつ置く。"""
    n = 0
    seen = []
    for x, y, _ in signals:
        if any((x - a) ** 2 + (y - b) ** 2 < 15 ** 2 for a, b in seen):
            continue  # 同じ交差点の重複 (OSM と Mapillary など)
        seen.append((x, y))
        hit = index.nearest(x, y)
        if hit is None or hit[0] > 30:
            continue
        _, si, pi = hit
        sg = segs[si]
        for direction in (1, -1):  # 両方向から来る車向け
            base, t, left = _edge_place(sg, pi, direction)
            facing = -t * direction  # 来る車の方を向く
            gz = float(grid.height(base[0], base[1]))
            v, uv, f = prism(base[0], base[1], gz - 0.3, 6.0, 0.12, uv=(0, 0, 1, 2))
            out.add("pole", "metal", base[0], base[1], v, uv, f)
            arm_len = min(sg["width"] * 0.6, 7.0)
            mid = base - left * direction * arm_len / 2
            v, uv, f = box8((mid[0], mid[1], gz + 5.5), (0.1, arm_len, 0.1), -left * direction)
            out.add("pole", "metal", mid[0], mid[1], v, uv, f)
            head = base - left * direction * arm_len
            v, uv, f = box((head[0], head[1], gz + 5.3), (1.3, 0.35, 0.45), facing,
                           uv_front=(0, 0, 0.98, 1), uv_other=(0.99, 0.1, 1.0, 0.2))
            out.add("signal", "signal", head[0], head[1], v, uv, f)
            n += 1
    return {"信号": n}


def build_lamps(lamps, segs, index, out, grid):
    n = 0
    for x, y, _ in lamps:
        hit = index.nearest(x, y)
        if hit is None or hit[0] > 25:
            continue
        _, si, pi = hit
        sg = segs[si]
        road_p = sg["center"][pi]
        to_road = road_p - (x, y)
        dist = np.linalg.norm(to_road)
        if dist < sg["width"] / 2 + 0.5:  # 道路の上に描かれていたら路肩へ
            base, _, left = _edge_place(sg, pi, 1)
            to_road, dist = -left, 1.0
        else:
            base = np.array([x, y])
        d = to_road / max(dist, 1e-6)
        gz = float(grid.height(base[0], base[1]))
        v, uv, f = prism(base[0], base[1], gz - 0.3, 8.0, 0.09, uv=(0, 0, 1, 2))
        out.add("pole", "metal", base[0], base[1], v, uv, f)
        head = base + d * 1.5
        v, uv, f = box8((head[0], head[1], gz + 7.8), (0.25, 1.0, 0.15), d)
        out.add("pole", "metal", head[0], head[1], v, uv, f)
        n += 1
    return n


def _sign(out, grid, pos, facing, kind):
    gz = float(grid.height(pos[0], pos[1]))
    v, uv, f = prism(pos[0], pos[1], gz - 0.3, 2.9, 0.04, sides=5)
    out.add("pole", "metal", pos[0], pos[1], v, uv, f)
    right = np.array([facing[1], -facing[0]])  # 板の正面から見て右
    p0, p1 = pos - right * 0.3 + facing * 0.06, pos + right * 0.3 + facing * 0.06
    v, uv, f = double_quad(p0, p1, gz + 2.0, gz + 2.6, sign_uv(kind))
    out.add("sign", "signs", pos[0], pos[1], v, uv, f)


def build_signs(segs, points, index, out, grid, z_base):
    """制限速度 (OSM の maxspeed と Mapillary の検出) と一時停止の標識。"""
    n = 0
    for sg in segs:
        m = re.match(r"(\d+)", sg["tags"].get("maxspeed", ""))
        if not m or int(m.group(1)) not in SPEEDS or sg["s"][-1] < 200 or sg["tunnel"]:
            continue
        sp = int(m.group(1))
        k = int(np.searchsorted(sg["s"], 25))
        pos, t, _ = _edge_place(sg, k, 1, 1.0)  # 左側通行なので左の路肩
        _sign(out, grid, pos, -t, sp)
        n += 1
        if lane_layout(sg)[1]:  # 対面通行なら反対方向にも
            k = int(np.searchsorted(sg["s"], sg["s"][-1] - 25))
            pos, t, _ = _edge_place(sg, k, -1, 1.0)
            _sign(out, grid, pos, t, sp)
            n += 1
    for kind_key in ("speed", "stop"):
        for x, y, extra in points[kind_key]:
            hit = index.nearest(x, y)
            if hit is None or hit[0] > 25:
                continue
            _, si, pi = hit
            sg = segs[si]
            c = sg["center"]
            t, left = frames(c[max(pi - 1, 0):pi + 2], False)
            t, left = t[0], left[0]
            rel = np.array([x, y]) - c[pi]
            on_left = np.dot(rel, left) >= 0
            if kind_key == "stop" and extra is not None:
                # OSM の一時停止は道路上の点。交差点に近い方の端に向かう車向けに左へ置く
                toward_end = sg["s"][pi] > sg["s"][-1] / 2
                side = 1 if toward_end else -1
                pos, tt, _ = _edge_place(sg, pi, side, 1.0)
                _sign(out, grid, pos, -tt if toward_end else tt, "stop")
            else:
                pos = np.array([x, y])
                if abs(np.dot(rel, left)) < sg["width"] / 2 + 0.5:
                    pos, _, _ = _edge_place(sg, pi, 1 if on_left else -1, 1.0)
                _sign(out, grid, pos, -t if on_left else t, extra if kind_key == "speed" else "stop")
            n += 1
    return n


# --------------------------------------------------------------------------- 電柱

def _pole(out, grid, pos, along):
    gz = float(grid.height(pos[0], pos[1]))
    v, uv, f = prism(pos[0], pos[1], gz - 0.3, 11.5, 0.16, uv=(0, 0, 1, 4))
    out.add("pole", "concrete", pos[0], pos[1], v, uv, f)
    across = np.array([-along[1], along[0]])
    v, uv, f = box8((pos[0], pos[1], gz + 10.6), (1.6, 0.1, 0.1), across)
    out.add("pole", "metal", pos[0], pos[1], v, uv, f)
    return gz


def _wire(out, a, b, za, zb):
    """電柱の間の電線 (たるみ付き、細い板)。"""
    k = np.linspace(0, 1, 4)
    p = a[None] * (1 - k[:, None]) + b[None] * k[:, None]
    z = za * (1 - k) + zb * k - 0.6 * 4 * k * (1 - k)
    verts = np.concatenate([np.column_stack([p, z]), np.column_stack([p, z + 0.03])])
    m = len(k)
    i = np.arange(m - 1)
    faces = np.vstack([np.stack([i, i + 1, m + i + 1], 1), np.stack([i, m + i + 1, m + i], 1),
                       np.stack([i, m + i + 1, i + 1], 1), np.stack([i, m + i, m + i + 1], 1)])
    uv = np.zeros((2 * m, 2))
    out.add("wire", "wire", p[m // 2][0], p[m // 2][1], verts, uv, faces)


def build_poles(segs, osm_poles, town, out, grid, z_base, x0, y0, x1, y1):
    """町の中の道路 (県道以下) の片側に 35m おきの電柱と電線。
    OSM / Mapillary に電柱がある所はその位置を使い、自動配置しない。"""
    known = Mask(x0, y0, x1, y1, res=10.0)
    n = 0
    for x, y, _ in osm_poles:
        _pole(out, grid, np.array([x, y]), np.array([1.0, 0.0]))
        known.draw.ellipse([(x - x0) / 10 - 4, (y1 - y) / 10 - 4, (x - x0) / 10 + 4, (y1 - y) / 10 + 4], fill=255)
        n += 1
    known._arr = None
    for sg in segs:
        if sg["rank"] > 3 or sg["rank"] < 1 or sg["bridge"] or sg["tunnel"] or sg["s"][-1] < 40:
            continue
        s_ = sg["s"]
        marks = np.arange(10, s_[-1] - 10, 35.0)
        prev = None
        for sm in marks:
            pi = int(np.searchsorted(s_, sm))
            pos, t, _ = _edge_place(sg, pi, 1, 0.5)
            if not town(pos[0], pos[1]) or known(pos[0], pos[1]):
                prev = None
                continue
            gz = _pole(out, grid, pos, t)
            n += 1
            if prev is not None:
                for h in (9.6, 10.6):
                    _wire(out, prev[0], pos, prev[1] + h, gz + h)
            prev = (pos, gz)
    return n


# --------------------------------------------------------------------------- 木

def build_trees(cfg, segs, grid, photos, road_mask, bld_mask, proj, out, rng, z_base):
    """道路から見える範囲 (band_m) で、航空写真が濃い緑の所に木を立てる。"""
    tcfg = cfg.get("trees", {})
    spacing = tcfg.get("spacing_m", 9.0)
    band = tcfg.get("band_m", [4, 45])
    max_count = tcfg.get("max_count", 150000)
    near = road_mask.dilated(band[1])
    clear = road_mask.dilated(band[0])
    bld = bld_mask.dilated(2)

    cand = []
    for (ci, cj), ph in photos.items():
        xs = np.arange(ph["x0"], ph["x1"], spacing)
        ys = np.arange(ph["y0"], ph["y1"], spacing)
        gx, gy = np.meshgrid(xs, ys)
        gx = (gx + rng.uniform(-0.4, 0.4, gx.shape) * spacing).ravel()
        gy = (gy + rng.uniform(-0.4, 0.4, gy.shape) * spacing).ravel()
        ok = near(gx, gy) & ~clear(gx, gy) & ~bld(gx, gy)
        gx, gy = gx[ok], gy[ok]
        if not len(gx):
            continue
        img = np.asarray(Image.open(ph["path"]).convert("RGB"), dtype=np.int16)
        la, lo = proj.to_latlon(gx, gy)
        u, v = ph["uv"](la, lo)
        px = np.clip((u * img.shape[1]).astype(int), 0, img.shape[1] - 1)
        py = np.clip(((1 - v) * img.shape[0]).astype(int), 0, img.shape[0] - 1)
        r, g, b = img[py, px, 0], img[py, px, 1], img[py, px, 2]
        exg = 2 * g - r - b
        bright = (r + g + b) / 3
        forest = (exg > 12) & (bright < 105)  # 濃い緑 = 木。田畑や芝は明るいので除く
        for x, y, br in zip(gx[forest], gy[forest], bright[forest]):
            cand.append((x, y, br))
    if len(cand) > max_count:
        keep = rng.choice(len(cand), max_count, replace=False)
        cand = [cand[k] for k in keep]

    for x, y, br in cand:
        gz = float(grid.height(x, y))
        sugi = br < 70 or gz + z_base > 250  # 暗い森と山の上は杉、それ以外は広葉樹
        h = rng.uniform(14, 24) if sugi else rng.uniform(8, 14)
        w = h * (0.4 if sugi else 0.8)
        uvx = (0.0, 0.0, 0.5, 1.0) if sugi else (0.5, 0.0, 1.0, 1.0)
        a = rng.uniform(0, np.pi)
        verts, uvs, faces = [], [], []
        for k, ang in enumerate((a, a + np.pi / 2)):  # 十字に交差した板 2 枚
            d = np.array([np.cos(ang), np.sin(ang)]) * w / 2
            v, uv, f = double_quad((x - d[0], y - d[1]), (x + d[0], y + d[1]), gz - 0.3, gz - 0.3 + h, uvx)
            faces += [tuple(i + 4 * k for i in tri) for tri in f]
            verts += v
            uvs += uv
        out.add("tree", "tree", x, y, verts, uvs, faces)
    return len(cand)
