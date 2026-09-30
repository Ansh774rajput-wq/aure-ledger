import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const publicDir = "public";
const iconsDir = join(publicDir, "icons");
mkdirSync(iconsDir, { recursive: true });

// Charcoal & Gold Aure Ledger SVG Icon
const svg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="104" fill="#111315"/>
  <rect x="24" y="24" width="464" height="464" rx="88" stroke="#D4AF37" stroke-width="4" stroke-opacity="0.3"/>
  <!-- Gold Shield / Vault emblem -->
  <circle cx="256" cy="256" r="160" fill="#181B1E" stroke="#D4AF37" stroke-width="6"/>
  <!-- Aure 'A' Monogram with scale balance beam -->
  <path d="M256 140L330 330H300L256 220L212 330H182L256 140Z" fill="url(#goldGradient)"/>
  <path d="M190 280H322" stroke="#E5C158" stroke-width="12" stroke-linecap="round"/>
  <!-- Central ledger diamond -->
  <polygon points="256,190 270,210 256,230 242,210" fill="#FFE58F"/>
  <circle cx="256" cy="350" r="10" fill="#D4AF37"/>
  <defs>
    <linearGradient id="goldGradient" x1="180" y1="140" x2="330" y2="330" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFF2B2"/>
      <stop offset="50%" stop-color="#D4AF37"/>
      <stop offset="100%" stop-color="#9A7B1C"/>
    </linearGradient>
  </defs>
</svg>
`.trim();

// Maskable version with extra padding
const maskableSvg = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#111315"/>
  <circle cx="256" cy="256" r="140" fill="#181B1E" stroke="#D4AF37" stroke-width="6"/>
  <path d="M256 150L320 320H292L256 225L220 320H192L256 150Z" fill="url(#goldGradient2)"/>
  <path d="M200 275H312" stroke="#E5C158" stroke-width="10" stroke-linecap="round"/>
  <polygon points="256,195 268,212 256,228 244,212" fill="#FFE58F"/>
  <circle cx="256" cy="340" r="8" fill="#D4AF37"/>
  <defs>
    <linearGradient id="goldGradient2" x1="190" y1="150" x2="320" y2="320" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#FFF2B2"/>
      <stop offset="50%" stop-color="#D4AF37"/>
      <stop offset="100%" stop-color="#9A7B1C"/>
    </linearGradient>
  </defs>
</svg>
`.trim();

writeFileSync(join(iconsDir, "icon.svg"), svg, "utf-8");

await sharp(Buffer.from(svg))
  .resize(192, 192)
  .png()
  .toFile(join(iconsDir, "icon-192.png"));

await sharp(Buffer.from(svg))
  .resize(512, 512)
  .png()
  .toFile(join(iconsDir, "icon-512.png"));

await sharp(Buffer.from(maskableSvg))
  .resize(512, 512)
  .png()
  .toFile(join(iconsDir, "icon-maskable-512.png"));

await sharp(Buffer.from(svg))
  .resize(180, 180)
  .png()
  .toFile(join(iconsDir, "apple-touch-icon.png"));

console.log("✓ PWA Icons successfully generated in public/icons/");
