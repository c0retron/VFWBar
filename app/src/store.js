// Ported from the Claude Design prototype (../vfw-bar-pos-system/project/VFW Bar POS.dc.html).
// The business logic here is intentionally kept close to the original — this is
// money-handling code, and fidelity to what was reviewed in Designer matters more
// than stylistic cleanup. See ../DESIGN_NOTES.md for the reasoning behind the
// buy-a-round/star system, book rules, and close-out math this implements.
import { reactive, computed } from 'vue';
import { enqueueDaySync, enqueueProductsSync } from './sync.js';

const KEY = 'vfw_pos_v1';
const DAY = 864e5;

class PosStore {
  constructor() {
    this.state = reactive({
      view: 'tabs', activeTabId: null, dlg: null, cat: 'All', salesCust: 'all',
      startName: '', tender: null, tenderCustom: '', payMethod: 'cash',
      bookMethod: 'cash', bookAmount: '', bookNote: '', ep: null, tip: 0, tipCustom: '',
      bills: { 1: 0, 5: 0, 10: 0, 20: 0, 50: 0, 100: 0 },
    });
    this.db = reactive(this.load());
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const db = JSON.parse(raw);
        if (db.v === 1) {
          db.tabs.forEach((t) => { if (!t.credits) t.credits = []; });
          if (db.cardTips == null) db.cardTips = 0;
          return db;
        }
      }
    } catch (e) { /* ignore corrupt/missing storage */ }
    const db = this.seed();
    db.tabs.forEach((t) => { if (!t.credits) t.credits = []; });
    if (db.cardTips == null) db.cardTips = 0;
    return db;
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.db)); } catch (e) { /* storage full/unavailable */ } }
  mut(fn) { fn(this.db); this.save(); }
  uid() { return 'x' + (this.db.seq++); }
  fmt(n) { const v = Math.round(n * 100) / 100; return (v < 0 ? '−$' : '$') + Math.abs(v).toFixed(2); }
  till() { return this.db.tillTarget || 200; }
  date(d) { return this.db.epoch - (61 - d) * DAY; }
  fmtDate(ts) { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  fmtTime(ts) { return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }

  seed() {
    let s = 42;
    const R = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const defs = [['Bud Light', 'Beer', 2.75], ['Budweiser', 'Beer', 2.75], ['Miller Lite', 'Beer', 2.75], ['Coors Light', 'Beer', 2.75], ['Busch Draft', 'Beer', 2.00], ['Mich Ultra', 'Beer', 3.00], ['Well Shot', 'Liquor', 3.00], ['Call Shot', 'Liquor', 4.25], ['Top Shelf', 'Liquor', 5.50], ['Mixed Drink', 'Liquor', 3.50], ['House Red', 'Wine', 3.50], ['House White', 'Wine', 3.50], ['Soda', 'Soda', 1.00], ['Coffee', 'Soda', 0.75], ['Bottled Water', 'Soda', 1.00], ['Hot Dog', 'Food', 2.00], ['Frozen Pizza', 'Food', 6.00], ['Chips', 'Food', 1.00], ['Pickled Egg', 'Food', 1.00]];
    const products = defs.map((d, i) => ({ id: 'p' + i, name: d[0], cat: d[1], price: d[2], active: true }));
    const regs = [['Cory', 95], ['Paul', 88], ['Charlie', 80], ['Mac', 74], ['Tom', 66], ['Jim', 60], ['Liz', 52], ['Conrad', 44], ['Fulkerson', 38]];
    const customers = regs.map((r, i) => ({ id: 'c' + i, name: r[0], ledger: [] }));
    const prefs = [[0, 6, 15], [4, 2, 17], [2, 16, 12], [1, 7, 15], [10, 8, 18], [4, 6, 13], [11, 9, 12], [5, 14, 16], [3, 6, 17]];
    const wReg = regs.map((r) => r[1]); const wRegSum = wReg.reduce((a, b) => a + b, 0);
    const pickReg = () => { let x = R() * wRegSum; for (let i = 0; i < wReg.length; i++) { x -= wReg[i]; if (x <= 0) return i; } return 0; };
    const hourDefs = [[12, 4], [13, 5], [14, 6], [15, 7], [16, 10], [17, 12], [18, 12], [19, 9], [20, 6], [21, 4], [22, 3]];
    const hSum = hourDefs.reduce((a, h) => a + h[1], 0);
    const pickHour = () => { let x = R() * hSum; for (const h of hourDefs) { x -= h[1]; if (x <= 0) return h[0]; } return 17; };
    const popular = [0, 1, 2, 3, 4, 5, 6, 12, 15, 17];
    const epoch = new Date(); epoch.setHours(0, 0, 0, 0);
    const E = epoch.getTime(); const date = (d) => E - (61 - d) * 864e5;
    const sales = [];
    for (let d = 1; d < 61; d++) {
      const dw = new Date(date(d)).getDay(); if (dw === 1) continue;
      const base = { 0: 42, 2: 26, 3: 30, 4: 36, 5: 62, 6: 56 }[dw] || 30;
      const n = Math.round(base * (0.8 + R() * 0.4) * (d > 45 ? 1.1 : 1));
      for (let k = 0; k < n; k++) {
        const h = pickHour(); const ci = R() < 0.86 ? pickReg() : null;
        let pi; if (ci != null && R() < 0.75) { const pf = prefs[ci]; const r2 = R(); pi = pf[r2 < 0.55 ? 0 : r2 < 0.85 ? 1 : 2]; } else pi = popular[(R() * popular.length) | 0];
        const q = R() < 0.85 ? 1 : 2; const r = R();
        const pay = r < 0.015 ? 'comp' : (ci != null && r < 0.10) ? 'book' : r < 0.58 ? 'cash' : 'card';
        sales.push({ d, h, p: 'p' + pi, c: ci != null ? 'c' + ci : null, q, pr: products[pi].price, pay });
      }
    }
    customers.forEach((c) => {
      let bal = 0;
      for (let d = 1; d < 61; d++) {
        const chg = sales.filter((x) => x.c === c.id && x.d === d && x.pay === 'book').reduce((a, x) => a + x.q * x.pr, 0);
        if (chg > 0) { c.ledger.push({ ts: date(d), kind: 'charge', amount: Math.round(chg * 100) / 100, note: 'Bar tab' }); bal += chg; }
        if (bal > 18 && R() < 0.35) { const p = Math.min(Math.round(bal), [10, 20, 20, 40][(R() * 4) | 0]); c.ledger.push({ ts: date(d), kind: 'payment', amount: p, method: R() < 0.6 ? 'cash' : 'card', note: 'Paid down' }); bal -= p; }
      }
    });
    customers[6].ledger.push({ ts: date(52), kind: 'credit', amount: 25, note: 'Worked the fish fry' });
    customers[7].ledger.push({ ts: date(48), kind: 'credit', amount: 15, note: 'Mowed the lot' });
    const now = Date.now(); const nowH = Math.min(Math.max(new Date().getHours(), 13), 22);
    for (let k = 0; k < 15; k++) {
      const h = 12 + ((R() * (nowH - 11)) | 0); const ci = R() < 0.8 ? pickReg() : null;
      let pi; if (ci != null && R() < 0.75) pi = prefs[ci][R() < 0.6 ? 0 : 1]; else pi = popular[(R() * popular.length) | 0];
      sales.push({ d: 61, h, p: 'p' + pi, c: ci != null ? 'c' + ci : null, q: 1, pr: products[pi].price, pay: R() < 0.6 ? 'cash' : 'card' });
    }
    sales.push({ d: 61, h: 14, p: 'p10', c: 'c4', q: 2, pr: 3.5, pay: 'book' });
    customers[4].ledger.push({ ts: now - 3 * 36e5, kind: 'charge', amount: 7, note: 'Bar tab' });
    customers[5].ledger.push({ ts: now - 2 * 36e5, kind: 'payment', amount: 20, method: 'cash', note: 'Paid down' });
    const todayBookPays = [{ custId: 'c5', name: 'Jim', amount: 20, method: 'cash' }];
    const tabs = [
      { id: 't1', name: 'Cory', custId: 'c0', openedAt: now - 52 * 6e4, items: [{ id: 'i1', prodId: 'p0', name: 'Bud Light', price: 2.75, qty: 2, comp: false }, { id: 'i2', prodId: 'p6', name: 'Well Shot', price: 3, qty: 1, comp: false }] },
      { id: 't2', name: 'Mac', custId: 'c3', openedAt: now - 31 * 6e4, items: [{ id: 'i3', prodId: 'p1', name: 'Budweiser', price: 2.75, qty: 1, comp: false }] },
      { id: 't3', name: 'Guest 1', custId: null, openedAt: now - 12 * 6e4, items: [{ id: 'i4', prodId: 'p5', name: 'Mich Ultra', price: 3, qty: 1, comp: false }, { id: 'i5', prodId: 'p17', name: 'Chips', price: 1, qty: 1, comp: false }] },
    ];
    return { v: 1, epoch: E, dayNumber: 61, tillTarget: 200, guestSeq: 2, seq: 100, products, customers, sales, tabs, todayBookPays, days: [] };
  }

  bookBal(c) { return c.ledger.reduce((a, e) => a + (e.kind === 'charge' ? e.amount : -e.amount), 0); }
  cust(id) { return this.db.customers.find((c) => c.id === id); }
  tab(id) { return this.db.tabs.find((t) => t.id === id); }
  tabTotal(t) { return t.items.reduce((a, i) => a + (i.comp || i.covered ? 0 : i.price * i.qty), 0); }
  visits(cid) { const ds = new Set(); this.db.sales.forEach((x) => { if (x.c === cid) ds.add(x.d); }); return ds.size; }
  visits30(cid) { const cutoff = this.db.dayNumber - 30; const ds = new Set(); this.db.sales.forEach((x) => { if (x.c === cid && x.d > cutoff) ds.add(x.d); }); return ds.size; }
  usualsFor(cid) {
    const m = {}; this.db.sales.forEach((x) => { if (x.c === cid) m[x.p] = (m[x.p] || 0) + x.q; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 4).map((e) => this.db.products.find((p) => p.id === e[0])).filter((p) => p && p.active);
  }
  openTabFor(cid) { return this.db.tabs.find((t) => t.custId === cid); }

  startTab(cid, name) {
    const ex = cid ? this.openTabFor(cid) : null;
    if (ex) { this.state.activeTabId = ex.id; this.state.view = 'tabs'; return; }
    const id = this.uid();
    this.mut((db) => db.tabs.push({ id, name, custId: cid, openedAt: Date.now(), items: [], credits: [] }));
    this.state.activeTabId = id; this.state.view = 'tabs'; this.state.cat = 'All';
  }

  addItem(tabId, prod, forName) {
    this.mut((db) => {
      const t = db.tabs.find((x) => x.id === tabId);
      if (!forName && t.credits && t.credits.length) {
        const cr = t.credits.shift();
        if (cr.fromTabId === t.id) { t.items.push({ id: this.uid(), prodId: prod.id, name: prod.name, price: prod.price, qty: 1, comp: false, selfRound: true }); return; }
        const payer = cr.fromTabId ? db.tabs.find((x) => x.id === cr.fromTabId) : null;
        const linkId = payer ? this.uid() : null;
        t.items.push({ id: this.uid(), prodId: prod.id, name: prod.name, price: prod.price, qty: 1, comp: false, covered: true, roundFrom: cr.fromName, linkId });
        if (payer) payer.items.push({ id: this.uid(), prodId: prod.id, name: prod.name, price: prod.price, qty: 1, comp: false, forName: t.name, linkId });
        return;
      }
      const ex = t.items.find((i) => i.prodId === prod.id && !i.comp && !i.covered && !i.selfRound && !i.linkId && (i.forName || '') === (forName || ''));
      if (ex) ex.qty++; else t.items.push({ id: this.uid(), prodId: prod.id, name: prod.name, price: prod.price, qty: 1, comp: false, forName: forName || '' });
    });
  }

  removeLine(tabId, lineId) {
    this.mut((db) => {
      const t = db.tabs.find((x) => x.id === tabId);
      const ln = t.items.find((i) => i.id === lineId); if (!ln) return;
      t.items = t.items.filter((i) => i !== ln);
      if (ln.covered) {
        let payerTab = null;
        if (ln.linkId) db.tabs.forEach((ot) => { const other = ot.items.find((i) => i.linkId === ln.linkId && i.id !== ln.id); if (other) { payerTab = ot; ot.items = ot.items.filter((i) => i !== other); } });
        t.credits.push({ id: this.uid(), fromName: ln.roundFrom, fromTabId: payerTab ? payerTab.id : null, prepaid: !payerTab });
      } else if (ln.linkId) {
        db.tabs.forEach((ot) => {
          const other = ot.items.find((i) => i.linkId === ln.linkId && i.id !== ln.id);
          if (other) { ot.items = ot.items.filter((i) => i !== other); ot.credits.push({ id: this.uid(), fromName: other.roundFrom, fromTabId: t.id }); }
        });
      }
    });
  }

  applyRound(tabId, lineId) {
    this.mut((db) => {
      const t = db.tabs.find((x) => x.id === tabId);
      const ci = (t.credits || []).findIndex((c) => c.fromTabId !== t.id);
      if (ci < 0) return;
      const cr = t.credits.splice(ci, 1)[0];
      const ln = t.items.find((i) => i.id === lineId); if (!ln) { t.credits.splice(ci, 0, cr); return; }
      const payer = cr.fromTabId ? db.tabs.find((x) => x.id === cr.fromTabId) : null;
      const linkId = payer ? this.uid() : null;
      const coveredLine = { id: this.uid(), prodId: ln.prodId, name: ln.name, price: ln.price, qty: 1, comp: false, covered: true, roundFrom: cr.fromName, linkId };
      if (ln.qty > 1) ln.qty--; else t.items = t.items.filter((i) => i !== ln);
      t.items.push(coveredLine);
      if (payer) payer.items.push({ id: this.uid(), prodId: ln.prodId, name: ln.name, price: ln.price, qty: 1, comp: false, forName: t.name, linkId });
    });
  }

  lastDrinkOf(t) { return [...t.items].reverse().find((i) => !i.covered && !i.comp) || null; }

  settleTab(t, method, tendered, tip) {
    const now = new Date(); const h = Math.min(Math.max(now.getHours(), 12), 23);
    this.mut((db) => {
      if (method === 'card' && tip > 0) db.cardTips = Math.round(((db.cardTips || 0) + tip) * 100) / 100;
      t.items.forEach((i) => { if (i.covered) return; db.sales.push({ d: db.dayNumber, h, p: i.prodId, c: t.custId, q: i.qty, pr: i.price, pay: i.comp ? 'comp' : method }); });
      const last = this.lastDrinkOf(t);
      let roundCharge = 0;
      db.tabs.forEach((ot) => {
        if (ot.id === t.id) return;
        (ot.credits || []).forEach((cr) => {
          if (cr.fromTabId !== t.id) return;
          if (last) { db.sales.push({ d: db.dayNumber, h, p: last.prodId, c: t.custId, q: 1, pr: last.price, pay: method }); roundCharge += last.price; }
          cr.fromTabId = null; cr.prepaid = true;
        });
      });
      if (method === 'book' && t.custId) {
        const c = db.customers.find((x) => x.id === t.custId);
        const amt = this.tabTotal(t) + roundCharge;
        if (amt > 0) c.ledger.push({ ts: Date.now(), kind: 'charge', amount: Math.round(amt * 100) / 100, note: 'Bar tab' });
      }
      db.tabs = db.tabs.filter((x) => x.id !== t.id);
    });
    Object.assign(this.state, { activeTabId: null, dlg: null, tender: null, tenderCustom: '', tip: 0, tipCustom: '' });
  }

  closeDay(summary) {
    this.mut((db) => {
      const DN = db.dayNumber;
      const dayStart = this.date(DN);
      // A plain ISO date (unlike dateLabel below) is guaranteed parseable by
      // Date.parse() in any JS engine -- restoreFromPull() depends on reading
      // this back correctly, and dateLabel's locale-formatted string isn't a
      // safe bet across the Apps Script V8 runtime and whatever WebView the
      // tablet has.
      summary.dayIso = new Date(dayStart).toISOString().slice(0, 10);
      // Snapshot this day's detail into the summary, resolved to human-readable
      // names rather than internal ids — this is what gets synced to Sheets,
      // and db.sales gets pruned below, so the summary is the only durable
      // record of a given day's line items past the 6000-row cap.
      summary.salesRows = db.sales.filter((x) => x.d === DN).map((x) => {
        const p = db.products.find((pp) => pp.id === x.p);
        const c = x.c ? db.customers.find((cc) => cc.id === x.c) : null;
        return { hour: x.h, product: p ? p.name : x.p, category: p ? p.cat : '', customer: c ? c.name : 'Walk-in', qty: x.q, price: x.pr, pay: x.pay };
      });
      const bookRows = [];
      db.customers.forEach((c) => {
        c.ledger.forEach((e) => { if (e.ts >= dayStart) bookRows.push({ ts: e.ts, customer: c.name, kind: e.kind, amount: e.amount, method: e.method || '', note: e.note || '' }); });
      });
      summary.bookRows = bookRows;
      summary.synced = false;
      db.days.push(summary);
      db.dayNumber++;
      db.todayBookPays = [];
      db.cardTips = 0;
      db.guestSeq = 1;
      if (db.sales.length > 6000) db.sales = db.sales.filter((x) => x.d > db.dayNumber - 120);
    });
    this.state.bills = { 1: 0, 5: 0, 10: 0, 20: 0, 50: 0, 100: 0 };
    this.state.dlg = { kind: 'dayClosed', summary };
    enqueueDaySync(summary);
  }

  depositPlan(counts, target) {
    // Bounded subset-sum: find the till total actually achievable from the bills
    // counted that's closest to `target` (exact, if some combination hits it
    // exactly), rather than a greedy fill that can land far off target even when
    // an exact split exists. reach[i] = sums achievable using only den[0..i-1].
    const den = [1, 5, 10, 20, 50, 100];
    const total = den.reduce((a, d) => a + d * (counts[d] || 0), 0);
    const reach = [new Array(total + 1).fill(false)];
    reach[0][0] = true;
    den.forEach((dn, i) => {
      const cnt = counts[dn] || 0;
      const prev = reach[i];
      const cur = prev.slice();
      for (let s = 0; s <= total; s++) {
        if (!prev[s]) continue;
        for (let k = 1; k <= cnt && s + k * dn <= total; k++) cur[s + k * dn] = true;
      }
      reach.push(cur);
    });
    const finalReach = reach[den.length];
    let bestSum = 0, bestDiff = Infinity;
    for (let s = 0; s <= total; s++) {
      if (!finalReach[s]) continue;
      const diff = Math.abs(s - target);
      if (diff < bestDiff) { bestDiff = diff; bestSum = s; }
    }
    // Backtrack largest denomination first, always taking the smallest count of
    // it that still leaves the remainder achievable with what's left -- biases
    // toward depositing big bills and keeping small ones for making change,
    // when more than one combination hits the same total.
    const keep = {};
    let s = bestSum;
    for (let i = den.length - 1; i >= 0; i--) {
      const dn = den[i]; const cnt = counts[dn] || 0;
      const before = reach[i];
      let chosen = 0;
      for (let k = 0; k <= cnt; k++) {
        const rem = s - k * dn;
        if (rem >= 0 && before[rem]) { chosen = k; break; }
      }
      keep[dn] = chosen;
      s -= chosen * dn;
    }
    return { keep };
  }
  sumBills(c) { return [1, 5, 10, 20, 50, 100].reduce((a, d) => a + d * (c[d] || 0), 0); }

  resetDemo() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    const fresh = this.seed();
    Object.keys(this.db).forEach((k) => delete this.db[k]);
    Object.assign(this.db, fresh);
    this.save();
    Object.assign(this.state, { view: 'tabs', activeTabId: null, dlg: null, bills: { 1: 0, 5: 0, 10: 0, 20: 0, 50: 0, 100: 0 } });
  }

  // Rebuilds all local data from a Google Sheet pull (see sync.js pullAll()).
  // For a new/reformatted tablet, or to reset after wiping beta-test data in
  // the sheet. Products and the book ledger reconstruct exactly (the ledger
  // already carries real timestamps). Sales history is best-effort: the sheet
  // only records which internal "day number" each sale happened on, so this
  // re-derives real calendar dates from the Close-out tab's saved date label,
  // then renumbers days 1..N in chronological order and anchors day N (the
  // most recent) to its real date. If the bar ever skipped calendar days
  // between closes, older reconstructed days compress those gaps -- day-of-week
  // charts for old data may drift slightly, but "last 30 days" reporting (what
  // actually matters day-to-day) anchors correctly off the most recent day.
  restoreFromPull(data) {
    const products = (data.products || []).map((r, i) => ({
      id: 'p' + i, name: String(r.Name || ''), cat: String(r.Category || ''),
      price: Number(r.Price) || 0, active: String(r.Active).toLowerCase() !== 'no',
    }));
    const prodByName = new Map(products.map((p) => [p.name, p]));

    const dayDate = {};
    (data.closeouts || []).forEach((r) => { const t = Date.parse(r.DateISO || r.Date); if (!isNaN(t)) dayDate[r.Day] = t; });
    const oldDays = Object.keys(dayDate).map(Number).sort((a, b) => dayDate[a] - dayDate[b]);
    const dayMap = {}; oldDays.forEach((oldD, i) => { dayMap[oldD] = i + 1; });
    const N = oldDays.length;
    const mostRecentMs = N ? dayDate[oldDays[N - 1]] : Date.now();
    const epoch = mostRecentMs + (61 - N) * DAY;

    const custByName = new Map();
    const getCust = (name) => {
      const key = (name || '').trim();
      if (!key || key === 'Walk-in') return null;
      if (!custByName.has(key)) custByName.set(key, { id: 'c' + custByName.size, name: key, ledger: [] });
      return custByName.get(key);
    };
    (data.book || []).forEach((r) => {
      const c = getCust(r.Customer); if (!c) return;
      const ts = Date.parse(r.Timestamp);
      c.ledger.push({ ts: isNaN(ts) ? Date.now() : ts, kind: String(r.Kind || 'charge'), amount: Number(r.Amount) || 0, method: r.Method || undefined, note: r.Note || undefined });
    });

    const sales = [];
    (data.sales || []).forEach((r) => {
      const newDay = dayMap[r.Day]; if (!newDay) return; // no matching close-out row for this day; skip
      let prod = prodByName.get(r.Product);
      if (!prod) { prod = { id: 'p' + products.length, name: String(r.Product || ''), cat: String(r.Category || ''), price: Number(r.Price) || 0, active: false }; products.push(prod); prodByName.set(prod.name, prod); }
      const cust = getCust(r.Customer);
      sales.push({ d: newDay, h: Number(r.Hour) || 12, p: prod.id, c: cust ? cust.id : null, q: Number(r.Qty) || 1, pr: Number(r.Price) || 0, pay: String(r.Payment || 'cash') });
    });

    const customers = Array.from(custByName.values());
    this.mut((db) => {
      db.epoch = epoch;
      db.dayNumber = N + 1;
      db.products = products;
      db.customers = customers;
      db.sales = sales;
      db.tabs = [];
      db.todayBookPays = [];
      db.cardTips = 0;
      db.guestSeq = 1;
      db.days = [];
      db.seq = 1000;
    });
    Object.assign(this.state, { view: 'tabs', activeTabId: null, dlg: null, bills: { 1: 0, 5: 0, 10: 0, 20: 0, 50: 0, 100: 0 } });
  }
}

export const store = new PosStore();

// See ../vfw-bar-pos-system/project/VFW Bar POS.dc.html lines 856-1247 (renderVals())
// for the original this was ported from. Kept as one function, same shape, on purpose:
// splitting it up would make it harder to diff against the reviewed prototype later.
function renderVals() {
  const S = store.state, db = store.db, fmt = store.fmt.bind(store);
  const set = (p) => Object.assign(S, p);
  const activeTab = S.activeTabId ? store.tab(S.activeTabId) : null;
  const openTabs = db.tabs;
  const todaySales = db.sales.filter((x) => x.d === db.dayNumber);
  const DN = db.dayNumber;

  const views = [['tabs', 'Tabs'], ['book', 'The Book'], ['sales', 'Sales'], ['close', 'Close-out'], ['admin', 'Admin']];
  const navItems = views.map((v) => ({ label: v[1], cur: S.view === v[0] ? 'page' : undefined, go: (e) => { e.preventDefault(); set({ view: v[0], activeTabId: null }); } }));
  const dayLabel = 'DAY ' + DN + ' · ' + new Date(store.date(DN)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();

  const tabCards = openTabs.map((t) => {
    const c = t.custId ? store.cust(t.custId) : null; const bal = c ? store.bookBal(c) : 0;
    // Grouped by product for a quick-glance summary; tapping a line adds one
    // more via the normal addItem() path (same star-credit/merge logic as the
    // tab-detail "add to tab" grid), so bartenders can re-round without
    // opening the tab at all. Deliberately collapses star/comp distinctions
    // that stay visible in the tab detail -- this is a summary, not the ledger.
    const grouped = {};
    t.items.forEach((i) => {
      if (!grouped[i.prodId]) grouped[i.prodId] = { prodId: i.prodId, name: i.name, qty: 0 };
      grouped[i.prodId].qty += i.qty;
    });
    const drinkLines = Object.values(grouped).map((g) => {
      const prod = db.products.find((p) => p.id === g.prodId);
      return { name: g.name, qty: g.qty, add: () => { if (prod) store.addItem(t.id, prod); } };
    });
    return { name: t.name, stars: '★'.repeat(Math.min((t.credits || []).length, 6)), total: fmt(store.tabTotal(t)), meta: t.items.reduce((a, i) => a + i.qty, 0) + ' items · opened ' + store.fmtTime(t.openedAt), hasBook: !!c && Math.abs(bal) >= 0.01, bookBal: fmt(bal), drinkLines, hasDrinkLines: drinkLines.length > 0, open: () => set({ activeTabId: t.id, cat: 'All' }) };
  });
  // "Regulars" is derived, not admin-managed: whoever has actually visited in
  // the last 30 days, most-frequent first. allCustomersSorted (all-time,
  // alphabetical) backs the Sales customer filter separately, since that
  // should still be able to look up anyone ever tracked, not just current
  // regulars.
  const activeRegulars = db.customers.map((c) => ({ c, v: store.visits30(c.id) })).filter(({ v }) => v > 0).sort((a, b) => b.v - a.v);
  const regularBtns = activeRegulars.map(({ c, v }) => { const bal = store.bookBal(c); return { name: c.name, sub: v + ' visits', hasBal: Math.abs(bal) >= 0.01, balLabel: fmt(bal), start: () => store.startTab(c.id, c.name) }; });
  const allCustomersSorted = db.customers.slice().sort((a, b) => a.name.localeCompare(b.name));
  // Starting a tab with a typed name looks up-or-creates a tracked customer
  // (case-insensitive match), rather than staying anonymous like a Guest
  // walk-in -- this is what lets someone become a "regular" over time now
  // that there's no manual Admin step to add them first.
  const startNamed = () => {
    const raw = S.startName.trim(); if (!raw) return;
    set({ startName: '' });
    const existing = db.customers.find((c) => c.name.trim().toLowerCase() === raw.toLowerCase());
    if (existing) { store.startTab(existing.id, existing.name); return; }
    const newId = store.uid();
    store.mut((d) => d.customers.push({ id: newId, name: raw, ledger: [] }));
    store.startTab(newId, raw);
  };

  let det = {};
  if (activeTab) {
    const c = activeTab.custId ? store.cust(activeTab.custId) : null; const bal = c ? store.bookBal(c) : 0;
    const compVal = activeTab.items.reduce((a, i) => a + (i.comp ? i.price * i.qty : 0), 0);
    const hasApplicable = (activeTab.credits || []).some((cr) => cr.fromTabId !== activeTab.id);
    det = {
      detName: activeTab.name, detMeta: 'Opened ' + store.fmtTime(activeTab.openedAt),
      detHasBook: !!c && Math.abs(bal) >= 0.01, detBookBal: fmt(bal),
      detEmpty: activeTab.items.length === 0,
      detItems: activeTab.items.map((i) => {
        const locked = !!(i.covered || i.linkId || i.selfRound);
        const note = i.covered ? '★ from ' + i.roundFrom : i.forName ? 'for ' + i.forName + (i.linkId ? ' ★' : '') : i.selfRound ? '★ round' : '';
        return {
          qty: i.qty, name: i.name, hasNote: !!note, note,
          noteCol: locked ? '#7a5c12' : 'var(--color-neutral-600)',
          comped: i.comp, compLabel: i.comp ? 'Un-comp' : 'Comp',
          line: i.comp || i.covered ? fmt(0) : fmt(i.price * i.qty),
          canQty: !locked, locked,
          canComp: !i.covered, canTransfer: !i.covered,
          canApply: hasApplicable && !i.covered && !i.comp && !i.linkId && !i.selfRound,
          inc: () => store.mut(() => { i.qty++; }),
          dec: () => { if (i.qty > 1) store.mut(() => { i.qty--; }); else store.removeLine(activeTab.id, i.id); },
          del: () => store.removeLine(activeTab.id, i.id),
          comp: () => store.mut(() => { i.comp = !i.comp; }),
          transfer: () => set({ dlg: { kind: 'transfer', lineId: i.id, n: 1 } }),
          applyRound: () => store.applyRound(activeTab.id, i.id),
        };
      }),
      detTotal: fmt(store.tabTotal(activeTab)),
      detHasComp: compVal > 0, detCompNote: fmt(compVal) + ' comped (tracked at full value)',
      backToTabs: () => set({ activeTabId: null }),
      openCloseDialog: () => set({ dlg: { kind: 'close' }, payMethod: 'cash', tender: null, tenderCustom: '', tip: 0, tipCustom: '' }),
      openRound: () => set({ dlg: { kind: 'round', counts: db.tabs.reduce((a, t) => { a[t.id] = 1; return a; }, {}) } }),
    };
    const usualProds = c ? store.usualsFor(c.id) : [];
    det.hasUsuals = usualProds.length > 0;
    const nCred = (activeTab.credits || []).length;
    det.detStars = '★'.repeat(Math.min(nCred, 6));
    det.hasCredits = nCred > 0;
    const crNames = Array.from(new Set((activeTab.credits || []).map((cr) => cr.fromName)));
    det.creditBanner = '★ ' + nCred + (nCred === 1 ? ' round drink waiting' : ' round drinks waiting') + ' (from ' + crNames.join(', ') + '). The next drinks added use a star automatically — or tap ★ Apply on a drink already on the tab.';
    det.usualsTitle = activeTab.name + "'s usuals";
    det.usuals = usualProds.map((p) => ({ label: p.name + ' · ' + fmt(p.price), add: () => store.addItem(activeTab.id, p) }));
  }
  const cats = ['All', 'Beer', 'Liquor', 'Wine', 'Soda', 'Food'];
  const catOpts = cats.map((cn) => ({ label: cn, on: S.cat === cn, pick: () => set({ cat: cn }) }));
  const prodBtns = db.products.filter((p) => p.active && (S.cat === 'All' || p.cat === S.cat)).map((p) => ({ name: p.name, price: fmt(p.price), add: () => activeTab && store.addItem(activeTab.id, p) }));

  const bookRows = db.customers.map((c) => {
    const bal = store.bookBal(c);
    const last = c.ledger.length ? store.fmtDate(c.ledger[c.ledger.length - 1].ts) : '—';
    const balStyle = bal > 0.005 ? 'background:var(--color-accent);color:var(--color-bg);border-color:var(--color-accent);font-size:13px' : bal < -0.005 ? 'border:1px solid var(--color-accent);color:var(--color-accent-700);font-size:13px' : 'border:1px solid var(--color-divider);color:var(--color-neutral-600);font-size:13px';
    const balLabel = bal < -0.005 ? fmt(-bal) + ' credit' : fmt(bal);
    return {
      name: c.name, balLabel, balStyle, last,
      ledger: () => set({ dlg: { kind: 'ledger', custId: c.id } }),
      pay: () => set({ dlg: { kind: 'bookAct', mode: 'pay', custId: c.id }, bookAmount: bal > 0 ? String(Math.round(bal * 100) / 100) : '', bookMethod: 'cash', bookNote: '' }),
      credit: () => set({ dlg: { kind: 'bookAct', mode: 'credit', custId: c.id }, bookAmount: '', bookNote: '' }),
      charge: () => set({ dlg: { kind: 'bookAct', mode: 'charge', custId: c.id }, bookAmount: '', bookNote: '' }),
    };
  });
  const owed = db.customers.reduce((a, c) => { const b = store.bookBal(c); return a + (b > 0 ? b : 0); }, 0);
  const cred = db.customers.reduce((a, c) => { const b = store.bookBal(c); return a + (b < 0 ? -b : 0); }, 0);
  const owedN = db.customers.filter((c) => store.bookBal(c) > 0.005).length;
  const credN = db.customers.filter((c) => store.bookBal(c) < -0.005).length;

  const scopeCust = S.salesCust;
  const inScope = (x) => (scopeCust === 'all' ? true : scopeCust === '_guest' ? x.c === null : x.c === scopeCust);
  const val = (x) => x.q * x.pr;
  const rev = (x) => (x.pay === 'comp' ? 0 : val(x));
  const s30 = db.sales.filter((x) => x.d > DN - 30 && inScope(x));
  const sPrior = db.sales.filter((x) => x.d > DN - 60 && x.d <= DN - 30 && inScope(x));
  const s10 = db.sales.filter((x) => x.d > DN - 10 && inScope(x));
  const rev30 = s30.reduce((a, x) => a + rev(x), 0);
  const revPrior = sPrior.reduce((a, x) => a + rev(x), 0);
  const delta = revPrior > 0 ? Math.round(((rev30 - revPrior) / revPrior) * 100) : 0;
  const items30 = s30.reduce((a, x) => a + x.q, 0);
  const unitsByProd = {}; s30.forEach((x) => { unitsByProd[x.p] = (unitsByProd[x.p] || 0) + x.q; });
  const bestP = Object.entries(unitsByProd).sort((a, b) => b[1] - a[1])[0];
  const bestProd = bestP ? db.products.find((p) => p.id === bestP[0]) : null;
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dowSum = {}, dowDays = {};
  s30.forEach((x) => { const dw = new Date(store.date(x.d)).getDay(); dowSum[dw] = (dowSum[dw] || 0) + rev(x); (dowDays[dw] = dowDays[dw] || new Set()).add(x.d); });
  const dowAvg = dowNames.map((n, i) => ({ label: n, v: dowDays[i] ? dowSum[i] / dowDays[i].size : 0 }));
  const dowMax = Math.max(...dowAvg.map((d) => d.v), 1);
  const dowBars = dowAvg.map((d) => ({ label: d.label, amt: d.v > 0 ? '$' + Math.round(d.v) : '—', h: Math.max(Math.round((d.v / dowMax) * 100), d.v > 0 ? 3 : 0), bg: d.v === dowMax ? 'var(--color-accent)' : 'var(--color-accent-300)' }));
  const bestDow = dowAvg.reduce((a, b) => (b.v > a.v ? b : a), dowAvg[0]);
  const monthMap = {};
  db.sales.forEach((x) => {
    if (!inScope(x)) return;
    const dt = new Date(store.date(x.d));
    const key = dt.getFullYear() + '-' + String(dt.getMonth()).padStart(2, '0');
    if (!monthMap[key]) monthMap[key] = { key, label: dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), sum: 0 };
    monthMap[key].sum += rev(x);
  });
  const monthList = Object.values(monthMap).sort((a, b) => a.key.localeCompare(b.key));
  const monthMax = Math.max(...monthList.map((m) => m.sum), 1);
  const monthBars = monthList.map((m, i) => ({ label: m.label, amt: '$' + Math.round(m.sum), h: Math.max(Math.round((m.sum / monthMax) * 100), m.sum > 0 ? 3 : 0), bg: i === monthList.length - 1 ? 'var(--color-accent)' : 'var(--color-accent-300)' }));
  const dayRev = {}; s30.forEach((x) => { dayRev[x.d] = (dayRev[x.d] || 0) + rev(x); });
  const dayList = []; for (let d = DN - 29; d <= DN; d++) dayList.push(d);
  const dMax = Math.max(...dayList.map((d) => dayRev[d] || 0), 1);
  const dailyBars = dayList.map((d) => ({ h: Math.round(((dayRev[d] || 0) / dMax) * 100), title: store.fmtDate(store.date(d)) + ' — ' + fmt(dayRev[d] || 0), bg: d === DN ? 'var(--color-accent)' : 'var(--color-accent-300)' }));
  const catSum = {}; s30.forEach((x) => { const p = db.products.find((pp) => pp.id === x.p); if (p) catSum[p.cat] = (catSum[p.cat] || 0) + rev(x); });
  const catTotal = Object.values(catSum).reduce((a, b) => a + b, 0) || 1;
  const catRows = ['Beer', 'Liquor', 'Wine', 'Soda', 'Food'].map((cn) => { const v = catSum[cn] || 0; return { label: cn, amt: fmt(v), pct: Math.round((v / catTotal) * 100) + '%', w: Math.round((v / catTotal) * 100) }; });
  const shopUnits = {}, shopRev = {};
  s10.forEach((x) => { shopUnits[x.p] = (shopUnits[x.p] || 0) + x.q; shopRev[x.p] = (shopRev[x.p] || 0) + rev(x); });
  const shopRows = Object.keys(shopUnits).map((pid) => { const p = db.products.find((pp) => pp.id === pid); return p ? { name: p.name, cat: p.cat, units: shopUnits[pid], perDay: (shopUnits[pid] / 10).toFixed(1), rev: fmt(shopRev[pid]) } : null; }).filter(Boolean).sort((a, b) => b.units - a.units);
  const custOptions = [{ id: 'all', name: 'Everyone' }, { id: '_guest', name: 'Walk-ins / guests' }].concat(allCustomersSorted.map((c) => ({ id: c.id, name: c.name })));
  const kpis = [
    { kick: 'Net sales · last 30 days', val: fmt(rev30), sub: (delta >= 0 ? '+' : '') + delta + '% vs prior 30 days' },
    { kick: 'Items rung · last 30 days', val: String(items30), sub: bestProd ? 'Best seller: ' + bestProd.name + ' (' + bestP[1] + ')' : '—' },
    { kick: 'Busiest day', val: bestDow && bestDow.v > 0 ? bestDow.label : '—', sub: bestDow && bestDow.v > 0 ? '$' + Math.round(bestDow.v) + ' avg night' : 'no sales in range' },
  ];
  let custPanel = false, custStats = [], custPanelTitle = '';
  if (scopeCust !== 'all' && scopeCust !== '_guest') {
    const c = store.cust(scopeCust);
    if (c) {
      custPanel = true; custPanelTitle = c.name + ' · last 30 days';
      const vDays = new Set(); s30.forEach((x) => vDays.add(x.d));
      const spent = rev30; const bal = store.bookBal(c);
      custStats = [
        { k: 'Visits', v: String(vDays.size) },
        { k: 'Spent', v: fmt(spent) },
        { k: 'Avg per visit', v: vDays.size ? fmt(spent / vDays.size) : '—' },
        { k: 'Book balance', v: bal < -0.005 ? fmt(-bal) + ' credit' : fmt(bal) },
        { k: 'Usuals', v: store.usualsFor(c.id).map((p) => p.name).slice(0, 3).join(', ') || '—' },
      ];
    }
  }

  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const cashSales = sum(todaySales.filter((x) => x.pay === 'cash'), val);
  const cardSales = sum(todaySales.filter((x) => x.pay === 'card'), val);
  const bookSales = sum(todaySales.filter((x) => x.pay === 'book'), val);
  const compValTotal = sum(todaySales.filter((x) => x.pay === 'comp'), val);
  const bp = db.todayBookPays || [];
  const bookPayCash = sum(bp.filter((x) => x.method === 'cash'), (x) => x.amount);
  const bookPayCard = sum(bp.filter((x) => x.method === 'card'), (x) => x.amount);
  const expected = store.till() + cashSales + bookPayCash;
  const coRows = [
    { label: 'Cash sales', amt: fmt(cashSales), col: 'inherit', wt: '500' },
    { label: 'Card sales', amt: fmt(cardSales), col: 'inherit', wt: '500' },
    { label: 'On the books today', amt: fmt(bookSales), col: 'inherit', wt: '500' },
    { label: 'Book pay-downs · cash in drawer', amt: fmt(bookPayCash), col: 'var(--color-neutral-600)', wt: '400' },
    { label: 'Book pay-downs · card', amt: fmt(bookPayCard), col: 'var(--color-neutral-600)', wt: '400' },
    { label: 'Comps given (full value)', amt: fmt(compValTotal), col: 'var(--color-neutral-600)', wt: '400' },
    { label: 'Till change (start of day)', amt: fmt(store.till()), col: 'var(--color-neutral-600)', wt: '400' },
  ];
  const denoms = [100, 50, 20, 10, 5, 1];
  const billRows = denoms.map((dn) => ({
    label: '$' + dn, count: S.bills[dn] === 0 ? '' : String(S.bills[dn]), rowTotal: fmt(dn * S.bills[dn]),
    inc: () => set({ bills: Object.assign({}, S.bills, { [dn]: S.bills[dn] + 1 }) }),
    dec: () => set({ bills: Object.assign({}, S.bills, { [dn]: Math.max(0, S.bills[dn] - 1) }) }),
    onSet: (e) => { const v = Math.max(0, Math.floor(Number(e.target.value) || 0)); set({ bills: Object.assign({}, S.bills, { [dn]: v }) }); },
  }));
  const counted = store.sumBills(S.bills);
  const over = counted - expected;
  const overLabel = counted === 0 ? 'not counted' : Math.abs(over) < 0.005 ? 'balanced' : over > 0 ? 'over ' + fmt(over) : 'short ' + fmt(-over);
  const overStyle = counted === 0 ? 'border:1px solid var(--color-divider);color:var(--color-neutral-600)' : Math.abs(over) < 0.005 ? 'background:var(--color-accent);color:var(--color-bg)' : 'border:1px solid var(--color-accent);color:var(--color-accent-700)';
  const plan = store.depositPlan(S.bills, store.till());
  const depRows = denoms.map((dn) => { const k = plan.keep[dn] || 0; const dep = (S.bills[dn] || 0) - k; return { label: '$' + dn, keep: k ? k + ' × $' + dn : '—', dep: dep ? dep + ' × $' + dn : '—' }; });
  const keepTotal = store.sumBills(plan.keep);
  const depTotal = counted - keepTotal;
  const hasDepNote = counted > 0 && Math.abs(keepTotal - store.till()) > 0.005;
  const depositNote = keepTotal < store.till() ? "Can't make " + fmt(store.till()) + ' exactly from these bills — till kept is ' + fmt(keepTotal) + '. Keep smaller bills back tomorrow.' : 'Nearest the drawer can get to ' + fmt(store.till()) + ' is ' + fmt(keepTotal) + '.';
  const openNames = openTabs.map((t) => t.name).join(', ');
  const canClose = openTabs.length === 0 && counted > 0;
  const closeDayHint = openTabs.length > 0 ? 'Settle open tabs first: ' + openNames : counted === 0 ? 'Count the drawer to unlock' : 'Logs the day and starts day ' + (DN + 1);
  const doCloseDay = () => {
    if (!canClose) return;
    const summary = {
      d: DN, dateLabel: new Date(store.date(DN)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      cash: cashSales, card: cardSales, book: bookSales, comps: compValTotal, bookPayCash, bookPayCard,
      counted, over, deposit: depTotal, till: keepTotal, cardBatch: cardSales + bookPayCard,
    };
    store.closeDay(summary);
  };

  const dlg = S.dlg || {};
  const dlgOpen = !!S.dlg;
  const closeDlg = () => set({ dlg: null });
  const dlgVals = {
    dlgOpen, closeDlg, backdropClick: () => set({ dlg: null }), eatClick: (e) => e.stopPropagation(),
    dlgClose: dlg.kind === 'close', dlgTransfer: dlg.kind === 'transfer', dlgRound: dlg.kind === 'round',
    dlgLedger: dlg.kind === 'ledger', dlgBookAct: dlg.kind === 'bookAct', dlgEditProduct: dlg.kind === 'editProduct', dlgDayClosed: dlg.kind === 'dayClosed',
  };
  if (dlg.kind === 'close' && activeTab) {
    const c = activeTab.custId ? store.cust(activeTab.custId) : null;
    const methods = [['cash', 'Cash'], ['card', 'Card']].concat(c ? [['book', 'The Book']] : []);
    const givenOut = openTabs.filter((t) => t.id !== activeTab.id).reduce((a, t) => a + (t.credits || []).filter((cr) => cr.fromTabId === activeTab.id).length, 0);
    const lastDrink = store.lastDrinkOf(activeTab);
    const roundCharge = givenOut && lastDrink ? givenOut * lastDrink.price : 0;
    const total = store.tabTotal(activeTab) + roundCharge;
    const tenderVals = []; [Math.ceil(total), Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 20) * 20].forEach((v) => { if (v >= total && !tenderVals.includes(v)) tenderVals.push(v); });
    const tender = S.tenderCustom !== '' ? Number(S.tenderCustom) : S.tender;
    const bal = c ? store.bookBal(c) : 0;
    const tip = S.tipCustom !== '' ? Math.max(Number(S.tipCustom) || 0, 0) : S.tip;
    const tipVals = [1, 2, 3, 5];
    Object.assign(dlgVals, {
      tipBtns: [{ label: 'No tip', v: 0 }].concat(tipVals.map((v) => ({ label: '$' + v, v }))).map((o) => ({ label: o.label, bc: S.tipCustom === '' && S.tip === o.v ? 'var(--color-accent)' : 'var(--color-divider)', pick: () => set({ tip: o.v, tipCustom: '' }) })),
      tipCustom: S.tipCustom, onTipCustom: (e) => set({ tipCustom: e.target.value }),
      cardChargeLabel: fmt(total + tip),
      dlgTabName: activeTab.name, dlgTotal: fmt(total),
      dlgItemsSummary: activeTab.items.reduce((a, i) => a + i.qty, 0) + ' items' + (roundCharge > 0 ? ' + ' + givenOut + ' ★ round' : ''),
      payOpts: methods.map((m) => ({ label: m[1], on: S.payMethod === m[0], pick: () => set({ payMethod: m[0] }) })),
      payCash: S.payMethod === 'cash', payCard: S.payMethod === 'card', payBook: S.payMethod === 'book',
      tenderBtns: tenderVals.map((v) => ({ label: '$' + v, bc: S.tender === v && S.tenderCustom === '' ? 'var(--color-accent)' : 'var(--color-divider)', pick: () => set({ tender: v, tenderCustom: '' }) })),
      tenderCustom: S.tenderCustom, onTenderCustom: (e) => set({ tenderCustom: e.target.value }),
      changeLabel: tender != null && tender >= total ? fmt(tender - total) : '—',
      bookPreview: c ? 'Puts ' + fmt(total) + ' on ' + c.name + "'s page. New balance: " + fmt(bal + total) + '.' : '',
      confirmCloseDisabled: S.payMethod === 'cash' && tender != null && tender < total,
      confirmCloseLabel: S.payMethod === 'cash' ? 'Take cash' : S.payMethod === 'card' ? 'Card done' : 'On the book',
      confirmClose: () => store.settleTab(activeTab, S.payMethod, tender, S.payMethod === 'card' ? tip : 0),
      closeCreditWarn: givenOut > 0,
      closeCreditWarnText: lastDrink
        ? '★ ' + givenOut + (givenOut === 1 ? ' round drink' : ' round drinks') + ' not picked up yet — adding ' + givenOut + ' × ' + fmt(lastDrink.price) + ' (' + lastDrink.name + ', their last drink). Stars stay good; if the drink picked costs more, the difference is on the house.'
        : '★ ' + givenOut + (givenOut === 1 ? ' round drink' : ' round drinks') + " not picked up yet — nothing on this tab to price them from, so they're on the house.",
    });
  }
  if (dlg.kind === 'transfer' && activeTab) {
    const line = activeTab.items.find((i) => i.id === dlg.lineId);
    const maxN = line ? line.qty : 1;
    const n = Math.min(Math.max(dlg.n || 1, 1), maxN);
    const targets = openTabs.filter((t) => t.id !== activeTab.id);
    Object.assign(dlgVals, {
      transferWhat: line ? (maxN > 1 ? n + ' × ' : '') + line.name : '',
      transferHasQty: maxN > 1, transferN: String(n), transferMax: 'of ' + maxN + ' on the tab',
      transferInc: () => set({ dlg: Object.assign({}, dlg, { n: Math.min(n + 1, maxN) }) }),
      transferDec: () => set({ dlg: Object.assign({}, dlg, { n: Math.max(n - 1, 1) }) }),
      transferNoTargets: targets.length === 0,
      transferTargets: targets.map((t) => ({
        name: t.name, total: fmt(store.tabTotal(t)),
        pick: () => {
          store.mut((d) => {
            const src = d.tabs.find((x) => x.id === activeTab.id); const dst = d.tabs.find((x) => x.id === t.id);
            const ln = src.items.find((i) => i.id === dlg.lineId); if (!ln) return;
            const moveAll = n >= ln.qty;
            if (moveAll) src.items = src.items.filter((i) => i !== ln); else ln.qty -= n;
            const plain = (q) => !q.comp && !q.covered && !q.linkId && !q.selfRound;
            const ex = plain(ln) ? dst.items.find((q) => q.prodId === ln.prodId && plain(q) && (q.forName || '') === (ln.forName || '')) : null;
            if (ex) ex.qty += n; else dst.items.push(moveAll ? ln : { id: store.uid(), prodId: ln.prodId, name: ln.name, price: ln.price, qty: n, comp: false, forName: ln.forName || '' });
          });
          set({ dlg: null });
        },
      })),
    });
  }
  if (dlg.kind === 'round' && activeTab) {
    const counts = dlg.counts || {};
    const totalPeople = openTabs.reduce((a, t) => a + (counts[t.id] || 0), 0);
    Object.assign(dlgVals, {
      dlgTabName: activeTab.name,
      roundTabs: openTabs.map((t) => ({
        name: t.name, isPayer: t.id === activeTab.id, n: String(counts[t.id] || 0),
        inc: () => set({ dlg: Object.assign({}, dlg, { counts: Object.assign({}, counts, { [t.id]: (counts[t.id] || 0) + 1 }) }) }),
        dec: () => set({ dlg: Object.assign({}, dlg, { counts: Object.assign({}, counts, { [t.id]: Math.max(0, (counts[t.id] || 0) - 1) }) }) }),
      })),
      roundCount: totalPeople + (totalPeople === 1 ? ' star' : ' stars'),
      roundConfirmDisabled: totalPeople === 0,
      roundConfirm: () => {
        store.mut((d) => { openTabs.forEach((t) => { const nn = counts[t.id] || 0; const tt = d.tabs.find((x) => x.id === t.id); for (let k = 0; k < nn; k++) tt.credits.push({ id: store.uid(), fromName: activeTab.name, fromTabId: activeTab.id }); }); });
        set({ dlg: null });
      },
    });
  }
  if (dlg.kind === 'ledger') {
    const c = store.cust(dlg.custId);
    let run = 0;
    const rows = (c ? c.ledger : []).map((e) => {
      run += e.kind === 'charge' ? e.amount : -e.amount;
      const kindLabel = e.kind === 'charge' ? 'Charge' : e.kind === 'payment' ? 'Payment (' + (e.method || 'cash') + ')' : 'Credit';
      return { date: store.fmtDate(e.ts), note: kindLabel + (e.note ? ' — ' + e.note : ''), amt: (e.kind === 'charge' ? '+' : '−') + fmt(e.amount).replace('$', '$'), col: e.kind === 'charge' ? 'inherit' : 'var(--color-accent-700)', bal: fmt(run) };
    }).reverse();
    Object.assign(dlgVals, { ledgerName: c ? c.name : '', ledgerRows: rows, ledgerBal: c ? (store.bookBal(c) < -0.005 ? fmt(-store.bookBal(c)) + ' credit' : fmt(store.bookBal(c))) : '' });
  }
  if (dlg.kind === 'bookAct') {
    const c = store.cust(dlg.custId); const bal = c ? store.bookBal(c) : 0;
    const amt = Number(S.bookAmount) || 0;
    const titles = { pay: 'Pay down — ' + (c ? c.name : ''), credit: 'Credit — ' + (c ? c.name : ''), charge: 'Charge — ' + (c ? c.name : '') };
    const ctas = { pay: 'Take payment', credit: 'Add credit', charge: 'Add charge' };
    Object.assign(dlgVals, {
      bookActTitle: titles[dlg.mode], bookActCta: ctas[dlg.mode],
      bookActBal: 'Current balance: ' + (bal < -0.005 ? fmt(-bal) + ' credit' : fmt(bal)) + (dlg.mode === 'pay' ? " — cash payments land in tonight's drawer." : dlg.mode === 'credit' ? ' — for work done for the post.' : ' — e.g. forgot the wallet.'),
      bookActIsPay: dlg.mode === 'pay',
      bookActNeedsNote: dlg.mode !== 'pay',
      bookNoteHint: dlg.mode === 'credit' ? 'What was it for? (fish fry, mowing…)' : 'What for?',
      bookMethodOpts: [['cash', 'Cash'], ['card', 'Card']].map((m) => ({ label: m[1], on: S.bookMethod === m[0], pick: () => set({ bookMethod: m[0] }) })),
      bookAmount: S.bookAmount, onBookAmount: (e) => set({ bookAmount: e.target.value }),
      bookNote: S.bookNote, onBookNote: (e) => set({ bookNote: e.target.value }),
      bookFullAmt: fmt(Math.max(bal, 0)), bookFull: () => set({ bookAmount: String(Math.max(Math.round(bal * 100) / 100, 0)) }),
      bookActDisabled: !(amt > 0),
      bookActConfirm: () => {
        if (!(amt > 0) || !c) return;
        const a = Math.round(amt * 100) / 100;
        store.mut((d) => {
          const cc = d.customers.find((x) => x.id === c.id);
          if (dlg.mode === 'pay') { cc.ledger.push({ ts: Date.now(), kind: 'payment', amount: a, method: S.bookMethod, note: 'Paid down' }); d.todayBookPays.push({ custId: cc.id, name: cc.name, amount: a, method: S.bookMethod }); }
          else if (dlg.mode === 'credit') cc.ledger.push({ ts: Date.now(), kind: 'credit', amount: a, note: S.bookNote || 'Credit' });
          else cc.ledger.push({ ts: Date.now(), kind: 'charge', amount: a, note: S.bookNote || 'Charge' });
        });
        set({ dlg: null, bookAmount: '', bookNote: '' });
      },
    });
  }
  if (dlg.kind === 'editProduct') {
    const ep = S.ep || {};
    Object.assign(dlgVals, {
      epTitle: ep.id ? 'Edit — ' + ep.origName : 'New product',
      epName: ep.name || '', onEpName: (e) => set({ ep: Object.assign({}, ep, { name: e.target.value }) }),
      epPrice: ep.price, onEpPrice: (e) => set({ ep: Object.assign({}, ep, { price: e.target.value }) }),
      epCats: ['Beer', 'Liquor', 'Wine', 'Soda', 'Food'].map((cn) => ({ label: cn, on: ep.cat === cn, pick: () => set({ ep: Object.assign({}, ep, { cat: cn }) }) })),
      epSaveDisabled: !(ep.name || '').trim() || !(Number(ep.price) > 0),
      epSave: () => {
        const nm = ep.name.trim(), pr = Math.round(Number(ep.price) * 100) / 100;
        store.mut((d) => {
          if (ep.id) { const p = d.products.find((x) => x.id === ep.id); p.name = nm; p.price = pr; p.cat = ep.cat; }
          else d.products.push({ id: store.uid(), name: nm, price: pr, cat: ep.cat, active: true });
        });
        syncProducts();
        set({ dlg: null, ep: null });
      },
    });
  }
  if (dlg.kind === 'dayClosed') {
    const sm = dlg.summary;
    Object.assign(dlgVals, {
      dayClosedTitle: 'Day ' + sm.d + ' closed — ' + sm.dateLabel,
      nextDayNum: String(sm.d + 1),
      dayClosedRows: [
        { label: 'Cash sales', val: fmt(sm.cash), wt: '400' },
        { label: 'Card sales (batch ' + fmt(sm.cardBatch) + ')', val: fmt(sm.card), wt: '400' },
        { label: 'Put on the books', val: fmt(sm.book), wt: '400' },
        { label: 'Comps given', val: fmt(sm.comps), wt: '400' },
        { label: 'Drawer counted', val: fmt(sm.counted) + (Math.abs(sm.over) < 0.005 ? ' (balanced)' : sm.over > 0 ? ' (over ' + fmt(sm.over) + ')' : ' (short ' + fmt(-sm.over) + ')'), wt: '400' },
        { label: 'Till kept for tomorrow', val: fmt(sm.till), wt: '500' },
        { label: 'CASH DEPOSIT', val: fmt(sm.deposit), wt: '700' },
      ],
    });
  }

  const syncProducts = () => enqueueProductsSync(db.products.map((p) => ({ name: p.name, cat: p.cat, price: p.price, active: p.active })));
  const prodRows = db.products.map((p) => ({
    name: p.name, cat: p.cat, price: fmt(p.price), dim: p.active ? '1' : '0.4',
    activeLabel: p.active ? 'Active' : 'Retired',
    toggle: () => { store.mut((d) => { const x = d.products.find((q) => q.id === p.id); x.active = !x.active; }); syncProducts(); },
    edit: () => set({ dlg: { kind: 'editProduct' }, ep: { id: p.id, origName: p.name, name: p.name, price: String(p.price), cat: p.cat } }),
    del: () => { store.mut((d) => { d.products = d.products.filter((q) => q.id !== p.id); }); syncProducts(); },
  }));

  return Object.assign({
    navItems, dayLabel, openCountLabel: openTabs.length + (openTabs.length === 1 ? ' open tab' : ' open tabs'),
    viewTabsList: S.view === 'tabs' && !activeTab, viewTabDetail: S.view === 'tabs' && !!activeTab,
    viewBook: S.view === 'book', viewSales: S.view === 'sales', viewClose: S.view === 'close', viewAdmin: S.view === 'admin',
    tabsHint: openTabs.length ? 'tap a tab to add drinks or close out' : '', hasTabs: openTabs.length > 0, noTabs: openTabs.length === 0,
    tabCards, regularBtns,
    startName: S.startName, onStartName: (e) => set({ startName: e.target.value }),
    onStartKey: (e) => { if (e.key === 'Enter') startNamed(); },
    startNamed, guestLabel: 'Walk-in — Guest ' + db.guestSeq,
    startGuest: () => { const n = 'Guest ' + db.guestSeq; store.mut((d) => d.guestSeq++); store.startTab(null, n); },
    catOpts, prodBtns, prodBtnH: '64px',
    bookRows, bookOwedTotal: fmt(owed), bookOwedSub: owedN + ' members owe', bookCreditTotal: fmt(cred), bookCreditSub: credN + ' members in credit',
    custOptions, salesCust: S.salesCust, onSalesCust: (e) => set({ salesCust: e.target.value }),
    salesScopeLabel: scopeCust === 'all' ? 'whole canteen' : (custOptions.find((o) => o.id === scopeCust) || {}).name,
    kpis, dowBars, monthBars, dailyBars, dailyStart: store.fmtDate(store.date(DN - 29)), dailyEnd: 'today',
    catRows, shopRows, custPanel, custPanelTitle, custStats,
    coDate: 'Day ' + DN + ' — ' + new Date(store.date(DN)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    coRows, coExpected: fmt(expected), coCardBatch: fmt(cardSales + bookPayCard),
    billRows, countedLabel: fmt(counted), overLabel, overStyle,
    tillTargetLabel: fmt(store.till()), depRows, keepTotal: fmt(keepTotal), depTotal: fmt(Math.max(depTotal, 0)),
    hasDepNote, depositNote,
    hasOpenTabsWarn: openTabs.length > 0, openTabNames: openNames,
    closeDayDisabled: !canClose, closeDayHint, doCloseDay,
    prodRows, addProduct: () => set({ dlg: { kind: 'editProduct' }, ep: { name: '', price: '', cat: 'Beer' } }),
    tillVal: String(db.tillTarget), onTill: (e) => store.mut((d) => { d.tillTarget = Math.max(50, Number(e.target.value) || 200); }),
    resetDemo: () => store.resetDemo(),
  }, det, dlgVals);
}

export const vm = computed(renderVals);
