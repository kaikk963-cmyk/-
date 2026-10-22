"""Assetto Corsa の .kn5 (モデル形式 version 5) を直接書き出す。KsEditor を使わずに済ませるため。

形式はコミュニティで解析されたもの (Thomas Hagnhofer の Blender kn5 exporter /
moppius/blender-assetto-corsa-tools と同じ構成) に合わせている:
    "sc6969", uint version
    テクスチャ: int 数, { int 有効, string 名前, blob 画像 (PNG / DDS) }
    マテリアル: int 数, { string 名前, string シェーダー, byte ブレンド, bool アルファテスト, int 深度,
                          uint プロパティ数 { string, float, vec2, vec3, vec4 },
                          uint テクスチャ数 { string スロット名, uint 番号, string テクスチャ名 } }
    ノード (再帰): uint 種類 (1 = ダミー, 2 = メッシュ), string 名前, uint 子の数, bool 有効, ...
座標は AC の Y-up: (x, y, z)_このツール -> (x, z, -y)、UV は (u, -v)。
"""
import io
import struct
from pathlib import Path

import numpy as np
from PIL import Image

# 透明部分のあるテクスチャは ksPerPixelAT (アルファテスト) にする
ALPHA_MATERIALS = {"tree", "guardrail_jp", "signs"}

# 遠くでは描かない距離 [m] (0 = 常に描く)。名前の頭で決める
LOD_OUT = {"tree_": 900.0, "bld_": 2500.0, "pole_": 700.0, "wire_": 400.0, "signal_": 800.0, "sign_": 500.0}

SHADER_PROPS = {"ksAmbient": 0.5, "ksDiffuse": 0.45, "ksSpecular": 0.0, "ksSpecularEXP": 1.0,
                "ksEmissive": 0.0, "ksAlphaRef": 0.0}

# 見た目だけの小物 / 木は別の kn5 にする (models.ini でまとめて読み込む)
OBJECT_PREFIXES = ("bld_", "pole_", "wire_", "signal_", "sign_")


class _W:
    def __init__(self, f):
        self.f = f

    def u32(self, v):
        self.f.write(struct.pack("<I", v))

    def i32(self, v):
        self.f.write(struct.pack("<i", v))

    def u8(self, v):
        self.f.write(struct.pack("<B", v))

    def b(self, v):
        self.f.write(struct.pack("<?", bool(v)))

    def floats(self, *v):
        self.f.write(struct.pack(f"<{len(v)}f", *v))

    def s(self, text):
        data = text.encode("utf-8")
        self.u32(len(data))
        self.f.write(data)

    def blob(self, data):
        self.u32(len(data))
        self.f.write(data)


def _vertex_normals(v, f):
    """面積で重み付けした頂点法線。打ち消し合って 0 になる所 (両面の板) は真上にする。"""
    n = np.zeros_like(v)
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    length = np.linalg.norm(n, axis=1, keepdims=True)
    up = np.array([0.0, 0.0, 1.0])
    return np.where(length > 1e-9, n / np.maximum(length, 1e-12), up)


def _write_mesh(w, mesh, material_id):
    v = np.concatenate(mesh.v).astype(np.float64)
    uv = np.concatenate(mesh.uv).astype(np.float64)
    f = np.concatenate(mesh.f).astype(np.int64)
    if len(v) > 65535:
        raise ValueError(f"{mesh.name}: 頂点数 {len(v)} が kn5 の上限 65535 を超えています")
    n = _vertex_normals(v, f)
    pos = np.column_stack([v[:, 0], v[:, 2], -v[:, 1]])
    nrm = np.column_stack([n[:, 0], n[:, 2], -n[:, 1]])
    # 法線マップは使わないので接線は法線に垂直な適当な向きでよい
    tan = np.cross(nrm, [0.0, 0.0, 1.0])
    bad = np.linalg.norm(tan, axis=1) < 1e-6
    tan[bad] = [1.0, 0.0, 0.0]
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    data = np.column_stack([pos, nrm, uv[:, 0], -uv[:, 1], tan]).astype("<f4")

    name = mesh.name
    lod_out = next((d for p, d in LOD_OUT.items() if name.startswith(p)), 0.0)
    w.u32(2)
    w.s(name)
    w.u32(0)            # 子の数
    w.b(True)           # 有効
    w.b(not name.startswith(("tree_", "wire_")))  # 影を落とす (木と電線は数が多いので落とさない)
    w.b(True)           # 表示
    w.b(False)          # 半透明 (アルファテストなので不要)
    w.u32(len(data))
    w.f.write(data.tobytes())
    w.u32(f.size)
    w.f.write(f.astype("<u2").tobytes())
    w.u32(material_id)
    w.u32(0)            # レイヤー
    w.floats(0.0, lod_out)
    lo, hi = pos.min(axis=0), pos.max(axis=0)
    c = (lo + hi) / 2
    w.floats(*c, float(np.linalg.norm(hi - lo) / 2))
    w.b(True)           # 描画する


def _write_dummy(w, name, marker):
    """AC_START_0 などのダミー。ローカル +Z が進行方向、+Y が上。"""
    x, y, z = marker["pos"]
    dx, dy = marker["dir"]
    fwd = np.array([dx, 0.0, -dy])
    fwd /= np.linalg.norm(fwd)
    right = np.array([fwd[2], 0.0, -fwd[0]])  # Y x Z
    w.u32(1)
    w.s(name)
    w.u32(0)
    w.b(True)
    # 行ベクトル形式 (行 = ローカル軸、最後の行 = 位置)
    w.floats(*right, 0.0, 0.0, 1.0, 0.0, 0.0, *fwd, 0.0, x, z, -y, 1.0)


def dds_bc1_with_mips(png_path):
    """不透明な大きいテクスチャ (航空写真) を DXT1 圧縮 + ミップマップ付きの DDS にする。
    PNG の 1/3 ほどの大きさになり、遠くの地面のちらつきも抑えられる。"""
    img = Image.open(png_path).convert("RGB")
    levels = []
    w, h = img.size
    while True:
        buf = io.BytesIO()
        img.resize((w, h), Image.LANCZOS).save(buf, format="DDS", pixel_format="DXT1")
        data = buf.getvalue()
        levels.append(data)
        if w == 1 and h == 1:
            break
        w, h = max(w // 2, 1), max(h // 2, 1)
    header = bytearray(levels[0][:128])
    flags, = struct.unpack_from("<I", header, 8)
    struct.pack_into("<I", header, 8, flags | 0x20000)           # DDSD_MIPMAPCOUNT
    struct.pack_into("<I", header, 28, len(levels))              # ミップの段数
    caps, = struct.unpack_from("<I", header, 108)
    struct.pack_into("<I", header, 108, caps | 0x400008)         # DDSCAPS_MIPMAP | COMPLEX
    return bytes(header) + b"".join(lv[128:] for lv in levels)


def _texture_data(tex_dir, name):
    """kn5 に入れる (名前, データ)。航空写真は DDS に変換する (変換結果はキャッシュ)。"""
    src = Path(tex_dir) / name
    if name.startswith("photo_") and name.endswith(".png"):
        dds = src.with_suffix(".dds")
        if not dds.exists() or dds.stat().st_mtime < src.stat().st_mtime:
            dds.write_bytes(dds_bc1_with_mips(src))
        return dds.name, dds.read_bytes()
    return name, src.read_bytes()


def write_kn5(path, root_name, meshes, markers, tex_dir, textures=None):
    """meshes (build_track.Mesh のリスト) と markers をそのまま 1 つの kn5 にする。"""
    textures = textures or {}
    materials = list(dict.fromkeys(m.material for m in meshes))
    src_of = {m: textures.get(m, f"{m}.png") for m in materials}
    tex_of = {}
    with open(path, "wb") as fh:
        w = _W(fh)
        fh.write(b"sc6969")
        w.u32(5)
        srcs = list(dict.fromkeys(src_of.values()))
        w.i32(len(srcs))
        for t in srcs:
            name, data = _texture_data(tex_dir, t)
            tex_of.update({m: name for m, src in src_of.items() if src == t})
            w.i32(1)
            w.s(name)
            w.blob(data)
        w.i32(len(materials))
        for m in materials:
            alpha = m in ALPHA_MATERIALS
            w.s(m)
            w.s("ksPerPixelAT" if alpha else "ksPerPixel")
            w.u8(0)          # ブレンド: 不透明
            w.b(alpha)       # アルファテスト
            w.i32(0)         # 深度: 通常
            w.u32(len(SHADER_PROPS))
            for k, val in SHADER_PROPS.items():
                w.s(k)
                w.floats(val, 0, 0, 0, 0, 0, 0, 0, 0, 0)
            w.u32(1)
            w.s("txDiffuse")
            w.u32(0)
            w.s(tex_of[m])
        mat_id = {m: i for i, m in enumerate(materials)}
        w.u32(1)                                  # ルート (ダミー)
        w.s(root_name)
        w.u32(len(meshes) + len(markers))
        w.b(True)
        w.floats(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
        for m in meshes:
            _write_mesh(w, m, mat_id[m.material])
        for name, mk in markers.items():
            _write_dummy(w, name, mk)
    return Path(path).stat().st_size


def _split_by_size(meshes, max_mb):
    """頂点 44 バイト + 添字 2 バイトで大きさを見積もって分ける。"""
    parts, cur, size = [], [], 0.0
    for m in meshes:
        b = m.count * 44 + sum(len(f) for f in m.f) * 6
        if cur and size + b > max_mb * 2**20:
            parts.append(cur)
            cur, size = [], 0.0
        cur.append(m)
        size += b
    return parts + [cur]


def write_track_kn5s(track_dir, track_id, meshes, markers, tex_dir, textures=None, split=True, max_mb=250):
    """トラックフォルダに kn5 を書き出す。split なら 地形・道路 / 小物 / 木 の 3 つに分けて models.ini を作る。"""
    track_dir = Path(track_dir)
    for old in track_dir.glob(f"{track_id}*.kn5"):
        old.unlink()  # 前回の分割数が違うと古いファイルが残るので消しておく
    if not split:
        size = write_kn5(track_dir / f"{track_id}.kn5", track_id, meshes, markers, tex_dir, textures)
        print(f"kn5: {track_dir / f'{track_id}.kn5'} ({size / 2**20:.0f} MB)")
        return
    groups = {
        track_id: [m for m in meshes if not m.name.startswith(OBJECT_PREFIXES + ("tree_",))],
        f"{track_id}_objects": [m for m in meshes if m.name.startswith(OBJECT_PREFIXES)],
        f"{track_id}_trees": [m for m in meshes if m.name.startswith("tree_")],
    }
    names = []
    for name, ms in groups.items():
        # 1 ファイルが max_mb を超えないよう、場所 (名前の中のチャンク番号) 順に並べて分ける
        parts = _split_by_size(sorted(ms, key=lambda m: m.name.split("_", 1)[-1]), max_mb) if name != track_id else [ms]
        for k, part in enumerate(parts):
            if not part:
                continue
            pname = name if len(parts) == 1 else f"{name}_{k + 1}"
            size = write_kn5(track_dir / f"{pname}.kn5", pname, part, markers if name == track_id else {},
                             tex_dir, textures)
            print(f"kn5: {track_dir / f'{pname}.kn5'} ({size / 2**20:.0f} MB, メッシュ {len(part)})")
            names.append(pname)
    (track_dir / "models.ini").write_text("".join(
        f"[MODEL_{i}]\nFILE={n}.kn5\nPOSITION=0,0,0\nROTATION=0,0,0\n\n" for i, n in enumerate(names)),
        encoding="utf-8")
