# 釘配置図（画像）から、盤面の壁・釘・入賞口を丸ごと読み取って board.js 用の JSON を作る。
#   python3 gen_board9.py 図.png geom9.json [確認用.png]
# 図の「玉が通れる白い部分」を塗りつぶしで取り出し、その境界線をそのまま壁にする。
# 釘・文字は小さな島として白に戻してから塗るので、釘は別に丸の見本照合で拾う。
import sys, json, cv2, numpy as np

src, out = sys.argv[1], sys.argv[2]
img = cv2.imread(src)
f = img.astype(int)
H_, W_ = img.shape[:2]

# 図に書き込まれた赤い囲み（左のレール）は消して、下の線を補う
red = ((f[..., 2] > 150) & (f[..., 1] < 140) & (f[..., 0] < 140) & (f[..., 2] - f[..., 1] > 60)).astype(np.uint8)
box = np.zeros_like(red); box[410:770, 60:215] = 1
img = cv2.inpaint(img, cv2.dilate(red & box, np.ones((3, 3), np.uint8)), 4, cv2.INPAINT_TELEA)
f = img.astype(int)
gray = (abs(f[..., 0] - f[..., 1]) < 14) & (abs(f[..., 1] - f[..., 2]) < 14) & (f[..., 1] > 110) & (f[..., 1] < 215)
gray0 = gray & (f.min(2) >= 170) & (f.max(2) <= 205)   # U字の縁の灰色（数字のふちや、カップの中の薄い影は入れない）

# ---- 釘 ----
g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
best = None
for rad in (4, 5):
    T = np.full((15, 15), 255, np.float32); cv2.circle(T, (7, 7), rad, 60, 2, lineType=cv2.LINE_AA)
    r = cv2.matchTemplate(g, T, cv2.TM_CCOEFF_NORMED)
    best = r if best is None else np.maximum(best, r)

# 釘の候補（あとで通れる部分の中のものだけ残す）。壁を作る前に、図から釘を消しておく
# （くっついて並んだ釘が1つの塊＝太い壁にならないように）
ys, xs = np.where(best > 0.5)
cand = sorted([(float(best[y, x]), int(x) + 7, int(y) + 7) for y, x in zip(ys, xs)], reverse=True)
cand_nms = []
for sc, x, y in cand:
    if sc >= 0.56 and all((x - px) ** 2 + (y - py) ** 2 > 8 ** 2 for _, px, py in cand_nms): cand_nms.append((sc, x, y))
img_nails = img.copy()
for sc, x, y in cand_nms:
    if 290 < y < 1165 and not (x > 700 and y > 1030):
        cv2.circle(img, (x, y), 7, (255, 255, 255), -1)
cv2.circle(img, (191, 898), 6, (255, 255, 255), -1)   # 風車の軸
f = img.astype(int)

# ---- 玉が通れる部分 ----
FREE_T = int(sys.argv[4]) if len(sys.argv) > 4 else 222
free = ((f[..., 0] > FREE_T) & (f[..., 1] > FREE_T) & (f[..., 2] > FREE_T)).astype(np.uint8)
# アタッカーのふた（赤）は開閉するので、ここでは通れる扱い（閉じているときは物理側で線を足す）
att = (f[..., 2] > 180) & (f[..., 1] < 140) & (f[..., 0] < 140); att[:590] = 0; att[625:] = 0; att[:, :890] = 0
free[att] = 1
nf = (1 - free).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(nf, connectivity=8)
free[np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] < 160])] = 1  # 釘・文字
def flood(free):
    nf = (1 - free).astype(np.uint8)
    reg = (1 - cv2.dilate(nf, np.ones((3, 3), np.uint8))).astype(np.uint8)
    ff = np.zeros((H_ + 2, W_ + 2), np.uint8)
    cv2.floodFill(reg, ff, (150, 820), 2, flags=4)
    return cv2.dilate((reg == 2).astype(np.uint8), np.ones((3, 3), np.uint8)) & free
region = flood(free)
# ステージの手前のふち（液晶の下の枠のいちばん下の線と、ステージの左はしの縦の線）は、道釘の上にかぶさって
# 描かれているだけで、玉はその下（道釘の列の上）を転がってヘソのほうへ行く。この線は壁にしない
for x in range(234, 662):
    col = np.where(region[880:1100, x])[0]
    if not len(col): continue
    r0 = 880 + col[0]
    for y in range(r0 - 1, r0 - 8, -1):
        if f[y, x].min() >= 140: free[y, x] = 1
        else: break
sub = free[903:942, 222:238]; sub[:] = 1   # ステージの左はしの縦の線のうち、ステージの床より下の部分
region = flood(free)
# 線のふちのぼかし（薄い灰色）までは通れる側に入れる（図の線の太さの真ん中あたりが本当の壁の面）
region |= cv2.dilate(region, np.ones((3, 3), np.uint8)) & (f.min(2) > 170).astype(np.uint8)

def fill_circle(cx, cy, r):
    m = np.zeros_like(region); cv2.circle(m, (cx, cy), r, 1, -1); region[m == 1] = 1
def fill_inside(x0, y0, x1, y1):
    # カップの中（灰色のU字の縁は残す。中の数字は消す）を通れる部分にする。口の両はしの「つの」も縁として残る
    sub = gray0[y0:y1, x0:x1].astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(sub, connectivity=8)
    band = (lab == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)   # いちばん大きい灰色＝U字の縁
    hull = cv2.convexHull(cv2.findNonZero(band))
    m = np.zeros_like(sub); cv2.fillPoly(m, [hull], 1)
    inner = (m == 1) & (cv2.dilate(band, np.ones((3, 3), np.uint8)) == 0)
    region[y0:y1, x0:x1][inner] = 1
    ys, xs = np.nonzero(inner)
    return (x0 + xs.mean(), y0 + ys.max() - 9)            # 入賞の判定位置：カップの底に玉が乗ったときの中心

# 打ち出しレーン：内レール（太い灰色）の左は盤面に入れない（レーンは物理側で別に扱う）
rail = []; x = 93.0
for y in range(760, 395, -2):
    lo = int(x) - 12; xs = np.where(gray[y, lo:int(x) + 14])[0] + lo
    runs = []
    for xx in xs:
        if runs and xx - runs[-1][1] <= 1: runs[-1][1] = xx
        else: runs.append([xx, xx])
    runs = [q for q in runs if q[1] - q[0] >= 3]
    if not runs: break
    q = min(runs, key=lambda q: abs((q[0] + q[1]) / 2 - x)); x = (q[0] + q[1]) / 2
    rail.append((int(q[0]), int(q[1]), y))
for a, c, y in rail:
    region[y:y + 2, :a] = 0
RAIL_TOP = rail[-1][2]
# レーン出口の戻り玉防止弁、風車、ヘソ、電チューのベロは物理側で扱うので壁にしない
# 外レール（細い黒線）を、レーンの下から出口の先まで1本のなめらかな曲線にする。
# レーンの玉の通り道と、出口のあたりの壁は、どちらもこの曲線から作る（段差があると強く打った玉が止まる）
dark = (f.max(2) < 200) & (f.max(2) - f.min(2) < 30)
arc = []
for a, c, y in rail:
    xx = np.where(dark[y, max(0, a - 40):a - 1])[0]
    if len(xx): arc.append((max(0, a - 40) + int(xx[-1]), y))
px = arc[-1][0]
for y in range(RAIL_TOP - 2, 299, -2):                 # 内レールの上端より上：前の行の近くの黒い点を追う
    lo = int(px) - 8; xx = np.where(f[y, lo:int(px) + 12].max(1) < 150)[0]
    if len(xx): px = lo + int(xx[0]); arc.append((px, y))
ay = np.array([p[1] for p in arc], float); ax = np.array([p[0] for p in arc], float)
co = np.polyfit(ay, ax, 4)
for _ in range(3):                                      # はずれ値（弁の取っ手など）を除いてもう一度
    keep = np.abs(np.polyval(co, ay) - ax) < 3
    co = np.polyfit(ay[keep], ax[keep], 4)
# 黒い線の中心から、通れる部分のふち（線の内側）までのずれ（内レールの上端の少し上で測る）
nat = lambda y: np.where(region[y, 150:300])[0][0] + 150
ARC_IN = float(np.median([nat(y) - np.polyval(co, y) for y in range(330, 345)]))
arcfit = lambda y: float(np.polyval(co, y)) + ARC_IN
# 出口のまわり（y=250〜内レールの上端）の外レールは、図のふちと上の曲線を1本のなめらかな曲線にして壁にする
# （折れ線のがたつきがあると、強く打った玉がレールから離れて釘に当たってしまう）
py_ = list(range(250, 341, 3)) + list(range(345, RAIL_TOP + 2, 3))
px_ = [nat(y) for y in range(250, 341, 3)] + [arcfit(y) for y in range(345, RAIL_TOP + 2, 3)]
co_top = np.polyfit(py_, px_, 3)
for y in range(250, RAIL_TOP + 2):
    sx = int(round(np.polyval(co_top, y)))
    region[y, 100:sx] = 0
    if y >= 300: region[y, sx:215] = 1
print("ARC_IN", round(ARC_IN, 2), "nat/arcfit at 345:", nat(345), round(arcfit(345), 1))
fill_circle(191, 898, 34)
fill_circle(557, 1100, 22)
lever = (f[..., :].max(2) < 120); lever[:1052] = 0; lever[1082:] = 0; lever[:, :722] = 0; lever[:, 795:] = 0
region[cv2.dilate(lever.astype(np.uint8), np.ones((5, 5), np.uint8)) == 1] = 1
# 一般入賞口（⑤のカップ3つとサブデジ）：カップの中を通れるようにして、中に落ちたら入賞
CUPS = [(268, 1055, 312, 1096), (354, 1081, 397, 1121), (388, 1097, 432, 1138)]
POCKETS = [fill_inside(*c) + (5,) for c in CUPS] + [fill_inside(727, 1104, 763, 1156) + (1,)]
# 盤面の外へ漏れないように、外枠の外側は消す
region[1163:] = 0
# ワープ出口の筒の左のくぼみ（筒のふちと枠のあいだ）は、玉がはまって動けなくなるので上を斜めにならす
cv2.fillPoly(region, [np.array([(222, 792), (222, 824), (204, 820)], np.int32)], 0)
# 玉の入れない細いすき間（線と線のあいだの白い筋）は埋める。玉が楔のように挟まらないように
region = cv2.morphologyEx(region, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))

# ステージからこぼれた玉が落ちる位置：液晶の下の枠のすぐ下（通れる部分の上端）
SPILL = []
for sx in list(range(290, 521, 25)) + list(range(600, 641, 20)):
    col = np.where(region[880:1100, sx])[0]
    if len(col): SPILL.append([round((sx - 79) * 300 / 949, 2), round((880 + col[0] + 11 - 158) * 300 / 949, 2)])
# 液晶の窓が通れる部分にかかっていないか
lcd = region[410:860, 300:850]
print("LCD overlaps playable px:", int(lcd.sum()))

# ---- 壁（通れる部分の境界線）----
cs, hier = cv2.findContours(region, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
O = (79, 158); S = 300 / 949
T = lambda x, y: [round((x - O[0]) * S, 2), round((y - O[1]) * S, 2)]
polys = []
for c in cs:
    if cv2.contourArea(c) < 120: continue                  # 線の切れはしのような小さい島は壁にしない
    a = cv2.approxPolyDP(c, 0.9, True)[:, 0, :]
    polys.append([T(float(x), float(y)) for x, y in a])
segs = []
outer = max(range(len(polys)), key=lambda i: len(polys[i]))
for k, p in enumerate(polys):
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        if k == outer and a[1] > T(0, 1140)[1] and b[1] > T(0, 1140)[1]: continue  # 盤面の底はアウト口（開けておく）
        ty = T(0, RAIL_TOP)[1]
        if abs(a[1] - ty) < 1.2 and abs(b[1] - ty) < 1.2 and max(a[0], b[0]) < T(215, 0)[0]: continue  # レーンの出口（ふたをしない）
        segs.append(a + b)

# ---- 釘（通れる部分の中にあるものだけ）----
regd = cv2.dilate(region, np.ones((15, 15), np.uint8))
pins = []
for s, x, y in cand_nms:
    if not regd[y, x] or not (290 < y < 1165): continue
    if x > 700 and y > 1030: continue                       # 電チュー・入賞口の文字
    if abs(y - 1075) < 6 and abs(x - 557) < 20: continue    # 命釘は開きの設定で動かす
    if all((x - px) ** 2 + (y - py) ** 2 > 8 ** 2 for px, py in pins): pins.append((x, y))

# 打ち出しレーン：外レールの曲線から玉の半径ぶん内側を、玉の中心が通る。下（発射位置）から内レールの上端の先まで
lane = []
for y in np.linspace(785, RAIL_TOP - 30, 40):
    x0 = arcfit(y); dx = np.polyval(np.polyder(co), y)
    nx, ny = 1 / np.hypot(1, dx), -dx / np.hypot(1, dx)   # 内向きの法線
    off = (2.9 + 0.05) / S                                  # 玉の半径＋すき間
    lane.append(T(x0 + nx * off, y + ny * off))

G = {
    "W": 300, "H": round((1185 - O[1]) * S, 2),
    "SEGS": segs, "POLYS": polys, "OUTER": outer, "BOTTOM_OPEN_Y": T(0, 1140)[1], "PINS": [T(x, y) for x, y in pins], "LANE": lane, "RAIL_TOP_Y": T(0, RAIL_TOP)[1],
    "RAIL": [T(c + 0.5, y) for a, c, y in rail[::4]],
    "WINDMILL": T(191, 898) + [round(31 * S, 2)],
    "HESO": T(557.5, 1083), "INOCHI_Y": T(0, 1074.5)[1],
    "POCKETS": [T(x, y) + [pay] for x, y, pay in POCKETS],
    "ATTACKER": {"x0": T(898, 0)[0], "x1": T(990, 0)[0], "y": T(0, 607)[1]}, "ATTACKER_LID": T(990, 603) + T(898, 612),
    "DENCHU": T(756, 1058) + [round(33 * S, 2)], "DENCHU_BAR": T(722, 1062) + T(790, 1064),
    # ワープ入口：液晶の枠の左上（図の水色の通路の入口）。枠にそって落ちてきた玉が入る
    "WARP_IN": [T(234, 398), T(254, 418)],
    # ステージ：ワープの出口から液晶の下の枠の上を転がって中央へ。中央から落ちた玉はヘソの真上に出る
    "STAGE_PATH": [T(244, 860), T(330, 905), T(430, 950), T(520, 1000), T(566, 1036)], "STAGE_EXIT": T(557.5, 1066),
    "SPILL": SPILL,
    "LCD": dict(zip(["x0", "y0"], T(300, 410))) | dict(zip(["x1", "y1"], T(850, 860))),
}
json.dump(G, open(out, "w"))
print("segs", len(segs), "polys", len(polys), "pins", len(pins), "rail_top", RAIL_TOP)
if len(sys.argv) > 3:
    vis = img_nails.copy()
    for p in polys:
        q = np.array([[(x / S + O[0]), (y / S + O[1])] for x, y in p], np.int32)
        cv2.polylines(vis, [q], True, (0, 160, 0), 1)
    for x, y in pins: cv2.circle(vis, (x, y), 6, (0, 0, 255), 1)
    for x, y in lane: cv2.circle(vis, (int(x / S + O[0]), int(y / S + O[1])), 2, (255, 0, 0), -1)
    cv2.imwrite(sys.argv[3], vis)
