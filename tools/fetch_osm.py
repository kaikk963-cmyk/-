"""OpenStreetMap から指定範囲の道路データを取得して data/<track_id>/osm.json に保存する。

使い方:
    python tools/fetch_osm.py config/hakone_turnpike.json

Overpass API に繋がらない場合は、https://www.openstreetmap.org/export で
同じ範囲を .osm (XML) として書き出し、--osm-file で渡してもよい。
"""
import argparse
import json
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
            r = requests.post(url, data={"data": q}, timeout=240)
            r.raise_for_status()
            return r.json()
        except Exception as ex:  # 次のミラーを試す
            print(f"  失敗: {ex}")
            last = ex
    raise RuntimeError(f"どの Overpass サーバーにも接続できませんでした: {last}")


def parse_osm_xml(path):
    """openstreetmap.org の Export で落とした .osm を Overpass JSON と同じ形にする。"""
    root = ET.parse(path).getroot()
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

    data = parse_osm_xml(args.osm_file) if args.osm_file else query_overpass(cfg["bbox"])
    ways = [e for e in data["elements"] if e["type"] == "way"]
    if not ways:
        sys.exit("道路が見つかりませんでした。bbox を確認してください。")

    (out_dir / "osm.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"{len(ways)} 本の way を {out_dir / 'osm.json'} に保存しました")

    names = sorted({w["tags"].get("name", "") for w in ways} - {""})
    print("範囲内の道路名 (config の route.name_regex の参考に):")
    for n in names:
        print("  ", n)


if __name__ == "__main__":
    main()
