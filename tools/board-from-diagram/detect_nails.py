import sys, json, cv2, numpy as np
img = cv2.imread(sys.argv[1])
g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
# 釘の見本：白い中に黒い縁の小さな丸（直径9px・縁2px）を合成して使う
T = np.full((15, 15), 255, np.float32)
cv2.circle(T, (7, 7), 4, 60, 2, lineType=cv2.LINE_AA)
res = cv2.matchTemplate(g, T, cv2.TM_CCOEFF_NORMED)
th = float(sys.argv[4]) if len(sys.argv) > 4 else 0.6
ys, xs = np.where(res > th)
cand = sorted([(float(res[y, x]), x + 7, y + 7) for y, x in zip(ys, xs)], reverse=True)
pts = []
skip = lambda cx, cy: cy < 300 or cy > 1150 or (cx < 300 and cy < 345) or (290 < cx < 600 and 435 < cy < 595) or cx > 1040 or (cx > 840 and cy < 300)
for s, x, y in cand:
    if skip(x, y): continue
    if all((x - px) ** 2 + (y - py) ** 2 > 7 ** 2 for px, py, _ in pts): pts.append((x, y, round(s, 2)))
out = img.copy()
for x, y, s in pts: cv2.circle(out, (int(x), int(y)), 7, (0, 0, 255), 2)
cv2.imwrite(sys.argv[2], out)
json.dump([(float(x), float(y)) for x, y, s in pts], open(sys.argv[3], "w"))
print(len(pts))
