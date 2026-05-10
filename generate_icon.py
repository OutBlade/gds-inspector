"""Generates desktop/build/icon.ico for the Electron build."""

import os

from PIL import Image, ImageDraw


def create_icon():
    os.makedirs("desktop/build", exist_ok=True)

    size = 256
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    m = 8
    draw.ellipse([m, m, size - m, size - m], fill=(11, 11, 26, 255))

    accent = (91, 108, 245, 255)
    border = 48
    lw = 8
    draw.rectangle(
        [border, border, size - border, size - border], outline=accent, width=lw
    )

    seg = 52
    draw.line(
        [border + seg, border, border + seg, size - border], fill=accent, width=lw
    )
    draw.line(
        [size - border - seg, border, size - border - seg, size - border],
        fill=accent,
        width=lw,
    )
    draw.line(
        [border, border + seg, size - border, border + seg], fill=accent, width=lw
    )
    draw.line(
        [border, size - border - seg, size - border, size - border - seg],
        fill=accent,
        width=lw,
    )

    mid = size // 2
    cx = 14
    draw.ellipse([mid - cx, mid - cx, mid + cx, mid + cx], fill=accent)

    path = "desktop/build/icon.ico"
    img.save(
        path,
        format="ICO",
        sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)],
    )
    print(f"Icon saved to {path}")


if __name__ == "__main__":
    create_icon()
