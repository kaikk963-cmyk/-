"""build_track.py の出力を Blender に読み込み、AC 用ダミー (Empty) を配置して FBX を書き出す。

使い方 (Blender 3.6 / 4.x):
    blender -b -P blender/import_to_blender.py -- out/hakone_turnpike/build
GUI で確認したい場合は -b を外す。

出力: <build>/track.blend と <build>/<track_id>.fbx (KsEditor に読み込む)
"""
import json
import math
import sys
from pathlib import Path

import bpy

# 車がコースと逆向きにスポーンしたら True にして再実行する
FLIP_START_DIRECTION = False


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
    bpy.ops.export_scene.fbx(
        filepath=str(build / f"{cfg['track_id']}.fbx"),
        axis_forward="-Z",
        axis_up="Y",
        apply_scale_options="FBX_SCALE_UNITS",
        object_types={"MESH", "EMPTY"},
        use_mesh_modifiers=True,
        mesh_smooth_type="FACE",
        path_mode="RELATIVE",
    )
    print("FBX を書き出しました:", build / f"{cfg['track_id']}.fbx")


main()
