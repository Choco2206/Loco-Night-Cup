'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('./config');
const { DIR } = require('./repository');
const { formatRating } = require('./selection');
const { TEMPLATE_SIZE, TOTT_LAYOUT } = require('./layout');

function escapeXml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]); }
function fittedName(name, width) { const value = String(name || 'Keine Wertung'); const size = Math.max(12, Math.min(22, Math.floor(width / Math.max(value.length * 0.58, 1)))); return { value: value.length > 22 ? `${value.slice(0, 21)}…` : value, size }; }
function fallbackAvatar(size) { return Buffer.from(`<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="#111827"/><text x="50%" y="56%" text-anchor="middle" fill="#e5e7eb" font-family="Arial" font-size="${size/4}" font-weight="700">LNC</text></svg>`); }
async function circularImage(input, diameter) { return sharp(input).resize(diameter, diameter, { fit: 'cover' }).composite([{ input: Buffer.from(`<svg width="${diameter}" height="${diameter}"><circle cx="${diameter/2}" cy="${diameter/2}" r="${diameter/2}" fill="white"/></svg>`), blend: 'dest-in' }]).png().toBuffer(); }

async function renderTeamOfTournament({ slots, outputPath = null, resolvePlayerImage = null }) {
  if (!fs.existsSync(config.templatePath)) throw new Error(`TOTT-Vorlage fehlt: ${config.templatePath}`);
  const metadata = await sharp(config.templatePath).metadata();
  if (metadata.width !== TEMPLATE_SIZE.width || metadata.height !== TEMPLATE_SIZE.height) throw new Error(`Unerwartete TOTT-Vorlagengroesse: ${metadata.width}x${metadata.height}`);
  const composites = [];
  for (const [slot, layout] of Object.entries(TOTT_LAYOUT)) {
    const player = slots?.[slot] || null; const diameter = layout.circle.radius * 2;
    let source = null;
    if (player && resolvePlayerImage) source = await resolvePlayerImage(player).catch(() => null);
    composites.push({ input: await circularImage(source || fallbackAvatar(diameter), diameter), left: layout.circle.cx - layout.circle.radius, top: layout.circle.cy - layout.circle.radius });
    const fitted = fittedName(player?.playerName || 'Keine Wertung', layout.name.width);
    const rating = player ? formatRating(player.average) : '';
    composites.push({ input: Buffer.from(`<svg width="${layout.name.width}" height="58" xmlns="http://www.w3.org/2000/svg"><style>.t{font-family:Arial,sans-serif;fill:white;paint-order:stroke;stroke:#000;stroke-width:3px;stroke-linejoin:round}</style><text class="t" x="50%" y="${fitted.size}" text-anchor="middle" font-size="${fitted.size}" font-weight="700">${escapeXml(fitted.value)}</text><text class="t" x="50%" y="52" text-anchor="middle" font-size="22" font-weight="700">${escapeXml(rating)}</text></svg>`), left: layout.name.x, top: layout.name.y });
  }
  const destination = outputPath || path.join(DIR, `render-${Date.now()}.png`); fs.mkdirSync(path.dirname(destination), { recursive: true });
  await sharp(config.templatePath).composite(composites).png().toFile(destination); return destination;
}

module.exports = { fallbackAvatar, fittedName, renderTeamOfTournament };
