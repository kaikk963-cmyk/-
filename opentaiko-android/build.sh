#!/usr/bin/env bash
# OpenTaiko（TJAPlayer3-Develop-ReWrite の後継・MIT）を Android 向けにビルドするスクリプト（Linux 用）。
# 上流の OpenTaiko.Android/scripts/*.ps1 が Windows でやっている処理を bash で再現したもの。
#
# 必要: git, curl, unzip, .NET 10 SDK + android workload, Android SDK (platform 36), JDK 17+
#
# 使い方:
#   ./build.sh [作業ディレクトリ]
# 環境変数:
#   OPENTAIKO_REF   ビルドする OpenTaiko のコミット/ブランチ (既定: 下の PINNED_REF)
#   ABIS            "arm64" (既定・実機向けで小さい) または "all" (arm64 + x86_64 エミュレータ用)
#   ANDROID_SDK     Android SDK のパス (既定: $ANDROID_HOME または $ANDROID_SDK_ROOT)
#   JAVA_SDK        JDK のパス (既定: $JAVA_HOME)
set -euo pipefail

PINNED_REF=63f2cd22155c5f3c1abc891a4c4360b17b0caa4a   # 2026-11-01 時点の main（この版でビルド確認済み）
REF=${OPENTAIKO_REF:-$PINNED_REF}
ABIS=${ABIS:-arm64}
WORK=$(realpath -m "${1:-./opentaiko-build}")
ANDROID_SDK=${ANDROID_SDK:-${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}}
JAVA_SDK=${JAVA_SDK:-${JAVA_HOME:-}}
[ -n "$ANDROID_SDK" ] || { echo "ANDROID_SDK (or ANDROID_HOME) を設定してください" >&2; exit 1; }
[ -n "$JAVA_SDK" ] || { echo "JAVA_SDK (or JAVA_HOME) を設定してください" >&2; exit 1; }

mkdir -p "$WORK"
SRC=$WORK/OpenTaiko
DL=$WORK/downloads
mkdir -p "$DL"

# ---- ソース取得 ---------------------------------------------------------------------------
if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC"
  git -C "$SRC" remote add origin https://github.com/0auBSQ/OpenTaiko.git
fi
git -C "$SRC" fetch -q --depth 1 origin "$REF"
git -C "$SRC" checkout -q --force FETCH_HEAD
echo "OpenTaiko: $(git -C "$SRC" rev-parse HEAD)"
AND=$SRC/OpenTaiko.Android

case "$ABIS" in
  arm64) ABI_LIST="arm64-v8a"
         # 実機 (arm64) 専用にして APK を約50MB小さくする
         sed -i 's#<RuntimeIdentifiers>android-arm64;android-x64</RuntimeIdentifiers>#<RuntimeIdentifiers>android-arm64</RuntimeIdentifiers>#' "$AND/OpenTaiko.Android.csproj" ;;
  all)   ABI_LIST="arm64-v8a x86_64" ;;
  *) echo "ABIS は arm64 か all" >&2; exit 1 ;;
esac

fetch() { curl -sSfL --retry 5 --retry-delay 5 --retry-all-errors -o "$2" "$1"; }

# ---- BASS (un4seen.com。非商用は無料) --------------------------------------------------------
for url in https://www.un4seen.com/files/bass24-android.zip \
           https://www.un4seen.com/files/bassmix24-android.zip \
           https://www.un4seen.com/files/z/0/bass_fx24-android.zip; do
  name=$(basename "$url" .zip)
  [ -f "$DL/$name.zip" ] || fetch "$url" "$DL/$name.zip"
  rm -rf "${DL:?}/$name"; unzip -q "$DL/$name.zip" -d "$DL/$name"
  for abi in $ABI_LIST; do
    mkdir -p "$AND/jniLibs/$abi"
    find "$DL/$name" -path "*libs/$abi/*.so" -exec cp {} "$AND/jniLibs/$abi/" \;
  done
done

# ---- FFmpeg 5.1.2 (Bytedeco LGPL ビルド, Maven Central) ---------------------------------------
FFV=5.1.2-1.5.8
for abi in $ABI_LIST; do
  case $abi in arm64-v8a) cls=android-arm64 ;; x86_64) cls=android-x86_64 ;; esac
  jar=$DL/ffmpeg-$FFV-$cls.jar
  [ -f "$jar" ] || fetch "https://repo1.maven.org/maven2/org/bytedeco/ffmpeg/$FFV/ffmpeg-$FFV-$cls.jar" "$jar"
  for so in libavutil.so libswresample.so libavcodec.so libavformat.so libswscale.so; do
    unzip -o -q -j "$jar" "*/$so" -d "$AND/jniLibs/$abi"
  done
done

# ---- FFmpeg.AutoGen 5.1.1 バインディング（上流パッチ適用） --------------------------------------
TP=$SRC/third_party/FFmpeg.AutoGen
if [ ! -f "$TP/upstream/FFmpeg.cs" ]; then
  tmp=$(mktemp -d)
  git -C "$tmp" init -q
  git -C "$tmp" remote add origin https://github.com/Ruslan-B/FFmpeg.AutoGen
  git -C "$tmp" fetch -q --depth 1 origin 40873965266b526eeb7982ad45b1e51957eb5411
  git -C "$tmp" checkout -q FETCH_HEAD -- FFmpeg.AutoGen
  rm -rf "$TP/upstream"; mkdir -p "$TP/upstream"
  cp -r "$tmp/FFmpeg.AutoGen/." "$TP/upstream/"
  rm -f "$TP/upstream/FFmpeg.AutoGen.csproj"
  (cd "$TP/upstream" && for p in ios-darwin-fallback.patch android-bionic-fallback.patch; do git apply -p1 --ignore-whitespace "$TP/$p"; done)
  rm -rf "$tmp"
fi

# ---- ビルド ---------------------------------------------------------------------------------
# Optimize=false は上流の必須条件（最適化ILだと Android の Mono インタプリタが起動時にクラッシュする）
dotnet build "$AND/OpenTaiko.Android.csproj" -c Release -f net10.0-android \
  -p:UseVendoredFFmpeg=true -p:Optimize=false \
  -p:AndroidSdkDirectory="$ANDROID_SDK" -p:JavaSdkDirectory="$JAVA_SDK"

APK=$(find "$AND/bin/Release" -name '*-Signed.apk' | head -1)
mkdir -p "$WORK/out"
cp "$APK" "$WORK/out/OpenTaiko-android-$ABIS.apk"
ls -la "$WORK/out"
