const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SOURCE_IMAGE = 'public/assets/aistudio/file_0000000070688211b9e19cba41aa3d05_911e1601.png';
const OBSIDIAN_BG = '#08090C';

if (!fs.existsSync(SOURCE_IMAGE)) {
  console.error('Source image missing:', SOURCE_IMAGE);
  process.exit(1);
}

// 1. Prepare cropped emblem (isolated without text for small icons)
// Bounding box from analysis: 921x776+166+170
const tmpEmblem = '/tmp/abmax_emblem.png';
const tmpEmblemTransparent = '/tmp/abmax_emblem_trans.png';
const tmpMonochrome = '/tmp/abmax_monochrome.png';
const tmpFullLogo = '/tmp/abmax_full_logo.png';

console.log('1. Isolating emblem and full logo...');
// Crop emblem
execSync(`convert "${SOURCE_IMAGE}" -crop 921x776+166+170 +repage "${tmpEmblem}"`);

// Crop full logo (emblem + text, non-black bounding box: 921x930+166+170)
execSync(`convert "${SOURCE_IMAGE}" -crop 921x935+166+170 +repage "${tmpFullLogo}"`);

// For adaptive foreground, remove pure black background to make it transparent
execSync(`convert "${tmpEmblem}" -fuzz 6% -transparent black "${tmpEmblemTransparent}"`);

// For monochrome themed icon, create white silhouette on transparent
execSync(`convert "${tmpEmblem}" -alpha off -threshold 8% -negate -transparent black -fill white +opaque none "${tmpMonochrome}"`);

// 2. Generate Android mipmap launcher icons
const mipmaps = [
  { dir: 'mipmap-mdpi', iconSize: 48, fgSize: 108 },
  { dir: 'mipmap-hdpi', iconSize: 72, fgSize: 162 },
  { dir: 'mipmap-xhdpi', iconSize: 96, fgSize: 216 },
  { dir: 'mipmap-xxhdpi', iconSize: 144, fgSize: 324 },
  { dir: 'mipmap-xxxhdpi', iconSize: 192, fgSize: 432 }
];

console.log('2. Generating Android launcher icons...');
for (const m of mipmaps) {
  const dirPath = path.join('android/app/src/main/res', m.dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  // A. ic_launcher.png (legacy square icon on obsidian background)
  // Fit emblem nicely within ~72% of square icon
  const iconEmblemSize = Math.round(m.iconSize * 0.72);
  execSync(
    `convert -size ${m.iconSize}x${m.iconSize} xc:"${OBSIDIAN_BG}" ` +
    `\\( "${tmpEmblemTransparent}" -resize ${iconEmblemSize}x${iconEmblemSize} \\) ` +
    `-gravity center -composite "${path.join(dirPath, 'ic_launcher.png')}"`
  );

  // B. ic_launcher_round.png (circular icon on obsidian background)
  execSync(
    `convert -size ${m.iconSize}x${m.iconSize} xc:none -fill "${OBSIDIAN_BG}" ` +
    `-draw "circle ${m.iconSize/2},${m.iconSize/2} ${m.iconSize/2},0" ` +
    `\\( "${tmpEmblemTransparent}" -resize ${iconEmblemSize}x${iconEmblemSize} \\) ` +
    `-gravity center -composite "${path.join(dirPath, 'ic_launcher_round.png')}"`
  );

  // C. ic_launcher_foreground.png (adaptive foreground on transparent canvas)
  // Safe zone for adaptive icons is inner 66% (72dp in 108dp canvas).
  // We size the emblem to ~58% of canvas to ensure safe padding across all masks (circle, rounded rect, squircle)
  const fgEmblemSize = Math.round(m.fgSize * 0.58);
  execSync(
    `convert -size ${m.fgSize}x${m.fgSize} xc:none ` +
    `\\( "${tmpEmblemTransparent}" -resize ${fgEmblemSize}x${fgEmblemSize} \\) ` +
    `-gravity center -composite "${path.join(dirPath, 'ic_launcher_foreground.png')}"`
  );
}

// 3. Generate monochrome icon for themed icons (API 33+)
console.log('3. Generating monochrome drawable...');
const monoFgSize = 432;
const monoEmblemSize = Math.round(monoFgSize * 0.58);
const drawableDir = 'android/app/src/main/res/drawable';
if (!fs.existsSync(drawableDir)) fs.mkdirSync(drawableDir, { recursive: true });

execSync(
  `convert -size ${monoFgSize}x${monoFgSize} xc:none ` +
  `\\( "${tmpMonochrome}" -resize ${monoEmblemSize}x${monoEmblemSize} \\) ` +
  `-gravity center -composite "${path.join(drawableDir, 'ic_launcher_monochrome.png')}"`
);

// 4. Generate Launch Screen (Splash) resources
console.log('4. Generating launch screens...');
const splashes = [
  { file: 'android/app/src/main/res/drawable/splash.png', w: 480, h: 320, mode: 'land' },
  { file: 'android/app/src/main/res/drawable-port-mdpi/splash.png', w: 320, h: 480, mode: 'port' },
  { file: 'android/app/src/main/res/drawable-port-hdpi/splash.png', w: 480, h: 800, mode: 'port' },
  { file: 'android/app/src/main/res/drawable-port-xhdpi/splash.png', w: 720, h: 1280, mode: 'port' },
  { file: 'android/app/src/main/res/drawable-port-xxhdpi/splash.png', w: 960, h: 1600, mode: 'port' },
  { file: 'android/app/src/main/res/drawable-port-xxxhdpi/splash.png', w: 1280, h: 1920, mode: 'port' },
  { file: 'android/app/src/main/res/drawable-land-mdpi/splash.png', w: 480, h: 320, mode: 'land' },
  { file: 'android/app/src/main/res/drawable-land-hdpi/splash.png', w: 800, h: 480, mode: 'land' },
  { file: 'android/app/src/main/res/drawable-land-xhdpi/splash.png', w: 1280, h: 720, mode: 'land' },
  { file: 'android/app/src/main/res/drawable-land-xxhdpi/splash.png', w: 1600, h: 960, mode: 'land' },
  { file: 'android/app/src/main/res/drawable-land-xxxhdpi/splash.png', w: 1920, h: 1280, mode: 'land' }
];

for (const s of splashes) {
  const dir = path.dirname(s.file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Size logo proportionally: in portrait, width is ~54% of screen width; in landscape, height is ~50% of screen height
  const maxW = s.mode === 'port' ? Math.round(s.w * 0.54) : Math.round(s.h * 0.75);
  const maxH = s.mode === 'port' ? Math.round(s.h * 0.40) : Math.round(s.h * 0.55);

  execSync(
    `convert -size ${s.w}x${s.h} xc:"${OBSIDIAN_BG}" ` +
    `\\( "${tmpFullLogo}" -resize ${maxW}x${maxH} \\) ` +
    `-gravity center -composite "${s.file}"`
  );
}

// 5. Generate Web & PWA assets with obsidian precision branding
console.log('5. Generating Web & PWA assets...');
execSync(`convert "${tmpFullLogo}" -resize 192x192 -background "${OBSIDIAN_BG}" -gravity center -extent 192x192 public/pwa-192x192.png`);
execSync(`convert "${tmpFullLogo}" -resize 512x512 -background "${OBSIDIAN_BG}" -gravity center -extent 512x512 public/pwa-512x512.png`);
// Maskable icon requires safe inner area
execSync(`convert "${tmpFullLogo}" -resize 360x360 -background "${OBSIDIAN_BG}" -gravity center -extent 512x512 public/pwa-maskable-512x512.png`);
execSync(`convert "${tmpFullLogo}" -resize 180x180 -background "${OBSIDIAN_BG}" -gravity center -extent 180x180 public/apple-touch-icon.png`);
execSync(`convert "${tmpFullLogo}" -resize 64x64 -background "${OBSIDIAN_BG}" -gravity center -extent 64x64 public/favicon.ico`);

console.log('✅ All obsidian precision branding assets generated successfully!');
