"""建物のモデル。外壁は種類ごとの描き込んだテクスチャ、屋根は切妻 / 寄棟 (軒の出と軒天付き) か
パラペット付きの陸屋根。屋根の色は航空写真のその建物の位置の色から選ぶ。

    種類        外壁テクスチャ                         屋根
    house2      2 階建ての家 (窓・掃き出し窓・玄関・基礎)  切妻 / 寄棟 (瓦・スレート・金属)
    house1      平屋                                  切妻 / 寄棟
    apartment   マンション・アパート (1 階ごとにベランダ)   陸屋根 + パラペット
    office      ビル・学校・病院 (帯状の窓)              陸屋根 + パラペット
    shop        店 (シャッター / ガラス + 看板の帯)        陸屋根 + パラペット
    factory     工場・倉庫 (波板)                       緩い切妻 (金属) か陸屋根
    shed        物置・納屋                              切妻 (金属)
"""
import math
import re
from collections import OrderedDict

import mapbox_earcut as earcut
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# --------------------------------------------------------------------------- テクスチャ

WALL_COLORS = {  # 外壁の色の種類
    "house": [(236, 233, 226), (228, 218, 194), (206, 192, 166), (192, 194, 196), (160, 128, 100),
              (196, 204, 208)],
    "apartment": [(232, 230, 224), (214, 202, 180), (176, 118, 92)],
    "office": [(214, 214, 210), (190, 186, 178)],
    "shop": [(222, 218, 210), (200, 196, 190), (180, 150, 120)],
    "factory": [(196, 198, 200), (150, 168, 184), (214, 206, 186)],
    "shed": [(150, 152, 150)],
}

# 屋根: (名前, 実際の色, 航空写真での見え方の目安, 模様)
ROOFS_PITCHED = [
    ("roof_kawara_gray", (88, 92, 100), (98, 100, 106), "kawara"),
    ("roof_kawara_black", (48, 50, 55), (60, 62, 66), "kawara"),
    ("roof_brown", (104, 72, 58), (112, 88, 74), "slate"),
    ("roof_red", (150, 72, 56), (142, 84, 70), "slate"),
    ("roof_blue", (62, 86, 120), (78, 96, 120), "metal"),
    ("roof_green", (70, 104, 86), (86, 110, 96), "metal"),
    ("roof_silver", (176, 178, 176), (168, 168, 164), "metal"),
]
ROOFS_FLAT = [
    ("roof_flat_gray", (168, 168, 162), (160, 160, 156)),
    ("roof_flat_green", (96, 128, 110), (104, 128, 112)),
    ("roof_flat_dark", (98, 98, 96), (100, 100, 98)),
]

# 外壁テクスチャ 1 枚の大きさ [m] (幅, 高さ)。テクスチャは 64px/m
TILE = {"house2": (4.0, 6.0), "house1": (4.0, 3.2), "apartment": (4.0, 2.9), "office": (4.0, 3.6),
        "shop": (4.0, 6.5), "factory": (4.0, 7.0), "shed": (4.0, 3.0)}
PX = 64
PLAIN_UV = (0.02, 0.48, 0.07, 0.52)  # どのテクスチャでも壁の地の色だけの所 (切妻の三角に使う)


def _shade(c, k):
    return tuple(int(max(0, min(255, v * k))) for v in c)


def _base(rng, w, h, color, amp=5):
    n = rng.normal(0, amp, (h, w, 1))
    img = np.clip(np.array(color, dtype=float) + n, 0, 255).astype(np.uint8)
    return Image.fromarray(img)


def _window(d, x0, y0, x1, y1, frame=(186, 188, 186), sash=True, shutter_box=False):
    """アルミサッシの窓。ガラスは上が明るい (空の映り込み)。"""
    d.rectangle([x0 - 3, y0 - 3, x1 + 3, y1 + 3], fill=frame)
    for y in range(y0, y1):
        t = (y - y0) / max(y1 - y0, 1)
        g = (int(120 - 70 * t), int(140 - 75 * t), int(160 - 70 * t))
        d.line([(x0, y), (x1, y)], fill=g)
    if sash:
        mx = (x0 + x1) // 2
        d.rectangle([mx - 2, y0, mx + 2, y1], fill=frame)
    d.rectangle([x0 - 5, y1 + 3, x1 + 5, y1 + 7], fill=_shade(frame, 0.8))  # 水切り
    if shutter_box:  # 雨戸の戸袋
        d.rectangle([x1 + 6, y0 - 3, x1 + 6 + (x1 - x0) // 2, y1 + 3], fill=_shade(frame, 0.9))


def _bands(d, w, h, top_px, bottom_px, top_col, bottom_col):
    d.rectangle([0, 0, w, top_px], fill=top_col)
    d.rectangle([0, h - bottom_px, w, h], fill=bottom_col)


def make_building_textures(tex_dir, seed=11):
    """外壁と屋根のテクスチャを作り、{マテリアル名: 種類} を返す。"""
    rng = np.random.default_rng(seed)
    made = {}
    found = (150, 150, 146)  # 基礎のコンクリート

    for k, col in enumerate(WALL_COLORS["house"]):
        for style in ("house2", "house1"):
            w, h = int(TILE[style][0] * PX), int(TILE[style][1] * PX)
            img = _base(rng, w, h, col, 4)
            d = ImageDraw.Draw(img)
            frame = (190, 190, 186) if k % 2 == 0 else (82, 70, 60)
            _bands(d, w, h, 10, 30, _shade(col, 0.55), found)
            if style == "house2":
                # 2 階: 腰窓 2 つ / 1 階: 掃き出し窓と玄関
                _window(d, 36, 70, 136, 150, frame, shutter_box=k % 3 == 0)
                _window(d, 180, 84, 222, 130, frame, sash=False)
                d.line([(0, 190), (w, 190)], fill=_shade(col, 0.85), width=4)  # 階の境目
                _window(d, 30, 222, 140, 344, frame)
                d.rectangle([174, 226, 230, 352], fill=_shade(frame, 0.75))      # 玄関ドア
                d.rectangle([180, 232, 224, 346], fill=(122, 92, 64) if k % 2 else (150, 150, 146))
                d.ellipse([214, 286, 220, 292], fill=(210, 200, 160))
                d.rectangle([168, 214, 236, 222], fill=_shade(col, 0.6))         # 玄関の庇
            else:
                _window(d, 30, 50, 150, 168, frame)
                _window(d, 180, 66, 222, 112, frame, sash=False)
            img = img.filter(ImageFilter.GaussianBlur(0.6))
            name = f"wall_{style}_{k}"
            img.save(tex_dir / f"{name}.png")
            made[name] = style

    for k, col in enumerate(WALL_COLORS["apartment"]):
        w, h = int(TILE["apartment"][0] * PX), int(TILE["apartment"][1] * PX)
        img = _base(rng, w, h, col, 4)
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, w, 14], fill=(176, 176, 172))                  # スラブ
        _window(d, 26, 28, 230, 172, (180, 182, 182))                      # 掃き出し窓
        rail = (232, 232, 228) if k != 1 else (120, 124, 128)
        d.rectangle([0, 104, w, 172], fill=rail)                           # ベランダの手すり壁
        for x in range(8, w, 16):
            d.line([(x, 108), (x, 168)], fill=_shade(rail, 0.9), width=2)
        d.rectangle([0, 100, w, 106], fill=_shade(rail, 0.7))
        d.rectangle([0, 14, 8, 172], fill=_shade(col, 0.8))                 # 隣との仕切り
        d.rectangle([w - 8, 14, w, 172], fill=_shade(col, 0.8))
        d.rectangle([0, 172, w, h], fill=(176, 176, 172))
        img = img.filter(ImageFilter.GaussianBlur(0.6))
        name = f"wall_apartment_{k}"
        img.save(tex_dir / f"{name}.png")
        made[name] = "apartment"

    for k, col in enumerate(WALL_COLORS["office"]):
        w, h = int(TILE["office"][0] * PX), int(TILE["office"][1] * PX)
        img = _base(rng, w, h, col, 3)
        d = ImageDraw.Draw(img)
        for x0 in range(4, w, 64):
            _window(d, x0 + 6, 70, x0 + 58, 196, (170, 172, 174), sash=False)
        img = img.filter(ImageFilter.GaussianBlur(0.6))
        name = f"wall_office_{k}"
        img.save(tex_dir / f"{name}.png")
        made[name] = "office"

    for k, col in enumerate(WALL_COLORS["shop"]):
        w, h = int(TILE["shop"][0] * PX), int(TILE["shop"][1] * PX)
        img = _base(rng, w, h, col, 4)
        d = ImageDraw.Draw(img)
        _bands(d, w, h, 12, 20, _shade(col, 0.6), found)
        _window(d, 40, 60, 216, 140, (170, 172, 174))
        sign = [(200, 50, 40), (40, 90, 160), (230, 170, 40)][k]
        d.rectangle([0, 196, w, 246], fill=sign)                            # 看板の帯
        d.rectangle([0, 246, w, 252], fill=_shade(sign, 0.6))
        if k == 1:  # シャッター
            d.rectangle([8, 256, 248, 396], fill=(170, 172, 170))
            for y in range(258, 396, 6):
                d.line([(8, y), (248, y)], fill=(140, 142, 140))
        else:       # ガラスの店先
            _window(d, 10, 262, 246, 392, (150, 152, 154))
        img = img.filter(ImageFilter.GaussianBlur(0.6))
        name = f"wall_shop_{k}"
        img.save(tex_dir / f"{name}.png")
        made[name] = "shop"

    for k, col in enumerate(WALL_COLORS["factory"]):
        w, h = int(TILE["factory"][0] * PX), int(TILE["factory"][1] * PX)
        img = _base(rng, w, h, col, 3)
        d = ImageDraw.Draw(img)
        for x in range(0, w, 10):  # 波板
            d.line([(x, 0), (x, h)], fill=_shade(col, 0.86), width=3)
            d.line([(x + 5, 0), (x + 5, h)], fill=_shade(col, 1.05), width=1)
        _window(d, 60, 70, 196, 120, (170, 172, 174))
        d.rectangle([0, h - 58, w, h], fill=found)
        name = f"wall_factory_{k}"
        img.save(tex_dir / f"{name}.png")
        made[name] = "factory"

    w, h = int(TILE["shed"][0] * PX), int(TILE["shed"][1] * PX)
    img = _base(rng, w, h, WALL_COLORS["shed"][0], 6)
    d = ImageDraw.Draw(img)
    for x in range(0, w, 10):
        d.line([(x, 0), (x, h)], fill=(120, 122, 120), width=3)
    img.save(tex_dir / "wall_shed_0.png")
    made["wall_shed_0"] = "shed"

    S = 256  # 屋根は 4m 四方で 1 枚
    for name, col, _, pattern in ROOFS_PITCHED:
        img = _base(rng, S, S, col, 6)
        d = ImageDraw.Draw(img)
        if pattern == "kawara":       # 瓦: 横の段と縦の波
            for y in range(0, S, 18):
                d.line([(0, y), (S, y)], fill=_shade(col, 0.6), width=3)
                for x in range(0, S, 16):
                    d.line([(x, y + 3), (x, y + 15)], fill=_shade(col, 0.82), width=2)
        elif pattern == "slate":      # スレート: 段とずらした継ぎ目
            for y in range(0, S, 22):
                d.line([(0, y), (S, y)], fill=_shade(col, 0.7), width=2)
                off = 0 if (y // 22) % 2 else 16
                for x in range(off, S, 32):
                    d.line([(x, y), (x, y + 22)], fill=_shade(col, 0.8), width=1)
        else:                          # 金属: 縦はぜ
            for x in range(0, S, 28):
                d.line([(x, 0), (x, S)], fill=_shade(col, 1.15), width=3)
                d.line([(x + 3, 0), (x + 3, S)], fill=_shade(col, 0.75), width=2)
        img.save(tex_dir / f"{name}.png")
        made[name] = "roof"
    for name, col, _ in ROOFS_FLAT:
        img = _base(rng, S, S, col, 8)
        d = ImageDraw.Draw(img)
        for y in range(0, S, 128):
            d.line([(0, y), (S, y)], fill=_shade(col, 0.85), width=2)
        img.save(tex_dir / f"{name}.png")
        made[name] = "roof"
    img = _base(rng, S, S, (200, 198, 192), 4)  # 軒天
    img.save(tex_dir / "soffit.png")
    made["soffit"] = "roof"
    return made


# --------------------------------------------------------------------------- 形

def signed_area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


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


def min_rect(p):
    """面積最小の外接長方形 (中心, 長辺方向の単位ベクトル, 長辺の半分, 短辺の半分)。"""
    best = None
    for i in range(len(p)):
        e = p[(i + 1) % len(p)] - p[i]
        L = np.linalg.norm(e)
        if L < 1e-6:
            continue
        ax = e / L
        ay = np.array([-ax[1], ax[0]])
        u, v = p @ ax, p @ ay
        area = np.ptp(u) * np.ptp(v)
        if best is None or area < best[0]:
            c = ax * (u.max() + u.min()) / 2 + ay * (v.max() + v.min()) / 2
            hu, hv = np.ptp(u) / 2, np.ptp(v) / 2
            best = (area, c, ax, hu, hv) if hu >= hv else (area, c, ay, hv, hu)
    return best


BUILDING_KINDS = {  # OSM の building=* -> 種類
    "house": "house", "detached": "house", "residential": "house", "semidetached_house": "house",
    "terrace": "house", "farm": "house", "temple": "house", "shrine": "house",
    "apartments": "apartment", "dormitory": "apartment",
    "commercial": "shop", "retail": "shop", "supermarket": "shop", "kiosk": "shop",
    "office": "office", "school": "office", "university": "office", "hospital": "office",
    "public": "office", "civic": "office", "government": "office", "hotel": "office",
    "industrial": "factory", "warehouse": "factory", "factory": "factory", "manufacture": "factory",
    "garage": "shed", "garages": "shed", "shed": "shed", "hut": "shed", "farm_auxiliary": "shed",
    "barn": "shed", "greenhouse": "shed", "carport": "shed", "roof": "shed",
}
FLOOR_H = {"house": 3.0, "apartment": 2.9, "office": 3.6, "shop": 3.25, "factory": 7.0, "shed": 3.0}


def classify(tags, area, rect_ratio, bid, gsi_code=None):
    """(種類, 階数, 高さ [m])。OSM の階数・高さタグがあればそれを使う。"""
    kind = BUILDING_KINDS.get(tags.get("building", "yes"))
    if tags.get("shop") and kind in (None, "house"):
        kind = "shop"
    r = (bid * 2654435761 % 2 ** 32) / 2 ** 32  # 建物ごとに決まった乱数
    floors = None
    if gsi_code == 3103:                       # 高層建物
        kind, floors = "apartment", 8 + int(r * 8)
    elif gsi_code == 3102:                     # 堅ろう建物 (鉄筋コンクリートなど)
        kind = kind or ("apartment" if r < 0.55 else "office")
        floors = 3 if area < 150 else 4 if area < 600 else 5 if area < 1500 else 4
    if kind is None:                           # 普通建物: 面積と形から推測
        if area < 25:
            kind = "shed"
        elif area < 260:
            kind = "house"
        elif area < 900:
            kind = "factory" if rect_ratio > 0.85 and r < 0.6 else "shop"
        else:
            kind = "factory"
    if floors is None:
        floors = {"house": 1 if (area < 55 or r < 0.15) else 2, "apartment": 3, "office": 3,
                  "shop": 2, "factory": 1, "shed": 1}[kind]
    lv = tags.get("building:levels", "")
    if lv.isdigit() and int(lv) > 0:
        floors = int(lv)
        if kind in ("house", "shop") and floors >= 3:
            kind = "apartment"
    m = re.match(r"[\d.]+", tags.get("height", ""))
    height = float(m.group(0)) if m else floors * FLOOR_H[kind] if kind != "factory" else (6.0 + 2.0 * r)
    return kind, floors, height


class PhotoColor:
    """航空写真から、ある地点の色 (周り 3x3 ピクセルの平均) を取る。"""

    def __init__(self, photos, chunk_of, proj, cache=24):
        self.photos, self.chunk_of, self.proj = photos, chunk_of, proj
        self.cache, self.size = OrderedDict(), cache

    def __call__(self, x, y):
        key = self.chunk_of(x, y)
        ph = self.photos.get(key)
        if ph is None:
            return None
        if key not in self.cache:
            self.cache[key] = np.asarray(Image.open(ph["path"]).convert("RGB"), dtype=np.float32)
            if len(self.cache) > self.size:
                self.cache.popitem(last=False)
        img = self.cache[key]
        self.cache.move_to_end(key)
        la, lo = self.proj.to_latlon(x, y)
        u, v = ph["uv"](la, lo)
        px = int(np.clip(u * img.shape[1], 1, img.shape[1] - 2))
        py = int(np.clip((1 - v) * img.shape[0], 1, img.shape[0] - 2))
        return img[py - 1:py + 2, px - 1:px + 2].reshape(-1, 3).mean(axis=0)


def _nearest(color, palette):
    """航空写真の色に一番近い屋根 (palette の 3 番目が写真での見え方)。"""
    if color is None:
        return palette[0][0]
    d = [np.sum((np.array(e[2], dtype=float) - color) ** 2) for e in palette]
    return palette[int(np.argmin(d))][0]


class BuildingMaker:
    def __init__(self, out, grid, photo_color, wall_materials):
        self.out, self.grid, self.photo = out, grid, photo_color
        self.walls = {}
        for name, style in wall_materials.items():
            self.walls.setdefault(style, []).append(name)
        self.count = {}

    def add(self, bid, tags, p, area, gsi_code=None):
        rect = min_rect(p)
        ratio = area / rect[0] if rect and rect[0] > 0 else 0
        kind, floors, height = classify(tags, area, ratio, bid, gsi_code)
        self.count[kind] = self.count.get(kind, 0) + 1
        r = (bid * 40503 % 65536) / 65536
        gz = self.grid.height(p[:, 0], p[:, 1])
        base = gz.min() - 0.3
        top = max(float(gz.mean()) + height, float(gz.max()) + min(height, 2.5))
        cx, cy = p.mean(axis=0)
        color = self.photo(cx, cy) if self.photo else None

        if kind in ("house",):
            style = "house2" if floors >= 2 else "house1"
        else:
            style = kind
        wall = self._pick(style, r)
        pitched = kind in ("house", "shed") and ratio > 0.8 and area < 500 \
            or kind == "factory" and ratio > 0.9 and area < 3000
        parapet = 0.0 if pitched else (0.9 if kind in ("apartment", "office") else 0.5)
        self._walls(p, base, top + parapet, wall, style, floors, cx, cy)
        if pitched:
            roof = _nearest(color, ROOFS_PITCHED) if kind == "house" else \
                _nearest(color, [x for x in ROOFS_PITCHED if x[3] == "metal"])
            pitch = 0.42 if kind == "house" else 0.18
            hip = kind == "house" and r < 0.45
            self._pitched(rect, top, roof, wall, pitch, 0.0 if kind == "factory" else 0.5, hip, cx, cy)
        else:
            self._flat(p, top, _nearest(color, ROOFS_FLAT), cx, cy)

    def _pick(self, style, r):
        lst = self.walls[style]
        return lst[int(r * len(lst)) % len(lst)]

    def _walls(self, p, base, top, wall, style, floors, cx, cy):
        """1 辺 1 枚の壁。家・店・工場はテクスチャ 1 枚を高さいっぱいに、
        マンションとビルは 1 階ぶんのテクスチャを上から繰り返す。"""
        n = len(p)
        q = np.roll(p, -1, axis=0)
        tw, th = TILE[style]
        lens = np.linalg.norm(q - p, axis=1)
        # 1 枚の幅 (4m) に近い整数枚になるように u をそろえる (窓が途中で切れにくい)
        reps = np.maximum(np.round(lens / tw), 1)
        u_end = np.cumsum(reps)
        u_start = u_end - reps
        if style in ("apartment", "office"):
            v_top = float(math.ceil((top - base) / th))
            v_bot = v_top - (top - base) / th
        else:
            v_top, v_bot = 1.0, 0.0
        verts = np.concatenate([np.column_stack([p, np.full(n, base)]), np.column_stack([q, np.full(n, base)]),
                                np.column_stack([q, np.full(n, top)]), np.column_stack([p, np.full(n, top)])])
        uvs = np.concatenate([np.column_stack([u_start, np.full(n, v_bot)]),
                              np.column_stack([u_end, np.full(n, v_bot)]),
                              np.column_stack([u_end, np.full(n, v_top)]),
                              np.column_stack([u_start, np.full(n, v_top)])])
        i = np.arange(n)
        faces = np.vstack([np.stack([i, i + n, i + 2 * n], 1), np.stack([i, i + 2 * n, i + 3 * n], 1)])
        self.out.add("bld_wall", wall, cx, cy, verts, uvs, faces)

    def _flat(self, p, top, roof, cx, cy):
        n = len(p)
        tri = earcut.triangulate_float64(p, np.array([n], dtype=np.uint32)).reshape(-1, 3)
        if not len(tri):
            return
        e1, e2 = p[tri[:, 1]] - p[tri[:, 0]], p[tri[:, 2]] - p[tri[:, 0]]
        flip = (e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]) < 0
        tri[flip] = tri[flip][:, [0, 2, 1]]  # 上向きにそろえる
        self.out.add("bld_roof", roof, cx, cy, np.column_stack([p, np.full(n, top)]), p / 4, tri)

    def _pitched(self, rect, top, roof, wall, pitch, overhang, hip, cx, cy):
        """長方形に切妻 / 寄棟の屋根。壁の上端で屋根面に接し、軒は overhang [m] 張り出す。"""
        _, c, ax, hl, hs = rect
        ay = np.array([-ax[1], ax[0]])
        rise = pitch * hs                       # 棟の高さ
        slope = pitch
        eave_z = top - slope * overhang         # 軒先の高さ
        L, S = hl + overhang, hs + overhang     # 軒先の長方形の半分
        A, B = c - ax * L - ay * S, c + ax * L - ay * S
        C, D = c + ax * L + ay * S, c - ax * L + ay * S
        ridge_z = top + rise
        if hip:
            k = max(L - S, 0.0)
            R1, R2 = c - ax * k, c + ax * k
        else:
            R1, R2 = c - ax * L, c + ax * L
        P = lambda xy, z: (float(xy[0]), float(xy[1]), float(z))  # noqa: E731
        slant = math.hypot(S, rise + slope * overhang) / 4
        v, uv, f = [], [], []

        def quad(pts, uvs):
            b = len(v)
            v.extend(pts)
            uv.extend(uvs)
            f.extend([(b, b + 1, b + 2), (b, b + 2, b + 3)] if len(pts) == 4 else [(b, b + 1, b + 2)])

        ln = 2 * L / 4
        # 長辺側の 2 面 (寄棟なら台形)
        quad([P(A, eave_z), P(B, eave_z), P(R2, ridge_z), P(R1, ridge_z)],
             [(0, 0), (ln, 0), (ln - (L - np.linalg.norm(R2 - c)) / 4, slant), ((L - np.linalg.norm(R1 - c)) / 4, slant)])
        quad([P(C, eave_z), P(D, eave_z), P(R1, ridge_z), P(R2, ridge_z)],
             [(0, 0), (ln, 0), (ln - (L - np.linalg.norm(R1 - c)) / 4, slant), ((L - np.linalg.norm(R2 - c)) / 4, slant)])
        if hip:   # 妻側の 2 面 (三角)
            quad([P(B, eave_z), P(C, eave_z), P(R2, ridge_z)], [(0, 0), (2 * S / 4, 0), (S / 4, slant)])
            quad([P(D, eave_z), P(A, eave_z), P(R1, ridge_z)], [(0, 0), (2 * S / 4, 0), (S / 4, slant)])
        self.out.add("bld_roof", roof, cx, cy, v, uv, f)

        if overhang > 0:  # 軒天 (下から見たときの軒の裏)。下向きの平らな面
            sv = [P(A, eave_z - 0.05), P(D, eave_z - 0.05), P(C, eave_z - 0.05), P(B, eave_z - 0.05)]
            self.out.add("bld_roof", "soffit", cx, cy, sv, [(0, 0), (0, 1), (1, 1), (1, 0)], [(0, 1, 2), (0, 2, 3)])
        if not hip:       # 切妻の三角の壁 (壁の面の位置)
            Bw, Cw = c + ax * hl - ay * hs, c + ax * hl + ay * hs
            Dw, Aw = c - ax * hl + ay * hs, c - ax * hl - ay * hs
            u0, v0, u1, v1 = PLAIN_UV
            gv = [P(Bw, top), P(Cw, top), P(c + ax * hl, ridge_z), P(Dw, top), P(Aw, top), P(c - ax * hl, ridge_z)]
            guv = [(u0, v0), (u1, v0), ((u0 + u1) / 2, v1)] * 2
            self.out.add("bld_wall", wall, cx, cy, gv, guv, [(0, 1, 2), (3, 4, 5)])
