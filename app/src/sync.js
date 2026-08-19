// Google Sheets sync — talks to a Google Apps Script Web App bound to a Sheet
// (see ../google-apps-script/Code.gs and SETUP.md). Deliberately decoupled from
// store.js: this module owns its own queue/config in localStorage and never
// touches `db` directly, so a sync failure can't affect the POS itself. The
// only coupling point is store.js calling enqueueDaySync() once per close-out.
import { reactive } from 'vue';

const CONFIG_KEY = 'vfw_pos_sync_config';
const QUEUE_KEY = 'vfw_pos_sync_queue';

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
  syncState.pendingCount = loadQueue().length;
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

export function retrySync() { processQueue(); }

let inFlight = false;

async function processQueue() {
  if (inFlight) return;
  const cfg = loadConfig();
  if (!cfg.url) { refreshState(); return; }
  let q = loadQueue();
  if (!q.length) { refreshState(); return; }

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
    syncState.status = 'idle';
  } catch (err) {
    syncState.status = 'error';
    syncState.lastError = String((err && err.message) || err);
  } finally {
    inFlight = false;
    refreshState();
  }
}

async function postDay(cfg, summary) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    // text/plain avoids a CORS preflight (Apps Script Web Apps handle preflight
    // OPTIONS requests poorly) — the body is still JSON, Apps Script parses it itself.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: cfg.secret, type: 'day', summary }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  // Some Apps Script deployments return an opaque/unreadable response even on
  // success. If we can read it, use it to catch app-level rejections (bad
  // secret, etc); if we can't, a non-throwing fetch is the best signal we get.
  try {
    const data = await res.json();
    if (data && data.ok === false) throw new Error(data.error || 'sync rejected');
  } catch (parseErr) {
    if (parseErr instanceof SyntaxError) return; // unreadable body, treat as sent
    throw parseErr;
  }
}

refreshState();
if (syncState.configured) processQueue(); // flush anything queued from a prior offline session
