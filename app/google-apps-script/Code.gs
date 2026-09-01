// VFW Bar POS -- Google Sheets sync endpoint.
// Deploy this as a Web App bound to the target spreadsheet. See SETUP.md.
//
// The app POSTs one JSON payload per closed day: { secret, type: 'day', summary }.
// summary.salesRows and summary.bookRows are already resolved to readable
// names by the app (see closeDay() in ../src/store.js) -- this script just
// appends rows, creating each tab with headers on first use.
//
// It also handles { type: 'products' } (full snapshot, replaces the Products
// tab each time -- see enqueueProductsSync() in ../src/sync.js) and
// { type: 'pull' } (reads everything back for the app's one-time "Restore
// from Google Sheet" -- the only path where data flows sheet -> app; every
// other sync is one-way app -> sheet).

var SHARED_SECRET = 'CHANGE_ME'; // Must match the secret entered in the app's Admin > Google Sheets sync.

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.secret !== SHARED_SECRET) {
      return json_({ ok: false, error: 'bad secret' });
    }
    if (body.type === 'day') {
      writeDay_(body.summary);
      return json_({ ok: true });
    }
    if (body.type === 'products') {
      writeProducts_(body.products);
      return json_({ ok: true });
    }
    if (body.type === 'pull') {
      return json_({
        ok: true,
        products: readSheet_('Products'),
        book: readSheet_('Book'),
        sales: readSheet_('Sales'),
        closeouts: readSheet_('Close-out'),
      });
    }
    return json_({ ok: false, error: 'unknown type: ' + body.type });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
  } else if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
  }
  return sh;
}

// Reads a sheet back as an array of {Header: value} objects, keyed by
// whatever's in row 1 -- used only by the 'pull' restore path.
function readSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  return values.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function writeDay_(summary) {
  var co = sheet_('Close-out', ['Day', 'Date', 'DateISO', 'Cash sales', 'Card sales', 'Book sales', 'Comps', 'Book pay-downs (cash)', 'Book pay-downs (card)', 'Counted', 'Over/short', 'Deposit', 'Till kept', 'Card batch total']);
  co.appendRow([summary.d, summary.dateLabel, summary.dayIso, summary.cash, summary.card, summary.book, summary.comps, summary.bookPayCash, summary.bookPayCard, summary.counted, summary.over, summary.deposit, summary.till, summary.cardBatch]);

  var sales = sheet_('Sales', ['Day', 'Hour', 'Product', 'Category', 'Customer', 'Qty', 'Price', 'Payment']);
  (summary.salesRows || []).forEach(function (r) {
    sales.appendRow([summary.d, r.hour, r.product, r.category, r.customer, r.qty, r.price, r.pay]);
  });

  var book = sheet_('Book', ['Day', 'Timestamp', 'Customer', 'Kind', 'Amount', 'Method', 'Note']);
  (summary.bookRows || []).forEach(function (r) {
    book.appendRow([summary.d, new Date(r.ts), r.customer, r.kind, r.amount, r.method, r.note]);
  });
}

// Full replace, not append -- Products is current-state, not history, so a
// stale/deleted product shouldn't linger.
function writeProducts_(products) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Products');
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet('Products');
  sh.appendRow(['Name', 'Category', 'Price', 'Active']);
  (products || []).forEach(function (p) {
    sh.appendRow([p.name, p.cat, p.price, p.active ? 'Yes' : 'No']);
  });
}

// Run this once manually from the Apps Script editor (select doGet from the
// function dropdown, click Run) to sanity-check the script has spreadsheet
// access before deploying -- it just confirms which sheet it's bound to.
function doGet() {
  return json_({ ok: true, boundTo: SpreadsheetApp.getActiveSpreadsheet().getName() });
}
