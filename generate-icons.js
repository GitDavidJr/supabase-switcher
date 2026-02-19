// generate-icons.js — run with: node generate-icons.js
// Requires: npm install canvas

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
const iconsDir = path.join(__dirname, 'icons');

if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir);

sizes.forEach(size => {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#1a1a1a';
    const r = size * 0.18;
    roundRect(ctx, 0, 0, size, size, r);
    ctx.fill();

    // Supabase-style arrow icon
    ctx.strokeStyle = '#3ECF8E';
    ctx.lineWidth = size * 0.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pad = size * 0.2;
    const cx = size / 2;
    const cy = size / 2;

    // Draw a simple "switch" arrows symbol
    const sw = size - pad * 2;

    // Arrow right (top)
    ctx.beginPath();
    ctx.moveTo(pad, cy - size * 0.12);
    ctx.lineTo(size - pad, cy - size * 0.12);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(size - pad - size * 0.18, cy - size * 0.12 - size * 0.1);
    ctx.lineTo(size - pad, cy - size * 0.12);
    ctx.lineTo(size - pad - size * 0.18, cy - size * 0.12 + size * 0.1);
    ctx.stroke();

    // Arrow left (bottom)
    ctx.beginPath();
    ctx.moveTo(size - pad, cy + size * 0.12);
    ctx.lineTo(pad, cy + size * 0.12);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pad + size * 0.18, cy + size * 0.12 - size * 0.1);
    ctx.lineTo(pad, cy + size * 0.12);
    ctx.lineTo(pad + size * 0.18, cy + size * 0.12 + size * 0.1);
    ctx.stroke();

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), buffer);
    console.log(`✓ icon${size}.png`);
});

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}
