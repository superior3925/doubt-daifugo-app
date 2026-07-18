// アイコン/スプラッシュのSVGデザインから assets/*.png を生成するスクリプト。
// デザインを調整したい場合はこのファイルを直接編集して再実行し、その後
// `npx capacitor-assets generate --android` で android/ 側に反映する。
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const CARD = `<g transform="translate(CX,CY) rotate(-8)">
  <rect x="-210" y="-290" width="420" height="580" rx="38" fill="#faf6ec" stroke="#c9a227" stroke-width="14"/>
  <path transform="translate(0,-40) scale(2.05)" d="M0 -100 C 42 -58 100 -8 100 42 C 100 82 68 102 38 90 C 30 104 18 122 0 140 C -18 122 -30 104 -38 90 C -68 102 -100 82 -100 42 C -100 -8 -42 -58 0 -100 Z M-16 140 L16 140 L28 176 L-28 176 Z" fill="#1c1c1c"/>
</g>
<g transform="translate(BX,BY) rotate(10)">
  <circle r="98" fill="#a6321f" stroke="#faf6ec" stroke-width="12"/>
  <text x="0" y="42" font-family="Georgia, 'Times New Roman', serif" font-size="150" font-weight="900" fill="#faf6ec" text-anchor="middle">?</text>
</g>`;

function card(cx, cy, bx, by){
  return CARD.replace('CX', cx).replace('CY', cy).replace('BX', bx).replace('BY', by);
}

const bgGradDefs = `<defs>
  <radialGradient id="bgGrad" cx="50%" cy="42%" r="70%">
    <stop offset="0%" stop-color="#1b5b45"/>
    <stop offset="78%" stop-color="#0a2b20"/>
    <stop offset="100%" stop-color="#051a13"/>
  </radialGradient>
</defs>`;

// 1024x1024: 背景レイヤー（アダプティブアイコン用）
const iconBackground = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${bgGradDefs}
  <rect width="1024" height="1024" fill="url(#bgGrad)"/>
</svg>`;

// 1024x1024: 前景レイヤー（透明背景、セーフゾーン内にカード+スペード+「？」バッジ）
const iconForeground = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${card(512, 512, 742, 300)}
</svg>`;

// 1024x1024: フラット版（背景+前景を合成、レガシー角丸アイコン・ストア掲載用）
const iconOnly = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${bgGradDefs}
  <rect width="1024" height="1024" fill="url(#bgGrad)"/>
  ${card(512, 512, 742, 300)}
</svg>`;

// 2732x2732: スプラッシュ画面（背景いっぱいのグラデーション＋中央にやや小さめのマーク）
const splashScale = 0.95; // マークを画面の中央に大きめに配置
const splashCX = 1366, splashCY = 1366;
const splashBX = splashCX + (742-512)*splashScale, splashBY = splashCY + (300-512)*splashScale;
const splash = `<svg viewBox="0 0 2732 2732" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bgGrad" cx="50%" cy="42%" r="70%">
      <stop offset="0%" stop-color="#1b5b45"/>
      <stop offset="78%" stop-color="#0a2b20"/>
      <stop offset="100%" stop-color="#051a13"/>
    </radialGradient>
  </defs>
  <rect width="2732" height="2732" fill="url(#bgGrad)"/>
  <g transform="translate(${splashCX},${splashCY}) scale(${splashScale}) translate(${-splashCX},${-splashCY})">
    ${card(splashCX, splashCY, splashBX, splashBY)}
  </g>
</svg>`;

const outDir = path.resolve(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

async function main(){
  await sharp(Buffer.from(iconBackground)).resize(1024,1024).png().toFile(path.join(outDir, 'icon-background.png'));
  await sharp(Buffer.from(iconForeground)).resize(1024,1024).png().toFile(path.join(outDir, 'icon-foreground.png'));
  await sharp(Buffer.from(iconOnly)).resize(1024,1024).png().toFile(path.join(outDir, 'icon-only.png'));
  await sharp(Buffer.from(splash)).resize(2732,2732).png().toFile(path.join(outDir, 'splash.png'));
  // PWA（ホーム画面に追加）用のマニフェストアイコン。フラット版（iconOnly）を流用する。
  await sharp(Buffer.from(iconOnly)).resize(192,192).png().toFile(path.join(outDir, 'pwa-icon-192.png'));
  await sharp(Buffer.from(iconOnly)).resize(512,512).png().toFile(path.join(outDir, 'pwa-icon-512.png'));
  console.log('generated icon-background.png, icon-foreground.png, icon-only.png, splash.png, pwa-icon-192.png, pwa-icon-512.png in assets/');
}
main().catch(e=>{ console.error(e); process.exit(1); });
