// Builds data/map-context.json: the geography drawn over the citywide ward map (wards.html) so people can
// tell where they are — rivers and creeks, major streets, neighborhood names and a few landmarks.
// Also lists, for each ward, the neighborhoods and major streets inside it (shown in the ward panel).
// Shapes come from OpenStreetMap and are projected onto the same frame as data/wards.json
// (city ward boundaries in Web Mercator, scaled to 1000px wide), so everything lines up.
// The geography rarely changes: run it by hand from the Actions tab ("Update map geography").
import { writeFileSync } from 'node:fs';

const WARDS = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Political_Wards/FeatureServer/0/query';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const R = 6378137;
const merc = ([lon, lat]) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
const unmerc = ([x, y]) => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];

// Rivers and creeks people navigate by. w = drawn width in px.
// near = where the label should go (lon, lat); creeks without one are drawn but not labeled.
const WATER = [
  { name: 'Delaware River', w: 16, label: 'Delaware River', near: [-75.105, 39.968] },
  { name: 'Schuylkill River', w: 5, label: 'Schuylkill River', near: [-75.198, 39.982] },
  { name: 'Wissahickon Creek', w: 2, label: 'Wissahickon Creek', near: [-75.218, 40.045] },
  { name: 'Pennypack Creek', w: 2, label: 'Pennypack Creek', near: [-75.045, 40.065] },
  { name: 'Cobbs Creek', w: 2, label: 'Cobbs Creek' },
  { name: 'Frankford Creek', w: 2, label: 'Frankford Creek' },
  { name: 'Tacony Creek', w: 2, label: 'Tacony Creek' },
  { name: 'Poquessing Creek', w: 2, label: 'Poquessing Creek' },
];
// Major streets. tier 1 is always on; tier 2 shows with the "More streets" toggle.
const ROADS = [
  { label: 'Broad St', match: /^(North |South )?Broad Street$/, tier: 1 },
  { label: 'Market St', match: /^(East |West )?Market Street$/, tier: 1 },
  { label: 'Roosevelt Blvd', match: /^Roosevelt Boulevard$/, tier: 1 },
  { label: 'I-95', ref: /\bI 95\b/, tier: 1, highway: true },
  { label: 'I-76', ref: /\bI 76\b/, tier: 1, highway: true },
  { label: 'Girard Ave', match: /^(East |West )?Girard Avenue$/, tier: 1 },
  { label: 'Lehigh Ave', match: /^(East |West )?Lehigh Avenue$/, tier: 2 },
  { label: 'Spring Garden St', match: /^(East |West )?Spring Garden Street$/, tier: 2 },
  { label: 'Washington Ave', match: /^Washington Avenue$/, tier: 2 },
  { label: 'Oregon Ave', match: /^Oregon Avenue$/, tier: 2 },
  { label: 'Germantown Ave', match: /^Germantown Avenue$/, tier: 1 },
  { label: 'Ridge Ave', match: /^Ridge Avenue$/, tier: 2 },
  { label: 'Cottman Ave', match: /^Cottman Avenue$/, tier: 2 },
  { label: 'Frankford Ave', match: /^Frankford Avenue$/, tier: 2 },
  { label: 'Baltimore Ave', match: /^Baltimore Avenue$/, tier: 2 },
  { label: 'Lancaster Ave', match: /^Lancaster Avenue$/, tier: 2 },
  { label: 'City Ave', match: /^City Avenue$/, tier: 2 },
  { label: 'Kelly Dr', match: /^Kelly Drive$/, tier: 2 },
];
// Big area names for orientation, plus a few landmarks and the neighbors across the line.
const REGIONS = [
  ['CENTER CITY', -75.1636, 39.9515], ['SOUTH PHILLY', -75.1700, 39.9220], ['WEST PHILLY', -75.2250, 39.9640],
  ['SOUTHWEST', -75.2280, 39.9230], ['NORTH PHILLY', -75.1550, 39.9930], ['RIVER WARDS', -75.1150, 39.9820],
  ['NORTHWEST', -75.2050, 40.0430], ['LOWER NORTHEAST', -75.0850, 40.0330], ['FAR NORTHEAST', -75.0100, 40.0950],
];
const OUTSIDE = [
  ['NEW JERSEY', -75.0700, 39.9250], ['DELAWARE COUNTY', -75.2650, 39.8930],
  ['MONTGOMERY COUNTY', -75.2000, 40.0950], ['BUCKS COUNTY', -74.9850, 40.1450],
];
const LANDMARKS = [
  ['City Hall', -75.16352, 39.95236], ['PHL Airport', -75.2424, 39.8744], ['Navy Yard', -75.1760, 39.8920],
];

// The public Overpass servers are often busy or rate-limited. Try every mirror; if all refuse,
// wait and go round again (30s, then 60s) before giving up.
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function overpass(q) {
  let last;
  const waits = [0, 30000, 60000];
  for (const [round, wait] of waits.entries()) {
    if (wait) { console.warn(`Overpass: all mirrors refused; retrying in ${wait / 1000}s (round ${round + 1} of ${waits.length})`); await sleep(wait); }
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': '30th Ward site map builder (phillygop30thward.com)' } });
        if (!res.ok) throw new Error(`${url} returned ${res.status}`);
        return (await res.json()).elements;
      } catch (e) { last = e; console.warn('Overpass:', e.message); }
    }
  }
  throw last;
}

// Douglas–Peucker simplification in px.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let idx = -1, max = tol;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > max) { max = d; idx = i; } }
    if (idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// Join ways that share endpoints into longer lines.
function chain(lines) {
  const key = p => p.join(',');
  let out = lines.map(l => l.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      let m = null;
      if (key(a[a.length - 1]) === key(b[0])) m = a.concat(b.slice(1));
      else if (key(b[b.length - 1]) === key(a[0])) m = b.concat(a.slice(1));
      else if (key(a[a.length - 1]) === key(b[b.length - 1])) m = a.concat(b.slice(0, -1).reverse());
      else if (key(a[0]) === key(b[0])) m = a.slice().reverse().concat(b.slice(1));
      if (m) { out[i] = m; out.splice(j, 1); merged = true; break outer; }
    }
  }
  return out;
}
function inside([px, py], rings) {
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const pathD = lines => lines.map(l => 'M' + l.map(p => p.map(v => +v.toFixed(1)).join(',')).join('L')).join('');

// Label spot: the longest run of nearly straight line whose middle sits where we want it (inside or outside the city).
function labelSpots(lines, want, len, n = 3, gap = 220) {
  const got = [];
  for (let k = 0; k < n; k++) {
    const s = labelSpot(lines, p => want(p) && got.every(g => Math.hypot(g.x - p[0], g.y - p[1]) > gap), len);
    if (!s) break; got.push(s);
  }
  return got;
}
function labelSpot(lines, want, len) {
  let best = null;
  for (const l of lines) for (let i = 0; i < l.length; i++) {
    let dist = 0, j = i;
    const a0 = Math.atan2(l[Math.min(i + 1, l.length - 1)][1] - l[i][1], l[Math.min(i + 1, l.length - 1)][0] - l[i][0]);
    while (j + 1 < l.length) {
      const ang = Math.atan2(l[j + 1][1] - l[j][1], l[j + 1][0] - l[j][0]);
      let d = Math.abs(ang - a0); if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > 0.35) break;
      dist += Math.hypot(l[j + 1][0] - l[j][0], l[j + 1][1] - l[j][1]); j++;
    }
    if (dist < len) continue;
    const [x0, y0] = l[i], [x1, y1] = l[j], mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    if (!want([mx, my])) continue;
    if (!best || dist > best.dist) {
      let a = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
      if (a > 90) a -= 180; if (a < -90) a += 180;
      best = { dist, x: +mx.toFixed(1), y: +my.toFixed(1), a: +a.toFixed(1) };
    }
  }
  return best && { x: best.x, y: best.y, a: best.a };
}

async function main() {
  const q = '?where=1%3D1&outFields=ward_num&returnGeometry=true&maxAllowableOffset=25&geometryPrecision=0&f=json&resultRecordCount=2000';
  const j = await (await fetch(WARDS + q)).json();
  const wkid = j.spatialReference?.latestWkid || j.spatialReference?.wkid;
  if (![3857, 102100].includes(wkid)) throw new Error(`Ward map is in spatial reference ${wkid}, expected Web Mercator`);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const f of j.features) for (const r of f.geometry.rings) for (const [x, y] of r) {
    minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
  }
  // Same frame as scripts/update-data.mjs wardsMap().
  const W = 1000, s = W / (maxx - minx), H = Math.round((maxy - miny) * s);
  const toPx = ll => { const [x, y] = merc(ll); return [(x - minx) * s, (maxy - y) * s]; };
  const wardRings = j.features.map(f => ({ ward: String(+f.attributes.ward_num), rings: f.geometry.rings.map(r => r.map(([x, y]) => [(x - minx) * s, (maxy - y) * s])) }));
  const inCity = p => wardRings.some(w => inside(p, w.rings));
  // City Ave and a few others run right along the city line, so allow a few px of slack.
  const nearCity = p => inCity(p) || [[4, 0], [-4, 0], [0, 4], [0, -4]].some(([dx, dy]) => inCity([p[0] + dx, p[1] + dy]));
  const wardOf = p => (wardRings.find(w => inside(p, w.rings)) || {}).ward;
  const pad = 2500, [w0, s0] = unmerc([minx - pad, miny - pad]), [e0, n0] = unmerc([maxx + pad, maxy + pad]);
  const bbox = `${s0},${w0},${n0},${e0}`;
  const onFrame = ([x, y]) => x > -60 && x < W + 60 && y > -60 && y < H + 60;

  const waterNames = WATER.map(w => w.name).join('|');
  const els = await overpass(`[out:json][timeout:180];
(
  way["waterway"~"^(river|stream)$"]["name"~"^(${waterNames})$"](${bbox});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)$"]["name"~"Broad Street|Market Street|Roosevelt Boulevard|Girard Avenue|Lehigh Avenue|Spring Garden Street|Washington Avenue|Oregon Avenue|Germantown Avenue|Ridge Avenue|Cottman Avenue|Frankford Avenue|Baltimore Avenue|Lancaster Avenue|City Avenue|Kelly Drive"](${bbox});
  way["highway"="motorway"]["ref"~"I 95|I 76"](${bbox});
);
out geom;
node["place"~"^(neighbourhood|suburb|quarter)$"]["name"](${bbox});
out;`);

  const lineOf = e => (e.geometry || []).map(g => toPx([g.lon, g.lat]));
  // Cut a line into the pieces that stay on (or near) the map frame.
  const clip = l => { const out = []; let cur = []; for (const p of l) { if (onFrame(p)) cur.push(p); else { if (cur.length > 1) out.push(cur); cur = []; } } if (cur.length > 1) out.push(cur); return out; };

  const water = WATER.map(w => {
    const raw = els.filter(e => e.type === 'way' && e.tags?.name === w.name).map(lineOf).filter(l => l.length > 1);
    const lines = chain(raw).flatMap(clip).map(l => simplify(l, 0.8)).filter(l => l.length > 1);
    if (!lines.length) { console.warn(`No shape found for ${w.name}`); return null; }
    // Wide rivers get labeled on the water; creeks on the line.
    const [hx, hy] = w.near ? toPx(w.near) : [0, 0];
    // Rivers wind, so if there's no long straight stretch near the spot, accept a shorter one.
    const near = p => Math.hypot(p[0] - hx, p[1] - hy) < 110;
    const first = w.near && [1, .6, .35].reduce((got, f) => got || labelSpot(lines, near, (w.w > 4 ? 70 : 40) * f), null);
    // Big rivers also get labeled farther along, away from the first spot.
    const more = first && w.w > 4 ? labelSpots(lines, p => onFrame(p) && p[0] > 20 && p[0] < W - 20 && p[1] > 20 && p[1] < H - 20 && Math.hypot(p[0] - first.x, p[1] - first.y) > 220, 45, 2) : [];
    return { name: w.label, w: w.w, d: pathD(lines), labels: first ? [first, ...more] : [] };
  }).filter(Boolean);

  const roads = ROADS.map(r => {
    const raw = els.filter(e => e.type === 'way' && e.tags?.highway && (r.ref ? r.ref.test(e.tags.ref || '') && e.tags.highway === 'motorway' : r.match.test(e.tags.name || '')))
      .map(lineOf).filter(l => l.length > 1);
    // Divided roads come as two parallel ways; snap to a coarse grid so both carriageways collapse into one line.
    const snapped = raw.map(l => simplify(l, 1).map(p => p.map(v => Math.round(v * 2) / 2)));
    // Keep only the parts inside the city (I-95, I-76 and Market St carry on into New Jersey and the suburbs).
    const cityClip = l => { const out = []; let cur = []; for (const p of l) { if (nearCity(p)) cur.push(p); else { if (cur.length) { cur.push(p); if (cur.length > 1) out.push(cur); } cur = []; } } if (cur.length > 1) out.push(cur); return out; };
    const lines = chain(snapped).flatMap(cityClip).map(l => simplify(l, 1.2)).filter(l => l.length > 1);
    if (!lines.length) { console.warn(`No shape found for ${r.label}`); return null; }
    // Which wards this street runs through, for the ward panel.
    const wards = new Set();
    for (const l of lines) for (let i = 0; i + 1 < l.length; i++) for (let k = 0; k <= 4; k++) {
      const p = [l[i][0] + (l[i + 1][0] - l[i][0]) * k / 4, l[i][1] + (l[i + 1][1] - l[i][1]) * k / 4];
      const w = wardOf(p); if (w) wards.add(w);
    }
    return { name: r.label, tier: r.tier, highway: !!r.highway, d: pathD(lines), labels: labelSpots(lines, inCity, 45, 4, 200), wards: [...wards].sort((a, b) => a - b) };
  }).filter(Boolean);

  // Neighborhood names by ward (OpenStreetMap place names inside each ward's lines).
  const hoods = {};
  for (const e of els) if (e.type === 'node' && e.tags?.name) {
    const w = wardOf(toPx([e.lon, e.lat])); if (!w) continue;
    (hoods[w] ||= new Set()).add(e.tags.name.replace(/^The /, ''));
  }
  const byWard = {};
  for (const { ward } of wardRings) {
    byWard[ward] = {
      neighborhoods: [...(hoods[ward] || [])].sort(),
      streets: roads.filter(r => r.wards.includes(ward)).map(r => r.name),
    };
  }
  const pt = ([name, lon, lat]) => { const [x, y] = toPx([lon, lat]); return { name, x: +x.toFixed(1), y: +y.toFixed(1) }; };

  writeFileSync(new URL('../data/map-context.json', import.meta.url), JSON.stringify({
    source: 'Rivers, streets and neighborhood names © OpenStreetMap contributors (ODbL); projected to the City of Philadelphia ward map frame',
    built: new Date().toISOString().slice(0, 10), width: W, height: H,
    water, roads: roads.map(({ wards, ...r }) => r),
    regions: REGIONS.map(pt), outside: OUTSIDE.map(pt), landmarks: LANDMARKS.map(pt),
    wards: byWard,
  }) + '\n');
  console.log(`map context: ${water.length} waterways, ${roads.length} streets, ${Object.values(byWard).filter(w => w.neighborhoods.length).length} wards with neighborhood names`);
}

main().catch(e => { console.error('map context: FAILED —', e.message); process.exitCode = 1; });
