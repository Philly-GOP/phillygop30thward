// Keeps photos of people out of Google's search thumbnails.
// Photos of people go in img/people/, which robots.txt blocks from crawlers.
// To add a new brand or icon image, add it to BRAND below. Fails the build if a rule is broken.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BRAND = new Set(['share.jpg', 'logo-square.jpg', 'sig-badge.png', 'email-header.png', 'email-footer-fade.png', 'email-red.png',
  'facebook-cream.png', 'facebook-lightnavy.png', 'facebook-red.png', 'instagram-cream.png', 'instagram-lightnavy.png', 'instagram-red.png']);
const SHARE = 'https://phillygop30thward.com/img/share.jpg';
const errors = [];

if (!/^Disallow: \/img\/people\/$/m.test(readFileSync('robots.txt', 'utf8'))) errors.push('robots.txt no longer blocks /img/people/');

for (const e of readdirSync('img', { withFileTypes: true }))
  if (e.isFile() && !BRAND.has(e.name)) errors.push(`img/${e.name}: photos of people belong in img/people/; brand images must be added to BRAND in this script`);

const pages = d => readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.name.startsWith('.') ? [] : e.isDirectory() ? pages(join(d, e.name)) : e.name.endsWith('.html') ? [join(d, e.name)] : []);

for (const f of pages('.')) {
  const h = readFileSync(f, 'utf8');
  for (const [, src] of h.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)) {
    const m = src.match(/(?:^|\/)img\/(.+?)(?:\?|$)/);
    if (m && !m[1].startsWith('people/') && !BRAND.has(m[1])) errors.push(`${f}: <img> uses ${src}`);
  }
  for (const [, c] of h.matchAll(/<meta (?:property="og:image"|name="twitter:image") content="([^"]+)"/g))
    if (c !== SHARE) errors.push(`${f}: share image is ${c}, expected ${SHARE}`);
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Search preview images OK');
