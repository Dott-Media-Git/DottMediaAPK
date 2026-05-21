from __future__ import annotations

import argparse
import re
import textwrap
from io import BytesIO
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET

import requests
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[2]
BRAND_LOGO_PATH = ROOT / "docs" / "brand-kits" / "assets" / "football-analytics-logo.jpeg"
OUTPUT_PATH = ROOT / "exports" / "football-analytics-news-poster-preview.jpg"
SIZE = 1080
FEEDS = [
    "https://feeds.bbci.co.uk/sport/football/rss.xml",
    "https://www.espn.com/espn/rss/soccer/news",
]
USER_AGENT = "DottMedia-FootballAnalyticsNewsPoster/1.0"

BLACK = (9, 10, 12)
YELLOW = (34, 197, 94)
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
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf" if bold else "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
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
FONT_BRAND = load_font(28, bold=True)


def normalize_news_image_url(url: str) -> str:
    value = (url or "").strip()
    if not value:
        return ""
    if "bbc.co.uk" in value or "bbci.co.uk" in value:
        value = re.sub(r"/\d{2,4}x\d{2,4}/", "/1024x576/", value)
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


def prepare_source_image(source: Image.Image) -> tuple[Image.Image, bool]:
    image = source.convert("RGB")
    width, height = image.size
    low_res = width < 900 or height < 500 or (width * height) < 700_000
    if low_res:
        upscale = min(max(900 / max(width, 1), 500 / max(height, 1), 1.0), 2.6)
        image = image.resize((int(width * upscale), int(height * upscale)), Image.LANCZOS)
        image = image.filter(ImageFilter.GaussianBlur(radius=0.35))
        image = ImageEnhance.Sharpness(image).enhance(1.08)
        image = ImageEnhance.Contrast(image).enhance(1.02)
    return image, low_res


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
    source = Image.open(BRAND_LOGO_PATH).convert("RGBA")
    source.thumbnail((184, 184), Image.LANCZOS)
    tile = Image.new("RGBA", (216, 216), (0, 0, 0, 0))
    tile_draw = ImageDraw.Draw(tile)
    tile_draw.rounded_rectangle(
        (0, 0, tile.width - 1, tile.height - 1),
        radius=32,
        fill=(0, 0, 0, 182),
        outline=GREEN_BRIGHT + (210,),
        width=2,
    )
    x = (tile.width - source.width) // 2
    y = (tile.height - source.height) // 2
    tile.alpha_composite(source, (x, y))
    return tile


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

    image_ref = candidate["image"]
    image_path = Path(image_ref)
    if image_path.exists():
        image_bytes = image_path.read_bytes()
    else:
        response = requests.get(image_ref, timeout=35, headers={"User-Agent": USER_AGENT}, verify=False)
        response.raise_for_status()
        image_bytes = response.content
    prepared_source, low_res = prepare_source_image(Image.open(BytesIO(image_bytes)))
    source_rgb = cover_image(prepared_source, SIZE, SIZE)
    background_rgb = ImageEnhance.Contrast(source_rgb).enhance(1.02 if not low_res else 1.01)
    background_rgb = ImageEnhance.Sharpness(background_rgb).enhance(1.04 if not low_res else 1.02)
    background = background_rgb.convert("RGBA")

    bottom_fade = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    fade_pixels = bottom_fade.load()
    for y in range(SIZE):
        ratio = y / max(SIZE - 1, 1)
        alpha = int(max(0.0, (ratio - 0.48) / 0.52) * 236)
        for x in range(SIZE):
            fade_pixels[x, y] = (8, 10, 12, alpha)
    base = Image.alpha_composite(background, bottom_fade)

    draw = ImageDraw.Draw(base)
    poster_title = " ".join(candidate["title"].split()[:8]).upper()
    headline_font, lines, line_height = fit_headline(poster_title, 850, 230)
    lines = lines[:3]
    y = 818
    draw.rounded_rectangle((58, 748, 154, 756), radius=4, fill=(53, 182, 83))
    for idx, line in enumerate(lines):
        draw.text((60, y + idx * line_height + 2), line, font=headline_font, fill=(0, 0, 0, 150))
        draw.text((58, y + idx * line_height), line, font=headline_font, fill=WHITE)

    final_rgb = base.convert("RGB").filter(ImageFilter.UnsharpMask(radius=0.8, percent=65, threshold=3))
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
