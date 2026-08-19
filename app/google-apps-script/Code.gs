// VFW Bar POS -- Google Sheets sync endpoint.
// Deploy this as a Web App bound to the target spreadsheet. See SETUP.md.
//
// The app POSTs one JSON payload per closed day: { secret, type: 'day', summary }.
// summary.salesRows and summary.bookRows are already resolved to readable
// names by the app (see closeDay() in ../src/store.js) -- this script just
// appends rows, creating each tab with headers on first use.

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

function writeDay_(summary) {
  var co = sheet_('Close-out', ['Day', 'Date', 'Cash sales', 'Card sales', 'Book sales', 'Comps', 'Book pay-downs (cash)', 'Book pay-downs (card)', 'Counted', 'Over/short', 'Deposit', 'Till kept', 'Card batch total']);
  co.appendRow([summary.d, summary.dateLabel, summary.cash, summary.card, summary.book, summary.comps, summary.bookPayCash, summary.bookPayCard, summary.counted, summary.over, summary.deposit, summary.till, summary.cardBatch]);

  var sales = sheet_('Sales', ['Day', 'Hour', 'Product', 'Category', 'Customer', 'Qty', 'Price', 'Payment']);
  (summary.salesRows || []).forEach(function (r) {
    sales.appendRow([summary.d, r.hour, r.product, r.category, r.customer, r.qty, r.price, r.pay]);
  });

  var book = sheet_('Book', ['Day', 'Timestamp', 'Customer', 'Kind', 'Amount', 'Method', 'Note']);
  (summary.bookRows || []).forEach(function (r) {
    book.appendRow([summary.d, new Date(r.ts), r.customer, r.kind, r.amount, r.method, r.note]);
  });
}

// Run this once manually from the Apps Script editor (select doGet from the
// function dropdown, click Run) to sanity-check the script has spreadsheet
// access before deploying -- it just confirms which sheet it's bound to.
function doGet() {
  return json_({ ok: true, boundTo: SpreadsheetApp.getActiveSpreadsheet().getName() });
}
