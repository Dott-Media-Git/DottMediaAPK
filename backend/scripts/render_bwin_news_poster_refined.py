from __future__ import annotations

import argparse
import textwrap
from io import BytesIO
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET

import requests
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[2]
LOGO_PATH = ROOT / "docs" / "brand-kits" / "assets" / "bwinbetug-logo.jpeg"
PDF_LOGO_PATH = ROOT / "docs" / "brand-kits" / "assets" / "bwinbetug-logo-from-pdf.png"
OUTPUT_PATH = ROOT / "exports" / "bwin-news-poster-preview-2-refined.jpg"
SIZE = 1080
FEEDS = [
    "https://feeds.bbci.co.uk/sport/football/rss.xml",
    "https://www.espn.com/espn/rss/soccer/news",
]
USER_AGENT = "DottMedia-BwinPosterRefined/1.0"

BLACK = (9, 10, 12)
YELLOW = (245, 196, 0)
WHITE = (246, 246, 246)
SOFT_WHITE = (229, 233, 236)
GREEN = (104, 243, 181)
GREEN_SOFT = (124, 237, 196)
GREEN_BRIGHT = (142, 255, 201)
FOOTER_GREEN = (10, 43, 31)


def load_font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    font_candidates: Iterable[str] = (
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/calibrib.ttf" if bold else "C:/Windows/Fonts/calibri.ttf",
    )
    for candidate in font_candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


FONT_URL = load_font(26, bold=True)
FONT_HEADLINE = load_font(66, bold=True)
FONT_TAG = load_font(36, bold=True)
FONT_FOOTER = load_font(18, bold=False)
FONT_SMALL = load_font(22, bold=True)
FONT_BADGE = load_font(22, bold=True)


def normalize_news_image_url(url: str) -> str:
    value = (url or "").strip()
    if not value:
        return ""
    if "bbc.co.uk" in value or "bbci.co.uk" in value:
        return (
            value.replace("/240/", "/1024/")
            .replace("/320/", "/1024/")
            .replace("/480/", "/1024/")
            .replace("/640/", "/1024/")
        )
    return value


def fetch_feed_items(feed_url: str) -> list[dict[str, str]]:
    response = requests.get(
        feed_url,
        timeout=30,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        },
    )
    response.raise_for_status()
    root = ET.fromstring(response.content)
    items: list[dict[str, str]] = []
    for item in root.findall(".//item"):
        image_url = ""
        for child in list(item):
            tag = child.tag.lower()
            if tag.endswith("thumbnail") or tag.endswith("content"):
                image_url = child.attrib.get("url") or child.attrib.get("href") or image_url
        items.append(
            {
                "title": (item.findtext("title") or "").strip(),
                "link": (item.findtext("link") or "").strip(),
                "pubDate": (item.findtext("pubDate") or "").strip(),
                "image": normalize_news_image_url(image_url),
            }
        )
    return [item for item in items if item["title"] and item["link"]]


def extract_og_image(article_url: str) -> str:
    response = requests.get(
        article_url,
        timeout=30,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
    )
    response.raise_for_status()
    html = response.text
    markers = ['property="og:image"', "property='og:image'", 'name="twitter:image"']
    for marker in markers:
        idx = html.find(marker)
        if idx == -1:
            continue
        snippet = html[idx : idx + 400]
        for opener in ['content="', "content='"]:
            pos = snippet.find(opener)
            if pos == -1:
                continue
            rest = snippet[pos + len(opener) :]
            end = rest.find(opener[-1])
            if end != -1:
                return normalize_news_image_url(rest[:end])
    return ""


def choose_candidate(index: int = 1) -> dict[str, str]:
    items: list[dict[str, str]] = []
    for feed in FEEDS:
        try:
            items.extend(fetch_feed_items(feed))
        except Exception:
            continue

    seen_links: set[str] = set()
    candidates: list[dict[str, str]] = []
    for item in items:
        if item["link"] in seen_links:
            continue
        seen_links.add(item["link"])
        image = item["image"] or extract_og_image(item["link"])
        if not image:
            continue
        try:
            test = requests.get(image, timeout=25, headers={"User-Agent": USER_AGENT})
            if test.status_code != 200 or not test.content:
                continue
        except Exception:
            continue
        candidates.append({**item, "image": image})
        if len(candidates) > index:
            break
    if len(candidates) <= index:
        raise RuntimeError("Could not find enough football news candidates")
    return candidates[index]


def cover_image(image: Image.Image, width: int, height: int) -> Image.Image:
    src_w, src_h = image.size
    scale = max(width / src_w, height / src_h)
    resized = image.resize((int(src_w * scale), int(src_h * scale)), Image.LANCZOS)
    left = max((resized.width - width) // 2, 0)
    top = max((resized.height - height) // 2, 0)
    return resized.crop((left, top, left + width, top + height))


def wrap_title(title: str) -> list[str]:
    clean = " ".join(title.split())
    return textwrap.wrap(clean, width=20)[:3]


def measure_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def wrap_title_to_width(
    title: str,
    font: ImageFont.ImageFont,
    max_width: int,
    *,
    max_lines: int,
) -> list[str]:
    probe = Image.new("RGB", (32, 32))
    draw = ImageDraw.Draw(probe)
    words = " ".join(title.split()).split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        width, _ = measure_text(draw, trial, font)
        if current and width > max_width:
            lines.append(current)
            current = word
        else:
            current = trial
    if current:
        lines.append(current)
    if len(lines) <= max_lines:
        return lines
    trimmed = lines[: max_lines - 1]
    remainder = " ".join(lines[max_lines - 1 :])
    last = remainder
    while True:
        width, _ = measure_text(draw, f"{last}...", font)
        if width <= max_width or " " not in last:
            break
        last = last.rsplit(" ", 1)[0]
    trimmed.append(f"{last}...")
    return trimmed


def fit_headline(title: str, max_width: int, max_height: int) -> tuple[ImageFont.ImageFont, list[str], int]:
    probe = Image.new("RGB", (32, 32))
    draw = ImageDraw.Draw(probe)
    for size in (70, 66, 62, 58, 54, 50):
        font = load_font(size, bold=True)
        lines = wrap_title_to_width(title, font, max_width, max_lines=4)
        line_height = size + 10
        total_height = len(lines) * line_height
        widest = max((measure_text(draw, line, font)[0] for line in lines), default=0)
        if total_height <= max_height and widest <= max_width:
            return font, lines, line_height
    font = load_font(46, bold=True)
    lines = wrap_title_to_width(title, font, max_width, max_lines=4)
    return font, lines, 54


def build_subject_mask() -> Image.Image:
    mask = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((250, 72, 676, 452), fill=255)
    draw.rounded_rectangle((176, 238, 708, 1028), radius=184, fill=246)
    draw.ellipse((54, 300, 544, 1048), fill=234)
    draw.ellipse((404, 350, 926, 1036), fill=212)
    draw.ellipse((430, 690, 828, 1066), fill=226)
    draw.polygon(
        [
            (112, 370),
            (86, 598),
            (132, 900),
            (258, 1062),
            (470, 1068),
            (422, 582),
        ],
        fill=228,
    )
    draw.polygon(
        [
            (560, 404),
            (820, 500),
            (972, 786),
            (922, 1056),
            (642, 1068),
            (584, 664),
        ],
        fill=208,
    )
    draw.ellipse((280, 226, 678, 622), fill=248)
    return mask.filter(ImageFilter.GaussianBlur(radius=20))


def prepare_logo() -> Image.Image:
    source = Image.open(PDF_LOGO_PATH).convert("RGBA")
    canvas = source.crop(source.getbbox())
    alpha = canvas.getchannel("A")
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 22), (0, 0), alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=2))
    wrapped = Image.new("RGBA", (canvas.width + 4, canvas.height + 4), (0, 0, 0, 0))
    wrapped.alpha_composite(shadow, (3, 3))
    wrapped.alpha_composite(canvas, (0, 0))
    return wrapped


def render(
    index: int = 1,
    output_path: Path = OUTPUT_PATH,
    *,
    title_override: str | None = None,
    image_url_override: str | None = None,
) -> Path:
    if title_override and image_url_override:
        candidate = {
            "title": title_override.strip(),
            "image": image_url_override.strip(),
        }
    else:
        candidate = choose_candidate(index=index)

    response = requests.get(candidate["image"], timeout=35, headers={"User-Agent": USER_AGENT})
    response.raise_for_status()
    source_rgb = cover_image(Image.open(BytesIO(response.content)).convert("RGB"), SIZE, SIZE)
    subject_mask = build_subject_mask()
    subject_rgb = ImageEnhance.Contrast(source_rgb).enhance(1.03)
    subject_rgb = ImageEnhance.Sharpness(subject_rgb).enhance(1.04)
    subject_rgb = ImageEnhance.Color(subject_rgb).enhance(1.01)

    background_rgb = ImageEnhance.Contrast(source_rgb).enhance(1.01)
    background = background_rgb.convert("RGBA")

    bottom_fade = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    fade_pixels = bottom_fade.load()
    for y in range(SIZE):
        ratio = y / max(SIZE - 1, 1)
        alpha = int(max(0.0, (ratio - 0.48) / 0.52) * 230)
        for x in range(SIZE):
            fade_pixels[x, y] = (8, 10, 12, alpha)
    background = Image.alpha_composite(background, bottom_fade)

    base = background.copy()
    subject_shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    zoom = 1.04
    zoom_size = (int(SIZE * zoom), int(SIZE * zoom))
    subject_foreground = subject_rgb.resize(zoom_size, Image.LANCZOS).convert("RGBA")
    zoom_mask = subject_mask.resize(zoom_size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(radius=18))
    offset_x = -18
    offset_y = -8
    shadow_fill = Image.new("RGBA", zoom_size, (0, 0, 0, 54))
    subject_shadow.paste(shadow_fill, (offset_x + 8, offset_y + 14), zoom_mask)
    subject_shadow = subject_shadow.filter(ImageFilter.GaussianBlur(radius=16))
    base = Image.alpha_composite(base, subject_shadow)
    base.paste(subject_foreground, (offset_x, offset_y), zoom_mask)

    draw = ImageDraw.Draw(base)
    logo = prepare_logo()
    logo = logo.resize((264, int(264 * logo.height / logo.width)), Image.LANCZOS)
    logo = ImageEnhance.Sharpness(logo).enhance(1.08)
    base.alpha_composite(logo, (38, 28))
    draw.text((SIZE - 365, 54), "www.bwinbetug.com", font=FONT_URL, fill=BLACK)

    overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    shadow_overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_overlay)
    shadow_draw.polygon([(48, 678), (742, 648), (788, 874), (74, 918)], fill=(0, 0, 0, 42))
    shadow_overlay = shadow_overlay.filter(ImageFilter.GaussianBlur(radius=11))
    base = Image.alpha_composite(base, shadow_overlay)

    card = [(34, 662), (726, 630), (770, 862), (58, 900)]
    overlay_draw.polygon(card, fill=(10, 18, 22, 212))
    overlay_draw.polygon(card, outline=(255, 255, 255, 14), width=2)
    accent = [(50, 676), (286, 664), (298, 694), (64, 706)]
    overlay_draw.polygon(accent, fill=GREEN_BRIGHT + (255,))
    base = Image.alpha_composite(base, overlay)

    draw = ImageDraw.Draw(base)
    headline_font, lines, line_height = fit_headline(candidate["title"], 592, 204)
    y = 720
    for idx, line in enumerate(lines):
        draw.text((76, y + idx * line_height + 2), line, font=headline_font, fill=(0, 0, 0, 150))
        draw.text((74, y + idx * line_height), line, font=headline_font, fill=WHITE)

    tag = "CLUB UPDATE"
    tag_box = draw.multiline_textbbox((0, 0), tag.replace(" ", "\n"), font=FONT_TAG, spacing=2)
    tag_x = SIZE - (tag_box[2] - tag_box[0]) - 54
    tag_y = 792
    draw.multiline_text((tag_x + 2, tag_y + 2), tag.replace(" ", "\n"), font=FONT_TAG, fill=(0, 0, 0, 150), align="right", spacing=2)
    draw.multiline_text((tag_x, tag_y), tag.replace(" ", "\n"), font=FONT_TAG, fill=WHITE, align="right", spacing=2)

    footer = Image.new("RGBA", (SIZE, 116), FOOTER_GREEN + (232,))
    base.alpha_composite(footer, (0, SIZE - 116))
    draw = ImageDraw.Draw(base)
    draw.text((34, SIZE - 84), "Betting is addictive and can be psychologically harmful.", font=FONT_FOOTER, fill=WHITE)
    draw.text((34, SIZE - 54), "Bwinbet is licensed and regulated by the National Lotteries and Gaming Regulatory Board", font=FONT_FOOTER, fill=SOFT_WHITE)

    badge_x = SIZE - 126
    badge_y = SIZE - 90
    draw.ellipse((badge_x, badge_y, badge_x + 62, badge_y + 62), outline=YELLOW, width=3)
    draw.text((badge_x + 11, badge_y + 16), "25+", font=FONT_BADGE, fill=YELLOW)
    draw.text((badge_x + 66, badge_y + 14), "Play", font=FONT_FOOTER, fill=YELLOW)
    draw.text((badge_x + 66, badge_y + 37), "Responsibly", font=FONT_FOOTER, fill=SOFT_WHITE)

    final_rgb = base.convert("RGB").filter(ImageFilter.UnsharpMask(radius=0.7, percent=45, threshold=4))
    final_rgb = final_rgb.filter(ImageFilter.GaussianBlur(radius=0.35))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    final_rgb.save(output_path, format="JPEG", quality=96, optimize=True)
    print(f"{candidate['title']} -> {output_path}")
    return output_path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--index", type=int, default=1)
    parser.add_argument("--out", type=str, default=str(OUTPUT_PATH))
    parser.add_argument("--title", type=str, default="")
    parser.add_argument("--image-url", type=str, default="")
    args = parser.parse_args()
    render(
        index=args.index,
        output_path=Path(args.out),
        title_override=args.title or None,
        image_url_override=args.image_url or None,
    )
