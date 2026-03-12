from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Iterable

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


WIDTH = 1080
HEIGHT = 1920
FPS = 24
DURATION_SECONDS = 8
DEFAULT_OUTPUT_PATH = Path(__file__).resolve().parents[1] / "public" / "fallback-videos" / "bwinbet-highlight-alert.mp4"

BLACK = (12, 12, 16)
BLACK_SOFT = (24, 24, 32)
YELLOW = (247, 198, 0)
YELLOW_SOFT = (255, 224, 102)
WHITE = (247, 247, 247)
GREY = (176, 176, 184)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    font_candidates: Iterable[str] = (
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/Arial.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/impact.ttf",
    )
    for candidate in font_candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


TITLE_FONT = load_font(104, bold=True)
SUBTITLE_FONT = load_font(56, bold=False)
LABEL_FONT = load_font(44, bold=True)
CTA_FONT = load_font(40, bold=False)
LOGO_FONT = load_font(72, bold=True)
DETAIL_FONT = load_font(42, bold=False)
HEADLINE_FONT = load_font(66, bold=True)


def fit_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = [part for part in text.split() if part]
    if not words:
        return []

    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def draw_centered_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, y: int, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    x = (WIDTH - (bbox[2] - bbox[0])) // 2
    draw.text((x, y), text, font=font, fill=fill)


def frame_image(
    frame_index: int,
    total_frames: int,
    *,
    kicker: str,
    title_lines: list[str],
    detail_lines: list[str],
    cta_primary: str,
    cta_secondary: str,
) -> Image.Image:
    t = frame_index / max(total_frames - 1, 1)
    pulse = (math.sin(t * math.pi * 2.0) + 1.0) / 2.0

    gradient = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    for y in range(HEIGHT):
        ratio = y / max(HEIGHT - 1, 1)
        gradient[y, :, 0] = int(lerp(BLACK[0], BLACK_SOFT[0], ratio))
        gradient[y, :, 1] = int(lerp(BLACK[1], BLACK_SOFT[1], ratio))
        gradient[y, :, 2] = int(lerp(BLACK[2], BLACK_SOFT[2], ratio))

    image = Image.fromarray(gradient, mode="RGB")
    draw = ImageDraw.Draw(image, "RGBA")

    top_glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(top_glow, "RGBA")
    glow_radius = int(240 + 80 * pulse)
    glow_draw.ellipse(
        (WIDTH - 430 - glow_radius // 2, 130 - glow_radius // 3, WIDTH - 30 + glow_radius // 2, 530 + glow_radius // 3),
        fill=(247, 198, 0, 78),
    )
    glow_draw.ellipse(
        (-120, 1180, 420, 1720),
        fill=(255, 224, 102, 54),
    )
    top_glow = top_glow.filter(ImageFilter.GaussianBlur(radius=80))
    image = Image.alpha_composite(image.convert("RGBA"), top_glow)
    draw = ImageDraw.Draw(image, "RGBA")

    stripe_offset = int(lerp(-220, 180, t))
    draw.polygon(
        [
            (0, 380 + stripe_offset),
            (WIDTH, 210 + stripe_offset),
            (WIDTH, 520 + stripe_offset),
            (0, 690 + stripe_offset),
        ],
        fill=(247, 198, 0, 42),
    )
    draw.polygon(
        [
            (0, 1060 - stripe_offset // 2),
            (WIDTH, 900 - stripe_offset // 2),
            (WIDTH, 1180 - stripe_offset // 2),
            (0, 1340 - stripe_offset // 2),
        ],
        fill=(247, 198, 0, 30),
    )

    label_w, label_h = 520, 86
    label_x = (WIDTH - label_w) // 2
    label_y = 144
    draw.rounded_rectangle(
        (label_x, label_y, label_x + label_w, label_y + label_h),
        radius=24,
        fill=(247, 198, 0, 230),
    )
    draw_centered_text(draw, kicker, LABEL_FONT, label_y + 18, BLACK)

    logo_box_w = 540
    logo_box_h = 128
    logo_box_x = (WIDTH - logo_box_w) // 2
    logo_box_y = 312
    draw.rounded_rectangle(
        (logo_box_x, logo_box_y, logo_box_x + logo_box_w, logo_box_y + logo_box_h),
        radius=18,
        fill=(18, 18, 24, 232),
        outline=(247, 198, 0, 255),
        width=3,
    )
    draw_centered_text(draw, "BWINBET UG", LOGO_FONT, logo_box_y + 24, YELLOW)

    title_y = 590
    title_shift = int(16 * math.sin(t * math.pi * 2.0))
    if title_lines:
        draw_centered_text(draw, title_lines[0], TITLE_FONT, title_y + title_shift, WHITE)
    if len(title_lines) > 1:
        draw_centered_text(draw, title_lines[1], TITLE_FONT, title_y + 112 + title_shift, YELLOW)

    sub_y = 860
    for idx, line in enumerate(detail_lines[:3]):
        font = HEADLINE_FONT if idx == 0 else SUBTITLE_FONT
        fill = WHITE if idx == 0 else GREY
        draw_centered_text(draw, line, font, sub_y + idx * 70, fill)

    info_card_x = 120
    info_card_y = 1140
    info_card_w = WIDTH - 240
    info_card_h = 340
    draw.rounded_rectangle(
        (info_card_x, info_card_y, info_card_x + info_card_w, info_card_y + info_card_h),
        radius=36,
        fill=(16, 16, 20, 208),
        outline=(255, 255, 255, 24),
        width=2,
    )

    chip_y = info_card_y + 52
    chip_w = 208
    gap = 26
    chips = ["VIDEOS", "HIGHLIGHTS", "UPDATES"]
    total_chip_width = len(chips) * chip_w + (len(chips) - 1) * gap
    chip_x = (WIDTH - total_chip_width) // 2
    for idx, chip in enumerate(chips):
        x = chip_x + idx * (chip_w + gap)
        fill = (247, 198, 0, 230) if idx == frame_index % len(chips) else (255, 255, 255, 22)
        text_fill = BLACK if idx == frame_index % len(chips) else WHITE
        draw.rounded_rectangle((x, chip_y, x + chip_w, chip_y + 78), radius=20, fill=fill)
        bbox = draw.textbbox((0, 0), chip, font=LABEL_FONT)
        tx = x + (chip_w - (bbox[2] - bbox[0])) // 2
        draw.text((tx, chip_y + 16), chip, font=LABEL_FONT, fill=text_fill)

    cta_y = info_card_y + 182
    draw_centered_text(draw, cta_primary, CTA_FONT, cta_y, WHITE)
    draw_centered_text(draw, cta_secondary, CTA_FONT, cta_y + 68, YELLOW_SOFT)

    story_box_x = 150
    story_box_y = 1510
    story_box_w = WIDTH - 300
    story_box_h = 170
    draw.rounded_rectangle(
        (story_box_x, story_box_y, story_box_x + story_box_w, story_box_y + story_box_h),
        radius=28,
        fill=(255, 255, 255, 14),
        outline=(255, 255, 255, 28),
        width=2,
    )
    for idx, line in enumerate(detail_lines[3:5]):
        draw_centered_text(draw, line, DETAIL_FONT, story_box_y + 30 + idx * 48, YELLOW_SOFT if idx == 0 else WHITE)

    ticker_y = HEIGHT - 180
    ticker_x = int(lerp(WIDTH + 120, -860, t))
    ticker_text = "DAILY FOOTBALL UPDATES  |  FRESH HIGHLIGHTS  |  BIG LEAGUES  |  BWINBET UG"
    draw.rounded_rectangle((0, ticker_y, WIDTH, ticker_y + 102), radius=0, fill=(247, 198, 0, 230))
    draw.text((ticker_x, ticker_y + 22), ticker_text, font=LABEL_FONT, fill=BLACK)

    return image.convert("RGB")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH))
    parser.add_argument("--kicker", default="OFFICIAL BWINBET UG")
    parser.add_argument("--title", default="FOOTBALL HIGHLIGHT ALERT")
    parser.add_argument("--matchup", default="Latest goals, biggest moments")
    parser.add_argument("--competition", default="Daily football buzz")
    parser.add_argument("--source", default="Verified football update")
    parser.add_argument("--cta-primary", dest="cta_primary", default="Bet now: bwinbetug.com")
    parser.add_argument("--cta-secondary", dest="cta_secondary", default="More info: bwinbetug.info")
    return parser.parse_args()


def main():
    args = parse_args()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    total_frames = FPS * DURATION_SECONDS
    dummy = Image.new("RGB", (WIDTH, HEIGHT), BLACK)
    draw = ImageDraw.Draw(dummy)
    title_lines = fit_text(draw, args.title.strip(), TITLE_FONT, WIDTH - 180)
    if len(title_lines) < 2:
        title_lines.append("HIGHLIGHT ALERT")
    else:
        title_lines = title_lines[:2]
    detail_lines = [
        line
        for line in [
            args.matchup.strip(),
            args.competition.strip(),
            args.source.strip(),
            "Fresh football update powered by verified match metadata.",
            "Built for quick social posting without raw third-party clip reuse.",
        ]
        if line
    ]
    writer = imageio.get_writer(
        output_path,
        fps=FPS,
        codec="libx264",
        quality=8,
        macro_block_size=1,
        ffmpeg_log_level="error",
    )
    try:
        for frame_index in range(total_frames):
            frame = frame_image(
                frame_index,
                total_frames,
                kicker=args.kicker.strip() or "OFFICIAL BWINBET UG",
                title_lines=title_lines,
                detail_lines=detail_lines,
                cta_primary=args.cta_primary.strip() or "Bet now: bwinbetug.com",
                cta_secondary=args.cta_secondary.strip() or "More info: bwinbetug.info",
            )
            writer.append_data(np.asarray(frame))
    finally:
        writer.close()
    print(str(output_path))


if __name__ == "__main__":
    main()
