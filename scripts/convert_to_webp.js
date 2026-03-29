#!/usr/bin/env node
/**
 * Convert all images in images/ to WebP format (max 1920px wide)
 * and backup originals to images/originals/
 *
 * Usage: NODE_PATH=... node scripts/convert_to_webp.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const IMAGES_DIR = path.join(__dirname, '..', 'images');
const ORIGINALS_DIR = path.join(IMAGES_DIR, 'originals');
const MAX_WIDTH = 1920;
const WEBP_QUALITY = 85;

const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png']);

async function convertImages() {
  if (!fs.existsSync(ORIGINALS_DIR)) {
    fs.mkdirSync(ORIGINALS_DIR, { recursive: true });
    console.log(`Created ${ORIGINALS_DIR}`);
  }

  const files = fs.readdirSync(IMAGES_DIR).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return SUPPORTED_EXTS.has(ext);
  });

  if (files.length === 0) {
    console.log('No images to convert.');
    return [];
  }

  const converted = [];
  let totalSaved = 0;

  for (const file of files) {
    const srcPath = path.join(IMAGES_DIR, file);
    const ext = path.extname(file).toLowerCase();
    const baseName = path.basename(file, ext);
    const webpName = baseName + '.webp';
    const destPath = path.join(IMAGES_DIR, webpName);
    const backupPath = path.join(ORIGINALS_DIR, file);

    const origStat = fs.statSync(srcPath);
    const origSize = origStat.size;

    try {
      let pipeline = sharp(srcPath);
      const meta = await pipeline.metadata();

      // Resize if wider than MAX_WIDTH
      if (meta.width > MAX_WIDTH) {
        pipeline = pipeline.resize(MAX_WIDTH, null, { fit: 'inside', withoutEnlargement: true });
        console.log(`  Resizing ${meta.width}px → ${MAX_WIDTH}px`);
      }

      await pipeline
        .webp({ quality: WEBP_QUALITY, effort: 6 })
        .toFile(destPath);

      const newStat = fs.statSync(destPath);
      const saved = origSize - newStat.size;
      const savedPct = ((saved / origSize) * 100).toFixed(1);
      totalSaved += saved;

      // Move original to backup
      fs.renameSync(srcPath, backupPath);

      console.log(`✓ ${file} → ${webpName} (${(origSize/1024).toFixed(0)}KB → ${(newStat.size/1024).toFixed(0)}KB, -${savedPct}%)`);
      converted.push({ original: file, webp: webpName });
    } catch (err) {
      console.error(`✗ Failed to convert ${file}: ${err.message}`);
    }
  }

  console.log(`\nDone! Converted ${converted.length} images, saved ${(totalSaved/1024/1024).toFixed(1)}MB`);
  return converted;
}

convertImages().catch(console.error);
