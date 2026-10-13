// Posts 30th Ward events from data/events.json to the ward Facebook Page, each linking back to its spot on
// calendar.html. Run by .github/workflows/facebook-events.yml (daily, and whenever events.json changes).
//
// What gets posted
//  - An announcement for each upcoming ward or election event, the first time the job sees it
//    (at most MAX_PER_RUN a day, soonest first, so a batch of new events spreads out).
//  - A reminder the day before.
//  - Around Philly events (around: true) are other hosts' events and are skipped unless they have "facebook": true.
//    Any event with "facebook": false is never posted.
//
// Preview mode: without the FB_PAGE_TOKEN secret nothing is posted or saved. The drafts are written to the
// run summary instead, so they can be copied into Meta Business Suite by hand.
//
// Secrets (repo Settings > Secrets and variables > Actions): FB_PAGE_ID, FB_PAGE_TOKEN (a long-lived Page token
// with pages_manage_posts). Optional variable: FB_GRAPH_VERSION.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';

const SITE = 'https://phillygop30thward.com';
const MAX_PER_RUN = 2;
const KEEP_DAYS = 60;
const VERSION = process.env.FB_GRAPH_VERSION || 'v25.0';
const PAGE = process.env.FB_PAGE_ID, TOKEN = process.env.FB_PAGE_TOKEN;
const LIVE = !!(PAGE && TOKEN) && process.env.DRY_RUN !== '1';

const file = p => new URL(`../data/${p}`, import.meta.url);
const STATE = 'facebook-posts.json';
const events = JSON.parse(readFileSync(file('events.json'), 'utf8')).events || [];
const state = existsSync(file(STATE)) ? JSON.parse(readFileSync(file(STATE), 'utf8'))
  : { note: 'Written by scripts/post-events.mjs. Records which events were posted to Facebook so nothing posts twice. Do not edit by hand.', announced: {}, reminded: {} };

// Same id rule as WardCal.slug in cal.js, so links land on the right event.
export const slug = e => e.date + '-' + e.title.toLowerCase().replace(/\W+/g, '-').replace(/^-+|-+$/g, '');

const today = process.env.TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const daysUntil = e => Math.round((Date.parse(e.date) - Date.parse(today)) / 864e5);
const eligible = e => e.facebook !== false && (!e.around || e.facebook === true);

const time12 = t => { const h = +t.slice(0, 2), m = t.slice(3); return (h % 12 || 12) + (m === '00' ? '' : ':' + m) + (h < 12 ? ' a.m.' : ' p.m.'); };
const when = e => new Date(e.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
  + (e.start ? ', ' + time12(e.start) + (e.end ? ' to ' + time12(e.end) : '') : '');
const link = (e, kind) => `${SITE}/calendar.html?event=${encodeURIComponent(slug(e))}`
  + `&utm_source=facebook&utm_medium=social&utm_campaign=events&utm_content=${kind}`;

function message(e, kind) {
  const head = kind === 'reminder' ? `Tomorrow: ${e.title}` : e.title;
  return [head, when(e), e.where, e.details, '', `Details and add it to your calendar: ${link(e, kind)}`]
    .filter((l, i) => l || i === 4).join('\n');
}

async function post(e, kind) {
  const body = new URLSearchParams({ message: message(e, kind), link: link(e, kind), access_token: TOKEN });
  const res = await fetch(`https://graph.facebook.com/${VERSION}/${PAGE}/feed`, { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.id) throw new Error(`${res.status} ${json.error ? json.error.message : 'no post id returned'}`);
  return json.id;
}

// Decide what to post this run.
const upcoming = events.filter(e => eligible(e) && daysUntil(e) >= 1).sort((a, b) => a.date.localeCompare(b.date));
const queue = [];
for (const e of upcoming) {
  const id = slug(e);
  if (daysUntil(e) === 1) { if (!state.reminded[id]) queue.push([e, 'reminder']); }
  else if (!state.announced[id] && queue.filter(q => q[1] === 'announce').length < MAX_PER_RUN) queue.push([e, 'announce']);
}

const out = [`## Facebook event posts, ${today}${LIVE ? '' : ' (preview — no Page token set, nothing posted)'}`, ''];
let failed = 0;
for (const [e, kind] of queue) {
  const id = slug(e);
  try {
    const postId = LIVE ? await post(e, kind) : null;
    if (LIVE) {
      const rec = { date: e.date, post: postId, on: today };
      if (kind === 'reminder') { state.reminded[id] = rec; state.announced[id] ||= rec; } else state.announced[id] = rec;
    }
    out.push(`### ${kind === 'reminder' ? 'Reminder' : 'Announcement'}: ${e.title}${postId ? ` — posted (${postId})` : ''}`, '```', message(e, kind), '```', '');
    console.log(`${LIVE ? 'Posted' : 'Would post'} ${kind}: ${id}`);
  } catch (err) {
    failed++;
    out.push(`### Failed: ${e.title} (${kind})`, String(err.message), '');
    console.error(`Failed ${kind} ${id}: ${err.message}`);
  }
}
if (!queue.length) out.push('Nothing to post today.');

if (LIVE) {
  // Forget events well in the past so the file stays small.
  for (const k of ['announced', 'reminded'])
    for (const [id, r] of Object.entries(state[k])) if ((Date.parse(today) - Date.parse(r.date)) / 864e5 > KEEP_DAYS) delete state[k][id];
  writeFileSync(file(STATE), JSON.stringify(state, null, 2) + '\n');
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.join('\n') + '\n');
else console.log('\n' + out.join('\n'));
if (failed) process.exit(1);
