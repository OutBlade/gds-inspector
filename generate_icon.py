"""Generates desktop/build/icon.ico for the Electron build."""

import os

from PIL import Image, ImageDraw


def create_icon():
    os.makedirs("desktop/build", exist_ok=True)
    sizes = [16, 32, 48, 64, 128, 256]
    images = []

    for size in sizes:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        m = max(1, size // 10)
        draw.ellipse([m, m, size - m, size - m], fill=(11, 11, 26, 255))

        accent = (91, 108, 245, 255)
        border = size // 5
        lw = max(1, size // 20)
        draw.rectangle(
            [border, border, size - border, size - border], outline=accent, width=lw
        )

        mid = size // 2
        seg = size // 5
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

        cx_size = max(2, size // 8)
        draw.ellipse(
            [mid - cx_size, mid - cx_size, mid + cx_size, mid + cx_size], fill=accent
        )

        images.append(img)

    path = "desktop/build/icon.ico"
    images[0].save(
        path, format="ICO", sizes=[(s, s) for s in sizes], append_images=images[1:]
    )
    print(f"Icon saved to {path}")


if __name__ == "__main__":
    create_icon()
