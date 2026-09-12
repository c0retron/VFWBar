// Prints receipts to a WiFi ESC/POS thermal printer via a small custom native
// plugin (android/.../EscPosPrinterPlugin.java) -- no browser/WebView API can
// open the raw TCP socket these printers speak (port 9100, the de facto
// standard "raw"/JetDirect printing protocol most network receipt printers
// use). Deliberately plain ASCII only in receipt text below: most of these
// printers only support single-byte codepages, so none of the app's own
// Unicode symbols (the star icon, the UI's fancy minus sign, etc.) are safe
// here even though they render fine on-screen.
//
// Printing is opt-in and best-effort throughout: every call is a no-op if no
// printer is configured, and a failure never blocks the transaction it's
// attached to (a tab still closes, a day still closes, even if the printer
// is unplugged or out of paper) -- see printerState for surfacing failures
// in Admin instead.
import { reactive } from 'vue';
import { Capacitor, registerPlugin } from '@capacitor/core';

const EscPosPrinter = registerPlugin('EscPosPrinter');
const CONFIG_KEY = 'vfw_pos_printer_config';

export const printerState = reactive({ status: 'idle', lastError: '', lastPrintAt: null });

function loadConfig() {
  try { return Object.assign({ ip: '', port: 9100, width: 32, enabled: false }, JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}); }
  catch (e) { return { ip: '', port: 9100, width: 32, enabled: false }; }
}
function saveConfig(cfg) { try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } }
export function getConfig() { return loadConfig(); }
export function setConfig(cfg) { saveConfig(cfg); }

const ESC = '\x1B', GS = '\x1D';
const INIT = ESC + '@';
const ALIGN_L = ESC + 'a\x00';
const ALIGN_C = ESC + 'a\x01';
const BOLD_ON = ESC + 'E\x01';
const BOLD_OFF = ESC + 'E\x00';
const BIG_ON = GS + '!\x11';
const BIG_OFF = GS + '!\x00';
const CUT = GS + 'V\x00'; // full cut -- the printer's autocutter handles this on receipt of this command

function row(width, left, right) {
  left = String(left); right = String(right);
  const pad = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(pad) + right;
}
function line(width) { return '-'.repeat(width); }
function money(n) { const v = Math.round((n || 0) * 100) / 100; return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2); }

async function sendRaw(text) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.ip) return; // not set up -- printing stays silent, not an error
  printerState.status = 'printing';
  try {
    if (!Capacitor.isNativePlatform()) { printerState.status = 'idle'; return; } // web/dev preview -- nothing to send to
    await EscPosPrinter.printRaw({ ip: cfg.ip, port: Number(cfg.port) || 9100, dataBase64: btoa(text) });
    printerState.status = 'idle';
    printerState.lastPrintAt = Date.now();
    printerState.lastError = '';
  } catch (err) {
    printerState.status = 'error';
    printerState.lastError = String((err && err.message) || err);
  }
}

export async function testPrint() {
  const cfg = loadConfig(); const W = cfg.width || 32;
  await sendRaw(INIT + ALIGN_C + BOLD_ON + 'VFW CANTEEN\n' + BOLD_OFF + 'Printer test OK\n' + ALIGN_L + line(W) + '\n\n\n' + CUT);
}

// tab: { dateLabel, timeLabel, name, items: [{qty, name, line, note}], total, methodLabel, tip, change }
export async function printTabReceipt(tab) {
  const cfg = loadConfig(); const W = cfg.width || 32;
  let out = INIT + ALIGN_C + BOLD_ON + BIG_ON + 'VFW CANTEEN\n' + BIG_OFF + BOLD_OFF;
  out += tab.dateLabel + '  ' + tab.timeLabel + '\n' + ALIGN_L + line(W) + '\n';
  out += BOLD_ON + tab.name + BOLD_OFF + '\n' + line(W) + '\n';
  tab.items.forEach((i) => {
    out += row(W, (i.qty > 1 ? i.qty + 'x ' : '') + i.name, money(i.line)) + '\n';
    if (i.note) out += '  ' + i.note + '\n';
  });
  out += line(W) + '\n';
  out += BOLD_ON + row(W, 'TOTAL', money(tab.total)) + BOLD_OFF + '\n';
  out += row(W, 'Paid by', tab.methodLabel) + '\n';
  if (tab.tip > 0) out += row(W, 'Tip', money(tab.tip)) + '\n';
  if (tab.change != null) out += row(W, 'Change', money(tab.change)) + '\n';
  out += '\n' + ALIGN_C + 'Thanks for stopping by!\n\n\n' + CUT;
  await sendRaw(out);
}

// summary: the same object built in doCloseDay() / closeDay()
export async function printDaySummary(summary) {
  const cfg = loadConfig(); const W = cfg.width || 32;
  let out = INIT + ALIGN_C + BOLD_ON + BIG_ON + 'DAY ' + summary.d + ' SUMMARY\n' + BIG_OFF + BOLD_OFF;
  out += summary.dateLabel + '\n' + ALIGN_L + line(W) + '\n';
  out += row(W, 'Cash sales', money(summary.cash)) + '\n';
  out += row(W, 'Card sales', money(summary.card)) + '\n';
  out += row(W, 'Book sales', money(summary.book)) + '\n';
  out += row(W, 'Comps given', money(summary.comps)) + '\n';
  out += row(W, 'Book pay-downs (cash)', money(summary.bookPayCash)) + '\n';
  out += row(W, 'Book pay-downs (card)', money(summary.bookPayCard)) + '\n';
  out += row(W, 'Card tips paid out', money(summary.cardTips || 0)) + '\n';
  out += line(W) + '\n';
  out += row(W, 'Drawer counted', money(summary.counted)) + '\n';
  out += row(W, summary.over >= 0 ? 'Over' : 'Short', money(Math.abs(summary.over))) + '\n';
  out += BOLD_ON + row(W, 'Till kept', money(summary.till)) + BOLD_OFF + '\n';
  out += ALIGN_C + BOLD_ON + BIG_ON + '\nDEPOSIT ' + money(summary.deposit) + '\n' + BIG_OFF + BOLD_OFF;
  out += '\n\n\n' + CUT;
  await sendRaw(out);
}

// denoms: [100,50,20,10,5,1]; keep: {denom: count}
export async function printDrawerBills(denoms, keep, keepTotal) {
  const cfg = loadConfig(); const W = cfg.width || 32;
  let out = INIT + ALIGN_C + BOLD_ON + BIG_ON + "TOMORROW'S DRAWER\n" + BIG_OFF + BOLD_OFF + ALIGN_L + line(W) + '\n';
  denoms.forEach((dn) => {
    const k = keep[dn] || 0;
    if (k > 0) out += row(W, '$' + dn + ' bills', 'x' + k) + '\n';
  });
  out += line(W) + '\n';
  out += BOLD_ON + row(W, 'TILL TOTAL', money(keepTotal)) + BOLD_OFF + '\n';
  out += '\n\n\n' + CUT;
  await sendRaw(out);
}
