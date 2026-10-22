"""OpenStreetMap から指定範囲の道路データを取得して data/<track_id>/osm.json に保存する。

使い方:
    python tools/fetch_osm.py config/hakone_turnpike.json

Overpass API に繋がらない場合は OSM 本体の API を小さな範囲に分けて取りに行く。
それも駄目なら、https://www.openstreetmap.org/export で
同じ範囲を .osm (XML) として書き出し、--osm-file で渡してもよい。
"""
import argparse
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]


def query_overpass(bbox):
    s, w, n, e = bbox
    q = f"""
[out:json][timeout:180];
way["highway"]({s},{w},{n},{e});
(._;>;);
out body;
"""
    last = None
    for url in OVERPASS_URLS:
        try:
            print(f"Overpass: {url}")
            r = requests.post(url, data={"data": q}, timeout=(15, 240))
            r.raise_for_status()
            return r.json()
        except Exception as ex:  # 次のミラーを試す
            print(f"  失敗: {ex}")
            last = ex
    raise RuntimeError(f"どの Overpass サーバーにも接続できませんでした: {last}")


def query_osm_api(bbox, step=0.04):
    """OSM 本体の /map API (1 回 0.25 度四方・5 万ノードまで) を格子状に分けて呼ぶ。"""
    s, w, n, e = bbox
    rows, cols = math.ceil((n - s) / step), math.ceil((e - w) / step)
    merged = {}
    for i in range(rows):
        for j in range(cols):
            b = (w + j * step, s + i * step, min(w + (j + 1) * step, e), min(s + (i + 1) * step, n))
            print(f"OSM API {i * cols + j + 1}/{rows * cols}")
            r = requests.get("https://api.openstreetmap.org/api/0.6/map",
                             params={"bbox": ",".join(f"{v:.5f}" for v in b)}, timeout=180,
                             headers={"User-Agent": "ac-japan-track-tools"})
            if r.status_code == 400 and step > 0.01:  # ノードが多すぎる -> さらに細かく
                for el in query_osm_api([b[1], b[0], b[3], b[2]], step / 2)["elements"]:
                    merged[(el["type"], el["id"])] = el
                continue
            r.raise_for_status()
            for el in parse_osm_xml(r.content)["elements"]:
                merged[(el["type"], el["id"])] = el
    return {"elements": list(merged.values())}


def only_highways(data):
    """道路 (highway=*) とそのノードだけ残す。"""
    ways = [e for e in data["elements"] if e["type"] == "way" and "highway" in e.get("tags", {})]
    used = {n for w in ways for n in w["nodes"]}
    nodes = [e for e in data["elements"] if e["type"] == "node" and e["id"] in used]
    return {"elements": nodes + ways}


def parse_osm_xml(src):
    """.osm (XML) を Overpass JSON と同じ形にする。src はファイルパスか bytes。"""
    root = ET.fromstring(src) if isinstance(src, bytes) else ET.parse(src).getroot()
    elements = []
    for el in root:
        tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
        if el.tag == "node":
            elements.append({"type": "node", "id": int(el.get("id")),
                             "lat": float(el.get("lat")), "lon": float(el.get("lon")), "tags": tags})
        elif el.tag == "way":
            elements.append({"type": "way", "id": int(el.get("id")),
                             "nodes": [int(nd.get("ref")) for nd in el.findall("nd")], "tags": tags})
    return {"elements": elements}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    ap.add_argument("--osm-file", help="手動でダウンロードした .osm (XML) ファイル")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    out_dir = Path("data") / cfg["track_id"]
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.osm_file:
        data = parse_osm_xml(args.osm_file)
    else:
        try:
            data = query_overpass(cfg["bbox"])
        except RuntimeError as ex:
            print(ex)
            print("OSM 本体の API で取得します (少し時間がかかります)")
            data = query_osm_api(cfg["bbox"])
    data = only_highways(data)
    ways = [e for e in data["elements"] if e["type"] == "way"]
    if not ways:
        sys.exit("道路が見つかりませんでした。bbox を確認してください。")

    (out_dir / "osm.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"{len(ways)} 本の way を {out_dir / 'osm.json'} に保存しました")

    # 主要な道路の名前だけ表示する (細い道まで出すと多すぎるため)
    major = {"motorway", "trunk", "primary", "secondary", "tertiary"}
    names = sorted({w["tags"].get("name", "") for w in ways if w["tags"].get("highway") in major} - {""})
    print("範囲内の主な道路名 (config の route.name_regex の参考に):")
    for n in names:
        print("  ", n)


if __name__ == "__main__":
    main()
