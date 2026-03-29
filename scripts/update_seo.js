#!/usr/bin/env node
/**
 * Update SEO tags across all HTML files:
 * 1. lang="en" → lang="ko"
 * 2. Add meta description per page
 * 3. Add Open Graph tags
 * 4. Add favicon (SVG emoji)
 * 5. Fix Instagram link
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const FAVICON = `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🗿</text></svg>">`;

const PAGES = [
  {
    file: 'index.html',
    title: 'Park Seong-Ha | Sculptor · AI Artist',
    description: '박성하 조각가·AI 아티스트의 포트폴리오. 치유를 주제로 한 석조 조각, AI 실감미디어, 인터랙티브 아트 작품을 소개합니다.',
    image: 'https://art-seongha-art.github.io/portfolio/images/ningbo_main.webp',
    url: 'https://art-seongha-art.github.io/portfolio/',
  },
  {
    file: 'works.html',
    title: 'Park Seong-Ha | Works Archive',
    description: '박성하의 전체 작품 아카이브. 석조 조각, 공공미술, AI 아트 시리즈를 연도별로 탐색합니다.',
    image: 'https://art-seongha-art.github.io/portfolio/images/ningbo_main.webp',
    url: 'https://art-seongha-art.github.io/portfolio/works.html',
  },
  {
    file: 'work-detail.html',
    title: "Park Seong-Ha | Healing — I'll Pick Stars for You",
    description: "치유하다 — 별을 따줄게. 사암과 검정 화강석, 스테인레스 스틸로 제작된 2.4m 높이의 석조 조각 작품.",
    image: 'https://art-seongha-art.github.io/portfolio/images/healing_stars.webp',
    url: 'https://art-seongha-art.github.io/portfolio/work-detail.html',
  },
  {
    file: 'cv.html',
    title: 'Park Seong-Ha | CV',
    description: '박성하 조각가·AI 아티스트 이력서. 학력, 개인전, 단체전, 수상, 공공미술 프로젝트 이력.',
    image: 'https://art-seongha-art.github.io/portfolio/images/ningbo_main.webp',
    url: 'https://art-seongha-art.github.io/portfolio/cv.html',
  },
];

function buildSeoBlock(page) {
  return `
<meta name="description" content="${page.description}"/>
<meta name="author" content="Park Seong-Ha"/>
<meta property="og:type" content="website"/>
<meta property="og:url" content="${page.url}"/>
<meta property="og:title" content="${page.title}"/>
<meta property="og:description" content="${page.description}"/>
<meta property="og:image" content="${page.image}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${page.title}"/>
<meta name="twitter:description" content="${page.description}"/>
<meta name="twitter:image" content="${page.image}"/>
${FAVICON}`;
}

let totalUpdated = 0;

for (const page of PAGES) {
  const filePath = path.join(ROOT, page.file);
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP (not found): ${page.file}`);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // 1. lang="en" → lang="ko"
  content = content.replace(/lang="en"/g, 'lang="ko"');

  // 2. Fix Instagram link (works.html footer)
  content = content.replace(
    /href="https:\/\/instagram\.com"\s+target="_blank"/g,
    'href="https://instagram.com/seongha.art" target="_blank"'
  );
  // Also fix bare instagram.com links without target
  content = content.replace(
    /href="https:\/\/instagram\.com"/g,
    'href="https://instagram.com/seongha.art"'
  );

  // 3. Remove existing meta description if any (to avoid duplicates)
  content = content.replace(/<meta name="description"[^/]*\/>\n?/gi, '');
  content = content.replace(/<meta property="og:[^"]*"[^/]*\/>\n?/gi, '');
  content = content.replace(/<meta name="twitter:[^"]*"[^/]*\/>\n?/gi, '');
  content = content.replace(/<meta name="author"[^/]*\/>\n?/gi, '');
  content = content.replace(/<link rel="icon"[^>]*>\n?/gi, '');

  // 4. Insert SEO block after viewport meta tag
  const seoBlock = buildSeoBlock(page);
  content = content.replace(
    /(<meta content="width=device-width, initial-scale=1\.0" name="viewport"\/>)/,
    `$1${seoBlock}`
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✓ Updated SEO: ${page.file}`);
    totalUpdated++;
  } else {
    console.log(`  No changes: ${page.file}`);
  }
}

console.log(`\nDone! Updated ${totalUpdated} files.`);
