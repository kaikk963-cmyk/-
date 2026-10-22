"""build_track.py / build_region.py の出力を Blender に読み込み、AC 用ダミー (Empty) を配置して FBX を書き出す。

使い方 (Blender 3.6 / 4.x / 5.x):
    blender -b -P blender/import_to_blender.py -- out/hakone_turnpike/build
GUI で確認したい場合は -b を外す。

出力: <build>/track.blend と <build>/<track_id>.fbx (KsEditor に読み込む)。
建物や木がある場合は <track_id>_objects.fbx / <track_id>_trees.fbx にも分けて書き出す。
"""
import json
import math
import sys
from pathlib import Path

import bpy

# 車がコースと逆向きにスポーンしたら True にして再実行する
FLIP_START_DIRECTION = False

# KsEditor ではこれらのマテリアルに ksPerPixelAT (アルファテスト) を設定する
ALPHA_MATERIALS = {"tree", "guardrail_jp", "signs"}

# 見た目だけの小物 (物理判定なし)。別の kn5 に分ける
OBJECT_PREFIXES = ("bld_", "pole_", "wire_", "signal_", "sign_")


def main():
    build = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    cfg = json.loads((build / "config.json").read_text(encoding="utf-8"))
    markers = json.loads((build / "markers.json").read_text(encoding="utf-8"))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    obj_path = str(build / "track.obj")
    if hasattr(bpy.ops.wm, "obj_import"):
        bpy.ops.wm.obj_import(filepath=obj_path)
    else:  # Blender 3.x 以前
        bpy.ops.import_scene.obj(filepath=obj_path)

    # OBJ 読み込みで付く ".001" などを除き、メッシュ名 = オブジェクト名にそろえる
    for ob in bpy.context.scene.objects:
        if ob.type == "MESH":
            ob.data.name = ob.name

    # 透明部分のあるテクスチャ (木・ガードレール・標識) は Blender 上でも抜けて見えるようにする
    for mat in bpy.data.materials:
        if mat.name.split(".")[0] not in ALPHA_MATERIALS or not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        tex = next((n for n in nodes if n.type == "TEX_IMAGE"), None)
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if tex and bsdf:
            mat.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            if hasattr(mat, "blend_method"):
                mat.blend_method = "CLIP"

    for name, m in markers.items():
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = "ARROWS"
        empty.empty_display_size = 2.0
        empty.location = m["pos"]
        dx, dy = m["dir"]
        # FBX (-Z forward, Y up) で書き出すと Blender の -Y が AC の +Z (車の前方) になる
        yaw = math.atan2(dx, -dy)
        if FLIP_START_DIRECTION:
            yaw += math.pi
        empty.rotation_euler = (0.0, 0.0, yaw)
        scene.collection.objects.link(empty)

    bpy.ops.wm.save_as_mainfile(filepath=str(build / "track.blend"))

    # 1 つの kn5 が大きくなりすぎないよう、地形・道路 / 建物などの小物 / 木 の 3 つに分けて書き出す
    # (広域モードではトラックフォルダの models.ini で 3 つまとめて読み込まれる)
    tid = cfg["track_id"]
    groups = {tid: [], tid + "_objects": [], tid + "_trees": []}
    for ob in scene.objects:
        if ob.type not in ("MESH", "EMPTY"):
            continue
        if ob.name.startswith("tree_"):
            groups[tid + "_trees"].append(ob)
        elif ob.name.startswith(OBJECT_PREFIXES):
            groups[tid + "_objects"].append(ob)
        else:
            groups[tid].append(ob)
    for name, obs in groups.items():
        if not obs:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for ob in obs:
            ob.select_set(True)
        bpy.ops.export_scene.fbx(
            filepath=str(build / f"{name}.fbx"),
            use_selection=True,
            axis_forward="-Z",
            axis_up="Y",
            apply_scale_options="FBX_SCALE_UNITS",
            object_types={"MESH", "EMPTY"},
            use_mesh_modifiers=True,
            mesh_smooth_type="FACE",
            path_mode="RELATIVE",
        )
        print("FBX を書き出しました:", build / f"{name}.fbx", f"({len(obs)} オブジェクト)")


main()
