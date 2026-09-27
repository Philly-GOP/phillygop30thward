// Refreshes the site's data files. Run daily by .github/workflows/update-data.yml.
//  - data/ward-leaders.json  Republican ward leaders, from the Committee of Seventy (contact details not copied)
//  - data/seats.json         committee seats filled vs. open, citywide and for the 30th Ward
//  - data/polling.json       polling place for each 30th Ward division (city data)
//  - data/wards.json         citywide ward map (city ward boundaries) with seats and ward leader status per ward
// Seats = 2 per division (city division map) filled by the 2026 primary (data/elected-2026.json)
// plus appointments since then (data/appointed.json, edited by hand).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HOME_WARD = '30';
const SEVENTY = 'https://seventy.org/get-informed/philadelphia-ward-leaders-committeepeople/republican-ward-leaders/';
const POLLING = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/POLLING_PLACES/FeatureServer/0/query';
const DIVISIONS = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Political_Divisions/FeatureServer/0/query';
const WARDS = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Political_Wards/FeatureServer/0/query';
const file = p => new URL(`../data/${p}`, import.meta.url);
const read = p => existsSync(file(p)) ? JSON.parse(readFileSync(file(p), 'utf8')) : null;
const today = new Date().toISOString().slice(0, 10);

function save(name, data) {
  const prev = read(name);
  const strip = o => JSON.stringify({ ...o, checked: 0, changed: 0 });
  const same = prev && strip(prev) === strip(data);
  writeFileSync(file(name), JSON.stringify({ ...data, checked: today, changed: same ? prev.changed : today }, null, 2) + '\n');
  return same ? 'no change' : 'updated';
}

// ---- Ward leaders (Committee of Seventy table) ----
const clean = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&#8217;|&rsquo;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function parseLeaders(html) {
  const table = html.match(/<table[\s\S]*?<\/table>/i);
  if (!table) throw new Error('No table found on the Seventy page');
  const wards = [];
  for (const row of table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)) {
    const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => clean(c[1]));
    if (cells.length < 2 || !/^\d+[A-Z]?$/i.test(cells[0])) continue;
    wards.push({ ward: cells[0].toUpperCase(), leader: /^vacant$/i.test(cells[1]) ? null : cells[1] });
  }
  return wards;
}

async function leaders() {
  const res = await fetch(SEVENTY, { headers: { 'User-Agent': 'Mozilla/5.0 (30th Ward site updater)' } });
  if (!res.ok) throw new Error(`Seventy returned ${res.status}`);
  const wards = parseLeaders(await res.text());
  if (wards.length < 60) throw new Error(`Only ${wards.length} wards parsed; page layout may have changed`);
  const vacant = wards.filter(w => !w.leader).map(w => w.ward);
  return save('ward-leaders.json', { source: SEVENTY, total: wards.length, vacantCount: vacant.length, vacant, wards });
}

// ---- Division list (city's official map) ----
async function divisions() {
  const all = [];
  for (let offset = 0; ; offset += 2000) {
    const q = `?where=1%3D1&outFields=division_num&returnGeometry=false&resultOffset=${offset}&resultRecordCount=2000&f=json`;
    const j = await (await fetch(DIVISIONS + q)).json();
    all.push(...j.features.map(f => f.attributes.division_num));
    if (!j.exceededTransferLimit) break;
  }
  if (all.length < 1500) throw new Error(`Only ${all.length} divisions returned`);
  return all.sort();
}

async function seats() {
  let divs;
  try { divs = await divisions(); } catch (e) {
    console.warn('Division map unavailable, using last saved list:', e.message);
    divs = read('seats.json')?.divisionList;
    if (!divs) throw e;
  }
  const elected = read('elected-2026.json').elected;
  const appointed = read('appointed.json').appointed;
  const filled = d => Math.min(2, (elected[d] || 0) + (appointed[d] || 0));
  const summarize = list => {
    const seatsTotal = list.length * 2, seatsFilled = list.reduce((n, d) => n + filled(d), 0);
    return { divisions: list.length, seats: seatsTotal, filled: seatsFilled, open: seatsTotal - seatsFilled };
  };
  const home = divs.filter(d => d.slice(0, 2) === HOME_WARD);
  // Citywide appointments aren't published seat by seat, so use the best available estimate
  // (or the seats we've listed ourselves, if that's higher).
  const a = read('appointed.json');
  const listed = Object.values(a.appointed).reduce((n, v) => n + v, 0);
  const city = summarize(divs);
  const extra = Math.max(0, (a.citywideAppointedEstimate || 0) - listed);
  city.filled = Math.min(city.seats, city.filled + extra);
  city.open = city.seats - city.filled;
  city.estimated = extra > 0;
  return save('seats.json', {
    sources: { divisions: DIVISIONS, elected: 'Committee of Seventy — Republican Committeepeople (elected 2026)', appointedEstimate: a.citywideSource || null },
    citywide: city,
    ward: { number: HOME_WARD, ...summarize(home),
      openDivisions: home.filter(d => filled(d) < 2).map(d => +d.slice(2)),
      byDivision: Object.fromEntries(home.map(d => [+d.slice(2), filled(d)])) },
    divisionList: divs,
  });
}

// ---- Citywide ward map (city ward boundaries + seat counts per ward) ----
const area = r => r.reduce((a, [x, y], i) => { const [u, v] = r[(i + 1) % r.length]; return a + x * v - u * y; }, 0) / 2;
function inside([px, py], rings) {
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// A point well inside the ward for its label: the middle of the widest horizontal run through the shape.
function labelPoint(rings) {
  const main = rings.reduce((a, b) => Math.abs(area(b)) > Math.abs(area(a)) ? b : a);
  const ys = main.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let best = null;
  for (let k = 1; k < 20; k++) {
    const y = y0 + (y1 - y0) * k / 20, xs = [];
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + (y - yi) * (xj - xi) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (!best || w > best.w) best = { w, x: (xs[i] + xs[i + 1]) / 2, y };
    }
  }
  return best ? [best.x, best.y] : main[0];
}

async function wardsMap() {
  const q = '?where=1%3D1&outFields=ward_num&returnGeometry=true&maxAllowableOffset=25&geometryPrecision=0&f=json&resultRecordCount=2000';
  const j = await (await fetch(WARDS + q)).json();
  if (!j.features || j.features.length < 60) throw new Error(`Only ${j.features?.length || 0} wards returned`);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const f of j.features) for (const r of f.geometry.rings) for (const [x, y] of r) {
    minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
  }
  const W = 1000, s = W / (maxx - minx), H = Math.round((maxy - miny) * s);
  const px = ([x, y]) => [Math.round((x - minx) * s), Math.round((maxy - y) * s)];
  const divs = read('seats.json')?.divisionList || [];
  const elected = read('elected-2026.json').elected, appointed = read('appointed.json').appointed;
  const vacant = new Set((read('ward-leaders.json')?.vacant || []).map(w => String(+w)));
  const wards = j.features.map(f => {
    const w = String(+f.attributes.ward_num);
    const rings = f.geometry.rings.map(r => r.map(px).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]));
    const d = rings.map(r => 'M' + r.map(p => p.join(',')).join('L') + 'Z').join('');
    const [lx, ly] = labelPoint(rings);
    const mine = divs.filter(x => String(+x.slice(0, 2)) === w);
    const filled = mine.reduce((n, x) => n + Math.min(2, (elected[x] || 0) + (appointed[x] || 0)), 0);
    return { ward: w, d, x: Math.round(lx), y: Math.round(ly), divisions: mine.length, seats: mine.length * 2, filled,
      open: mine.length * 2 - filled, leaderVacant: vacant.has(w) };
  }).sort((a, b) => +a.ward - +b.ward);
  return save('wards.json', { source: 'City of Philadelphia ward boundaries; seats from 2026 primary results plus recorded appointments', width: W, height: H, wards });
}

// ---- Polling places (city data) ----
const KEEP_UPPER = new Set(['PHA', 'YMCA', 'YWCA', 'PAL', 'SEPTA', 'US', 'PA']);
export function tidy(s) {
  return s.replace(/Y M C A/gi, 'YMCA').replace(/\s*@\s*/g, ' at ').replace(/\[([^\]]+)\]/g, '($1)')
    .toLowerCase().replace(/[a-z0-9]+/g, w => KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase()
      : /^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))
    .replace(/ (At|Of|The|And|For) /g, (m, w) => ` ${w.toLowerCase()} `);
}

async function polling() {
  const q = `?where=ward%3D${+HOME_WARD}&outFields=division,placename,street_address,zip_code&orderByFields=division&returnGeometry=false&f=json`;
  const j = await (await fetch(POLLING + q)).json();
  if (!j.features?.length) throw new Error('No polling places returned');
  const places = j.features.map(({ attributes: a }) => ({
    division: a.division, name: tidy(a.placename), address: tidy(a.street_address), zip: a.zip_code,
  }));
  return save('polling.json', { source: 'City of Philadelphia polling places', ward: HOME_WARD, places });
}

// Each part fails on its own, so a bad day for one source doesn't block the other.
let failed = false;
for (const [name, job] of [['ward leaders', leaders], ['seats', seats], ['polling places', polling], ['ward map', wardsMap]]) {
  try { console.log(`${name}: ${await job()}`); }
  catch (e) { failed = true; console.error(`${name}: FAILED — ${e.message}`); }
}
if (failed) process.exitCode = 1;
