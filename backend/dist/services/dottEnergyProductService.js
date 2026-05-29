import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import https from "https";
import path from "path";
import sharp from "sharp";
import { saveGeneratedImageBuffer } from "./generatedMediaService.js";
const SHOP_URL = (process.env.DOTT_ENERGY_SHOP_URL ?? "https://dott-energy-2.myshopify.com").replace(/\/$/, "");
const PRODUCTS_URL = `${SHOP_URL}/products.json?limit=60`;
const USER_AGENT = process.env.DOTT_ENERGY_USER_AGENT ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const httpsAgent = process.env.DOTT_ENERGY_TLS_INSECURE === "false" ? void 0 : new https.Agent({ rejectUnauthorized: false });
const LOGO_PATH = path.resolve(
  process.env.DOTT_ENERGY_LOGO_PATH?.trim() || path.join(process.cwd(), "assets/dott-energy/logo.png")
);
const cleanText = (value) => String(value ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const escapeSvg = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const unique = (items) => {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};
const wrapWords = (value, maxChars, maxLines) => {
  const words = value.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
};
const formatUsd = (value) => {
  const numeric = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};
const getStartingPrice = (product) => {
  const prices = (product.variants ?? []).map((variant) => Number(String(variant.price ?? "").replace(/[^\d.]/g, ""))).filter((value) => Number.isFinite(value) && value > 0);
  if (!prices.length) return void 0;
  return Math.min(...prices).toFixed(2);
};
const extractOptions = (product, pattern) => unique(
  (product.variants ?? []).flatMap((variant) => [variant.option1, variant.option2, variant.option3]).map((value) => String(value ?? "").match(pattern)?.[0]?.toUpperCase() ?? "").filter(Boolean)
);
const normalizeProduct = (product) => {
  const id = String(product.id ?? "").trim();
  const title = cleanText(product.title);
  const handle = String(product.handle ?? "").trim();
  const images = unique((product.images ?? []).map((image) => image.src ?? "").filter(Boolean));
  if (!id || !title || !handle || !images.length) return null;
  return {
    id,
    title,
    handle,
    url: `${SHOP_URL}/products/${handle}`,
    vendor: cleanText(product.vendor),
    productType: cleanText(product.product_type),
    priceUsd: getStartingPrice(product),
    powerOptions: extractOptions(product, /\b\d+(?:\.\d+)?\s*(?:KW|W)\b/i),
    voltageOptions: extractOptions(product, /\b\d+\s*V\b/i),
    description: cleanText(product.body_html),
    images
  };
};
async function fetchImageBuffer(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { "User-Agent": USER_AGENT, Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
    httpsAgent,
    timeout: 3e4,
    maxContentLength: 20 * 1024 * 1024
  });
  const type = String(response.headers["content-type"] ?? "");
  if (!type.startsWith("image/")) {
    throw new Error(`Dott Energy image source is not an image: ${type || "unknown"}`);
  }
  return Buffer.from(response.data);
}
async function uploadDottEnergyImage(buffer, folder = "covers") {
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const bucket = process.env.CLIENT_CAMPAIGN_BUCKET?.trim() || "dott-campaign";
  if (supabaseUrl && serviceRoleKey) {
    try {
      const safeFolder = folder.replace(/[^a-z0-9_-]/gi, "") || "covers";
      const objectPath = `client-autopost/dott-energy/${safeFolder}/${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}/${Date.now()}-${crypto.randomUUID()}.jpg`;
      await axios.post(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, buffer, {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          "Content-Type": "image/jpeg",
          "x-upsert": "true"
        },
        maxBodyLength: Infinity,
        httpsAgent,
        timeout: 3e4
      });
      return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;
    } catch (error) {
      console.warn("[dott-energy] Supabase image upload failed; using generated media fallback", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return saveGeneratedImageBuffer(buffer, "jpg");
}
const logoOverlay = async (width, height) => {
  if (!fs.existsSync(LOGO_PATH)) return null;
  const logoWidth = Math.round(width * 0.34);
  const logoHeight = Math.round(height * 0.085);
  return sharp(LOGO_PATH).resize(logoWidth, logoHeight, { fit: "cover", position: "center" }).jpeg({ quality: 88 }).toBuffer();
};
const buildFallbackLogoSvg = (width, height) => `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" rx="26" fill="#07120f" opacity="0.88"/>
  <circle cx="52" cy="${height / 2}" r="30" fill="#7ed957"/>
  <path d="M52 18 L64 ${height / 2} L52 ${height - 18} L40 ${height / 2} Z" fill="#0097d7" opacity="0.9"/>
  <text x="96" y="${height / 2 + 9}" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" fill="#eef7f0">DOTT-ENERGY</text>
</svg>`;
const buildOverlaySvg = (product, format, width, height) => {
  const isStory = format === "story";
  const headline = product.powerOptions.length ? `${product.powerOptions.slice(0, 3).join(" / ")} Wind Power` : product.productType || "Clean Wind Power";
  const headlineLines = wrapWords(headline, isStory ? 19 : 26, 2);
  const productLines = wrapWords(product.title, isStory ? 22 : 25, 2);
  const price = formatUsd(product.priceUsd);
  const options = [
    product.voltageOptions.length ? product.voltageOptions.slice(0, 3).join(" / ") : null,
    product.productType || null
  ].filter(Boolean).join("  |  ");
  const safeStore = SHOP_URL.replace(/^https?:\/\//, "");
  const bottomY = isStory ? height - 455 : height - 260;
  const textX = isStory ? 70 : 58;
  const headlineSize = isStory ? 70 : 50;
  const titleSize = isStory ? 44 : 34;
  const cardWidth = isStory ? width - 140 : width - 116;
  const cardHeight = isStory ? 405 : 198;
  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#06100d" stop-opacity="0.72"/>
      <stop offset="1" stop-color="#06100d" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#06100d" stop-opacity="0"/>
      <stop offset="0.25" stop-color="#06100d" stop-opacity="0.74"/>
      <stop offset="1" stop-color="#06100d" stop-opacity="0.96"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${Math.round(height * 0.24)}" fill="url(#top)"/>
  <rect y="${Math.round(height * 0.5)}" width="${width}" height="${Math.round(height * 0.5)}" fill="url(#bottom)"/>
  <rect x="${textX}" y="${bottomY}" width="${cardWidth}" height="${cardHeight}" rx="32" fill="#07120f" opacity="0.82"/>
  <rect x="${textX}" y="${bottomY}" width="14" height="${cardHeight}" rx="7" fill="#7ed957"/>
  ${headlineLines.map(
    (line, index) => `<text x="${textX + 44}" y="${bottomY + (isStory ? 78 : 58) + index * (headlineSize + 8)}" fill="#f4fff4" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="${headlineSize}" font-weight="900">${escapeSvg(line)}</text>`
  ).join("")}
  ${productLines.map(
    (line, index) => `<text x="${textX + 48}" y="${bottomY + (isStory ? 235 : 118) + index * (titleSize + 12)}" fill="#d7f7e0" font-family="Arial, Helvetica, sans-serif" font-size="${titleSize}" font-weight="700">${escapeSvg(line)}</text>`
  ).join("")}
  ${price ? `<rect x="${width - (isStory ? 370 : 300)}" y="${bottomY + (isStory ? 318 : 132)}" width="${isStory ? 300 : 242}" height="${isStory ? 78 : 64}" rx="28" fill="#7ed957"/><text x="${width - (isStory ? 220 : 178)}" y="${bottomY + (isStory ? 370 : 175)}" text-anchor="middle" fill="#07120f" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="${isStory ? 40 : 32}" font-weight="900">From ${escapeSvg(price)}</text>` : ""}
  <text x="${textX + 48}" y="${height - (isStory ? 105 : 58)}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="${isStory ? 34 : 24}" font-weight="700">${escapeSvg(options || "Wind turbines, generators and controllers")}</text>
  <text x="${width - textX}" y="${isStory ? 172 : height - 30}" text-anchor="end" fill="#8ee6ff" font-family="Arial, Helvetica, sans-serif" font-size="${isStory ? 30 : 22}" font-weight="700">${escapeSvg(safeStore)}</text>
</svg>`;
};
const dottEnergyProductHistoryKey = (product) => `dott-energy-product:${product.handle || product.id}`;
async function fetchDottEnergyProducts() {
  const response = await axios.get(PRODUCTS_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    httpsAgent,
    timeout: 3e4
  });
  const products = response.data?.products ?? [];
  return products.map(normalizeProduct).filter((product) => Boolean(product));
}
async function pickDottEnergyProduct(options = {}) {
  const products = await fetchDottEnergyProducts();
  if (!products.length) throw new Error("No Dott Energy Shopify products found");
  const recent = options.recentKeys ?? /* @__PURE__ */ new Set();
  const fresh = products.filter((product) => !recent.has(dottEnergyProductHistoryKey(product).toLowerCase()));
  const candidates = fresh.length ? fresh : products;
  return candidates[Math.floor(Date.now() / (60 * 60 * 1e3)) % candidates.length];
}
function buildDottEnergyProductCaption(product) {
  const price = formatUsd(product.priceUsd);
  const power = product.powerOptions.length ? product.powerOptions.slice(0, 4).join(", ") : "multiple power options";
  const voltage = product.voltageOptions.length ? product.voltageOptions.slice(0, 3).join(", ") : "12V / 24V options";
  const lines = [
    `${product.title}`,
    "",
    `Clean wind power for homes, farms, lodges and off-grid sites that need reliable backup energy.`,
    "",
    `Power options: ${power}`,
    `Voltage: ${voltage}`,
    price ? `Starting from: ${price}` : null,
    "",
    `Shop Dott Energy: ${SHOP_URL}`,
    "DM Dott Energy with your site, location and power needs so we can help you choose the right turbine, generator or controller.",
    "",
    "#DottEnergy #WindPower #CleanEnergy #RenewableEnergy #OffGridPower #UgandaBusiness"
  ].filter((line) => line !== null);
  return lines.join("\n");
}
async function renderDottEnergyProductImage(product, imageUrl = product.images[0], format = "feed") {
  const width = 1080;
  const height = format === "story" ? 1920 : 1080;
  const productBuffer = await fetchImageBuffer(imageUrl);
  const productLayer = await sharp(productBuffer).resize(Math.round(width * 0.96), Math.round(height * (format === "story" ? 0.74 : 0.82)), {
    fit: "contain",
    background: { r: 236, g: 246, b: 239, alpha: 0 }
  }).toBuffer();
  const overlay = Buffer.from(buildOverlaySvg(product, format, width, height));
  const logo = await logoOverlay(width, height);
  const logoWidth = Math.round(width * 0.34);
  const logoHeight = Math.round(height * 0.085);
  const composites = [
    {
      input: productLayer,
      top: format === "story" ? 210 : 128,
      left: Math.round(width * 0.02)
    },
    { input: overlay, top: 0, left: 0 }
  ];
  if (logo) {
    composites.push({ input: logo, top: format === "story" ? 58 : 34, left: format === "story" ? 64 : 52 });
  } else {
    composites.push({
      input: Buffer.from(buildFallbackLogoSvg(logoWidth, logoHeight)),
      top: format === "story" ? 58 : 34,
      left: format === "story" ? 64 : 52
    });
  }
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 230, g: 243, b: 234 }
    }
  }).composite(composites).jpeg({ quality: 91, mozjpeg: true }).toBuffer();
  return uploadDottEnergyImage(buffer, format === "story" ? "stories" : "covers");
}
export {
  buildDottEnergyProductCaption,
  dottEnergyProductHistoryKey,
  fetchDottEnergyProducts,
  pickDottEnergyProduct,
  renderDottEnergyProductImage
};
