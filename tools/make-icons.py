#!/usr/bin/env python3
"""SHOOTOUT 4 — アイコン・国旗の生成（PIL）

  python3 tools/make-icons.py

入力: ../../downloads/shootout4-icon-2-flatball.png（IPKSF 公式エンブレム・白紺フラットボール）
出力:
  assets/icon-1024.png         App Store 用 1024x1024 / RGB / アルファなし
  assets/emblem-512.png        ホームのロゴ（エンブレム部分を少し拡大した 512）
  assets/icons/*.png           各サイズ（iPhone/iPad/Android 用）
  assets/flags/{code}-96.png   国旗を 3:2 にそろえた 96x64（UI 用）
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png  (1024)

App Store のアイコンは「アルファなし・RGB」でなければ審査に通らないため、
最後に必ず convert('RGB') で書き出す。
"""

from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
WORKSPACE = ROOT.parent.parent
SOURCE = WORKSPACE / "downloads" / "shootout4-icon-2-flatball.png"
ASSETS = ROOT / "assets"
ICONS = ASSETS / "icons"
FLAGS = ASSETS / "flags"
IOS_ICON = ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset"

# iOS の全サイズ（pts x scale）
IOS_SIZES = {
    "icon-20@2x": 40, "icon-20@3x": 60,
    "icon-29@2x": 58, "icon-29@3x": 87,
    "icon-40@2x": 80, "icon-40@3x": 120,
    "icon-60@2x": 120, "icon-60@3x": 180,
    "icon-76@1x": 76, "icon-76@2x": 152,
    "icon-83.5@2x": 167,
    "icon-1024": 1024,
}

ANDROID_SIZES = {
    "mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192,
}


def load_source() -> Image.Image:
    image = Image.open(SOURCE).convert("RGB")
    side = min(image.size)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    return image.crop((left, top, left + side, top + side))


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, "PNG", optimize=True)


def main() -> None:
    square = load_source()
    master = square.resize((1024, 1024), Image.LANCZOS)
    save_png(master, ASSETS / "icon-1024.png")

    # ホーム用エンブレム: 外側の空を少し落として紋章を大きく見せる
    inset = int(1024 * 0.055)
    emblem = master.crop((inset, inset, 1024 - inset, 1024 - inset)).resize((512, 512), Image.LANCZOS)
    save_png(emblem, ASSETS / "emblem-512.png")

    for name, size in IOS_SIZES.items():
        save_png(master.resize((size, size), Image.LANCZOS), ICONS / f"{name}.png")

    for name, size in ANDROID_SIZES.items():
        save_png(master.resize((size, size), Image.LANCZOS), ASSETS / "android" / f"{name}.png")

    save_png(master, IOS_ICON / "AppIcon-512@2x.png")

    # 国旗: 3:2 にそろえる（UI の枠がぶれないように）
    for path in sorted(FLAGS.glob("*.png")):
        if path.name.endswith("-96.png"):
            continue
        flag = Image.open(path).convert("RGB")
        flag = ImageOps.fit(flag, (96, 64), method=Image.LANCZOS, centering=(0.5, 0.5))
        save_png(flag, FLAGS / f"{path.stem}-96.png")

    print("icons:", len(IOS_SIZES), "ios sizes,", len(ANDROID_SIZES), "android sizes")
    print("flags:", len(list(FLAGS.glob("*-96.png"))))
    print("master:", master.size, master.mode)


if __name__ == "__main__":
    main()
