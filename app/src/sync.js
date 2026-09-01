// Google Sheets sync — talks to a Google Apps Script Web App bound to a Sheet
// (see ../google-apps-script/Code.gs and SETUP.md). Deliberately decoupled from
// store.js: this module owns its own queue/config in localStorage and never
// touches `db` directly, so a sync failure can't affect the POS itself. The
// only coupling point is store.js calling enqueueDaySync() once per close-out.
import { reactive } from 'vue';

const CONFIG_KEY = 'vfw_pos_sync_config';
const QUEUE_KEY = 'vfw_pos_sync_queue';
const PRODUCTS_KEY = 'vfw_pos_sync_products_pending';

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || { url: '', secret: '' }; }
  catch (e) { return { url: '', secret: '' }; }
}
function saveConfig(cfg) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
}
function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; }
  catch (e) { return []; }
}
function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) { /* ignore */ }
}

export const syncState = reactive({
  configured: false,
  status: 'idle', // idle | syncing | error
  lastSyncAt: null,
  lastError: '',
  pendingCount: 0,
});

function refreshState() {
  const cfg = loadConfig();
  syncState.configured = !!cfg.url;
  syncState.pendingCount = loadQueue().length + (localStorage.getItem(PRODUCTS_KEY) ? 1 : 0);
}

export function getConfig() { return loadConfig(); }

export function setConfig(url, secret) {
  saveConfig({ url: (url || '').trim(), secret: secret || '' });
  refreshState();
  processQueue();
}

export function enqueueDaySync(summary) {
  const q = loadQueue();
  if (!q.some((x) => x.id === summary.d)) q.push({ id: summary.d, summary });
  saveQueue(q);
  refreshState();
  processQueue();
}

// Products are a "latest wins" snapshot, not a history -- unlike day
// summaries, there's no value in queuing every intermediate edit if several
// happen before the next successful sync.
export function enqueueProductsSync(products) {
  try { localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products)); } catch (e) { /* ignore */ }
  processQueue();
}

// One-time pull of everything currently in the sheet, for setting up a
// replacement tablet or resetting local data after clearing the sheet. This
// is the one place sync.js reads back from the sheet rather than only
// pushing to it -- ongoing sync stays one-way.
export async function pullAll() {
  const cfg = loadConfig();
  if (!cfg.url) throw new Error('Google Sheets sync is not set up yet');
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: cfg.secret, type: 'pull' }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch (e) {
    throw new Error('Got a non-JSON response (HTTP ' + res.status + ') — check the Web App URL and deployment access. Response started with: ' + text.slice(0, 100));
  }
  if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

// Recovery path: re-queues every day this tablet has ever closed, regardless
// of whether it was already (supposedly) synced. Meant for clawing back from
// the silent-failure bug above -- if a day was dequeued without actually
// reaching the sheet, this is the only way to get it there short of manually
// re-entering it. Safe to run as long as nothing in the range genuinely made
// it to the sheet already; if some days did land before, re-sending them
// will duplicate those rows in Sales/Book/Close-out.
export function enqueueAllDays(days) {
  const q = loadQueue();
  (days || []).forEach((summary) => { if (!q.some((x) => x.id === summary.d)) q.push({ id: summary.d, summary }); });
  saveQueue(q);
  refreshState();
  processQueue();
}

export function retrySync() { processQueue(); }

let inFlight = false;

async function processQueue() {
  if (inFlight) return;
  const cfg = loadConfig();
  if (!cfg.url) { refreshState(); return; }
  let q = loadQueue();
  const pendingProducts = localStorage.getItem(PRODUCTS_KEY);
  if (!q.length && !pendingProducts) { refreshState(); return; }

  inFlight = true;
  syncState.status = 'syncing';
  syncState.lastError = '';
  try {
    for (const item of [...q]) {
      await postDay(cfg, item.summary);
      q = q.filter((x) => x.id !== item.id);
      saveQueue(q);
      syncState.lastSyncAt = Date.now();
      syncState.pendingCount = q.length;
    }
    if (pendingProducts) {
      await postProducts(cfg, JSON.parse(pendingProducts));
      localStorage.removeItem(PRODUCTS_KEY);
      syncState.lastSyncAt = Date.now();
    }
    syncState.status = 'idle';
  } catch (err) {
    syncState.status = 'error';
    syncState.lastError = String((err && err.message) || err);
  } finally {
    inFlight = false;
    refreshState();
  }
}

// Deliberately strict: an earlier version treated an unparseable response as
// "probably sent, Apps Script is just being weird about CORS" and swallowed
// it as success. In practice that meant a misconfigured deployment (wrong
// URL, wrong access setting, an expired version) failed *silently* -- the
// item got marked sent and dequeued locally while never actually reaching
// the sheet, with no error surfaced anywhere. Never assume success on a
// response we can't actually read.
async function postJson_(cfg, payload) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    // text/plain avoids a CORS preflight (Apps Script Web Apps handle preflight
    // OPTIONS requests poorly) — the body is still JSON, Apps Script parses it itself.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch (e) {
    throw new Error('Got a non-JSON response (HTTP ' + res.status + ') — check the Web App URL is correct and deployed with "Execute as: Me" / "Who has access: Anyone". Response started with: ' + text.slice(0, 100));
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
}

async function postDay(cfg, summary) { return postJson_(cfg, { secret: cfg.secret, type: 'day', summary }); }
async function postProducts(cfg, products) { return postJson_(cfg, { secret: cfg.secret, type: 'products', products }); }

refreshState();
if (syncState.configured) processQueue(); // flush anything queued from a prior offline session
