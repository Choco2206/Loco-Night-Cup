const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUTPUT_DIR = path.join(process.cwd(), 'data', 'generated');

const FRIDAY_TEMPLATE = path.join(
  process.cwd(),
  'assets',
  'ceremony',
  'EA9A63DC-3C6B-43D4-8B3E-5C060A92D772.png'
);

const SATURDAY_TEMPLATE = path.join(
  process.cwd(),
  'assets',
  'ceremony',
  '6CF88BB2-4C60-4EE7-B916-0C3C3E129358.png'
);

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function safeText(value, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text.length ? text : fallback;
}

function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function getTemplatePath(eventKey) {
  return eventKey === 'saturday'
    ? SATURDAY_TEMPLATE
    : FRIDAY_TEMPLATE;
}

async function logoOverlay(logoPath, left, top, size) {
  if (!logoPath || !fs.existsSync(logoPath)) {
    return null;
  }

  const buffer = await sharp(logoPath)
    .resize(size, size, {
      fit: 'contain',
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      },
    })
    .png()
    .toBuffer();

  return {
    input: buffer,
    left,
    top,
  };
}

async function generateCeremonyImage({
  eventKey,
  eventLabel,
  first,
  second,
  third,
  firstLogoPath,
  secondLogoPath,
  thirdLogoPath,
}) {
  ensureOutputDir();

  const templatePath = getTemplatePath(eventKey);

  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `Siegerehrungs-Template nicht gefunden: ${templatePath}`
    );
  }

  const outputPath = path.join(
    OUTPUT_DIR,
    `ceremony-${eventKey}-${Date.now()}.png`
  );

  const svg = `
  <svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">

    <style>
      .title {
        font-family: Arial, sans-serif;
        font-size: 82px;
        font-weight: 900;
        fill: white;
        text-anchor: middle;
      }

      .subtitle {
        font-family: Arial, sans-serif;
        font-size: 42px;
        font-weight: 800;
        fill: #ffd34d;
        text-anchor: middle;
      }

      .place {
        font-family: Arial, sans-serif;
        font-size: 38px;
        font-weight: 900;
        fill: white;
        text-anchor: middle;
      }

      .team {
        font-family: Arial, sans-serif;
        font-size: 42px;
        font-weight: 900;
        fill: white;
        text-anchor: middle;
      }
    </style>

    <text x="960" y="90" class="title">
      LOCO NIGHT CUP
    </text>

    <text x="960" y="145" class="subtitle">
      SIEGEREHRUNG • ${escapeXml(safeText(eventLabel))}
    </text>

    <text x="960" y="790" class="place">
      🥇 1. PLATZ
    </text>

    <text x="960" y="850" class="team">
      ${escapeXml(safeText(first?.clubName))}
    </text>

    <text x="430" y="825" class="place">
      🥈 2. PLATZ
    </text>

    <text x="430" y="885" class="team">
      ${escapeXml(safeText(second?.clubName))}
    </text>

    <text x="1490" y="825" class="place">
      🥉 3. PLATZ
    </text>

    <text x="1490" y="885" class="team">
      ${escapeXml(safeText(third?.clubName))}
    </text>

  </svg>
  `;

  const overlays = [
    {
      input: Buffer.from(svg),
      left: 0,
      top: 0,
    },
  ];

  const firstLogo = await logoOverlay(
    firstLogoPath,
    810,
    390,
    300
  );

  const secondLogo = await logoOverlay(
    secondLogoPath,
    310,
    455,
    240
  );

  const thirdLogo = await logoOverlay(
    thirdLogoPath,
    1370,
    455,
    240
  );

  if (firstLogo) overlays.push(firstLogo);
  if (secondLogo) overlays.push(secondLogo);
  if (thirdLogo) overlays.push(thirdLogo);

  await sharp(templatePath)
    .resize(1920, 1080)
    .composite(overlays)
    .png()
    .toFile(outputPath);

  return outputPath;
}

module.exports = {
  generateCeremonyImage,
};