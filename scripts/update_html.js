#!/usr/bin/env node
/**
 * Update HTML files:
 * 1. Replace .jpg/.png image src paths with .webp
 * 2. Add loading="lazy" to all <img> tags (except above-fold hero image)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML_FILES = ['index.html', 'works.html', 'work-detail.html', 'cv.html'];

// Hero images that should NOT be lazy-loaded (above the fold)
const HERO_IMAGES = new Set(['ningbo_main.webp']);

function updateHtml(filePath) {
  if (!fs.existsSync(filePath)) return false;

  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // 1. Replace image extensions: .jpg/.jpeg/.png → .webp (only for images/ paths)
  content = content.replace(/(src="images\/[^"]+)\.(jpg|jpeg|png)"/gi, '$1.webp"');

  // 2. Add loading="lazy" to <img> tags that don't already have it,
  //    skipping hero images that are above the fold.
  content = content.replace(/<img\s([^>]*)>/gi, (match, attrs) => {
    // Already has loading attribute
    if (/\bloading\s*=/i.test(attrs)) return match;

    // Check if this is a hero image (don't lazy-load above-fold content)
    const srcMatch = /src="([^"]*)"/i.exec(attrs);
    if (srcMatch) {
      const imgFile = path.basename(srcMatch[1]);
      if (HERO_IMAGES.has(imgFile)) {
        return match; // skip hero image
      }
    }

    return `<img loading="lazy" ${attrs}>`;
  });

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Updated ${path.basename(filePath)}`);
    return true;
  } else {
    console.log(`  No changes: ${path.basename(filePath)}`);
    return false;
  }
}

let updated = 0;
for (const file of HTML_FILES) {
  const filePath = path.join(ROOT, file);
  if (updateHtml(filePath)) updated++;
}
console.log(`\nUpdated ${updated} HTML files.`);
