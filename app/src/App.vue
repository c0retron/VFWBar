<script setup>
// Ported from ../vfw-bar-pos-system/project/VFW Bar POS.dc.html (the Claude Design
// prototype). The `vm` computed mirrors that file's renderVals() view-model almost
// exactly — see src/store.js. Template structure below mirrors the original 1:1
// (sc-if -> v-if, sc-for -> v-for, {{ }} bindings unchanged) so it stays easy to
// diff against the reviewed prototype if something looks off.
import { ref, computed } from 'vue';
import { vm, store } from './store.js';
import { isDark, toggleDark } from './theme.js';
import { syncState, getConfig, setConfig, retrySync, pullAll, enqueueAllDays, enqueueProductsSync } from './sync.js';
import { weather } from './weather.js';
import { getConfig as getPrinterConfig, setConfig as setPrinterConfig, printerState, testPrint } from './printer.js';

function iconSvg(cat) {
  const a = 'width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
  if (cat === 'sun') return '<svg ' + a + '><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>';
  if (cat === 'cloud') return '<svg ' + a + '><path d="M17.5 19H9a5 5 0 1 1 1.55-9.76A6 6 0 0 1 22 12.5a4.5 4.5 0 0 1-4.5 4.5Z"></path></svg>';
  if (cat === 'snow') return '<svg ' + a + '><path d="M17.5 12H9a5 5 0 1 1 1.55-6.76A6 6 0 0 1 22 8.5"></path><path d="M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"></path></svg>';
  return '<svg ' + a + '><path d="M17.5 12H9a5 5 0 1 1 1.55-6.76A6 6 0 0 1 22 8.5"></path><path d="M16 14v6M8 14v6M12 16v6"></path></svg>'; // rain
}

const initialCfg = getConfig();
const sheetsUrl = ref(initialCfg.url);
const sheetsSecret = ref(initialCfg.secret);
function saveSheetsConfig() { setConfig(sheetsUrl.value, sheetsSecret.value); }

// "Sync now" always force-includes the current product list, not just
// whatever's already queued -- otherwise the Products tab never appears
// until a product happens to be edited after sync gets set up.
function syncNow() {
  enqueueProductsSync(store.db.products.map((p) => ({ name: p.name, cat: p.cat, price: p.price, active: p.active })));
  retrySync();
}

const initialPrinterCfg = getPrinterConfig();
const printerIp = ref(initialPrinterCfg.ip);
const printerPort = ref(String(initialPrinterCfg.port));
const printerWidth = ref(String(initialPrinterCfg.width));
const printerEnabled = ref(!!initialPrinterCfg.enabled);
function savePrinterConfig() {
  setPrinterConfig({ ip: printerIp.value.trim(), port: Number(printerPort.value) || 9100, width: Number(printerWidth.value) || 32, enabled: printerEnabled.value });
}
const printerStatusLabel = computed(() => {
  if (!printerEnabled.value) return 'Printing is off.';
  if (printerState.status === 'printing') return 'Printing…';
  if (printerState.status === 'error') return 'Last print failed: ' + printerState.lastError;
  if (printerState.lastPrintAt) return 'Last printed ' + new Date(printerState.lastPrintAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return 'Ready — prints automatically on tab close and day close.';
});

const restoring = ref(false);
const restoreStatus = ref('');
async function doRestore() {
  if (!confirm("This replaces everything on this tablet — products, tabs, book balances, and sales history — with what's currently in the Google Sheet. This can't be undone. Continue?")) return;
  restoring.value = true;
  restoreStatus.value = 'Pulling from sheet…';
  try {
    const data = await pullAll();
    store.restoreFromPull(data);
    restoreStatus.value = 'Restored ' + (data.products || []).length + ' products, ' + (data.book || []).length + ' book entries, ' + (data.sales || []).length + ' sales rows.';
  } catch (err) {
    restoreStatus.value = 'Restore failed: ' + (err.message || err);
  } finally {
    restoring.value = false;
  }
}

// Recovery for the silent-failure sync bug (fixed, but days closed before the
// fix may have been marked "sent" locally without ever reaching the sheet).
// Re-queues every day this tablet has ever closed. Only run this once things
// are confirmed working -- if any days genuinely made it through before,
// this duplicates those rows.
function resendAllDays() {
  if (!confirm('Re-send every closed day to the sheet? Only do this if you\'re not sure earlier days actually made it there — if some already did, this will duplicate those rows.')) return;
  enqueueAllDays(store.db.days);
}

const syncStatusLabel = computed(() => {
  if (!syncState.configured) return 'Not set up yet — paste in the Web App URL above and save.';
  if (syncState.status === 'syncing') return 'Syncing…';
  if (syncState.status === 'error') return "Couldn't reach the sheet (" + syncState.lastError + ') — ' + syncState.pendingCount + ' day(s) waiting, will retry.';
  if (syncState.pendingCount > 0) return syncState.pendingCount + ' day(s) waiting to sync.';
  if (syncState.lastSyncAt) return 'Synced — last at ' + new Date(syncState.lastSyncAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return 'Ready. Syncs automatically each time you close a day.';
});
</script>

<template>
<div style="height:100vh;display:flex;flex-direction:column;overflow:hidden;font-variant-numeric:tabular-nums">
  <nav class="nav" style="border-bottom:1.5px solid var(--color-divider);flex:none">
    <span class="nav-brand" style="margin-right:var(--space-4)">VFW CANTEEN</span>
    <div v-if="weather.ready" style="display:flex;align-items:center;gap:var(--space-2);font-size:12px;color:var(--color-neutral-600)">
      <span v-html="iconSvg(weather.current.cat)" style="display:inline-flex;color:var(--color-accent-700)"></span>
      <span style="font-family:var(--font-heading);font-size:18px;color:var(--color-text)">{{ weather.current.temp }}°</span>
      <span style="width:1px;height:16px;background:var(--color-divider)"></span>
      <span v-for="(d, i) in weather.days" :key="i" style="display:flex;align-items:center;gap:3px">
        <span>{{ d.label }}</span>
        <span v-html="iconSvg(d.cat)" style="display:inline-flex"></span>
        <span>{{ d.hi }}°/{{ d.lo }}°</span>
      </span>
    </div>
    <div style="display:flex;align-items:center;gap:var(--space-3);margin-left:auto">
      <a v-for="(n, i) in vm.navItems" :key="i" href="#" :aria-current="n.cur" @click="n.go" style="padding:10px 2px;font-size:15px">{{ n.label }}</a>
      <span class="tag tag-accent">{{ vm.openCountLabel }}</span>
      <span style="font-size:12px;letter-spacing:0.08em;color:var(--color-neutral-600)">{{ vm.dayLabel }}</span>
      <button type="button" class="btn btn-ghost" @click="toggleDark" :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'" style="min-width:36px;min-height:36px;padding:0">
        <svg v-if="!isDark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>
      </button>
    </div>
  </nav>

  <!-- Tabs list -->
  <div v-if="vm.viewTabsList" style="flex:1;min-height:0;display:flex;gap:var(--space-4);padding:var(--space-4)">
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--space-3)">
      <div style="display:flex;align-items:baseline;gap:var(--space-2)">
        <h6 style="margin: 0; color: var(--color-accent-700); font-size: 18px">Open tabs</h6>
        <span style="font-size:12px;color:var(--color-neutral-600)">{{ vm.tabsHint }}</span>
      </div>
      <div v-if="vm.hasTabs" style="flex:1;min-height:0;overflow-y:auto;display:flex;gap:var(--space-3);align-items:start">
        <div v-for="(col, ci) in vm.tabColumns" :key="ci" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--space-3)">
          <div v-for="(t, i) in col" :key="i" class="card blueprint" role="button" tabindex="0" @click="t.open" style="cursor:pointer;gap:var(--space-1);min-height:128px">
            <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
            <div style="display:flex;justify-content:space-between;align-items:start;gap:var(--space-2)">
              <div class="card-title" style="font-size:22px">{{ t.name }} <span style="color:#a3781f" v-html="t.stars"></span></div>
              <span v-if="t.hasBook" class="tag tag-outline">book {{ t.bookBal }}</span>
            </div>
            <div v-if="t.hasDrinkLines" style="display:flex;flex-direction:column;gap:1px">
              <div v-for="(d, di) in t.drinkLines" :key="di" style="display:flex;align-items:center;gap:8px;min-height:36px;font-size:14px">
                <span style="flex:1;min-width:0">{{ d.name }}</span>
                <span style="font-size:17px;font-weight:600;color:var(--color-neutral-600)">× {{ d.qty }}</span>
                <button type="button" class="btn" @click.stop="d.add" aria-label="add one more" style="min-width:44px;min-height:36px;padding:0 8px;font-size:15px;font-weight:600;color:var(--color-accent-700)">+1</button>
              </div>
            </div>
            <div style="font-family:var(--font-heading);font-size:30px;color:var(--color-accent-700);margin-top:auto">{{ t.total }}</div>
            <div class="card-meta"><span>{{ t.meta }}</span></div>
          </div>
        </div>
      </div>
      <div v-if="vm.noTabs" class="card blueprint" style="flex:none;padding:var(--space-6);align-items:center;text-align:center">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="card-title">No open tabs</div>
        <p class="card-body" style="margin:0">Start one from the panel on the right — tap a regular or ring a walk-in guest.</p>
      </div>
    </div>
    <div style="flex:none;width:300px;display:flex;flex-direction:column;gap:var(--space-3);border-left:1.5px solid var(--color-divider);padding-left:var(--space-4)">
      <h6 style="margin: 0; color: var(--color-accent-700); font-size: 16px">Start a tab</h6>
      <div style="display:flex;gap:var(--space-1)">
        <input class="input" placeholder="Name…" :value="vm.startName" @input="vm.onStartName" @keydown="vm.onStartKey" style="min-height:44px">
        <button type="button" class="btn" @click="vm.startNamed" style="min-height:44px">Start</button>
      </div>
      <div v-if="vm.hasNameSuggestions" style="display:flex;flex-direction:column;gap:1px;border:1.5px solid var(--color-divider);padding:2px">
        <button v-for="(s, i) in vm.nameSuggestions" :key="i" type="button" class="btn btn-ghost" @click="s.pick" style="justify-content:flex-start;min-height:38px;font-size:14px">{{ s.name }}</button>
      </div>
      <button type="button" class="btn" @click="vm.startGuest" style="min-height:44px;justify-content:flex-start">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
        {{ vm.guestLabel }}
      </button>
      <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-600);margin-top:var(--space-2)">Regulars · most frequent first</div>
      <div style="flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:var(--space-1)">
        <button v-for="(r, i) in vm.regularBtns" :key="i" type="button" class="btn" @click="r.start" style="min-height:46px;justify-content:space-between;font-size:16px">
          <span>{{ r.name }}</span>
          <span style="display:inline-flex;gap:6px;align-items:center">
            <span v-if="r.hasBal" class="tag tag-outline">{{ r.balLabel }}</span>
            <span style="font-family:var(--font-body);font-size:11px;color:var(--color-neutral-600)">{{ r.sub }}</span>
          </span>
        </button>
      </div>
      <div style="font-size:11px;color:var(--color-neutral-600)">Tapping a regular with an open tab jumps to their tab.</div>
    </div>
  </div>

  <!-- Tab detail -->
  <div v-if="vm.viewTabDetail" style="flex:1;min-height:0;display:flex;gap:var(--space-4);padding:var(--space-4)">
    <div style="flex:1;min-width:0;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;gap:var(--space-2);padding-bottom:var(--space-3);border-bottom:1.5px solid var(--color-divider)">
        <button type="button" class="btn btn-ghost" @click="vm.backToTabs" style="min-height: 44px; font-size: 18px; border-width: 1px; border-style: solid; border-color: #000000">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width: 32px; height: 31px"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>
          Tabs
        </button>
        <span style="color:#a3781f" v-html="vm.detStars"></span>
        <span v-if="vm.detHasBook" class="tag tag-outline">book {{ vm.detBookBal }}</span>
        <h3 style="margin:0">{{ vm.detName }}</h3><span style="margin-left:auto;font-size:12px;color:var(--color-neutral-600)">{{ vm.detMeta }}</span>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;padding:var(--space-2) 0">
        <p v-if="vm.detEmpty" style="color:var(--color-neutral-600);padding:var(--space-3) 0">Nothing yet — tap drinks on the right.</p>
        <div v-for="(it, i) in vm.detItems" :key="i" style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-1) 0;border-bottom:1px solid var(--mix-text-22)">
          <span v-if="it.canQty" style="display:inline-flex;align-items:center;gap:2px">
            <button type="button" class="btn btn-ghost" @click="it.dec" aria-label="less" style="min-width:44px;min-height:44px;font-size:20px">−</button>
            <span style="font-family:var(--font-heading);font-size:19px;min-width:26px;text-align:center">{{ it.qty }}</span>
            <button type="button" class="btn btn-ghost" @click="it.inc" aria-label="more" style="min-width:44px;min-height:44px;font-size:20px">+</button>
          </span>
          <span v-if="it.locked" style="display:inline-block;min-width:114px;text-align:center;color:#a3781f"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display:inline"><path d="M12 2.5l2.97 6.53 7.03.66-5.31 4.9 1.5 7.16L12 17.9l-6.19 3.85 1.5-7.16-5.31-4.9 7.03-.66L12 2.5Z"></path></svg></span>
          <span style="flex:1;min-width:0">
            <span style="font-size:17px">{{ it.name }}</span>
            <span v-if="it.hasNote" :style="`font-size:12px;color:${it.noteCol}`"> · <span v-html="it.note"></span></span>
            <span v-if="it.comped" class="tag tag-accent" style="margin-left:8px">COMP</span>
          </span>
          <button v-if="it.canApply" type="button" class="btn btn-ghost" @click="it.applyRound" style="min-height:44px;font-size:12px;color:#7a5c12"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="display:inline;vertical-align:-1px"><path d="M12 2.5l2.97 6.53 7.03.66-5.31 4.9 1.5 7.16L12 17.9l-6.19 3.85 1.5-7.16-5.31-4.9 7.03-.66L12 2.5Z"></path></svg> Apply</button>
          <button v-if="it.canComp" type="button" class="btn btn-ghost" @click="it.comp" style="min-height:44px;font-size:12px">{{ it.compLabel }}</button>
          <button v-if="it.canTransfer" type="button" class="btn btn-ghost" @click="it.transfer" style="min-height:44px;font-size:12px">Transfer</button>
          <span style="width:76px;text-align:right;font-size:17px">{{ it.line }}</span>
          <button type="button" class="btn btn-ghost" @click="it.del" aria-label="remove" style="min-width:44px;min-height:44px">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
          </button>
        </div>
      </div>
      <div style="border-top:1.5px solid var(--color-divider);padding-top:var(--space-3);display:flex;align-items:center;gap:var(--space-2)">
        <button type="button" class="btn" @click="vm.openRound" style="min-height:48px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 11h1a3 3 0 0 1 0 6h-1"></path><path d="M9 12v6"></path><path d="M13 12v6"></path><path d="M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5Z"></path><path d="M5 8v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"></path></svg>
          Buy a round
        </button>
        <span v-if="vm.detHasComp" style="font-size:12px;color:var(--color-neutral-600)">{{ vm.detCompNote }}</span>
        <span style="margin-left:auto;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-neutral-600)">Total</span>
        <span style="font-family:var(--font-heading);font-size:34px;color:var(--color-accent-700)">{{ vm.detTotal }}</span>
        <button type="button" class="btn btn-primary blueprint" @click="vm.openCloseDialog" style="min-height:52px;font-size:17px;padding:0 var(--space-4)">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          Close out
        </button>
      </div>
    </div>
    <div style="flex:none;width:340px;display:flex;flex-direction:column;gap:var(--space-2);border-left:1.5px solid var(--color-divider);padding-left:var(--space-4)">
      <div v-if="vm.hasCredits" style="border:1px solid #a3781f;padding:var(--space-2);font-size:13px;color:#7a5c12" v-html="vm.creditBanner"></div>
      <template v-if="vm.hasUsuals">
        <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent-700)">{{ vm.usualsTitle }}</div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-1)">
          <button v-for="(u, i) in vm.usuals" :key="i" type="button" class="btn" @click="u.add" style="min-height:46px;border-color:var(--color-accent-300)">{{ u.label }}</button>
        </div>
      </template>
      <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-neutral-600);margin-top:var(--space-1)">Add to tab</div>
      <div class="seg" style="display:flex">
        <label v-for="(c, i) in vm.catOpts" :key="i" class="seg-opt" style="flex:1;justify-content:center;min-height:40px;padding:7px 4px"><input type="radio" name="cat" :checked="c.on" @change="c.pick">{{ c.label }}</label>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:1fr 1fr;gap:var(--space-1);align-content:start;padding-top:var(--space-1)">
        <button v-for="(p, i) in vm.prodBtns" :key="i" type="button" class="btn" @click="p.add" :style="`min-height:${vm.prodBtnH};flex-direction:column;gap:2px;padding:8px 6px`">
          <span style="font-size:15px;line-height:1.15;text-align:center">{{ p.name }}</span>
          <span style="font-family:var(--font-body);font-size:12px;color:var(--color-neutral-600)">{{ p.price }}</span>
        </button>
      </div>
    </div>
  </div>

  <!-- The Book -->
  <div v-if="vm.viewBook" style="flex:1;min-height:0;display:flex;gap:var(--space-4);padding:var(--space-4)">
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--space-3)">
      <h6 style="margin: 0; color: var(--color-accent-700); font-size: 16px">The book · member accounts</h6>
      <div style="flex:1;min-height:0;overflow-y:auto">
        <table class="table">
          <thead><tr><th>Member</th><th>Balance</th><th>Last activity</th><th style="text-align:right">Actions</th></tr></thead>
          <tbody>
            <tr v-for="(b, i) in vm.bookRows" :key="i">
              <td style="font-size:16px">{{ b.name }}</td>
              <td><span class="tag" :style="b.balStyle">{{ b.balLabel }}</span></td>
              <td class="text-muted">{{ b.last }}</td>
              <td style="text-align:right;white-space:nowrap">
                <button type="button" class="btn btn-ghost" @click="b.ledger" style="min-height:42px">Ledger</button>
                <button type="button" class="btn btn-ghost" @click="b.pay" style="min-height:42px">Pay down</button>
                <button type="button" class="btn btn-ghost" @click="b.credit" style="min-height:42px">Credit</button>
                <button type="button" class="btn btn-ghost" @click="b.charge" style="min-height:42px">Charge</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div style="flex:none;width:300px;display:flex;flex-direction:column;gap:var(--space-3);border-left:1.5px solid var(--color-divider);padding-left:var(--space-4)">
      <div class="card blueprint">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="card-kicker" style="font-size: 14px">Owed to the canteen</div>
        <div style="font-family:var(--font-heading);font-size:32px">{{ vm.bookOwedTotal }}</div>
        <div class="card-meta"><span>{{ vm.bookOwedSub }}</span></div>
      </div>
      <div class="card blueprint">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="card-kicker" style="font-size: 14px">Credit outstanding</div>
        <div style="font-family:var(--font-heading);font-size:32px">{{ vm.bookCreditTotal }}</div>
        <div class="card-meta"><span>{{ vm.bookCreditSub }}</span></div>
      </div>
      <p style="font-size:13px;color:var(--color-neutral-600);margin:0">Charges land here when a tab is closed to the book. Credits cover work done for the post — mowing, fish fry shifts. Pay-downs show up in tonight's close-out drawer.</p>
    </div>
  </div>

  <!-- Sales -->
  <div v-if="vm.viewSales" style="flex:1;min-height:0;overflow-y:auto;padding:var(--space-4);display:flex;flex-direction:column;gap:var(--space-3)">
    <div style="display:flex;align-items:center;gap:var(--space-3)">
      <h6 style="margin:0;color:var(--color-accent-700)">Sales &amp; reports</h6>
      <span style="font-size:12px;color:var(--color-neutral-600)">{{ vm.salesScopeLabel }}</span>
      <span style="margin-left:auto;font-size:12px;color:var(--color-neutral-600)">Customer</span>
      <select class="input" :value="vm.salesCust" @change="vm.onSalesCust" style="width:220px;min-height:44px">
        <option v-for="(o, i) in vm.custOptions" :key="i" :value="o.id">{{ o.name }}</option>
      </select>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3)">
      <div v-for="(k, i) in vm.kpis" :key="i" class="card blueprint">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="card-kicker">{{ k.kick }}</div>
        <div style="font-family:var(--font-heading);font-size:30px;line-height:1.05">{{ k.val }}</div>
        <div class="card-meta"><span>{{ k.sub }}</span></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
      <div class="card blueprint">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="card-kicker">Sales by day of week · last 30 days</div>
        <div style="display:flex;align-items:flex-end;gap:var(--space-2);height:150px;border-bottom:1.5px solid var(--color-divider);padding-top:var(--space-2)">
          <div v-for="(b, i) in vm.dowBars" :key="i" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%" :title="b.amt">
            <span style="font-size:11px;color:var(--color-neutral-600)">{{ b.amt }}</span>
            <div :style="`width:70%;height:${b.h}%;background:${b.bg}`"></div>
          </div>
        </div>
        <div style="display:flex;gap:var(--space-2)">
          <span v-for="(b, i) in vm.dowBars" :key="i" style="flex:1;text-align:center;font-size:11px;color:var(--color-neutral-600)">{{ b.label }}</span>
        </div>
      </div>
      <div class="card blueprint">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="card-kicker">Sales by month</div>
        <div style="display:flex;align-items:flex-end;gap:var(--space-2);height:150px;border-bottom:1.5px solid var(--color-divider);padding-top:var(--space-2)">
          <div v-for="(b, i) in vm.monthBars" :key="i" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%" :title="b.amt">
            <span style="font-size:11px;color:var(--color-neutral-600)">{{ b.amt }}</span>
            <div :style="`width:70%;height:${b.h}%;background:${b.bg}`"></div>
          </div>
        </div>
        <div style="display:flex;gap:var(--space-2)">
          <span v-for="(b, i) in vm.monthBars" :key="i" style="flex:1;text-align:center;font-size:11px;color:var(--color-neutral-600)">{{ b.label }}</span>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:var(--space-3)">
      <div class="card blueprint">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="card-kicker">Daily sales · last 30 days</div>
        <div style="display:flex;align-items:flex-end;gap:2px;height:130px;border-bottom:1.5px solid var(--color-divider);padding-top:var(--space-2)">
          <div v-for="(b, i) in vm.dailyBars" :key="i" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%" :title="b.title">
            <div :style="`width:100%;height:${b.h}%;background:${b.bg}`"></div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--color-neutral-600)"><span>{{ vm.dailyStart }}</span><span>{{ vm.dailyEnd }}</span></div>
      </div>
      <div class="card blueprint">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="card-kicker">Category mix · last 30 days</div>
        <div style="display:flex;flex-direction:column;gap:var(--space-2);padding-top:var(--space-1)">
          <div v-for="(c, i) in vm.catRows" :key="i">
            <div style="display:flex;justify-content:space-between;font-size:12px"><span>{{ c.label }}</span><span style="color:var(--color-neutral-600)">{{ c.amt }} · {{ c.pct }}</span></div>
            <div style="height:8px;border:1px solid var(--color-divider);margin-top:3px"><div :style="`height:100%;width:${c.w}%;background:var(--color-accent-300)`"></div></div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="vm.custPanel" class="card blueprint">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="card-kicker">{{ vm.custPanelTitle }}</div>
      <div style="display:flex;gap:var(--space-6);flex-wrap:wrap">
        <div v-for="(s, i) in vm.custStats" :key="i"><div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:var(--color-neutral-600)">{{ s.k }}</div><div style="font-family:var(--font-heading);font-size:24px">{{ s.v }}</div></div>
      </div>
    </div>
    <div class="card blueprint">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div style="display:flex;align-items:baseline;gap:var(--space-2)">
        <div class="card-kicker">Shopping report · sold in the last 10 days</div>
        <span style="font-size:12px;color:var(--color-neutral-600)">take this to the store, eyeball the closet</span>
      </div>
      <table class="table">
        <thead><tr><th>Product</th><th>Category</th><th style="text-align:right">Units sold</th><th style="text-align:right">Per day</th><th style="text-align:right">Revenue</th></tr></thead>
        <tbody>
          <tr v-for="(s, i) in vm.shopRows" :key="i">
            <td>{{ s.name }}</td>
            <td><span class="tag tag-neutral">{{ s.cat }}</span></td>
            <td style="text-align:right;font-size:16px;font-weight:500">{{ s.units }}</td>
            <td style="text-align:right" class="text-muted">{{ s.perDay }}</td>
            <td style="text-align:right">{{ s.rev }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Close-out -->
  <div v-if="vm.viewClose" style="flex:1;min-height:0;overflow-y:auto;padding:var(--space-4)">
    <div style="display:grid;grid-template-columns:1fr 1.1fr 1fr;gap:var(--space-4);align-items:start">
      <div style="display:flex;flex-direction:column;gap:var(--space-3)">
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <h6 style="margin:0;color:var(--color-accent-700)">Day summary</h6>
          <button type="button" class="btn" @click="vm.openTabsOverview" style="margin-left:auto;min-height:36px;font-size:12px">View all tabs</button>
        </div>
        <div class="card blueprint">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          <div class="card-kicker">{{ vm.coDate }}</div>
          <div style="display:flex;flex-direction:column">
            <div v-for="(r, i) in vm.coRows" :key="i" style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--mix-text-22);font-size:14px">
              <span :style="`color:${r.col}`">{{ r.label }}</span><span :style="`font-weight:${r.wt}`">{{ r.amt }}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:10px 0 2px;font-family:var(--font-heading);font-size:19px">
              <span>Expected drawer cash</span><span style="color:var(--color-accent-700)">{{ vm.coExpected }}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--color-neutral-600)">
              <span>Card reader batch should read</span><span>{{ vm.coCardBatch }}</span>
            </div>
          </div>
        </div>
        <div v-if="vm.hasCardTips" class="card blueprint" style="border-color:var(--color-accent);align-items:center">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          <div class="card-kicker">Bartender's card tips — pay out in cash</div>
          <div style="font-family:var(--font-heading);font-size:38px;color:var(--color-accent-700)">{{ vm.coCardTips }}</div>
        </div>
        <div v-if="vm.hasOpenTabsWarn" class="card blueprint" style="border-color:var(--color-accent)">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          <div class="card-kicker">Still open — settle before closing</div>
          <p class="card-body" style="margin:0">{{ vm.openTabNames }}. Cash them out, or close to the book.</p>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-3)">
        <h6 style="margin:0;color:var(--color-accent-700)">Count the drawer</h6>
        <div class="card blueprint">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          <div style="display:flex;flex-direction:column">
            <div v-for="(b, i) in vm.billRows" :key="i" style="display:flex;align-items:center;gap:var(--space-2);padding:4px 0;border-bottom:1px solid var(--mix-text-22)">
              <span style="width:48px;font-family:var(--font-heading);font-size:18px">{{ b.label }}</span>
              <button type="button" class="btn btn-ghost" @click="b.dec" aria-label="less" style="min-width:44px;min-height:44px;font-size:20px">−</button>
              <input class="input" type="number" min="0" :value="b.count" @change="b.onSet" style="width:70px;min-height:44px;text-align:center;font-size:16px">
              <button type="button" class="btn btn-ghost" @click="b.inc" aria-label="more" style="min-width:44px;min-height:44px;font-size:20px">+</button>
              <span style="margin-left:auto;color:var(--color-neutral-600);font-size:14px">{{ b.rowTotal }}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding-top:var(--space-2)">
              <span style="font-family:var(--font-heading);font-size:19px">Counted</span>
              <span style="display:inline-flex;align-items:center;gap:8px">
                <span class="tag" :style="vm.overStyle">{{ vm.overLabel }}</span>
                <span style="font-family:var(--font-heading);font-size:24px">{{ vm.countedLabel }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:var(--space-3)">
        <h6 style="margin:0;color:var(--color-accent-700)">Deposit plan</h6>
        <div class="card blueprint">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          <div class="card-kicker">Keep {{ vm.tillTargetLabel }} till · deposit the rest</div>
          <table class="table">
            <thead><tr><th>Bill</th><th style="text-align:right">Keep in till</th><th style="text-align:right">Deposit</th></tr></thead>
            <tbody>
              <tr v-for="(d, i) in vm.depRows" :key="i"><td>{{ d.label }}</td><td style="text-align:right">{{ d.keep }}</td><td style="text-align:right;font-weight:500">{{ d.dep }}</td></tr>
            </tbody>
          </table>
          <div style="display:flex;justify-content:space-between;padding-top:var(--space-1);font-size:14px"><span>Till kept</span><span>{{ vm.keepTotal }}</span></div>
          <div style="display:flex;justify-content:space-between;font-family:var(--font-heading);font-size:22px"><span>Cash deposit</span><span style="color:var(--color-accent-700)">{{ vm.depTotal }}</span></div>
          <div v-if="vm.hasDepNote" style="font-size:12px;color:var(--color-neutral-600)">{{ vm.depositNote }}</div>
        </div>
        <button type="button" class="btn btn-primary btn-block blueprint" @click="vm.doCloseDay" :disabled="vm.closeDayDisabled" style="min-height:56px;font-size:18px">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          Close the day
        </button>
        <div style="font-size:12px;color:var(--color-neutral-600);text-align:center">{{ vm.closeDayHint }}</div>
      </div>
    </div>
  </div>

  <!-- Admin -->
  <div v-if="vm.viewAdmin" style="flex:1;min-height:0;display:flex;gap:var(--space-4);padding:var(--space-4)">
    <div style="flex:1.3;min-width:0;display:flex;flex-direction:column;gap:var(--space-2)">
      <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
        <h6 style="margin:0;color:var(--color-accent-700)">Products &amp; prices</h6>
        <button type="button" class="btn" @click="vm.openShoppingHistory" style="margin-left:auto;min-height:44px;font-size:12px">Past shopping lists</button>
        <button type="button" class="btn" @click="vm.openShoppingList" style="min-height:44px">Create shopping list</button>
        <button type="button" class="btn" @click="vm.addProduct" style="min-height:44px">+ Add product</button>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto">
        <table class="table">
          <thead><tr><th>Product</th><th>Category</th><th style="text-align:right">Price</th><th style="text-align:right">Qty on hand</th><th>Status</th><th style="text-align:right"></th><th style="text-align:right"></th></tr></thead>
          <tbody>
            <tr v-for="(p, i) in vm.prodRows" :key="i">
              <td :style="`font-size:15px;opacity:${p.dim}`">{{ p.name }}</td>
              <td><span class="tag tag-neutral">{{ p.cat }}</span></td>
              <td style="text-align:right">{{ p.price }}</td>
              <td style="text-align:right">
                <input class="input" type="number" step="0.5" :value="p.qty" @change="p.onQty" :style="`width:70px;min-height:36px;text-align:right;display:inline-block${p.qtyLow ? ';border-color:var(--color-accent);color:var(--color-accent-700)' : ''}`">
              </td>
              <td><button type="button" class="btn btn-ghost" @click="p.toggle" style="min-height:40px;font-size:12px">{{ p.activeLabel }}</button></td>
              <td style="text-align:right"><button type="button" class="btn btn-ghost" @click="p.edit" style="min-height:40px">Edit</button></td>
              <td style="text-align:right"><button type="button" class="btn btn-ghost" @click="p.del" style="min-height:40px;color:var(--color-accent-700)">Delete</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div style="flex:none;width:320px;display:flex;flex-direction:column;gap:var(--space-3);border-left:1.5px solid var(--color-divider);padding-left:var(--space-4)">
      <h6 style="margin:0;color:var(--color-accent-700)">Settings</h6>
      <div class="field">
        <label>Till change target</label>
        <input class="input" type="number" step="25" min="50" :value="vm.tillVal" @change="vm.onTill" style="min-height:44px">
      </div>
      <div class="field">
        <label>Max beer storage (24-packs)</label>
        <input class="input" type="number" step="1" min="0" :value="vm.beerCapVal" @change="vm.onBeerCap" style="min-height:44px">
      </div>
      <div class="card blueprint">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="card-kicker">Google Sheets sync</div>
        <p class="card-body" style="margin:0">This app saves everything on the tablet and works offline. Sales, book entries, close-out, and the product list sync here in the background. See google-apps-script/SETUP.md for one-time setup.</p>
        <div class="field"><label>Web App URL</label><input class="input" placeholder="https://script.google.com/macros/s/…/exec" v-model="sheetsUrl" style="min-height:44px"></div>
        <div class="field"><label>Shared secret</label><input class="input" type="password" v-model="sheetsSecret" style="min-height:44px"></div>
        <div style="display:flex;gap:var(--space-1)">
          <button type="button" class="btn" @click="saveSheetsConfig" style="min-height:44px">Save</button>
          <button type="button" class="btn btn-ghost" @click="syncNow" :disabled="!syncState.configured" style="min-height:44px">Sync now</button>
        </div>
        <div style="font-size:12px;color:var(--color-neutral-600)">{{ syncStatusLabel }}</div>
        <div class="hr" style="margin:var(--space-1) 0"></div>
        <button type="button" class="btn btn-ghost" @click="doRestore" :disabled="!syncState.configured || restoring" style="min-height:44px">Restore from Google Sheet…</button>
        <div v-if="restoreStatus" style="font-size:12px;color:var(--color-neutral-600)">{{ restoreStatus }}</div>
        <button type="button" class="btn btn-ghost" @click="resendAllDays" :disabled="!syncState.configured" style="min-height:44px;font-size:12px">Re-send all closed days…</button>
      </div>
      <div class="card blueprint">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="card-kicker">Receipt printer (WiFi)</div>
        <p class="card-body" style="margin:0">Prints a customer receipt when a tab closes, and a day summary + tomorrow's till breakdown when the day closes. Requires an ESC/POS network printer on the same WiFi (port 9100 unless yours is different).</p>
        <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer"><input type="checkbox" :checked="printerEnabled" @change="printerEnabled = $event.target.checked; savePrinterConfig()" style="width:18px;height:18px">Enable printing</label>
        <div style="display:flex;gap:var(--space-1)">
          <div class="field" style="flex:2"><label>Printer IP</label><input class="input" placeholder="192.168.1.50" v-model="printerIp" @change="savePrinterConfig" style="min-height:44px"></div>
          <div class="field" style="flex:1"><label>Port</label><input class="input" type="number" v-model="printerPort" @change="savePrinterConfig" style="min-height:44px"></div>
        </div>
        <div class="field"><label>Receipt width (characters — 32 for 58mm paper, 42-48 for 80mm)</label><input class="input" type="number" v-model="printerWidth" @change="savePrinterConfig" style="min-height:44px"></div>
        <button type="button" class="btn" @click="testPrint" :disabled="!printerEnabled" style="min-height:44px">Test print</button>
        <div style="font-size:12px;color:var(--color-neutral-600)">{{ printerStatusLabel }}</div>
      </div>
      <button type="button" class="btn btn-ghost" @click="vm.resetDemo" style="min-height:44px;color:var(--color-accent-700)">Reset demo data</button>
    </div>
  </div>

  <!-- Dialogs -->
  <div v-if="vm.dlgOpen" class="dialog-backdrop" @click="vm.backdropClick">
    <div v-if="vm.dlgClose" class="dialog blueprint" @click="vm.eatClick" style="background:var(--color-bg);width:min(480px,100%)">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="dialog-title">Close out — {{ vm.dlgTabName }}</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:13px;color:var(--color-neutral-600)" v-html="vm.dlgItemsSummary"></span>
        <span style="font-family:var(--font-heading);font-size:36px;color:var(--color-accent-700)">{{ vm.dlgTotal }}</span>
      </div>
      <div class="seg" style="display:flex">
        <label v-for="(m, i) in vm.payOpts" :key="i" class="seg-opt" style="flex:1;justify-content:center;min-height:46px"><input type="radio" name="paym" :checked="m.on" @change="m.pick">{{ m.label }}</label>
      </div>
      <div v-if="vm.payCash" style="display:flex;flex-direction:column;gap:var(--space-2)">
        <div style="font-size:12px;color:var(--color-neutral-600)">Cash tendered</div>
        <div style="display:flex;gap:var(--space-1);flex-wrap:wrap">
          <button v-for="(t, i) in vm.tenderBtns" :key="i" type="button" class="btn" @click="t.pick" :style="`min-height:46px;border-color:${t.bc}`">{{ t.label }}</button>
          <input class="input" type="number" placeholder="Other" :value="vm.tenderCustom" @change="vm.onTenderCustom" style="width:90px;min-height:46px">
        </div>
        <div style="display:flex;justify-content:space-between;font-family:var(--font-heading);font-size:22px">
          <span>Change due</span><span>{{ vm.changeLabel }}</span>
        </div>
      </div>
      <div v-if="vm.payCard" style="display:flex;flex-direction:column;gap:var(--space-2)">
        <div style="font-size:12px;color:var(--color-neutral-600)">Tip added on the reader</div>
        <div style="display:flex;gap:var(--space-1);flex-wrap:wrap;align-items:center">
          <button v-for="(t, i) in vm.tipBtns" :key="i" type="button" class="btn" @click="t.pick" :style="`min-height:46px;border-color:${t.bc}`">{{ t.label }}</button>
          <input class="input" type="number" step="0.25" min="0" placeholder="Other" :value="vm.tipCustom" @change="vm.onTipCustom" style="width:90px;min-height:46px">
        </div>
        <div style="display:flex;justify-content:space-between;font-family:var(--font-heading);font-size:22px">
          <span>Charge on reader</span><span>{{ vm.cardChargeLabel }}</span>
        </div>
        <p class="dialog-body" style="margin:0;font-size:13px;color:var(--color-neutral-600)">Run it, then confirm here. Card tips are paid out to the bartender from the till at close-out.</p>
      </div>
      <p v-if="vm.payBook" class="dialog-body" style="margin:0">{{ vm.bookPreview }}</p>
      <p v-if="vm.closeCreditWarn" class="dialog-body" style="margin:0;color:#7a5c12" v-html="vm.closeCreditWarnText"></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" @click="vm.closeDlg" style="min-height:48px">Cancel</button>
        <button type="button" class="btn btn-primary blueprint" @click="vm.confirmClose" :disabled="vm.confirmCloseDisabled" style="min-height:48px;padding:0 var(--space-4)">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          {{ vm.confirmCloseLabel }}
        </button>
      </div>
    </div>

    <div v-if="vm.dlgTransfer" class="dialog blueprint" @click="vm.eatClick" style="background:var(--color-bg)">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="dialog-title">Transfer {{ vm.transferWhat }}</div>
      <div v-if="vm.transferHasQty" style="display:flex;align-items:center;gap:var(--space-2)">
        <span style="font-size:14px">How many?</span>
        <button type="button" class="btn btn-ghost" @click="vm.transferDec" aria-label="fewer" style="min-width:44px;min-height:44px;font-size:20px">−</button>
        <span style="font-family:var(--font-heading);font-size:20px;min-width:26px;text-align:center">{{ vm.transferN }}</span>
        <button type="button" class="btn btn-ghost" @click="vm.transferInc" aria-label="more" style="min-width:44px;min-height:44px;font-size:20px">+</button>
        <span style="font-size:12px;color:var(--color-neutral-600)">{{ vm.transferMax }}</span>
      </div>
      <p class="dialog-body" style="margin:0">Move to which tab?</p>
      <div style="display:flex;flex-direction:column;gap:var(--space-1);max-height:280px;overflow-y:auto">
        <button v-for="(t, i) in vm.transferTargets" :key="i" type="button" class="btn" @click="t.pick" style="min-height:48px;justify-content:space-between"><span>{{ t.name }}</span><span style="color:var(--color-neutral-600);font-size:13px">{{ t.total }}</span></button>
      </div>
      <p v-if="vm.transferNoTargets" class="dialog-body" style="margin:0;color:var(--color-neutral-600)">No other open tabs — start one first.</p>
      <div class="dialog-actions"><button type="button" class="btn btn-ghost" @click="vm.closeDlg" style="min-height:48px">Cancel</button></div>
    </div>

    <div v-if="vm.dlgRound" class="dialog blueprint" @click="vm.eatClick" style="background:var(--color-bg);width:min(520px,100%)">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="dialog-title">Buy a round — on {{ vm.dlgTabName }}</div>
      <p class="dialog-body" style="margin:0">How many people on each tab? Everyone gets a <span style="color:#a3781f"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:inline;vertical-align:-2px"><path d="M12 2.5l2.97 6.53 7.03.66-5.31 4.9 1.5 7.16L12 17.9l-6.19 3.85 1.5-7.16-5.31-4.9 7.03-.66L12 2.5Z"></path></svg></span> — their next drink rings up as {{ vm.dlgTabName }}'s round.</p>
      <div style="display:flex;flex-direction:column;gap:var(--space-1);max-height:300px;overflow-y:auto">
        <div v-for="(t, i) in vm.roundTabs" :key="i" style="display:flex;align-items:center;gap:var(--space-2);border:1px solid var(--color-divider);padding:2px var(--space-2)">
          <span style="font-size:16px">{{ t.name }}</span>
          <span style="margin-left:auto;display:inline-flex;align-items:center;gap:2px">
            <button type="button" class="btn btn-ghost" @click="t.dec" aria-label="fewer" style="min-width:44px;min-height:44px;font-size:20px">−</button>
            <span style="font-family:var(--font-heading);font-size:20px;min-width:26px;text-align:center">{{ t.n }}</span>
            <button type="button" class="btn btn-ghost" @click="t.inc" aria-label="more" style="min-width:44px;min-height:44px;font-size:20px">+</button>
          </span>
        </div>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" @click="vm.closeDlg" style="min-height:48px">Cancel</button>
        <button type="button" class="btn btn-primary blueprint" @click="vm.roundConfirm" :disabled="vm.roundConfirmDisabled" style="min-height:48px">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          Give stars ({{ vm.roundCount }})
        </button>
      </div>
    </div>

    <div v-if="vm.dlgLedger" class="dialog blueprint" @click="vm.eatClick" style="background:var(--color-bg);width:min(640px,100%)">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="dialog-title">{{ vm.ledgerName }} — ledger</div>
      <div style="max-height:340px;overflow-y:auto">
        <table class="table">
          <thead><tr><th>Date</th><th>Entry</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th></tr></thead>
          <tbody>
            <tr v-for="(l, i) in vm.ledgerRows" :key="i"><td class="text-muted" style="white-space:nowrap">{{ l.date }}</td><td>{{ l.note }}</td><td :style="`text-align:right;color:${l.col}`">{{ l.amt }}</td><td style="text-align:right">{{ l.bal }}</td></tr>
          </tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:space-between;font-family:var(--font-heading);font-size:20px"><span>Balance</span><span>{{ vm.ledgerBal }}</span></div>
      <div class="dialog-actions"><button type="button" class="btn btn-ghost" @click="vm.closeDlg" style="min-height:48px">Close</button></div>
    </div>

    <div v-if="vm.dlgBookAct" class="dialog blueprint" @click="vm.eatClick" style="background:var(--color-bg)">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="dialog-title">{{ vm.bookActTitle }}</div>
      <p class="dialog-body" style="margin:0">{{ vm.bookActBal }}</p>
      <div v-if="vm.bookActIsPay" class="seg" style="display:flex">
        <label v-for="(m, i) in vm.bookMethodOpts" :key="i" class="seg-opt" style="flex:1;justify-content:center;min-height:44px"><input type="radio" name="bookm" :checked="m.on" @change="m.pick">{{ m.label }}</label>
      </div>
      <div style="display:flex;gap:var(--space-1)">
        <input class="input" type="number" step="0.25" min="0" placeholder="Amount" :value="vm.bookAmount" @change="vm.onBookAmount" style="min-height:48px;font-size:18px">
        <button v-if="vm.bookActIsPay" type="button" class="btn" @click="vm.bookFull" style="min-height:48px;white-space:nowrap">Full {{ vm.bookFullAmt }}</button>
      </div>
      <input v-if="vm.bookActNeedsNote" class="input" :placeholder="vm.bookNoteHint" :value="vm.bookNote" @change="vm.onBookNote" style="min-height:48px">
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" @click="vm.closeDlg" style="min-height:48px">Cancel</button>
        <button type="button" class="btn btn-primary blueprint" @click="vm.bookActConfirm" :disabled="vm.bookActDisabled" style="min-height:48px">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          {{ vm.bookActCta }}
        </button>
      </div>
    </div>

    <div v-if="vm.dlgEditProduct" class="dialog blueprint" @click="vm.eatClick" style="background:var(--color-bg)">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="dialog-title">{{ vm.epTitle }}</div>
      <div class="field"><label>Name</label><input class="input" :value="vm.epName" @change="vm.onEpName" style="min-height:46px"></div>
      <div class="field"><label>Price</label><input class="input" type="number" step="0.25" min="0" :value="vm.epPrice" @change="vm.onEpPrice" style="min-height:46px"></div>
      <div class="field"><label>Category</label>
        <div class="seg" style="display:flex">
          <label v-for="(c, i) in vm.epCats" :key="i" class="seg-opt" style="flex:1;justify-content:center;min-height:44px;padding:7px 4px"><input type="radio" name="epcat" :checked="c.on" @change="c.pick">{{ c.label }}</label>
        </div>
      </div>
      <div style="display:flex;gap:var(--space-1)">
        <div class="field" style="flex:1"><label>Qty on hand (drinks)</label><input class="input" type="number" step="0.5" :value="vm.epQty" @change="vm.onEpQty" style="min-height:46px"></div>
        <div class="field" style="flex:1"><label>Used per sale</label><input class="input" type="number" step="0.5" min="0.5" :value="vm.epUnitsPerSale" @change="vm.onEpUnitsPerSale" style="min-height:46px"></div>
        <div class="field" style="flex:1"><label>Per case/bottle</label><input class="input" type="number" step="1" min="1" :value="vm.epRestockUnit" @change="vm.onEpRestockUnit" style="min-height:46px"></div>
      </div>
      <p class="dialog-body" style="margin:0;font-size:12px;color:var(--color-neutral-600)">"Used per sale" is how many drink-units one order of this uses — a mixed drink might use more than a straight shot. "Per case/bottle" is how many drink-units one shopping-list unit restocks (24 for a beer case, 12 for a liquor bottle).</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" @click="vm.closeDlg" style="min-height:48px">Cancel</button>
        <button type="button" class="btn btn-primary blueprint" @click="vm.epSave" :disabled="vm.epSaveDisabled" style="min-height:48px">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          Save
        </button>
      </div>
    </div>

    <div v-if="vm.dlgShoppingList" class="dialog blueprint" @click="vm.eatClick" style="background:var(--color-bg);width:min(720px,100%)">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="dialog-title">Suggested shopping list</div>
      <p class="dialog-body" style="margin:0;font-size:13px;color:var(--color-neutral-600)">Based on sales since the last confirmed list, aiming for about two weeks of stock at each item's current pace. Adjust anything before confirming — confirming adds these quantities straight to inventory.</p>
      <p v-if="vm.hasBeerCap" class="dialog-body" style="margin:0;font-size:12px;color:var(--color-neutral-600)">Beer storage cap: {{ vm.beerCapLabel }} — suggestions are trimmed to fit, slowest movers first.</p>
      <div style="max-height:380px;overflow-y:auto">
        <table class="table">
          <thead><tr><th>Product</th><th style="text-align:right">On hand</th><th style="text-align:right">Daily rate</th><th style="text-align:center">Order</th><th style="text-align:right">Adds</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in vm.shoppingRows" :key="i">
              <td style="font-size:14px">{{ r.name }}</td>
              <td style="text-align:right;color:var(--color-neutral-600)">{{ r.currentQty }}</td>
              <td style="text-align:right;color:var(--color-neutral-600)">{{ r.dailyRate }}/day</td>
              <td style="text-align:center">
                <span style="display:inline-flex;align-items:center;gap:4px">
                  <button type="button" class="btn btn-ghost" @click="r.dec" aria-label="fewer" style="min-width:36px;min-height:36px;font-size:16px">−</button>
                  <span style="font-family:var(--font-heading);font-size:17px;min-width:24px;text-align:center">{{ r.units }}</span>
                  <button type="button" class="btn btn-ghost" @click="r.inc" aria-label="more" style="min-width:36px;min-height:36px;font-size:16px">+</button>
                  <span style="font-size:12px;color:var(--color-neutral-600)">{{ r.unitLabel }}{{ r.units === 1 ? '' : 's' }}</span>
                </span>
              </td>
              <td style="text-align:right;color:var(--color-neutral-600)">{{ r.adds ? '+' + r.adds : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn btn-ghost" @click="vm.closeDlg" style="min-height:48px">Cancel</button>
        <button type="button" class="btn btn-primary blueprint" @click="vm.confirmShoppingList" :disabled="!vm.shoppingOrderedCount" style="min-height:48px">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          Confirm &amp; add to inventory ({{ vm.shoppingOrderedCount }})
        </button>
      </div>
    </div>

    <div v-if="vm.dlgShoppingHistory" class="dialog blueprint" @click="vm.eatClick" style="background:var(--color-bg);width:min(640px,100%)">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="dialog-title">Past shopping lists</div>
      <p v-if="!vm.shoppingHistoryRows.length" class="dialog-body" style="margin:0;color:var(--color-neutral-600)">No confirmed shopping lists yet.</p>
      <div v-else style="max-height:380px;overflow-y:auto;display:flex;flex-direction:column;gap:var(--space-2)">
        <div v-for="(r, i) in vm.shoppingHistoryRows" :key="i" style="border-bottom:1px solid var(--mix-text-22);padding-bottom:var(--space-2)">
          <div style="font-family:var(--font-heading);font-size:15px">{{ r.date }}</div>
          <div style="font-size:13px;color:var(--color-neutral-600)">{{ r.itemsList }}</div>
        </div>
      </div>
      <div class="dialog-actions"><button type="button" class="btn btn-ghost" @click="vm.closeDlg" style="min-height:48px">Close</button></div>
    </div>

    <div v-if="vm.dlgDayClosed" class="dialog blueprint" @click="vm.eatClick" style="background:var(--color-bg);width:min(460px,100%)">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="dialog-title">{{ vm.dayClosedTitle }}</div>
      <p class="dialog-body" style="margin:0">The binder sheet, filled out for you:</p>
      <div style="display:flex;flex-direction:column">
        <div v-for="(r, i) in vm.dayClosedRows" :key="i" style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--mix-text-22);font-size:14px">
          <span>{{ r.label }}</span><span :style="`font-weight:${r.wt}`">{{ r.val }}</span>
        </div>
      </div>
      <p class="dialog-body" style="margin:0;color:var(--color-neutral-600)">In production this sheet is appended to the Google Sheet log automatically.</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-primary blueprint" @click="vm.closeDlg" style="min-height:48px">
          <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
          Start day {{ vm.nextDayNum }}
        </button>
      </div>
    </div>

    <div v-if="vm.dlgTabsOverview" class="dialog blueprint" @click="vm.eatClick" style="background:var(--color-bg);width:min(760px,100%)">
      <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <div class="dialog-title">Today's tabs</div>
      <p v-if="!vm.tabsOverviewRows.length" class="dialog-body" style="margin:0;color:var(--color-neutral-600)">No tabs yet today.</p>
      <div v-else style="max-height:420px;overflow-y:auto">
        <table class="table">
          <thead><tr><th>Name</th><th>Status</th><th>Ordered</th><th style="text-align:right">Total</th><th style="text-align:right">When</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in vm.tabsOverviewRows" :key="i">
              <td style="font-size:15px">{{ r.name }}</td>
              <td><span class="tag" :style="r.statusStyle">{{ r.status }}</span></td>
              <td style="font-size:13px;color:var(--color-neutral-600)" v-html="r.itemsList"></td>
              <td style="text-align:right">{{ r.total }}</td>
              <td style="text-align:right;font-size:12px;color:var(--color-neutral-600);white-space:nowrap">{{ r.when }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="dialog-actions"><button type="button" class="btn btn-ghost" @click="vm.closeDlg" style="min-height:48px">Close</button></div>
    </div>
  </div>
</div>
</template>
