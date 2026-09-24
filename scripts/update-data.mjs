// Refreshes the site's data files. Run daily by .github/workflows/update-data.yml.
//  - data/ward-leaders.json  Republican ward leaders, from the Committee of Seventy (contact details not copied)
//  - data/seats.json         committee seats filled vs. open, citywide and for the 30th Ward
// Seats = 2 per division (city division map) filled by the 2026 primary (data/elected-2026.json)
// plus appointments since then (data/appointed.json, edited by hand).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HOME_WARD = '30';
const SEVENTY = 'https://seventy.org/get-informed/philadelphia-ward-leaders-committeepeople/republican-ward-leaders/';
const DIVISIONS = 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Political_Divisions/FeatureServer/0/query';
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
      openDivisions: home.filter(d => filled(d) < 2).map(d => +d.slice(2)) },
    divisionList: divs,
  });
}

// Each part fails on its own, so a bad day for one source doesn't block the other.
let failed = false;
for (const [name, job] of [['ward leaders', leaders], ['seats', seats]]) {
  try { console.log(`${name}: ${await job()}`); }
  catch (e) { failed = true; console.error(`${name}: FAILED — ${e.message}`); }
}
if (failed) process.exitCode = 1;
