/* HyperX pricing engine · Iontech
 * One copy of the price math, used by:
 *   - editor.html (live preview in the browser)
 *   - the Apps Script backend (paste this file as Engine.gs)
 * so the editor, the sales page and the Sheet always agree.
 *
 * Price rules (from the KT-HP Threshold Costing sheet):
 *   invoice cost = NDP x VAT (1.12)
 *   Base DP      = ROUND(invoice cost / (1 - DP margin), DP rounding)   <- nearest, default whole peso
 *   Threshold    = ROUNDUP(invoice cost / (1 - threshold margin), threshold rounding)
 *   Rebate price = ROUNDUP((NDP - rebate) x VAT / (1 - threshold margin), threshold rounding)
 *                  used only while rebate units are left, and only if lower than Threshold
 *   Special price (what sales sees) = rebate price if it applies, else Threshold
 *   Margin w/o rebate = 1 - invoice cost / special price
 *   Limited Qty Price  = margin w/o rebate < the category's "Limited below" (default MIN_MARGIN 5%; Monitors 0%)
 *     units left = MIN(rebate units left, on hand) when rebate-backed, else on hand
 * Rounding digits work like Excel ROUNDUP: 2 = centavo, 1 = 10 centavos, 0 = peso, -1 = tens.
 */
var HXPricing = (function () {
  function roundUp(x, digits) {
    if (x == null || isNaN(x)) return null;
    var d = Number(digits); if (isNaN(d)) d = 0;
    var f = Math.pow(10, d);
    // tiny epsilon so 909.1800000001 does not jump a step because of float noise
    return Math.ceil(x * f - 1e-9) / f;
  }
  function roundNear(x, digits) {
    if (x == null || isNaN(x)) return null;
    var d = Number(digits); if (isNaN(d)) d = 0;
    var f = Math.pow(10, d);
    return Math.round(x * f + 1e-9) / f;
  }
  /** New = explicit Y/N in the New column, else Auto: release date or OPG-added date within `days` of today. */
  function resolveNew(flag, release, opgAdded, today, days) {
    var f = String(flag == null ? '' : flag).trim();
    if (/^(y|yes|true|1|new)$/i.test(f)) return true;
    if (/^(n|no|false|0|existing)$/i.test(f)) return false;
    var t = toDate(today) || new Date(), win = Number(days) || 90, newest = null;
    [release, opgAdded].forEach(function (x) { var d = toDate(x); if (d && (!newest || d > newest)) newest = d; });
    return !!newest && (t - newest) / 864e5 <= win && newest <= t;
  }
  function pct(x) { var n = Number(x); if (isNaN(n)) return null; return n > 1 ? n / 100 : n; }
  function num(x) { if (x === '' || x == null) return null; var n = typeof x === 'number' ? x : Number(String(x).replace(/[₱,\s]/g, '')); return isNaN(n) ? null : n; }
  function isNew(v) { return /^(y|yes|true|1|new)$/i.test(String(v == null ? '' : v).trim()); }
  function seg(v) { return isNew(v) ? 'New' : 'Existing'; }

  /** rules: [{cat, seg:'New'|'Existing', dpMargin, dpDigits, thrMargin, thrDigits}] ; '*' cat = fallback */
  function findRule(rules, cat, segment) {
    var hit = null, star = null;
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.seg !== segment) continue;
      if (r.cat === cat) { hit = r; break; }
      if (r.cat === '*') star = r;
    }
    return hit || star || { cat: '*', seg: segment, dpMargin: 0.15, dpDigits: 0, thrMargin: 0.06, thrDigits: 0, limitBelow: null };
  }

  /**
   * item:  {sku, desc, cat, isNew, ndp, srp, dpOverride, thrOverride, onHand, active}
   * rebate (optional): {rebate, max, sold, left}
   * opts: {vat, minMargin}
   */
  function priceItem(item, rules, rebate, opts) {
    var vat = num(opts && opts.vat) || 1.12;
    var minMargin = pct(opts && opts.minMargin); if (minMargin == null) minMargin = 0.05;
    var segment = seg(item.isNew);
    var rule = findRule(rules, item.cat, segment);
    var lim = rule.limitBelow === '' || rule.limitBelow == null ? null : pct(rule.limitBelow);
    if (lim != null) minMargin = lim;
    var ndp = num(item.ndp);
    var cost = ndp == null ? null : ndp * vat;
    var dpM = pct(rule.dpMargin), thM = pct(rule.thrMargin);

    var dpCalc = cost == null ? null : roundNear(cost / (1 - dpM), rule.dpDigits);
    var thrCalc = cost == null ? null : roundUp(cost / (1 - thM), rule.thrDigits);
    var dp = num(item.dpOverride) != null ? num(item.dpOverride) : dpCalc;
    var thr = num(item.thrOverride) != null ? num(item.thrOverride) : thrCalc;

    var reb = rebate && num(rebate.rebate) ? rebate : null;
    var rebatePrice = null, rebateBacked = false;
    if (reb && ndp != null && (reb.left || 0) > 0) {
      rebatePrice = roundUp((ndp - num(reb.rebate)) * vat / (1 - thM), rule.thrDigits);
      if (thr != null && rebatePrice < thr) rebateBacked = true; else rebatePrice = null;
    }
    var sp = rebateBacked ? rebatePrice : thr;

    var mNo = (cost == null || !sp) ? null : 1 - cost / sp;
    var mWith = (cost == null || !sp) ? null : 1 - (reb ? (ndp - num(reb.rebate)) * vat : cost) / sp;
    var onHand = num(item.onHand);
    var limited = mNo != null && mNo < minMargin;
    var unitsLeft = null;
    if (limited) {
      if (rebateBacked) unitsLeft = onHand == null ? reb.left : Math.min(reb.left, Math.max(0, onHand));
      else unitsLeft = onHand == null ? null : Math.max(0, onHand);
    }
    return {
      sku: item.sku, desc: item.desc, cat: item.cat, segment: segment, isNew: segment === 'New',
      ndp: ndp, cost: cost, srp: num(item.srp),
      dp: dp, dpCalc: dpCalc, dpOverridden: num(item.dpOverride) != null,
      thr: thr, thrCalc: thrCalc, thrOverridden: num(item.thrOverride) != null,
      rule: rule,
      rebate: reb ? num(reb.rebate) : 0, rebateMax: reb ? reb.max : null, rebateSold: reb ? reb.sold : null, rebateLeft: reb ? reb.left : null,
      rebatePrice: rebatePrice, rebateBacked: rebateBacked,
      sp: sp, marginNoRebate: mNo, marginWithRebate: mWith,
      dpMarginActual: (cost == null || !dp) ? null : 1 - cost / dp,
      limited: limited, limitBelow: minMargin, unitsLeft: unitsLeft, onHand: onHand,
      noRebateCover: limited && !rebateBacked
    };
  }

  /** HP sell-out rows -> sold per SKU inside each program window. Returns net off; floor 0. */
  function rebateStatus(programRows, selloutRows) {
    var by = {};
    programRows.forEach(function (r) {
      var s = baseSku(r.sku); if (!s) return;
      by[s] = { sku: s, rebate: num(r.rebate) || 0, max: num(r.max) || 0, start: toDate(r.start), end: toDate(r.end), sold: 0, left: 0 };
    });
    var raw = {}, latest = null;
    (selloutRows || []).forEach(function (r) {
      var s = baseSku(r.sku), b = by[s]; if (!b) return;
      var d = toDate(r.date);
      if (d && b.start && d < b.start) return;
      if (d && b.end && d > b.end) return;
      if (d && (!latest || d > latest)) latest = d;
      raw[s] = (raw[s] || 0) + sapQty(r.qty);
    });
    Object.keys(by).forEach(function (s) { var b = by[s]; b.sold = Math.max(0, raw[s] || 0); b.left = Math.max(0, b.max - b.sold); });
    return { bySku: by, latest: latest };
  }

  function baseSku(s) { return String(s || '').split('#')[0].trim().toUpperCase(); }
  function sapQty(x) { if (typeof x === 'number') return x; var s = String(x || '').trim(), neg = /-$/.test(s); var n = Number(s.replace(/-$/, '').replace(/,/g, '')) || 0; return neg ? -n : n; }
  function toDate(x) {
    if (!x) return null;
    if (Object.prototype.toString.call(x) === '[object Date]') return x;
    var s = String(x).trim();
    // dates are compared as local calendar days, so "20261113" and "2026-11-13" mean the same day
    if (/^\d{8}$/.test(s)) return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(s); return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  return { roundUp: roundUp, roundNear: roundNear, resolveNew: resolveNew, priceItem: priceItem, findRule: findRule, rebateStatus: rebateStatus, baseSku: baseSku, sapQty: sapQty, num: num, pct: pct, isNew: isNew };
})();
/**
 * HyperX Sales Pricing API · Iontech
 * Apps Script web app bound to the private "HyperX Sales Pricing" Google Sheet.
 * Project files: Engine.gs (same math as the site's assets/pricing-engine.js), Code.gs (this), Seed.gs (starting data).
 *
 * Who sees what (Allowlist tab, Role column):
 *   admin - everything: sales special prices, every dealer page, the pricelist editor and the admin console
 *   sales - sales special prices (sales.html) + dealer pages they are assigned to
 *   cso   - channel sales officer: only the dealer pages they are assigned to (dealer.html)
 *   csomgr- CSO manager: sales special prices + every active dealer page (view only, no cost/margin)
 * Anyone not on the Allowlist (Active = Y) gets nothing. Sales and CSOs never receive NDP, cost, rebate or margin.
 *
 * Deploy: Deploy > New deployment > Web app > Execute as: Me · Who has access: Anyone.
 * After changing this code: Deploy > Manage deployments > Edit > Version: New version (keeps the same URL).
 */

/** The pricing Sheet. Filled in at setup; blank = the Sheet this script is bound to. */
var SHEET_ID = '1xD-FSPoc2mTj4fKCFAZXE_ZDvbiKOfI00rdF1h0gTfs';
function ss_() { return SS_ || (SS_ = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive()); }

var TAB = {
  settings: 'Settings', allow: 'Allowlist', rules: 'MarginRules', pricing: 'Pricing', rebate: 'Rebate',
  sellout: 'SellOut', dealers: 'Dealers', dprices: 'DealerPrices', log: 'AccessLog', edits: 'EditLog', incoming: 'Incoming', reg: 'Registrations', assign: 'Assignments', pipes: 'Pipes'
};
var H = {
  allow: ['Email', 'Name', 'Role', 'Active', 'Updated by', 'Updated on', 'Group'],
  rules: ['Category', 'Segment', 'DP margin', 'DP rounding', 'Threshold margin', 'Threshold rounding', 'Limited below'],
  pricing: ['SKU', 'Material', 'Description', 'Category', 'New', 'Release date', 'OPG added', 'NDP', 'SRP', 'DP override', 'Threshold override', 'On hand', 'MOQ', 'Active', 'OPG status', 'Exclusive dealers'],
  rebate: ['Deal', 'Program', 'SKU', 'Description', 'Max Qty', 'Rebate per unit', 'Start', 'End'],
  sellout: ['Txn Date', 'Your Customer Name', 'Txn Doc ID', 'HP Product ID', 'Ship Out Quantity'],
  dealers: ['Dealer ID', 'Dealer name', 'Customer code', 'HP Partner ID', 'HP lead', 'CSO manager', 'Favorite', 'Assigned emails', 'Valid until', 'Note', 'Active', 'Updated by', 'Updated on', 'Group'],
  dprices: ['Dealer ID', 'SKU', 'Special price', 'Qty cap', 'Note'],
  log: ['Timestamp', 'Email', 'Name', 'Role', 'Result', 'Page'],
  edits: ['Timestamp', 'Email', 'Summary', 'Details'],
  reg: ['Email', 'Name', 'Requested role', 'Mobile', 'Partners handled', 'Note', 'Status', 'Requested on', 'Decided by', 'Decided on', 'Granted role', 'Dealer IDs', 'Entries', 'Group'],
  assign: ['Email', 'Dealer ID', 'Dealer name', 'Accounts', 'Partner (as typed)', 'Updated by', 'Updated on'],
  pipes: ['ID', 'Created', 'Email', 'Name', 'Role', 'Customer', 'Dealer ID', 'Dealer name', 'Price basis', 'Lines', 'Units', 'Total', 'Note', 'Page', 'Idempotency key'],
  incoming: ['SKU', 'PO', 'PO date', 'Qty', 'Shipped qty', 'Status', 'Ship date', 'ETA', 'Mode', 'Shipment', 'Description']
};
var ROLES = ['admin', 'csomgr', 'sm', 'sales', 'csa', 'cso', 'hplead', 'dealer'];
/* Sales groups (Allowlist 'Group' and Dealers 'Group'). SM = sales manager: every active dealer page in their group. */
var GROUPS = ['GMA 1', 'GMA 2', 'Prov 1', 'Prov 2', 'Prov 3', 'Corp'];
var GROUP_NAMES = { 'GMA 1': 'GMA 1 · Manila', 'GMA 2': 'GMA 2 · Manila', 'Prov 1': 'Prov 1 · Luzon', 'Prov 2': 'Prov 2 · Visayas', 'Prov 3': 'Prov 3 · Mindanao', 'Corp': 'Corp · Corporate accounts' };
function normGroup_(g) { var k = String(g || '').replace(/\s+/g, '').toLowerCase(); for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].replace(/\s+/g, '').toLowerCase() === k) return GROUPS[i]; return ''; }
/* Capability matrix (server-side; the UI only mirrors it):
 *  admin  : everything, incl. cost/margin
 *  csomgr : sales prices, every active dealer page, quotes for any dealer, sees all quotes (no cost)
 *  sm     : sales manager — sales prices, every active dealer page in their Group (+ assigned), sees quotes/pipes of their Group
 *  sales  : sales prices, every active dealer page, quotes for any active dealer (own history)
 *  csa    : sales assistant — sales prices + assigned dealer pages, quotes for those (own history)
 *  cso    : only assigned dealer pages; quotes for assigned dealers (own history)
 *  hplead : only assigned dealer pages, view only (no quotes) until permissions are defined
 *  dealer : only its own assigned dealer page, read-only, stock as levels only, no quotes
 */
var ALL_DEALERS = { admin: 1, csomgr: 1, sales: 1 };
var CAN_QUOTE = { admin: 1, csomgr: 1, sm: 1, sales: 1, csa: 1, cso: 1 };
var SEES_SALES = { admin: 1, csomgr: 1, sm: 1, sales: 1, csa: 1 };
H.quotes = ['Quote ID', 'Created', 'Email', 'Name', 'Role', 'Dealer ID', 'Dealer name', 'Source', 'Status', 'Lines', 'Total', 'Note', 'Idempotency key', 'Meta'];
H.qlines = ['Quote ID', 'Line', 'SKU', 'Description', 'Qty', 'SRP', 'Regular DP', 'SP', 'Line total', 'Price source'];
TAB.quotes = 'Quotes'; TAB.qlines = 'QuoteLines'; TAB.commit = 'Commitments';
H.commit = ['ID', 'Batch', 'Type', 'Status', 'Created', 'Email', 'Name', 'Dealer ID', 'Dealer name', 'SKU', 'Description', 'Qty', 'Until', 'Remarks', 'Decided by', 'Decided at', 'Decision note', 'Idempotency key'];
var COMMIT_TYPES = { reservation: 1, hold: 1, allocation: 1 };
var EDITABLE_SETTINGS = ['RES_WAREHOUSE', 'MIN_MARGIN', 'NEW_DAYS', 'SALES_NOTE', 'DEALER_NOTE', 'PRICES_AS_OF'];

/* ================================================================== entry points */

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  var out;
  try { out = route_(body); } catch (err) { out = { ok: false, error: 'server_error', detail: String(err && err.message || err) }; }
  return json_(out);
}

function doGet(e) {
  // Public, sign-in-free feed for the open pricelist (index.html): SRP, Base DP and stock LEVELS only.
  // No cost, special price, rebate or quantity ever leaves through GET.
  if (e && e.parameter && e.parameter.action === 'public') return json_(publicData_());
  return json_({ ok: true, service: 'HyperX Sales Pricing API', time: new Date().toISOString() });
}

function publicData_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('public_v1');
  if (hit) return JSON.parse(hit);
  var settings = readSettings_(), all = loadAll_(settings);
  var lim = Number(settings.STOCK_LIMITED || 20), very = Number(settings.STOCK_VERY || 5);
  var prices = {}, levels = {};
  all.order.forEach(function (s) {
    var p = all.priced[s]; if (!p.active) return;
    prices[s] = p.exclusive.length ? { srp: p.srp, dp: null, exclusive: true } : { srp: p.srp, dp: p.dp };
    if (p.eol) prices[s].eol = true;
    var q = p.atp != null ? p.atp : p.onHand;
    if (q != null) levels[s] = q <= 0 ? 'out' : q <= very ? 'very' : q < lim ? 'limited' : 'ok';
  });
  var out = { ok: true, updated: new Date().toISOString(), pricesAsOf: settings.PRICES_AS_OF || '', source: 'HyperX Sales Pricing sheet', prices: prices, levels: levels };
  try { cache.put('public_v1', JSON.stringify(out), 300); } catch (err) {}
  return out;
}
function bustPublic_() { try { CacheService.getScriptCache().remove('public_v1'); } catch (err) {} }

function route_(body) {
  var action = String(body.action || 'prices');
  if (action === 'guestLog') return guestLog_(body);              // public quote cart: no sign-in, rate-limited, public prices only
  var write = !READ_ACTIONS_[action];
  if (write) CACHE_OFF_ = true;                                     // write requests always read the live sheet
  var settings = readSettings_();
  var who = authenticate_(body, settings);
  if (!who.ok) { log_(who.email || '', '', '', action + ' rejected: ' + who.error, body.page); return { ok: false, error: who.error }; }
  var m = findMember_(who.email);
  if (action === 'registration' || action === 'register') {      // open to any verified Google account
    var r = action === 'register' ? register_(who, body) : registrationStatus_(who, m);
    if (action === 'register') { log_(who.email, who.name, m ? m.role : '', action, body.page); bumpVer_(); }
    if (who.newSession && r) r.session = issueSession_(who);
    return r;
  }
  if (!m) { log_(who.email, who.name, '', action + ' · not on allowlist', body.page); return { ok: false, error: 'not_allowed', email: who.email }; }
  var user = { email: who.email, name: m.name || who.name, role: m.role, group: m.group || '', picture: who.picture || '' };
  var isAdmin = m.role === 'admin';
  var ctx = { settings: settings, user: user, isAdmin: isAdmin, body: body };
  var adminOnly = { decideCommitment: 1, editor: 1, save: 1, admin: 1, saveUsers: 1, saveDealer: 1, saveDealerPrices: 1, setFavorite: 1, uploadSellout: 1, uploadStock: 1, uploadIncoming: 1, decideRegistration: 1, uploadOpg: 1, saveAssignment: 1, uploadRebate: 1, saveSettings: 1 };
  if (adminOnly[action] && !isAdmin) { log_(who.email, user.name, m.role, action + ' denied (not admin)', body.page); return { ok: false, error: 'admin_only', user: user }; }

  var out = platformRoute_(action, ctx);
  if (out === undefined) switch (action) {
    case 'whoami': out = whoami_(ctx); break;
    case 'prices':
      if (!SEES_SALES[m.role]) { out = { ok: false, error: 'cso_dealers_only', user: user, dealers: dealersFor_(user, false) }; break; }
      out = salesData_(ctx); break;
    case 'dealer': out = dealerData_(ctx, String(body.dealerId || '')); break;
    case 'editor': out = editorData_(ctx); break;
    case 'save': out = saveEdits_(ctx); if (out.ok) out = merge_(editorData_(ctx), { saved: out.summary }); break;
    case 'admin': out = adminData_(ctx); break;
    case 'saveUsers': out = saveUsers_(ctx); break;
    case 'saveDealer': out = saveDealer_(ctx); break;
    case 'saveDealerPrices': out = saveDealerPrices_(ctx); break;
    case 'setFavorite': out = setFavorite_(ctx); break;
    case 'uploadSellout': out = uploadSellout_(ctx); break;
    case 'uploadStock': out = uploadStock_(ctx); break;
    case 'uploadIncoming': out = uploadIncoming_(ctx); break;
    case 'uploadRebate': out = uploadRebate_(ctx); break;
    case 'saveSettings': out = saveSettings_(ctx); break;
    case 'createQuote': out = createQuote_(ctx); break;
    case 'quotes': out = listQuotes_(ctx); break;
    case 'commitments': out = listCommitments_(ctx); break;
    case 'stock': out = stockData_(ctx); break;
    case 'decideRegistration': out = decideRegistration_(ctx); break;
    case 'uploadOpg': out = uploadOpg_(ctx); break;
    case 'saveAssignment': out = saveAssignment_(ctx); break;
    case 'logPipe': out = logPipe_(ctx); break;
    case 'pipes': out = listPipes_(ctx); break;
    case 'requestCommitment': out = requestCommitment_(ctx); break;
    case 'decideCommitment': out = decideCommitment_(ctx); break;
    case 'releaseCommitment': out = releaseCommitment_(ctx); break;
    default: out = { ok: false, error: 'unknown_action' };
  }
  var failed = out && out.ok === false;
  // Access log: sign-ins, every write, and every refusal. Routine reads are not logged (each log row costs a sheet write).
  if (write || failed || who.newSession) log_(who.email, user.name, m.role, action + (failed ? ' · ' + out.error : '') + (body.dealerId ? ' ' + body.dealerId : '') + (who.newSession ? ' · sign-in' : ''), body.page);
  if (write && !failed && !NO_BUMP_[action]) bumpVer_();
  if (out && !failed) { out.ok = true; out.user = user; out.can = caps_(user); }
  if (out && who.newSession) out.session = issueSession_(who);
  return out;
}

function caps_(user) {
  var all = !!ALL_DEALERS[user.role];
  return { sales: !!SEES_SALES[user.role], admin: user.role === 'admin', quote: !!CAN_QUOTE[user.role], allDealers: all, dealers: all || dealersFor_(user, false).length > 0 };
}

function whoami_(ctx) { return { dealers: dealersFor_(ctx.user, false) }; }

/* ================================================================== auth */

function verifyToken_(idToken, clientId) {
  if (!idToken) return { ok: false, error: 'no_token' };
  if (!clientId) return { ok: false, error: 'server_not_configured' };
  var res;
  try { res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true }); }
  catch (err) { return { ok: false, error: 'verify_failed' }; }
  if (res.getResponseCode() !== 200) return { ok: false, error: 'invalid_token' };
  var t = JSON.parse(res.getContentText());
  var email = String(t.email || '').toLowerCase();
  if (t.aud !== String(clientId).trim()) return { ok: false, error: 'wrong_audience', email: email };
  if (t.iss !== 'accounts.google.com' && t.iss !== 'https://accounts.google.com') return { ok: false, error: 'wrong_issuer', email: email };
  if (String(t.email_verified) !== 'true') return { ok: false, error: 'email_not_verified', email: email };
  if (Number(t.exp) * 1000 < Date.now()) return { ok: false, error: 'expired', email: email };
  return { ok: true, email: email, name: t.name || '', picture: t.picture || '' };
}

function findMember_(email) {
  var rows = rows_(TAB.allow);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (normEmail_(r['Email']) === email && !/^n/i.test(String(r['Active'] || 'Y'))) {
      var role = String(r['Role'] || 'sales').trim().toLowerCase();
      return { name: r['Name'] || '', role: ROLES.indexOf(role) >= 0 ? role : 'sales', group: normGroup_(r['Group']) };
    }
  }
  return null;
}

/* ================================================================== pricing data */

function loadAll_(settings) {
  var rules = rows_(TAB.rules).map(function (r) {
    return { cat: String(r['Category']).trim(), seg: /new/i.test(r['Segment']) ? 'New' : 'Existing',
      dpMargin: HXPricing.pct(r['DP margin']), dpDigits: Number(r['DP rounding']),
      thrMargin: HXPricing.pct(r['Threshold margin']), thrDigits: Number(r['Threshold rounding']),
      limitBelow: r['Limited below'] === '' || r['Limited below'] == null ? null : HXPricing.pct(r['Limited below']) };
  });
  var today = new Date(), newDays = Number(settings.NEW_DAYS) || 90;
  var items = rows_(TAB.pricing).filter(function (r) { return r['SKU']; }).map(function (r) {
    var mode = String(r['New'] || '').trim();
    return { sku: HXPricing.baseSku(r['SKU']), material: String(r['Material'] || ''), desc: r['Description'], cat: String(r['Category']).trim(),
      newMode: /^y/i.test(mode) ? 'Y' : /^n/i.test(mode) ? 'N' : 'Auto', release: iso_(toDate_(r['Release date'])), opgAdded: iso_(toDate_(r['OPG added'])),
      isNew: HXPricing.resolveNew(mode, toDate_(r['Release date']), toDate_(r['OPG added']), today, newDays),
      ndp: r['NDP'], srp: r['SRP'], dpOverride: r['DP override'], thrOverride: r['Threshold override'],
      onHand: r['On hand'], moq: r['MOQ'], active: !/^n/i.test(String(r['Active'] || 'Y')),
      eol: /eol/i.test(String(r['OPG status'] || '')), exclusive: String(r['Exclusive dealers'] || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean) };
  });
  var prog = [], deal = null;
  rows_(TAB.rebate).forEach(function (r) {
    if (!r['SKU']) return;
    if (!deal) deal = { id: String(r['Deal'] || ''), name: String(r['Program'] || ''), start: iso_(toDate_(r['Start'])), end: iso_(toDate_(r['End'])) };
    prog.push({ sku: r['SKU'], rebate: r['Rebate per unit'], max: r['Max Qty'], start: r['Start'], end: r['End'] });
  });
  var sellout = rows_(TAB.sellout).map(function (r) { return { sku: r['HP Product ID'], qty: r['Ship Out Quantity'], date: r['Txn Date'] }; });
  var st = HXPricing.rebateStatus(prog, sellout);
  var opts = { vat: Number(settings.VAT || 1.12), minMargin: settings.MIN_MARGIN === '' || settings.MIN_MARGIN == null ? 0.05 : HXPricing.pct(settings.MIN_MARGIN) };
  var priced = {}, order = [];
  items.forEach(function (it) {
    var p = HXPricing.priceItem(it, rules, st.bySku[it.sku], opts);
    p.active = it.active; p.moq = HXPricing.num(it.moq); p.material = it.material; p.eol = it.eol; p.exclusive = it.exclusive;
    if (it.eol && it.newMode === 'Auto') p.isNew = false;
    priced[it.sku] = p; order.push(it.sku);
  });
  var committed = committedBySku_();
  Object.keys(priced).forEach(function (s) { var p = priced[s]; p.committed = committed[s] || 0; p.atp = p.onHand == null ? null : Math.max(0, p.onHand - p.committed); });
  var inc = incomingBySku_(); Object.keys(priced).forEach(function (s) { var x = inc[s]; priced[s].incoming = x ? x.qty : 0; priced[s].nextEta = x ? x.eta : ''; priced[s].incomingLines = x ? x.lines : []; });
  opts.newDays = newDays; opts.today = iso_(today);
  return { rules: rules, items: items, priced: priced, order: order, rebateBySku: st.bySku, deal: deal, selloutAsOf: iso_(st.latest), opts: opts };
}

function salesData_(ctx) {
  var all = loadAll_(ctx.settings), admin = ctx.isAdmin, DN = {}; dealerRows_().forEach(function (d) { DN[d.id] = d.name; });
  var items = all.order.map(function (s) { return all.priced[s]; }).filter(function (p) { return p.active && p.sp; }).map(function (p) {
    var o = { sku: p.sku, desc: p.desc, cat: p.cat, isNew: p.isNew, srp: p.srp, dp: p.dp, sp: p.sp,
      tier: p.limited ? 'limited' : 'special', unitsLeft: p.unitsLeft, rebateBacked: p.rebateBacked,
      onHand: p.onHand, committed: p.committed, atp: p.atp, incoming: p.incoming, nextEta: p.nextEta, incomingLines: p.incomingLines,
      eol: p.eol, exclusive: p.exclusive.length ? p.exclusive.map(function (id) { return DN[id] || id; }) : null };
    if (admin) { o.ndp = p.ndp; o.cost = p.cost; o.thr = p.thr; o.rebate = p.rebate; o.rebateLeft = p.rebateLeft; o.marginNoRebate = p.marginNoRebate; o.marginWithRebate = p.marginWithRebate; o.noRebateCover = p.noRebateCover; }
    return o;
  });
  return { asOf: ctx.settings.PRICES_AS_OF || '', stockAsOf: ctx.settings.STOCK_AS_OF || '', incomingAsOf: ctx.settings.INCOMING_AS_OF || '', minMargin: all.opts.minMargin, note: ctx.settings.SALES_NOTE || '',
    deal: all.deal, selloutAsOf: all.selloutAsOf, items: items, dealers: dealersFor_(ctx.user, false) , myDealers: dealersFor_(ctx.user, false).map(function (d) { return { id: d.id, name: d.name, code: d.code, via: d.via }; }) };
}

function editorData_(ctx) {
  var all = loadAll_(ctx.settings), reb = {};
  Object.keys(all.rebateBySku).forEach(function (s) { var b = all.rebateBySku[s]; reb[s] = { rebate: b.rebate, max: b.max, sold: b.sold, left: b.left }; });
  return { asOf: ctx.settings.PRICES_AS_OF || '', opgAsOf: ctx.settings.OPG_AS_OF || '', opts: all.opts, rules: all.rules, items: all.items, rebate: reb, deal: all.deal, selloutAsOf: all.selloutAsOf,
    dealers: dealerRows_().filter(function (d) { return d.active; }).map(function (d) { return { id: d.id, name: d.name, code: d.code, favorite: d.favorite }; }).sort(function (a, b) { return (b.favorite - a.favorite) || a.name.localeCompare(b.name); }) };
}

/* ================================================================== dealer pages */

function dealerRows_() {
  return rows_(TAB.dealers).filter(function (r) { return r['Dealer ID']; }).map(function (r) {
    return { id: String(r['Dealer ID']).trim(), name: String(r['Dealer name'] || ''), code: String(r['Customer code'] || ''),
      partnerId: String(r['HP Partner ID'] || ''), hpLead: String(r['HP lead'] || ''), csoManager: String(r['CSO manager'] || ''), favorite: /^y/i.test(String(r['Favorite'] || '')),
      emails: splitEmails_(r['Assigned emails']), validUntil: iso_(toDate_(r['Valid until'])), note: String(r['Note'] || ''),
      active: !/^n/i.test(String(r['Active'] || 'Y')), updatedBy: String(r['Updated by'] || ''), updatedOn: r['Updated on'] instanceof Date ? r['Updated on'].toISOString() : String(r['Updated on'] || ''), group: normGroup_(r['Group']) };
  });
}

/** Dealers this user may open, favorites first. Admins: all (inactive too when includeInactive). CSO managers: all active. Others: active ones that list their email. */
function dealersFor_(user, includeInactive) {
  var counts = {};
  rows_(TAB.dprices).forEach(function (r) { var id = String(r['Dealer ID']).trim(); if (id && r['SKU']) counts[id] = (counts[id] || 0) + 1; });
  var teams = teamsOf_(user.email);
  return dealerRows_().filter(function (d) {
    if (user.role === 'admin') return includeInactive || d.active;
    return !!accessVia_(user, d, teams);
  }).map(function (d) {
    return { id: d.id, name: d.name, code: d.code, partnerId: d.partnerId, hpLead: d.hpLead, csoManager: d.csoManager, favorite: d.favorite, validUntil: d.validUntil, active: d.active, group: d.group, skus: counts[d.id] || 0, via: accessVia_(user, d, teams) };
  }).sort(function (a, b) { return (b.favorite - a.favorite) || a.name.localeCompare(b.name); });
}
function canSeeDealer_(user, d) { return !!accessVia_(user, d); }

function dealerData_(ctx, id) {
  var d = dealerRows_().filter(function (x) { return x.id === id; })[0];
  var allowed = d && canSeeDealer_(ctx.user, d);
  if (!allowed) return { ok: false, error: 'dealer_not_allowed', dealers: dealersFor_(ctx.user, false) };
  var all = loadAll_(ctx.settings), admin = ctx.isAdmin, minM = all.opts.minMargin, vat = all.opts.vat;
  var expired = d.validUntil && d.validUntil < iso_(new Date());
  // Every active SKU inherits Base DP; DealerPrices rows are exceptions (overrides) only.
  var ov = {};
  rows_(TAB.dprices).forEach(function (r) { if (String(r['Dealer ID']).trim() === id && r['SKU']) ov[HXPricing.baseSku(r['SKU'])] = r; });
  var isDealer = ctx.user.role === 'dealer';
  var lim = Number(ctx.settings.STOCK_LIMITED || 20), very = Number(ctx.settings.STOCK_VERY || 5);
  var items = all.order.filter(function (s) { var q = all.priced[s]; return q.active && (q.dp || ov[s]) && (!q.exclusive.length || q.exclusive.indexOf(id) >= 0); }).map(function (sku) {
    var r = ov[sku] || {}, p = all.priced[sku], over = HXPricing.num(r['Special price']), cap = HXPricing.num(r['Qty cap']);
    var price = over != null ? over : p.dp;
    if (price == null) return null;
    var reb = all.rebateBySku[sku];
    var mNo = p.cost ? 1 - p.cost / price : null;
    var rebateUsable = reb && reb.left > 0;
    var mWith = p.cost ? 1 - (rebateUsable ? (p.ndp - reb.rebate) * vat : p.cost) / price : null;
    var limBelow = p.limitBelow != null ? p.limitBelow : minM;
    var limited = mNo != null && mNo < limBelow;
    var units = null;
    if (limited) {
      var c = [];
      if (rebateUsable) c.push(reb.left);
      if (p.onHand != null) c.push(Math.max(0, p.onHand));
      if (cap != null) c.push(cap);
      units = c.length ? Math.min.apply(null, c) : null;
    } else if (cap != null) units = cap;
    var o = { sku: sku, desc: p.desc, cat: p.cat, isNew: p.isNew, srp: p.srp, dp: p.dp, price: price, qtyCap: cap, note: String(r['Note'] || ''),
      override: over != null, tier: over == null ? 'base' : (limited ? 'limited' : 'special'), unitsLeft: units, eol: p.eol, exclusive: p.exclusive.length > 0,
      level: p.atp == null ? 'unknown' : p.atp <= 0 ? 'out' : p.atp <= very ? 'very' : p.atp < lim ? 'limited' : 'ok' };
    if (isDealer) { o.unitsLeft = null; o.qtyCap = null; }
    if (admin) { o.cost = p.cost; o.thr = p.thr; o.sp = p.sp; o.rebate = rebateUsable ? reb.rebate : 0; o.rebateLeft = reb ? reb.left : null; o.marginNoRebate = mNo; o.marginWithRebate = mWith; o.limitBelow = limBelow; o.belowWithRebate = mWith != null && mWith < limBelow; }
    return o;
  }).filter(Boolean);
  var info = { id: d.id, name: d.name, code: d.code, partnerId: d.partnerId, hpLead: d.hpLead, csoManager: d.csoManager, favorite: d.favorite, validUntil: d.validUntil, note: d.note, expired: !!expired, active: d.active };
  var asg = assignRows_().filter(function (a) { return a.dealerId === id; });
  if (admin) { info.emails = d.emails; info.assignments = asg; }
  else { var mine = asg.filter(function (a) { return a.email === ctx.user.email; })[0]; if (mine) info.myAccounts = mine.accounts; }
  info.canQuote = !!CAN_QUOTE[ctx.user.role];
  return { dealer: info, items: items, minMargin: minM, note: ctx.settings.DEALER_NOTE || '', asOf: ctx.settings.PRICES_AS_OF || '',
    deal: all.deal, selloutAsOf: all.selloutAsOf, dealers: dealersFor_(ctx.user, admin) };
}

/* ================================================================== quotations */

/** Server-priced quote with price snapshot. Client sends SKU + qty (+ optional SP); prices come from the dealer page logic. Idempotent per key. */
function createQuote_(ctx) {
  var u = ctx.user, b = ctx.body;
  if (!CAN_QUOTE[u.role]) return { ok: false, error: 'quote_not_allowed' };
  var key = String(b.idem || '').slice(0, 64);
  if (!/^[\w-]{8,64}$/.test(key)) return { ok: false, error: 'bad_request', detail: 'Missing idempotency key' };
  var lines = Array.isArray(b.lines) ? b.lines.slice(0, 200) : [];
  if (!lines.length) return { ok: false, error: 'bad_request', detail: 'Add at least one item.' };
  var dd = dealerData_(ctx, String(b.dealerId || ''));
  if (dd.ok === false) return dd;
  var by = {}; dd.items.forEach(function (i) { by[i.sku] = i; });
  var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var qsh = sheet_(TAB.quotes);
    if (qsh.getLastRow() === 0) qsh.appendRow(H.quotes);
    var lsh = sheet_(TAB.qlines);
    if (lsh.getLastRow() === 0) lsh.appendRow(H.qlines);
    // idempotency: same key -> return the quote already saved
    var keyCol = H.quotes.indexOf('Idempotency key') + 1;
    if (qsh.getLastRow() > 1) {
      var keys = qsh.getRange(2, keyCol, qsh.getLastRow() - 1, 1).getValues();
      for (var k = keys.length - 1; k >= 0; k--) if (String(keys[k][0]) === key) {
        var qid = qsh.getRange(k + 2, 1).getValue();
        return merge_(quoteById_(ctx, qid), { duplicate: true });
      }
    }
    var rows = [], total = 0, n = 0;
    var props = PropertiesService.getScriptProperties();
    var day = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyMMdd');
    var seq = Number(props.getProperty('QSEQ_' + day) || 0) + 1; props.setProperty('QSEQ_' + day, String(seq));
    var id = 'Q' + day + '-' + ('000' + seq).slice(-3);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], sku = HXPricing.baseSku(l.sku), it = by[sku];
      if (!it) return { ok: false, error: 'bad_request', detail: 'SKU not available for this dealer: ' + sku };
      var qty = Math.round(Number(l.qty)); if (!(qty > 0) || qty > 100000) return { ok: false, error: 'bad_request', detail: 'Check the quantity for ' + sku };
      var sp = HXPricing.num(l.sp), src = 'dealer price';
      if (sp == null) sp = it.price; else if (sp !== it.price) src = 'entered by ' + u.email;
      if (!(sp > 0)) return { ok: false, error: 'bad_request', detail: 'Check the price for ' + sku };
      var lt = Math.round(sp * qty * 100) / 100; total += lt; n++;
      rows.push([id, n, sku, it.desc, qty, it.srp, it.dp, sp, lt, src]);
    }
    total = Math.round(total * 100) / 100;
    lsh.getRange(lsh.getLastRow() + 1, 1, rows.length, H.qlines.length).setValues(rows);
    qsh.appendRow([id, new Date(), u.email, u.name, u.role, dd.dealer.id, dd.dealer.name, String(b.source || 'Website').slice(0, 20), 'Issued', n, total, String(b.note || '').slice(0, 300), key, cleanMeta_(b.meta)]);
    return quoteById_(ctx, id);
  } finally { lock.releaseLock(); }
}

/** Formal-quotation header + terms, as typed by the salesperson (plain text only). */
function cleanMeta_(m) {
  if (!m || typeof m !== 'object') return '';
  var o = {}, keys = ['attention', 'company', 'address', 'project', 'availability', 'warranty', 'validity', 'payment', 'note', 'preparedBy', 'title'];
  keys.forEach(function (k) { if (m[k] != null) o[k] = String(m[k]).slice(0, 300); });
  return JSON.stringify(o);
}
function quoteRows_() {
  var qs = rows_(TAB.quotes).filter(function (r) { return r['Quote ID']; });
  return qs.map(function (r) {
    return { id: String(r['Quote ID']), created: r['Created'] instanceof Date ? r['Created'].toISOString() : String(r['Created']), email: String(r['Email']), name: String(r['Name'] || ''),
      dealerId: String(r['Dealer ID']), dealer: String(r['Dealer name']), source: String(r['Source'] || ''), status: String(r['Status'] || ''), lines: Number(r['Lines']) || 0, total: Number(r['Total']) || 0, note: String(r['Note'] || ''), meta: (function () { try { return JSON.parse(r['Meta'] || '{}'); } catch (e) { return {}; } })() };
  });
}
function groupOf_(email) { var m = findMember_(email); return m ? m.group : ''; }
function canSeeQuote_(u, q) { return u.role === 'admin' || u.role === 'csomgr' || q.email === u.email || (u.role === 'sm' && !!u.group && groupOf_(q.email) === u.group); }

function quoteById_(ctx, id) {
  var q = quoteRows_().filter(function (x) { return x.id === String(id); })[0];
  if (!q || !canSeeQuote_(ctx.user, q)) return { ok: false, error: 'not_found' };
  q.items = rows_(TAB.qlines).filter(function (r) { return String(r['Quote ID']) === q.id; }).map(function (r) {
    return { line: Number(r['Line']), sku: String(r['SKU']), desc: String(r['Description']), qty: Number(r['Qty']), srp: HXPricing.num(r['SRP']), dp: HXPricing.num(r['Regular DP']), sp: HXPricing.num(r['SP']), total: HXPricing.num(r['Line total']), src: String(r['Price source'] || '') };
  });
  return { quote: q };
}

function listQuotes_(ctx) {
  if (!CAN_QUOTE[ctx.user.role]) return { ok: false, error: 'quote_not_allowed' };
  if (ctx.body.quoteId) return quoteById_(ctx, ctx.body.quoteId);
  var list = quoteRows_().filter(function (q) { return canSeeQuote_(ctx.user, q); });
  if (ctx.body.dealerId) list = list.filter(function (q) { return q.dealerId === String(ctx.body.dealerId); });
  return { quotes: list.reverse().slice(0, 100) };
}

/* ================================================================== stock commitments
 * One row per SKU line. Every type starts Pending and only Approved rows reduce available-to-promise (ATP):
 *   ATP = SAP on hand - SUM(qty of Approved rows that have not expired or been released).
 * Approval re-checks ATP under a script lock, so two requests can never both claim the same units.
 * Expiry: reservation = end of its Manila business day; hold = end of its hold-until date; allocation = no expiry (release it).
 */
function commitRows_() {
  var sh = ss_().getSheetByName(TAB.commit);
  if (!sh || sh.getLastRow() < 2) return [];
  var now = new Date();
  return sh.getDataRange().getValues().slice(1).map(function (r, i) {
    var o = {}; H.commit.forEach(function (k, j) { o[k] = r[j]; });
    var until = o['Until'] instanceof Date ? o['Until'] : toDate_(o['Until']);
    var st = String(o['Status'] || 'pending').toLowerCase();
    if ((st === 'pending' || st === 'approved') && until && endOfDay_(until) < now) st = 'expired';
    return { row: i + 2, id: String(o['ID']), batch: String(o['Batch']), type: String(o['Type']), status: st,
      created: o['Created'] instanceof Date ? o['Created'].toISOString() : String(o['Created']), email: String(o['Email']), name: String(o['Name'] || ''),
      dealerId: String(o['Dealer ID']), dealer: String(o['Dealer name']), sku: HXPricing.baseSku(o['SKU']), desc: String(o['Description'] || ''), qty: Number(o['Qty']) || 0,
      until: until ? iso_(until) : '', remarks: String(o['Remarks'] || ''), decidedBy: String(o['Decided by'] || ''),
      decidedAt: o['Decided at'] instanceof Date ? o['Decided at'].toISOString() : String(o['Decided at'] || ''), decisionNote: String(o['Decision note'] || ''), idem: String(o['Idempotency key'] || '') };
  });
}
function endOfDay_(d) { var x = new Date(d.getTime()); x.setHours(23, 59, 59, 999); return x; }
function committedBySku_() {
  var m = {};
  commitRows_().forEach(function (c) { if (c.status === 'approved') m[c.sku] = (m[c.sku] || 0) + c.qty; });
  return m;
}
var INTERNAL = { admin: 1, csomgr: 1, sm: 1, sales: 1, csa: 1, cso: 1 };

function listCommitments_(ctx) {
  if (!INTERNAL[ctx.user.role]) return { ok: false, error: 'not_allowed_here' };
  var rows = commitRows_(), all = loadAll_(ctx.settings), skus = {};
  var cutoff = Date.now() - 30 * 864e5;
  var list = rows.filter(function (c) { return c.status === 'pending' || c.status === 'approved' || Date.parse(c.created) > cutoff; }).reverse().slice(0, 500);
  list.forEach(function (c) { skus[c.sku] = 1; });
  (ctx.body.skus || []).forEach(function (s) { skus[HXPricing.baseSku(s)] = 1; });
  var stock = {};
  Object.keys(skus).forEach(function (s) { var p = all.priced[s]; if (!p) return;
    var pend = rows.filter(function (c) { return c.sku === s && c.status === 'pending'; }).reduce(function (a, c) { return a + c.qty; }, 0);
    stock[s] = { onHand: p.onHand, committed: p.committed, atp: p.atp, pending: pend, desc: p.desc }; });
  list.forEach(function (c) { c.mine = c.email === ctx.user.email; delete c.row; delete c.idem; });
  return { commitments: list, stock: stock, stockAsOf: ctx.settings.STOCK_AS_OF || '', warehouse: ctx.settings.RES_WAREHOUSE || 'BS3', dealers: dealersFor_(ctx.user, false) };
}

function requestCommitment_(ctx) {
  var u = ctx.user, b = ctx.body, type = String(b.type || '');
  if (!INTERNAL[u.role] || u.role === 'hplead') return { ok: false, error: 'not_allowed_here' };
  if (!COMMIT_TYPES[type]) return { ok: false, error: 'bad_request', detail: 'Unknown request type' };
  var key = String(b.idem || '');
  if (!/^[\w-]{8,64}$/.test(key)) return { ok: false, error: 'bad_request', detail: 'Missing idempotency key' };
  var d = dealerRows_().filter(function (x) { return x.id === String(b.dealerId || ''); })[0];
  if (!d || !canSeeDealer_(u, d)) return { ok: false, error: 'dealer_not_allowed' };
  var lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 100);
  if (!lines.length) return { ok: false, error: 'bad_request', detail: 'Add at least one item.' };
  var today = new Date(), until = null;
  if (type === 'reservation') until = today;
  else if (type === 'hold') { until = toDate_(b.until); if (!until || endOfDay_(until) < today) return { ok: false, error: 'bad_request', detail: 'Pick a hold-until date from today onward.' }; }
  else if (b.until) until = toDate_(b.until);
  var all = loadAll_(ctx.settings);
  var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var sh = sheet_(TAB.commit); if (sh.getLastRow() === 0) sh.appendRow(H.commit);
    var existing = commitRows_().filter(function (c) { return c.idem === key; });
    if (existing.length) return merge_(listCommitments_(ctx), { duplicate: true, batch: existing[0].batch });
    var props = PropertiesService.getScriptProperties(), day = Utilities.formatDate(today, 'Asia/Manila', 'yyMMdd');
    var seq = Number(props.getProperty('CSEQ_' + day) || 0) + 1; props.setProperty('CSEQ_' + day, String(seq));
    var batch = { reservation: 'R', hold: 'H', allocation: 'A' }[type] + day + '-' + ('000' + seq).slice(-3);
    var rows = [], n = 0;
    for (var i = 0; i < lines.length; i++) {
      var sku = HXPricing.baseSku(lines[i].sku), p = all.priced[sku], qty = Math.round(Number(lines[i].qty));
      if (!p || !p.active) return { ok: false, error: 'bad_request', detail: 'Unknown SKU ' + sku };
      if (!(qty > 0)) return { ok: false, error: 'bad_request', detail: 'Check the quantity for ' + sku };
      n++;
      rows.push([batch + '/' + n, batch, type, 'pending', today, u.email, u.name, d.id, d.name, sku, p.desc, qty, until ? iso_(until) : '', String(lines[i].remarks || b.remarks || '').slice(0, 200), '', '', '', n === 1 ? key : key + '#' + n]);
    }
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, H.commit.length).setValues(rows);
    sh.getRange(2, 13, sh.getLastRow() - 1, 1).setNumberFormat('@');
    editLog_(u.email, type + ' request ' + batch + ' for ' + d.name + ': ' + rows.length + ' SKUs', null);
  } finally { lock.releaseLock(); }
  return merge_(listCommitments_(ctx), { batch: batch });
}

/** Admin approve / reject. Approve re-checks ATP per SKU inside the lock; lines that would oversubscribe stay pending and are reported. */
function decideCommitment_(ctx) {
  var b = ctx.body, ids = (b.ids || []).map(String), decision = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : '';
  if (!ids.length || !decision) return { ok: false, error: 'bad_request' };
  var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  var done = [], conflicts = [], skipped = [];
  try {
    var rows = commitRows_(), all = loadAll_(ctx.settings), sh = sheet_(TAB.commit), now = new Date();
    var atp = {}; Object.keys(all.priced).forEach(function (s) { atp[s] = all.priced[s].atp; });
    rows.filter(function (c) { return ids.indexOf(c.id) >= 0; }).sort(function (a, b) { return a.row - b.row; }).forEach(function (c) {
      if (c.status !== 'pending') { skipped.push(c.id + ' (' + c.status + ')'); return; }
      if (decision === 'approved' && atp[c.sku] != null && c.qty > atp[c.sku]) { conflicts.push(c.id + ': ' + c.sku + ' needs ' + c.qty + ', only ' + atp[c.sku] + ' available'); return; }
      if (decision === 'approved' && atp[c.sku] != null) atp[c.sku] -= c.qty;
      sh.getRange(c.row, 4).setValue(decision);
      sh.getRange(c.row, 15, 1, 3).setValues([[ctx.user.email, now, String(b.note || '').slice(0, 200)]]);
      done.push(c.id);
    });
    if (done.length) editLog_(ctx.user.email, decision + ' ' + done.join(', '), { conflicts: conflicts });
  } finally { lock.releaseLock(); }
  return merge_(listCommitments_(ctx), { decided: done, conflicts: conflicts, skipped: skipped });
}

/** Release an approved commitment (admin or requester) or cancel your own pending request. */
function releaseCommitment_(ctx) {
  var ids = (ctx.body.ids || []).map(String), u = ctx.user, out = [];
  var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var sh = sheet_(TAB.commit), now = new Date();
    commitRows_().filter(function (c) { return ids.indexOf(c.id) >= 0; }).forEach(function (c) {
      var mine = c.email === u.email, admin = u.role === 'admin';
      if (c.status === 'approved' && (admin || mine)) { sh.getRange(c.row, 4).setValue('released'); }
      else if (c.status === 'pending' && (admin || mine)) { sh.getRange(c.row, 4).setValue('cancelled'); }
      else return;
      sh.getRange(c.row, 15, 1, 2).setValues([[u.email, now]]); out.push(c.id);
    });
    if (out.length) editLog_(u.email, 'released/cancelled ' + out.join(', '), null);
  } finally { lock.releaseLock(); }
  return merge_(listCommitments_(ctx), { released: out });
}

/* ================================================================== admin: console data */

function adminData_(ctx) {
  var all = loadAll_(ctx.settings);
  var users = rows_(TAB.allow).filter(function (r) { return r['Email']; }).map(function (r) {
    return { email: normEmail_(r['Email']), name: String(r['Name'] || ''), role: String(r['Role'] || 'sales').toLowerCase(), active: !/^n/i.test(String(r['Active'] || 'Y')), group: normGroup_(r['Group']),
      updatedBy: String(r['Updated by'] || ''), updatedOn: r['Updated on'] instanceof Date ? r['Updated on'].toISOString() : String(r['Updated on'] || '') };
  });
  var prices = {};
  rows_(TAB.dprices).forEach(function (r) {
    var id = String(r['Dealer ID']).trim(); if (!id || !r['SKU']) return;
    (prices[id] = prices[id] || []).push({ sku: HXPricing.baseSku(r['SKU']), price: HXPricing.num(r['Special price']), qtyCap: HXPricing.num(r['Qty cap']), note: String(r['Note'] || '') });
  });
  var dealers = dealerRows_().map(function (d) { d.prices = prices[d.id] || []; return d; });
  var itm = {}; all.items.forEach(function (it) { itm[it.sku] = it; });
  var catalog = all.order.map(function (s) {
    var p = all.priced[s], it = itm[s] || {};
    return { sku: p.sku, desc: p.desc, cat: p.cat, isNew: p.isNew, active: p.active, srp: p.srp, dp: p.dp, thr: p.thr, sp: p.sp, cost: p.cost, ndp: p.ndp,
      rebate: p.rebate, rebateLeft: p.rebateLeft, rebateMax: p.rebateMax, onHand: p.onHand, limited: p.limited, limitBelow: p.limitBelow, release: it.release || '', opgAdded: it.opgAdded || '' };
  });
  var settings = {};
  EDITABLE_SETTINGS.forEach(function (k) { settings[k] = ctx.settings[k] == null ? '' : ctx.settings[k]; });
  settings.OWNER_EMAIL = ctx.settings.OWNER_EMAIL || '';
  settings.CLIENT_ID_SET = !!ctx.settings.CLIENT_ID; settings.INCOMING_AS_OF = ctx.settings.INCOMING_AS_OF || ''; settings.STOCK_AS_OF = ctx.settings.STOCK_AS_OF || ''; settings.OPG_AS_OF = ctx.settings.OPG_AS_OF || '';
  return { teams: teamRows_(), registrations: regRows_(), assignments: assignRows_(), roleNames: REG_ROLES, groups: GROUPS, groupNames: GROUP_NAMES, users: users, dealers: dealers, catalog: catalog, settings: settings, opts: all.opts, deal: all.deal, selloutAsOf: all.selloutAsOf,
    sellout: { rows: Math.max(0, sheet_(TAB.sellout).getLastRow() - 1) },
    rebate: rows_(TAB.rebate).filter(function (r) { return r['SKU']; }).length,
    access: tail_(TAB.log, 200), edits: tail_(TAB.edits, 60) };
}

/* ================================================================== admin: users */

function saveUsers_(ctx) {
  var list = ctx.body.users;
  if (!Array.isArray(list)) return { ok: false, error: 'bad_request' };
  var owner = normEmail_(ctx.settings.OWNER_EMAIL);
  var seen = {}, rows = [], now = new Date();
  var before = {}; rows_(TAB.allow).forEach(function (r) { before[normEmail_(r['Email'])] = r; });
  for (var i = 0; i < list.length; i++) {
    var u = list[i], email = normEmail_(u.email);
    if (!email) continue;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'bad_email', detail: email };
    if (seen[email]) return { ok: false, error: 'duplicate_email', detail: email };
    seen[email] = 1;
    var role = ROLES.indexOf(String(u.role).toLowerCase()) >= 0 ? String(u.role).toLowerCase() : 'sales';
    var active = u.active !== false;
    var b = before[email];
    var group = u.group === undefined && b ? normGroup_(b['Group']) : normGroup_(u.group);
    var changed = !b || String(b['Role']).toLowerCase() !== role || (!/^n/i.test(String(b['Active'] || 'Y'))) !== active || String(b['Name'] || '') !== String(u.name || '') || normGroup_(b['Group']) !== group;
    rows.push([email, String(u.name || '').slice(0, 80), role, active ? 'Y' : 'N', changed ? ctx.user.email : (b['Updated by'] || ''), changed ? now : (b['Updated on'] || ''), group]);
  }
  if (owner && !rows.some(function (r) { return r[0] === owner && r[2] === 'admin' && r[3] === 'Y'; }))
    return { ok: false, error: 'owner_locked', detail: owner + ' is the owner account and must stay an active admin.' };
  if (!rows.some(function (r) { return r[2] === 'admin' && r[3] === 'Y'; })) return { ok: false, error: 'need_admin' };
  if (!rows.some(function (r) { return r[0] === ctx.user.email && r[2] === 'admin' && r[3] === 'Y'; }))
    return { ok: false, error: 'self_lockout', detail: 'You cannot remove your own admin access here. Ask another admin, or edit the Sheet.' };
  var removed = Object.keys(before).filter(function (e) { return e && !seen[e]; });
  writeRows_(TAB.allow, H.allow, rows);
  editLog_(ctx.user.email, 'users: ' + rows.length + ' on list' + (removed.length ? ', removed ' + removed.join(' ') : ''), { users: rows.map(function (r) { return r.slice(0, 4).concat([r[6]]); }) });
  return adminData_(ctx);
}

/* ================================================================== admin: dealers */

function saveDealer_(ctx) {
  var d = ctx.body.dealer || {}, prices = ctx.body.prices;
  var name = String(d.name || '').trim();
  if (!name) return { ok: false, error: 'bad_request', detail: 'Dealer name is required.' };
  var emails = splitEmails_(d.emails);
  var bad = emails.filter(function (e) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); });
  if (bad.length) return { ok: false, error: 'bad_email', detail: bad.join(', ') };
  var lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var sh = sheet_(TAB.dealers), v = sh.getDataRange().getValues(), id = String(d.id || '').trim(), at = -1;
    for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim() === id && id) at = i;
    if (!id || at < 0) {
      var max = 0; for (var j = 1; j < v.length; j++) { var n = Number(String(v[j][0]).replace(/\D/g, '')); if (n > max) max = n; }
      if (!id) id = 'D-' + ('000' + (max + 1)).slice(-4);
    }
    var row = [id, name, String(d.code || '').trim(), String(d.partnerId || '').trim(), String(d.hpLead || '').trim(), String(d.csoManager || '').trim(), d.favorite ? 'Y' : 'N',
      emails.join(', '), d.validUntil ? String(d.validUntil) : '', String(d.note || '').slice(0, 300), d.active === false ? 'N' : 'Y', ctx.user.email, new Date(), normGroup_(d.group)];
    if (at > 0) sh.getRange(at + 1, 1, 1, row.length).setValues([row]); else sh.appendRow(row);

    // users assigned to a dealer must be able to sign in: add missing emails as CSOs
    var added = [];
    if (emails.length) {
      var known = {}; rows_(TAB.allow).forEach(function (r) { known[normEmail_(r['Email'])] = 1; });
      var ash = sheet_(TAB.allow);
      emails.forEach(function (e) { if (!known[e]) { ash.appendRow([e, '', 'cso', 'Y', ctx.user.email, new Date(), normGroup_(d.group)]); added.push(e); } });
    }

    var nPrices = null;
    if (Array.isArray(prices)) {
      var pv = sheet_(TAB.dprices).getDataRange().getValues();
      var keep = pv.slice(1).filter(function (r) { return String(r[0]).trim() !== id && r[0] !== ''; });
      var mine = [], seen = {};
      prices.forEach(function (p) {
        var sku = HXPricing.baseSku(p.sku), price = HXPricing.num(p.price);
        if (!sku || price == null || price <= 0 || seen[sku]) return; seen[sku] = 1;
        var cap = HXPricing.num(p.qtyCap);
        mine.push([id, sku, price, cap == null ? '' : Math.max(0, Math.round(cap)), String(p.note || '').slice(0, 200)]);
      });
      writeRows_(TAB.dprices, H.dprices, keep.concat(mine));
      nPrices = mine.length;
    }
    editLog_(ctx.user.email, 'dealer ' + id + ' ' + name + (nPrices != null ? ': ' + nPrices + ' prices' : '') + (added.length ? ', added CSO ' + added.join(' ') : ''), { dealer: row.slice(0, 11), prices: prices || null });
    var out = adminData_(ctx); out.savedDealer = id; out.addedUsers = added;
    return out;
  } finally { lock.releaseLock(); }
}

/** Inline edits from the dealer page (admin): upsert special prices per SKU.
 *  changes: [{sku, price (null/'' = back to Base DP), qtyCap, note}]. A row equal to Base DP with no cap/note is removed
 *  so DealerPrices keeps exceptions only. */
function saveDealerPrices_(ctx) {
  var id = String(ctx.body.dealerId || '').trim(), changes = Array.isArray(ctx.body.changes) ? ctx.body.changes.slice(0, 500) : [];
  var d = dealerRows_().filter(function (x) { return x.id === id; })[0];
  if (!d) return { ok: false, error: 'bad_request', detail: 'Unknown dealer.' };
  if (!changes.length) return { ok: false, error: 'bad_request', detail: 'Nothing to save.' };
  var all = loadAll_(ctx.settings), bad = [];
  var lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var v = sheet_(TAB.dprices).getDataRange().getValues(), mine = {}, order = [], keep = [];
    v.slice(1).forEach(function (r) {
      if (r[0] === '' && r[1] === '') return;
      if (String(r[0]).trim() === id && r[1]) { var k = HXPricing.baseSku(r[1]); if (!mine[k]) order.push(k); mine[k] = r.slice(0, 5); }
      else keep.push(r.slice(0, 5));
    });
    var before = {}, n = 0;
    changes.forEach(function (c) {
      var sku = HXPricing.baseSku(c.sku || ''), p = all.priced[sku];
      if (!sku || !p) { bad.push(String(c.sku || '?')); return; }
      var price = c.price === '' || c.price == null ? null : HXPricing.num(c.price);
      if (price != null && !(price > 0)) { bad.push(sku); return; }
      var cap = HXPricing.num(c.qtyCap); cap = cap == null ? '' : Math.max(0, Math.round(cap));
      var note = String(c.note || '').slice(0, 200).trim();
      before[sku] = mine[sku] ? { price: mine[sku][2], cap: mine[sku][3], note: mine[sku][4] } : null;
      if (price != null) price = Math.round(price * 100) / 100;
      var same = price == null || (p.dp != null && price === p.dp);
      if (same && cap === '' && !note) { delete mine[sku]; n++; return; }
      if (!mine[sku]) order.push(sku);
      mine[sku] = [id, sku, price == null ? (p.dp == null ? '' : p.dp) : price, cap, note]; n++;
    });
    if (bad.length) return { ok: false, error: 'bad_request', detail: 'Check these SKUs: ' + bad.slice(0, 10).join(', ') };
    var rows = keep.concat(order.filter(function (k, i) { return mine[k] && order.indexOf(k) === i; }).map(function (k) { return mine[k]; }));
    writeRows_(TAB.dprices, H.dprices, rows);
    editLog_(ctx.user.email, 'dealer prices ' + id + ' ' + d.name + ': ' + n + ' change' + (n === 1 ? '' : 's'), { dealer: id, changes: changes, before: before });
  } finally { lock.releaseLock(); }
  var out = dealerData_(ctx, id); out.saved = n; return out;
}

/** Star / unstar a dealer page (favorites sort first everywhere). */
function setFavorite_(ctx) {
  var id = String(ctx.body.dealerId || '').trim(), fav = !!ctx.body.favorite;
  var sh = sheet_(TAB.dealers), v = sh.getDataRange().getValues(), c = v[0].map(String).indexOf('Favorite');
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim() === id) {
    sh.getRange(i + 1, c + 1).setValue(fav ? 'Y' : 'N');
    editLog_(ctx.user.email, (fav ? 'starred ' : 'unstarred ') + id + ' ' + v[i][1], null);
    return adminData_(ctx);
  }
  return { ok: false, error: 'bad_request', detail: 'Dealer not found' };
}

/* ================================================================== admin: data uploads */

/** HP sell-out report pasted as text (tab-separated, header row included). mode: replace | append (append skips duplicates). */
function uploadSellout_(ctx) {
  var t = parseTsv_(ctx.body.text);
  if (!t) return { ok: false, error: 'bad_paste', detail: 'Paste the whole report including the header row.' };
  var c = { date: t.col('Txn Date'), cust: t.col('Your Customer Name'), doc: t.col('Txn Doc ID'), sku: t.col('HP Product ID'), qty: t.col('Ship Out Quantity') };
  if (c.sku < 0 || c.qty < 0 || c.date < 0) return { ok: false, error: 'bad_paste', detail: 'Could not find the HP Product ID, Ship Out Quantity and Txn Date columns.' };
  var rows = t.rows.filter(function (r) { return r[c.sku]; }).map(function (r) { return [String(r[c.date]), c.cust >= 0 ? r[c.cust] : '', c.doc >= 0 ? String(r[c.doc]) : '', String(r[c.sku]), String(r[c.qty])]; });
  var existing = ctx.body.mode === 'append' ? sheet_(TAB.sellout).getDataRange().getValues().slice(1) : [];
  var key = function (r) { return [r[0], r[2], HXPricing.baseSku(r[3]), r[4]].join('|'); };
  var have = {}; existing.forEach(function (r) { have[key(r)] = 1; });
  var add = rows.filter(function (r) { if (have[key(r)]) return false; have[key(r)] = 1; return true; });
  writeRows_(TAB.sellout, H.sellout, existing.map(function (r) { return r.slice(0, 5); }).concat(add));
  sheet_(TAB.sellout).getRange('A:A').setNumberFormat('@');
  editLog_(ctx.user.email, 'sell-out ' + (ctx.body.mode === 'append' ? 'appended ' : 'replaced: ') + add.length + ' rows', null);
  var out = adminData_(ctx); out.uploaded = { rows: add.length, skipped: rows.length - add.length };
  return out;
}

/** SAP stock list pasted as text (e.g. MB52). Finds Material + Unrestricted columns, sums per SKU, writes Pricing "On hand". */
function uploadStock_(ctx) {
  var t = parseTsv_(ctx.body.text);
  if (!t) return { ok: false, error: 'bad_paste', detail: 'Paste the whole SAP list including the header row.' };
  var cMat = t.find(/^material$|^material\s*(no|number)?\.?$/i), cQty = t.find(/unrestr/i), cDesc = t.find(/description|material\s*desc/i);
  if (cQty < 0 || (cMat < 0 && cDesc < 0)) return { ok: false, error: 'bad_paste', detail: 'Could not find the Material and Unrestricted columns in the header row.' };
  var psh = sheet_(TAB.pricing), pv = psh.getDataRange().getValues(), ph = pv[0].map(String);
  var cs = ph.indexOf('SKU'), cm = ph.indexOf('Material'), co = ph.indexOf('On hand');
  var byMat = {}, bySku = {};
  for (var i = 1; i < pv.length; i++) { bySku[HXPricing.baseSku(pv[i][cs])] = i; if (cm >= 0 && pv[i][cm]) byMat[String(pv[i][cm]).replace(/\D/g, '')] = i; }
  var qty = {}, unknown = [], matched = 0;
  t.rows.forEach(function (r) {
    var q = HXPricing.sapQty(String(r[cQty]).replace(/,/g, '')); if (!r.join('')) return;
    var idx = cMat >= 0 ? byMat[String(r[cMat]).replace(/\D/g, '')] : undefined;
    if (idx == null && cDesc >= 0) { var mm = String(r[cDesc]).toUpperCase().match(/\b([0-9A-Z]{5}A[A-Z])\b/); if (mm && bySku[mm[1]] != null) idx = bySku[mm[1]]; }
    if (idx == null) { if (cMat >= 0 && r[cMat]) unknown.push(String(r[cMat])); return; }
    qty[idx] = (qty[idx] || 0) + q; matched++;
  });
  var zero = ctx.body.zeroMissing !== false, changed = 0;
  for (var k = 1; k < pv.length; k++) {
    var nv = qty[k] != null ? qty[k] : (zero ? 0 : pv[k][co]);
    if (pv[k][co] !== nv) changed++;
    pv[k][co] = nv;
  }
  psh.getRange(1, 1, pv.length, ph.length).setValues(pv);
  setSetting_('STOCK_AS_OF', Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm'));
  editLog_(ctx.user.email, 'stock: ' + matched + ' SAP lines matched, ' + changed + ' SKUs changed' + (unknown.length ? ', ' + unknown.length + ' unknown materials' : ''), { unknown: unknown.slice(0, 50) });
  var out = adminData_(ctx); out.uploaded = { matched: matched, changed: changed, unknown: unknown.slice(0, 30) };
  return out;
}

/* ================================================================== registration (self-service access requests) */
var REG_ROLES = { sales: 'Sales', cso: 'Channel sales officer (CSO)', csa: 'Channel sales assistant (CSA)', sm: 'Sales manager (SM)', csomgr: 'CSO manager', hplead: 'HP lead' };

function regRows_() {
  if (!ss_().getSheetByName(TAB.reg)) return [];
  return rows_(TAB.reg).filter(function (r) { return r['Email']; }).map(function (r) {
    return { email: normEmail_(r['Email']), name: String(r['Name'] || ''), role: String(r['Requested role'] || ''), mobile: String(r['Mobile'] || ''),
      partners: String(r['Partners handled'] || ''), note: String(r['Note'] || ''), status: String(r['Status'] || 'pending'),
      requestedOn: r['Requested on'] instanceof Date ? r['Requested on'].toISOString() : String(r['Requested on'] || ''),
      decidedBy: String(r['Decided by'] || ''), decidedOn: r['Decided on'] instanceof Date ? r['Decided on'].toISOString() : String(r['Decided on'] || ''),
      grantedRole: String(r['Granted role'] || ''), dealerIds: String(r['Dealer IDs'] || ''), entries: parseJson_(r['Entries'], []), group: normGroup_(r['Group']) };
  });
}

function registrationStatus_(who, m) {
  var mine = regRows_().filter(function (r) { return r.email === who.email; })[0] || null;
  return { ok: true, email: who.email, name: who.name, member: m ? { role: m.role } : null,
    request: mine ? { status: mine.status, role: mine.role, partners: mine.partners, entries: mine.entries, requestedOn: mine.requestedOn, name: mine.name, mobile: mine.mobile, note: mine.note, group: mine.group } : null, roles: REG_ROLES, groups: GROUPS, groupNames: GROUP_NAMES };
}

function register_(who, body) {
  if (findMember_(who.email)) return registrationStatus_(who, findMember_(who.email));
  var entries = (Array.isArray(body.entries) ? body.entries : []).slice(0, 40).map(function (e) { return { partner: String(e.partner || '').trim().slice(0, 120), accounts: String(e.accounts || '').trim().slice(0, 600) }; }).filter(function (e) { return e.partner; });
  var name = String(body.name || '').trim().slice(0, 80), role = String(body.role || '').trim();
  var partners = entries.length ? entries.map(function (e) { return e.partner + (e.accounts ? ' — accounts: ' + e.accounts : ''); }).join('\n') : String(body.partners || '').trim().slice(0, 1000);
  if (!name || !REG_ROLES[role]) return { ok: false, error: 'bad_request', detail: 'Name and role are required.' };
  if (!partners && role !== 'csomgr' && role !== 'sm') return { ok: false, error: 'bad_request', detail: 'List the HP partners / dealers you handle.' };
  var group = normGroup_(body.group);
  var row = [who.email, name, role, String(body.mobile || '').trim().slice(0, 30), partners.slice(0, 5000), String(body.note || '').trim().slice(0, 300), 'pending', new Date(), '', '', '', '', JSON.stringify(entries), group];
  var lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var sh = ss_().getSheetByName(TAB.reg);
    if (!sh) { sh = ss_().insertSheet(TAB.reg); sh.setFrozenRows(1); }
    sh.getRange(1, 1, 1, H.reg.length).setValues([H.reg]);
    var v = sh.getDataRange().getValues(), at = -1;
    for (var i = 1; i < v.length; i++) if (normEmail_(v[i][0]) === who.email) at = i;
    if (at > 0 && /rejected/i.test(v[at][6]) && !body.again) return { ok: false, error: 'bad_request', detail: 'Your earlier request was declined. Contact the HyperX brand manager.' };
    if (at > 0) sh.getRange(at + 1, 1, 1, row.length).setValues([row]); else sh.getRange(v.length + 1, 1, 1, row.length).setValues([row]);
  } finally { lock.releaseLock(); }
  return registrationStatus_(who, null);
}

/** Admin approves (adds to the allowlist with a role and assigns dealer pages) or rejects a request. */
function decideRegistration_(ctx) {
  var b = ctx.body, email = normEmail_(b.email), dec = b.decision === 'approve' ? 'approve' : 'reject';
  var req = regRows_().filter(function (r) { return r.email === email; })[0];
  if (!req) return { ok: false, error: 'bad_request', detail: 'No request from ' + email };
  var assign = (Array.isArray(b.assign) ? b.assign : []).map(function (a) { return { dealerId: String(a.dealerId || ''), accounts: String(a.accounts || '').slice(0, 600), partner: String(a.partner || '').slice(0, 120) }; }).filter(function (a) { return a.dealerId; });
  var role = String(b.role || req.role), ids = (Array.isArray(b.dealerIds) ? b.dealerIds : []).map(String);
  assign.forEach(function (a) { if (ids.indexOf(a.dealerId) < 0) ids.push(a.dealerId); });
  if (dec === 'approve' && ROLES.indexOf(role) < 0) return { ok: false, error: 'bad_request', detail: 'Pick a role.' };
  var lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    if (dec === 'approve') {
      var ash = sheet_(TAB.allow), av = ash.getDataRange().getValues(), at = -1;
      for (var i = 1; i < av.length; i++) if (normEmail_(av[i][0]) === email) at = i;
      var arow = [email, req.name, role, 'Y', ctx.user.email, new Date(), normGroup_(b.group || req.group)];
      if (at > 0) ash.getRange(at + 1, 1, 1, arow.length).setValues([arow]); else ash.getRange(av.length + 1, 1, 1, arow.length).setValues([arow]);
      if (ids.length) {
        var dsh = sheet_(TAB.dealers), dv = dsh.getDataRange().getValues(), dh = dv[0].map(String), ce = dh.indexOf('Assigned emails'), cu = dh.indexOf('Updated by'), co = dh.indexOf('Updated on');
        for (var j = 1; j < dv.length; j++) if (ids.indexOf(String(dv[j][0]).trim()) >= 0) {
          var list = splitEmails_(dv[j][ce]); if (list.indexOf(email) < 0) list.push(email);
          dsh.getRange(j + 1, ce + 1).setValue(list.join(', '));
          if (cu >= 0) dsh.getRange(j + 1, cu + 1).setValue(ctx.user.email); if (co >= 0) dsh.getRange(j + 1, co + 1).setValue(new Date());
        }
      }
    }
    if (dec === 'approve' && assign.length) {
      var DN = {}; dealerRows_().forEach(function (d) { DN[d.id] = d.name; });
      upsertAssign_(email, assign.map(function (a) { return [email, a.dealerId, DN[a.dealerId] || '', a.accounts, a.partner, ctx.user.email, new Date()]; }));
    }
    var rsh = sheet_(TAB.reg), rv = rsh.getDataRange().getValues();
    for (var k = 1; k < rv.length; k++) if (normEmail_(rv[k][0]) === email) {
      rsh.getRange(k + 1, 7).setValue(dec === 'approve' ? 'approved' : 'rejected');
      rsh.getRange(k + 1, 9, 1, 4).setValues([[ctx.user.email, new Date(), dec === 'approve' ? role : '', ids.join(', ')]]);
      if (b.note) rsh.getRange(k + 1, 6).setValue(String(req.note ? req.note + ' | ' : '') + 'Admin: ' + String(b.note).slice(0, 200));
    }
  } finally { lock.releaseLock(); }
  editLog_(ctx.user.email, 'access request ' + email + ': ' + dec + (dec === 'approve' ? ' as ' + role + (ids.length ? ', dealers ' + ids.join(', ') : '') : ''), b);
  return adminData_(ctx);
}

function parseJson_(v, dflt) { try { return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } }
function ensureTab_(name, header) {
  var sh = ss_().getSheetByName(name);
  if (!sh) { sh = ss_().insertSheet(name); sh.setFrozenRows(1); }
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  return sh;
}
function assignRows_() {
  if (!ss_().getSheetByName(TAB.assign)) return [];
  return rows_(TAB.assign).filter(function (r) { return r['Email'] && r['Dealer ID']; }).map(function (r) {
    return { email: normEmail_(r['Email']), dealerId: String(r['Dealer ID']).trim(), dealerName: String(r['Dealer name'] || ''), accounts: String(r['Accounts'] || ''), partner: String(r['Partner (as typed)'] || '') };
  });
}
/** Replace (email, dealer) rows; other people's rows are untouched. */
function upsertAssign_(email, rows) {
  var sh = ensureTab_(TAB.assign, H.assign), v = sh.getDataRange().getValues(), keep = [];
  var ids = {}; rows.forEach(function (r) { ids[r[1]] = 1; });
  v.slice(1).forEach(function (r) { if (!r[0]) return; if (normEmail_(r[0]) === email && ids[String(r[1]).trim()]) return; keep.push(r.slice(0, H.assign.length)); });
  var all = keep.concat(rows);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, H.assign.length).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, H.assign.length).setValues(all);
}
/** Admin edits one person's accounts on one dealer page. */
function saveAssignment_(ctx) {
  var b = ctx.body, email = normEmail_(b.email), id = String(b.dealerId || '').trim();
  var d = dealerRows_().filter(function (x) { return x.id === id; })[0];
  if (!d || !email) return { ok: false, error: 'bad_request' };
  var lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try { upsertAssign_(email, [[email, id, d.name, String(b.accounts || '').slice(0, 600), String(b.partner || ''), ctx.user.email, new Date()]]); } finally { lock.releaseLock(); }
  editLog_(ctx.user.email, 'accounts for ' + email + ' on ' + d.name, b);
  return adminData_(ctx);
}

/* ================================================================== OPG (HP orderable list): auto OPG date + EOL */
/** body.skus: SKUs found in the uploaded OPG file. In OPG → OPG status 'In OPG' (OPG added = today if blank).
 *  On the pricelist but missing from the OPG → 'EOL' until it comes back. */
function uploadOpg_(ctx) {
  var list = (Array.isArray(ctx.body.skus) ? ctx.body.skus : []).map(function (x) { return HXPricing.baseSku(String(x)); }).filter(function (x) { return /^[A-Z0-9]{5,8}$/.test(x); });
  if (list.length < 5) return { ok: false, error: 'bad_paste', detail: 'Found only ' + list.length + ' SKUs in that file.' };
  var inOpg = {}; list.forEach(function (x) { inOpg[x] = 1; });
  var today = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd'), res = { added: [], eol: [], back: [], notListed: [] };
  var lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var sh = sheet_(TAB.pricing), v = sh.getDataRange().getValues(), h = v[0].map(String);
    ['OPG status', 'Exclusive dealers'].forEach(function (nm) { if (h.indexOf(nm) < 0) { h.push(nm); v.forEach(function (row, k) { row.push(k ? '' : nm); }); } });
    var cs = h.indexOf('SKU'), co = h.indexOf('OPG added'), cst = h.indexOf('OPG status'), seen = {};
    for (var i = 1; i < v.length; i++) {
      var sku = HXPricing.baseSku(v[i][cs]); if (!sku) continue; seen[sku] = 1;
      var was = String(v[i][cst] || '');
      if (inOpg[sku]) {
        if (!v[i][co]) { v[i][co] = today; res.added.push(sku); }
        if (/eol/i.test(was)) res.back.push(sku);
        v[i][cst] = 'In OPG';
      } else { if (!/eol/i.test(was)) res.eol.push(sku); v[i][cst] = 'EOL'; }
    }
    list.forEach(function (x) { if (!seen[x]) res.notListed.push(x); });
    sh.getRange(1, 1, v.length, h.length).setValues(v);
  } finally { lock.releaseLock(); }
  setSetting_('OPG_AS_OF', Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm'));
  bustPublic_();
  editLog_(ctx.user.email, 'OPG: ' + list.length + ' SKUs · ' + res.added.length + ' new to OPG · ' + res.eol.length + ' now EOL · ' + res.back.length + ' back', res);
  var out = adminData_(ctx); out.opg = { total: list.length, added: res.added, eol: res.eol, back: res.back, notListed: res.notListed.slice(0, 200) }; return out;
}

/* ================================================================== pipes (quote tables made from the cart) */
/* logPipe_ / listPipes_ live in Platform.gs */

/** Exact stock for signed-in internal staff on the public pricelist (never dealers / HP leads). */
function stockData_(ctx) {
  if (!INTERNAL[ctx.user.role]) return { ok: false, error: 'not_allowed_here' };
  var all = loadAll_(ctx.settings), out = {};
  all.order.forEach(function (s) { var p = all.priced[s]; if (!p || !p.active) return;
    out[s] = { onHand: p.onHand, committed: p.committed, atp: p.atp, incoming: p.incoming, nextEta: p.nextEta, lines: p.incomingLines }; });
  return { stock: out, stockAsOf: ctx.settings.STOCK_AS_OF || '', incomingAsOf: ctx.settings.INCOMING_AS_OF || '' };
}

/* ================================================================== incoming (HP OSS open-order report) */

function incomingBySku_() {
  var sh = ss_().getSheetByName(TAB.incoming), out = {};
  if (!sh) return out;
  rows_(TAB.incoming).forEach(function (r) {
    var sku = HXPricing.baseSku(r['SKU'] || ''), q = HXPricing.num(r['Qty']) || 0; if (!sku || !q) return;
    var eta = iso_(toDate_(r['ETA'])), o = out[sku] = out[sku] || { qty: 0, eta: '', lines: [] };
    o.qty += q; if (eta && (!o.eta || eta < o.eta)) o.eta = eta;
    o.lines.push({ po: String(r['PO'] || ''), qty: q, status: String(r['Status'] || ''), eta: eta, mode: String(r['Mode'] || '') });
  });
  Object.keys(out).forEach(function (k) { out[k].lines.sort(function (a, b) { return (a.eta || '9') < (b.eta || '9') ? -1 : 1; }); });
  return out;
}

function parseCsv_(text) {
  var rows = [], row = [], f = '', q = false, t = String(text || '').replace(/^﻿/, '');
  for (var i = 0; i < t.length; i++) {
    var c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; if (row.join('').trim()) rows.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.join('').trim()) rows.push(row);
  return rows;
}

/** HP OSS report (CSV). Keeps HyperX lines for SKUs on the pricelist that are not yet delivered (no POD date,
 *  not cancelled). Replaces the Incoming tab: the OSS report is always the full open-order picture. */
function uploadIncoming_(ctx) {
  var rows = parseCsv_(ctx.body.text);
  if (rows.length < 2) return { ok: false, error: 'bad_paste', detail: 'That does not look like an OSS report.' };
  var h = rows[0].map(function (x) { return String(x).trim(); }), col = function (n) { return h.indexOf(n); };
  var cSku = col('ProductNumber'), cQty = col('OrderedQuantity');
  if (cSku < 0 || cQty < 0) return { ok: false, error: 'bad_paste', detail: 'Missing ProductNumber / OrderedQuantity columns.' };
  var cPo = col('PurchaseOrderNo'), cPoD = col('PurchaseOrderDate'), cShipQ = col('ShippedQuantity'), cSt = col('Status'), cShip = col('SchedShipDate'),
      cDelv = col('SchedDelvDate'), cMode = col('TransportModeAtShipment'), cShipNo = col('ShipmentNumber'), cDesc = col('ProductDescription'), cPod = col('PODDateTime');
  var all = loadAll_(ctx.settings), out = [], skipped = 0, other = 0;
  rows.slice(1).forEach(function (r) {
    var sku = HXPricing.baseSku(r[cSku] || ''); if (!sku) return;
    if (!all.priced[sku]) { other++; return; }
    var st = cSt >= 0 ? String(r[cSt]).trim() : '';
    if ((cPod >= 0 && String(r[cPod]).trim()) || /cancel|deliver/i.test(st)) { skipped++; return; }
    var q = HXPricing.num(r[cQty]) || 0; if (!q) return;
    out.push([sku, cPo >= 0 ? r[cPo] : '', cPoD >= 0 ? r[cPoD] : '', q, cShipQ >= 0 ? (HXPricing.num(r[cShipQ]) || 0) : '', st,
      cShip >= 0 ? r[cShip] : '', cDelv >= 0 ? r[cDelv] : '', cMode >= 0 ? r[cMode] : '', cShipNo >= 0 ? r[cShipNo] : '', cDesc >= 0 ? r[cDesc] : '']);
  });
  var lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try { writeRows_(TAB.incoming, H.incoming, out); } finally { lock.releaseLock(); }
  var skus = {}; out.forEach(function (r) { skus[r[0]] = (skus[r[0]] || 0) + r[3]; });
  setSetting_('INCOMING_AS_OF', Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm'));
  editLog_(ctx.user.email, 'incoming (OSS): ' + out.length + ' open HyperX lines, ' + Object.keys(skus).length + ' SKUs', { skipped: skipped, otherProducts: other });
  var res = adminData_(ctx); res.uploaded = { lines: out.length, skus: Object.keys(skus).length, units: out.reduce(function (a, r) { return a + r[3]; }, 0), delivered: skipped, other: other };
  return res;
}

/** New HP rebate program: lines of "SKU <tab> Max Qty <tab> Rebate per unit [<tab> Description]". Replaces the Rebate tab. */
function uploadRebate_(ctx) {
  var b = ctx.body, deal = String(b.deal || '').trim(), start = String(b.start || ''), end = String(b.end || '');
  if (!deal || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return { ok: false, error: 'bad_request', detail: 'Deal number, start and end dates are required.' };
  var lines = String(b.text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  var rows = [];
  lines.forEach(function (l) {
    var m = l.match(/\b([0-9A-Z]{5}A[A-Z])\b/i); if (!m) return;
    var nums = (l.replace(m[1], ' ').match(/\d[\d,]*(\.\d+)?/g) || []).map(function (x) { return Number(x.replace(/,/g, '')); });
    if (nums.length < 2) return;
    var desc = l.replace(m[1], '').replace(/^\s*MS\s+/, '').replace(/\s*\d[\d,]*(\.\d+)?\s+\d[\d,]*(\.\d+)?.*$/, '').trim();
    rows.push([deal, String(b.program || ''), m[1].toUpperCase(), desc, nums[nums.length - 2], nums[nums.length - 1], start, end]);
  });
  if (!rows.length) return { ok: false, error: 'bad_paste', detail: 'No lines with a SKU, max qty and rebate amount were found.' };
  writeRows_(TAB.rebate, H.rebate, rows);
  editLog_(ctx.user.email, 'rebate program ' + deal + ': ' + rows.length + ' SKUs', null);
  var out = adminData_(ctx); out.uploaded = { rows: rows.length };
  return out;
}

function saveSettings_(ctx) {
  var s = ctx.body.settings || {}, done = [];
  EDITABLE_SETTINGS.forEach(function (k) {
    if (!(k in s)) return;
    var v = s[k];
    if (k === 'MIN_MARGIN') { var n = HXPricing.pct(v); if (n == null || n < 0 || n > 0.5) throw new Error('Minimum margin must be between 0% and 50%'); v = n; }
    if (k === 'NEW_DAYS') { var d = Math.round(Number(v)); if (isNaN(d) || d < 1 || d > 730) throw new Error('New window must be 1 to 730 days'); v = d; }
    if (k === 'PRICES_AS_OF' && v && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new Error('Date must look like 2026-11-23');
    setSetting_(k, typeof v === 'string' ? v.slice(0, 500) : v); done.push(k);
  });
  editLog_(ctx.user.email, 'settings: ' + done.join(', '), s);
  return adminData_(ctx);
}

/* ================================================================== admin: pricelist editor save */

function saveEdits_(ctx) {
  var body = ctx.body, lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var changes = [];
    if (Array.isArray(body.rules) && body.rules.length) {
      var sh = sheet_(TAB.rules);
      var grid = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, H.rules.length).getValues() : [];
      var key = function (cat, seg) { return String(cat).trim().toLowerCase() + '|' + (/new/i.test(seg) ? 'New' : 'Existing'); };
      var at = {}; grid.forEach(function (g, i) { at[key(g[0], g[1])] = i; });
      body.rules.forEach(function (r) {
        var row = [String(r.cat).trim(), r.seg === 'New' ? 'New' : 'Existing', clampPct_(r.dpMargin), clampDigits_(r.dpDigits), clampPct_(r.thrMargin), clampDigits_(r.thrDigits),
          r.limitBelow === '' || r.limitBelow == null ? '' : clampPct_(r.limitBelow)];
        var k = key(row[0], row[1]);
        if (at[k] != null) grid[at[k]] = row; else { at[k] = grid.length; grid.push(row); }
      });
      if (grid.length) sh.getRange(2, 1, grid.length, H.rules.length).setValues(grid);
      changes.push(body.rules.length + ' margin rules');
    }
    if (Array.isArray(body.items) && body.items.length) {
      var psh = sheet_(TAB.pricing), v = psh.getDataRange().getValues(), h = v[0].map(String);
      ['OPG status', 'Exclusive dealers'].forEach(function (nm) { if (h.indexOf(nm) < 0) { h.push(nm); v.forEach(function (row, k) { row.push(k ? '' : nm); }); } });
      var c = { sku: h.indexOf('SKU'), nw: h.indexOf('New'), rel: h.indexOf('Release date'), opg: h.indexOf('OPG added'), dpo: h.indexOf('DP override'), tho: h.indexOf('Threshold override'), act: h.indexOf('Active'), exc: h.indexOf('Exclusive dealers') };
      var validD = {}; dealerRows_().forEach(function (d) { validD[d.id] = 1; });
      var rowOf = {}; for (var i = 1; i < v.length; i++) rowOf[HXPricing.baseSku(v[i][c.sku])] = i;
      var n = 0;
      body.items.forEach(function (it) {
        var i = rowOf[HXPricing.baseSku(it.sku)]; if (i == null) return;
        if ('newMode' in it) v[i][c.nw] = it.newMode === 'Y' ? 'Y' : it.newMode === 'N' ? 'N' : 'Auto';
        if ('release' in it && c.rel >= 0) v[i][c.rel] = cleanDate_(it.release);
        if ('opgAdded' in it && c.opg >= 0) v[i][c.opg] = cleanDate_(it.opgAdded);
        if ('dpOverride' in it) v[i][c.dpo] = cleanNum_(it.dpOverride);
        if ('thrOverride' in it) v[i][c.tho] = cleanNum_(it.thrOverride);
        if ('active' in it) v[i][c.act] = it.active ? 'Y' : 'N';
        if ('exclusive' in it) v[i][c.exc] = (Array.isArray(it.exclusive) ? it.exclusive : []).map(String).filter(function (x) { return validD[x]; }).join(', ');
        n++;
      });
      psh.getRange(1, 1, v.length, h.length).setValues(v);
      changes.push(n + ' SKU edits');
    }
    if (body.pricesAsOf) setSetting_('PRICES_AS_OF', String(body.pricesAsOf));
    bustPublic_();
    var summary = changes.join(', ') || 'no changes';
    editLog_(ctx.user.email, 'pricelist: ' + summary, { rules: body.rules || [], items: body.items || [] });
    return { ok: true, summary: summary };
  } finally { lock.releaseLock(); }
}

function clampPct_(x) { var n = HXPricing.pct(x); if (n == null || n < -0.5 || n >= 0.95) throw new Error('Margin out of range: ' + x); return Math.round(n * 1e6) / 1e6; }
function clampDigits_(x) { var n = Math.round(Number(x)); if (isNaN(n) || n < -2 || n > 2) throw new Error('Rounding must be between -2 and 2'); return n; }
function cleanDate_(x) { var s = String(x || '').trim(); if (!s) return ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Dates must look like 2026-11-23'); return s; }
function cleanNum_(x) { var n = HXPricing.num(x); return n == null ? '' : n; }

/* ================================================================== helpers */

function sheet_(name) { var ss = ss_(); return ss.getSheetByName(name) || ss.insertSheet(name); }

function readSettings_() {
  var out = {}, vals = sheetValues_(TAB.settings);
  if (!vals.length) return out;
  vals.slice(1).forEach(function (r) { if (r[0]) out[String(r[0]).trim()] = r[1]; });
  if (out.PRICES_AS_OF instanceof Date) out.PRICES_AS_OF = iso_(out.PRICES_AS_OF);
  return out;
}

function setSetting_(key, value) {
  var sh = sheet_(TAB.settings), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim() === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  sh.appendRow([key, value, '']);
}

function rows_(name) {
  var v = sheetValues_(name);
  if (v.length < 2) return [];
  var h = v[0].map(function (x) { return String(x).trim(); });
  return v.slice(1).map(function (row) { var o = {}; h.forEach(function (k, i) { o[k] = row[i]; }); return o; });
}

/** Rewrites a tab's data rows under its header. */
function writeRows_(name, header, rows) {
  var sh = sheet_(name);
  sh.clearContents();
  var w = header.length, grid = [header].concat(rows.map(function (r) { var c = r.slice(0, w); while (c.length < w) c.push(''); return c; }));
  sh.getRange(1, 1, grid.length, w).setValues(grid);
  sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#16181c').setFontColor('#ffffff');
  sh.setFrozenRows(1);
}

function tail_(name, n) {
  var sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var last = sh.getLastRow(), from = Math.max(2, last - n + 1);
  return sh.getRange(from, 1, last - from + 1, Math.min(sh.getLastColumn(), 6)).getValues().reverse().map(function (r) {
    return r.map(function (x) { return x instanceof Date ? x.toISOString() : (typeof x === 'string' ? x.slice(0, 300) : x); });
  });
}

/** Tab-separated paste -> {head, rows, col(name), find(regex)}; header = first row with 3+ non-empty cells. */
function parseTsv_(text) {
  var lines = String(text || '').split(/\r?\n/).filter(function (l) { return l.replace(/\t/g, '').trim(); });
  if (lines.length < 2) return null;
  var split = function (l) { return l.split("\t").map(function (x) { return x.trim().replace(/^"([\s\S]*)"$/, "$1"); }); };
  var hi = 0; while (hi < lines.length && split(lines[hi]).filter(Boolean).length < 3) hi++;
  if (hi >= lines.length - 1) return null;
  var head = split(lines[hi]);
  return {
    head: head, rows: lines.slice(hi + 1).map(split),
    col: function (n) { return head.indexOf(n); },
    find: function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; }
  };
}

function log_(email, name, role, result, page) {
  var sh = ss_().getSheetByName(TAB.log);
  if (sh) sh.appendRow([new Date(), email, name, role, String(result).slice(0, 200), String(page || '').slice(0, 60)]);
}
function editLog_(email, summary, details) {
  bustPublic_();
  var sh = ss_().getSheetByName(TAB.edits);
  if (sh) sh.appendRow([new Date(), email, summary, details ? JSON.stringify(details).slice(0, 45000) : '']);
}

function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function splitEmails_(s) {
  var seen = {};
  return (Array.isArray(s) ? s : String(s || '').split(/[\s,;]+/)).map(normEmail_).filter(function (e) { if (!e || seen[e]) return false; seen[e] = 1; return true; });
}
function merge_(a, b) { Object.keys(b).forEach(function (k) { a[k] = b[k]; }); return a; }
function toDate_(x) {
  if (!x) return null;
  if (x instanceof Date) return x;
  var s = String(x).trim();
  if (/^\d{8}$/.test(s)) return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  var d = new Date(s); return isNaN(d) ? null : d;
}
function iso_(d) { return d ? Utilities.formatDate(d, 'Asia/Manila', 'yyyy-MM-dd') : ''; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ================================================================== setup + tests (run from the Apps Script editor) */

/** Run once after pasting the three files. Builds every tab from Seed.gs. Re-running rewrites the data tabs but keeps logs, users and dealers. */
function setup() {
  if (typeof SEED === 'undefined') throw new Error('Seed.gs is not in this project: the Sheet was already filled in, so setup is not needed.');
  var ss = ss_(), S = SEED, owner = Session.getEffectiveUser().getEmail();
  writeTab_(ss, TAB.settings, [['Key', 'Value', 'What it is']].concat(S.settings.map(function (r) { return r[0] === 'OWNER_EMAIL' && !r[1] ? [r[0], owner, r[2]] : r; })));
  if (!hasRows_(TAB.allow)) writeTab_(ss, TAB.allow, [H.allow].concat(S.allowlist.map(function (r) { return r.concat(['setup', new Date()]); })));
  writeTab_(ss, TAB.rules, [H.rules].concat(S.rules));
  writeTab_(ss, TAB.pricing, [H.pricing].concat(S.pricing));
  writeTab_(ss, TAB.rebate, [H.rebate].concat(S.rebate));
  writeTab_(ss, TAB.sellout, [H.sellout].concat(S.sellout));
  ss.getSheetByName(TAB.sellout).getRange('A:A').setNumberFormat('@');
  ss.getSheetByName(TAB.pricing).getRange('B:B').setNumberFormat('@');
  if (!hasRows_(TAB.dealers)) writeTab_(ss, TAB.dealers, [H.dealers].concat((S.dealers || []).map(function (r) { return r.concat(['setup', new Date()]); })));
  if (!hasRows_(TAB.dprices)) writeTab_(ss, TAB.dprices, [H.dprices]);
  if (!ss.getSheetByName(TAB.log)) writeTab_(ss, TAB.log, [H.log]);
  if (!ss.getSheetByName(TAB.edits)) writeTab_(ss, TAB.edits, [H.edits]);
  var first = ss.getSheetByName('Sheet1'); if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
  SpreadsheetApp.flush();
  Logger.log('Setup done: ' + S.pricing.length + ' SKUs, ' + S.rules.length + ' margin rules, ' + S.rebate.length + ' rebate lines. Owner: ' + owner);
}
function hasRows_(name) { var sh = ss_().getSheetByName(name); return !!sh && sh.getLastRow() > 1; }

function writeTab_(ss, name, values) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  var w = values.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
  var grid = values.map(function (r) { var c = r.slice(); while (c.length < w) c.push(''); return c; });
  sh.getRange(1, 1, grid.length, w).setValues(grid);
  sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#16181c').setFontColor('#ffffff');
  sh.setFrozenRows(1);
}

/** Editor test: what an admin's sales view would return, no sign-in needed. */
function testPricing() {
  var d = salesData_({ settings: readSettings_(), isAdmin: true, user: { role: 'admin', email: '' } });
  var lim = d.items.filter(function (i) { return i.tier === 'limited'; });
  Logger.log(d.items.length + ' priced SKUs, ' + lim.length + ' Limited Qty');
  lim.slice(0, 12).forEach(function (i) { Logger.log(i.sku + '  SP ' + i.sp + '  w/o rebate ' + (i.marginNoRebate * 100).toFixed(1) + '%  units left ' + i.unitsLeft); });
}
/* HyperX × Iontech — platform layer (loaded after Engine.gs and Code.gs).
 *  1. Read cache: sheet values cached in CacheService, keyed by a data version that every write request bumps.
 *  2. Sessions: after one Google sign-in the server issues a signed 12-hour session token, so later calls skip
 *     Google's token check. Role, group and dealer access are still re-read (from the cache) on every request.
 *  3. Sales teams (many-to-many) and bulk dealer assignment.
 *  4. Personal and company quotation templates.
 *  5. Quotation pipeline: one record per quotation + an activity log, statuses, guest logging, filters, stats.
 */

/* ================================================================== 1. read cache */

var SS_ = null, MEMO_ = {}, CACHE_OFF_ = false, VER_ = null, CACHE_TTL_ = 600;
/* Tabs that change on almost every export are always read live (and their writes don't invalidate everyone's cache). */
var LIVE_TABS_ = { Pipes: 1, PipeEvents: 1, QuoteTemplates: 1, AccessLog: 1, EditLog: 1 };
var NO_BUMP_ = { logPipe: 1, setPipeStatus: 1, saveTemplate: 1, deleteTemplate: 1 };
var READ_ACTIONS_ = { whoami: 1, prices: 1, dealer: 1, editor: 1, admin: 1, quotes: 1, commitments: 1, stock: 1, pipes: 1, pipe: 1, pipeStats: 1, templates: 1, registration: 1, session: 1 };

function cache_() { return CacheService.getScriptCache(); }
function dataVer_() {
  if (VER_) return VER_;
  var v = null;
  try { v = cache_().get('dver'); } catch (e) {}
  if (!v) { v = PropertiesService.getScriptProperties().getProperty('DATA_VER') || '1'; try { cache_().put('dver', v, 21600); } catch (e) {} }
  return (VER_ = v);
}
function bumpVer_() {
  var v = String(Date.now());
  PropertiesService.getScriptProperties().setProperty('DATA_VER', v);
  try { cache_().put('dver', v, 21600); cache_().remove('public_v1'); } catch (e) {}
  VER_ = v; MEMO_ = {};
}
function packDates_(k, v) { var raw = this[k]; return raw instanceof Date ? { $d: raw.getTime() } : v; }
function unpackDates_(k, v) { return v && typeof v === 'object' && v.$d != null && Object.keys(v).length === 1 ? new Date(v.$d) : v; }
function cacheGetBig_(key) {
  try {
    var c = cache_(), head = c.get(key); if (!head) return null;
    var n = Number(head); if (!n) return null;
    var keys = []; for (var i = 0; i < n; i++) keys.push(key + ':' + i);
    var parts = c.getAll(keys), s = '';
    for (var j = 0; j < n; j++) { if (parts[keys[j]] == null) return null; s += parts[keys[j]]; }
    return s;
  } catch (e) { return null; }
}
function cachePutBig_(key, s, ttl) {
  try {
    var size = 90000, map = {}, n = Math.ceil(s.length / size) || 1;
    if (n > 40) return;                                          // too big to be worth caching
    for (var i = 0; i < n; i++) map[key + ':' + i] = s.slice(i * size, (i + 1) * size);
    var c = cache_(); c.putAll(map, ttl); c.put(key, String(n), ttl);
  } catch (e) {}
}
/** Full value grid of a tab (header row included), cached between requests. */
function sheetValues_(name) {
  if (MEMO_[name]) return MEMO_[name];
  var live = CACHE_OFF_ || LIVE_TABS_[name];
  if (live) { var sh0 = ss_().getSheetByName(name), lv = sh0 && sh0.getLastRow() > 0 ? sh0.getDataRange().getValues() : []; if (!CACHE_OFF_) MEMO_[name] = lv; return lv; }
  var key = 'v' + dataVer_() + ':' + name, vals = null;
  if (!CACHE_OFF_) { var hit = cacheGetBig_(key); if (hit) { try { vals = JSON.parse(hit, unpackDates_); } catch (e) { vals = null; } } }
  if (!vals) {
    var sh = ss_().getSheetByName(name);
    vals = sh && sh.getLastRow() > 0 ? sh.getDataRange().getValues() : [];
    if (!CACHE_OFF_) cachePutBig_(key, JSON.stringify(vals, packDates_), CACHE_TTL_);
  }
  if (!CACHE_OFF_) MEMO_[name] = vals;
  return vals;
}

/* ================================================================== 2. sessions */

var SESSION_HOURS_ = 12;
function b64u_(bytesOrStr) { return Utilities.base64EncodeWebSafe(bytesOrStr).replace(/=+$/, ''); }
function sessionSecret_() {
  var p = PropertiesService.getScriptProperties(), s = p.getProperty('SESSION_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SESSION_SECRET', s); }
  return s;
}
function sessionEpoch_() { return PropertiesService.getScriptProperties().getProperty('SESSION_EPOCH') || '1'; }
function issueSession_(who) {
  var exp = Date.now() + SESSION_HOURS_ * 3600e3;
  var payload = b64u_(JSON.stringify({ e: who.email, n: who.name || '', p: who.picture || '', x: exp, v: sessionEpoch_() }));
  var sig = b64u_(Utilities.computeHmacSha256Signature(payload, sessionSecret_()));
  return { token: 's1.' + payload + '.' + sig, exp: exp, email: who.email };
}
function verifySession_(tok) {
  var p = String(tok || '').split('.');
  if (p.length !== 3 || p[0] !== 's1') return { ok: false, error: 'invalid_token' };
  var sig = b64u_(Utilities.computeHmacSha256Signature(p[1], sessionSecret_()));
  if (sig !== p[2]) return { ok: false, error: 'invalid_token' };
  var o; try { o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(p[1] + '==='.slice((p[1].length + 3) % 4))).getDataAsString()); } catch (e) { return { ok: false, error: 'invalid_token' }; }
  if (!o || !o.e || Number(o.x) < Date.now()) return { ok: false, error: 'expired' };
  if (String(o.v) !== sessionEpoch_()) return { ok: false, error: 'expired' };
  return { ok: true, email: String(o.e).toLowerCase(), name: o.n || '', picture: o.p || '', viaSession: true };
}
/** Google ID token check, cached for the token's remaining life so a page's burst of calls costs one round trip. */
function verifyTokenCached_(idToken, clientId) {
  if (!idToken) return { ok: false, error: 'no_token' };
  var key = 'tok:' + b64u_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  try { var hit = cache_().get(key); if (hit) return JSON.parse(hit); } catch (e) {}
  var who = verifyToken_(idToken, clientId);
  if (who.ok) try { cache_().put(key, JSON.stringify(who), 1800); } catch (e) {}
  return who;
}
function authenticate_(body, settings) {
  if (body.session) {
    var s = verifySession_(body.session);
    if (s.ok || !body.idToken) return s;
  }
  var who = verifyTokenCached_(body.idToken, settings.CLIENT_ID);
  if (who.ok) who.newSession = true;
  return who;
}
/** Admin: sign everyone out (e.g. after a role change that must apply immediately everywhere). */
function revokeSessions_(ctx) {
  PropertiesService.getScriptProperties().setProperty('SESSION_EPOCH', String(Date.now()));
  editLog_(ctx.user.email, 'signed out all sessions');
  return { ok: true };
}

/* ================================================================== 3. sales teams + bulk dealer assignment */

TAB.teams = 'SalesTeams';
H.teams = ['Team ID', 'Team name', 'Lead', 'Members', 'Dealer IDs', 'Active', 'Updated by', 'Updated on'];

function teamRows_() {
  if (!ss_().getSheetByName(TAB.teams)) return [];
  return rows_(TAB.teams).filter(function (r) { return r['Team ID']; }).map(function (r) {
    return { id: String(r['Team ID']).trim(), name: String(r['Team name'] || ''), lead: normEmail_(r['Lead']), members: splitEmails_(r['Members']),
      dealers: String(r['Dealer IDs'] || '').split(/[\s,;]+/).map(function (x) { return x.trim(); }).filter(Boolean), active: !/^n/i.test(String(r['Active'] || 'Y')) };
  });
}
function teamsOf_(email) { return teamRows_().filter(function (t) { return t.active && (t.members.indexOf(email) >= 0 || t.lead === email); }); }
/** How this user reaches dealer d: 'all' | 'direct' | 'group' | 'team:<name>' | '' (no access). */
function accessVia_(user, d, teams) {
  if (user.role === 'admin') return 'all';
  if (!d.active) return '';
  if (ALL_DEALERS[user.role]) return 'all';
  if (d.emails.indexOf(user.email) >= 0) return 'direct';
  teams = teams || teamsOf_(user.email);
  for (var i = 0; i < teams.length; i++) if (teams[i].dealers.indexOf(d.id) >= 0) return 'team:' + teams[i].name;
  if (user.role === 'sm' && user.group && d.group === user.group) return 'group';
  return '';
}
function saveTeam_(ctx) {
  var t = ctx.body.team || {}, name = String(t.name || '').trim().slice(0, 80);
  if (!name) return { ok: false, error: 'bad_request', detail: 'Give the team a name.' };
  var known = {}; rows_(TAB.allow).forEach(function (r) { if (r['Email']) known[normEmail_(r['Email'])] = 1; });
  var members = splitEmails_((t.members || []).join(',')).filter(function (e) { return known[e]; });
  var lead = normEmail_(t.lead); if (lead && !known[lead]) lead = '';
  var dids = {}; dealerRows_().forEach(function (d) { dids[d.id] = 1; });
  var dealers = (t.dealers || []).map(String).filter(function (x) { return dids[x]; });
  var lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var sh = ensureTab_(TAB.teams, H.teams), v = sh.getDataRange().getValues(), at = -1, id = String(t.id || '');
    for (var i = 1; i < v.length; i++) if (id && String(v[i][0]) === id) at = i;
    if (at < 0) id = 'T-' + ('000' + v.length).slice(-3) + '-' + Utilities.getUuid().slice(0, 4);
    var row = [id, name, lead, members.join(', '), dealers.join(', '), t.active === false ? 'N' : 'Y', ctx.user.email, new Date()];
    if (at > 0) sh.getRange(at + 1, 1, 1, row.length).setValues([row]); else sh.getRange(v.length + 1, 1, 1, row.length).setValues([row]);
  } finally { lock.releaseLock(); }
  editLog_(ctx.user.email, 'team ' + name + ': ' + members.length + ' people, ' + dealers.length + ' dealers', { id: id, members: members, dealers: dealers, lead: lead });
  return { ok: true, id: id, teams: teamRows_() };
}
function deleteTeam_(ctx) {
  var id = String(ctx.body.id || ''), sh = ss_().getSheetByName(TAB.teams);
  if (!sh || !id) return { ok: false, error: 'not_found' };
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) { sh.deleteRow(i + 1); editLog_(ctx.user.email, 'deleted team ' + v[i][1]); return { ok: true, teams: teamRows_() }; }
  return { ok: false, error: 'not_found' };
}
/** Bulk direct assignment: add/remove one person on many dealer pages in one write. */
function assignDealers_(ctx) {
  var b = ctx.body, email = normEmail_(b.email);
  if (!email) return { ok: false, error: 'bad_request' };
  var add = {}, rem = {}; (b.add || []).forEach(function (x) { add[String(x)] = 1; }); (b.remove || []).forEach(function (x) { rem[String(x)] = 1; });
  var lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  var changed = 0;
  try {
    var sh = sheet_(TAB.dealers), v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
    var ci = h.indexOf('Dealer ID'), ce = h.indexOf('Assigned emails'), cu = h.indexOf('Updated by'), co = h.indexOf('Updated on');
    if (ci < 0 || ce < 0) return { ok: false, error: 'server_error', detail: 'Dealers tab is missing columns.' };
    var now = new Date();
    for (var i = 1; i < v.length; i++) {
      var id = String(v[i][ci]).trim(); if (!id || (!add[id] && !rem[id])) continue;
      var list = splitEmails_(v[i][ce]), has = list.indexOf(email) >= 0;
      if (add[id] && !has) list.push(email); else if (rem[id] && has) list = list.filter(function (e) { return e !== email; }); else continue;
      v[i][ce] = list.join(', '); if (cu >= 0) v[i][cu] = ctx.user.email; if (co >= 0) v[i][co] = now; changed++;
    }
    if (changed) sh.getRange(1, 1, v.length, v[0].length).setValues(v);
    var known = rows_(TAB.allow).some(function (r) { return normEmail_(r['Email']) === email; });
    if (!known && Object.keys(add).length) sheet_(TAB.allow).appendRow([email, '', 'cso', 'Y', ctx.user.email, now, '']);
  } finally { lock.releaseLock(); }
  editLog_(ctx.user.email, 'dealer access for ' + email + ': +' + Object.keys(add).length + ' −' + Object.keys(rem).length, { add: Object.keys(add), remove: Object.keys(rem) });
  return { ok: true, changed: changed };
}

/* ================================================================== 4. quotation templates */

TAB.tpl = 'QuoteTemplates';
H.tpl = ['Template ID', 'Owner', 'Name', 'Default', 'Config', 'Updated on'];

function tplRows_() {
  if (!ss_().getSheetByName(TAB.tpl)) return [];
  return rows_(TAB.tpl).filter(function (r) { return r['Template ID']; }).map(function (r) {
    return { id: String(r['Template ID']), owner: normEmail_(r['Owner']) || '*', name: String(r['Name'] || ''), isDefault: /^y/i.test(String(r['Default'] || '')),
      config: parseJson_(r['Config'], {}), updated: r['Updated on'] instanceof Date ? r['Updated on'].toISOString() : String(r['Updated on'] || '') };
  });
}
function listTemplates_(ctx) {
  var me = ctx.user.email, all = tplRows_();
  return { company: all.filter(function (t) { return t.owner === '*'; }), mine: all.filter(function (t) { return t.owner === me; }) };
}
function saveTemplate_(ctx) {
  if (!CAN_QUOTE[ctx.user.role]) return { ok: false, error: 'not_allowed_here' };
  var t = ctx.body.template || {}, master = !!t.master;
  if (master && !ctx.isAdmin) return { ok: false, error: 'admin_only' };
  var name = String(t.name || '').trim().slice(0, 60) || 'My template', cfg = JSON.stringify(t.config || {});
  if (cfg.length > 45000) return { ok: false, error: 'bad_request', detail: 'Template is too large (logos must be links, not pasted images).' };
  var owner = master ? '*' : ctx.user.email;
  var lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  var id;
  try {
    var sh = ensureTab_(TAB.tpl, H.tpl), v = sh.getDataRange().getValues(), at = -1; id = String(t.id || '');
    for (var i = 1; i < v.length; i++) if (id && String(v[i][0]) === id) {
      var o = normEmail_(v[i][1]) || '*';
      if (o !== owner) return { ok: false, error: 'not_allowed_here', detail: 'You can only edit your own templates. Duplicate it first.' };
      at = i;
    }
    if (at < 0) id = (master ? 'TC-' : 'TU-') + Utilities.getUuid().slice(0, 8);
    if (t.isDefault) for (var j = 1; j < v.length; j++) if ((normEmail_(v[j][1]) || '*') === owner && String(v[j][0]) !== id && /^y/i.test(String(v[j][3]))) sh.getRange(j + 1, 4).setValue('N');
    var row = [id, owner, name, t.isDefault ? 'Y' : 'N', cfg, new Date()];
    if (at > 0) sh.getRange(at + 1, 1, 1, row.length).setValues([row]); else sh.getRange(v.length + 1, 1, 1, row.length).setValues([row]);
  } finally { lock.releaseLock(); }
  return merge_({ ok: true, id: id }, listTemplates_(ctx));
}
function deleteTemplate_(ctx) {
  var id = String(ctx.body.id || ''), sh = ss_().getSheetByName(TAB.tpl);
  if (!sh) return { ok: false, error: 'not_found' };
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) {
    var o = normEmail_(v[i][1]) || '*';
    if (!(o === ctx.user.email || (o === '*' && ctx.isAdmin))) return { ok: false, error: 'not_allowed_here' };
    sh.deleteRow(i + 1); return merge_({ ok: true }, listTemplates_(ctx));
  }
  return { ok: false, error: 'not_found' };
}

/* ================================================================== 5. quotation pipeline */

H.pipes = ['ID', 'Created', 'Email', 'Name', 'Role', 'Customer', 'Dealer ID', 'Dealer name', 'Price basis', 'Lines', 'Units', 'Total', 'Note', 'Page', 'Idempotency key',
  'Client key', 'Last activity', 'Status', 'Type', 'Source', 'Template', 'Items', 'Group', 'Team', 'Exports', 'Guest ref', 'Lines hash'];
TAB.pevents = 'PipeEvents';
H.pevents = ['Event ID', 'Quote ID', 'When', 'Email', 'Name', 'Action', 'Format', 'Detail', 'Idempotency key'];
var PIPE_STATUSES = ['Draft', 'Quoted', 'Follow-up', 'Negotiation', 'Won', 'Lost', 'Cancelled'];
var PIPE_ACTIONS = { created: 'Created', save: 'Saved', table: 'Copied email table', text: 'Copied Viber text', image: 'Saved image', xlsx: 'Exported Excel', pdf: 'Exported PDF',
  special: 'Exported Special Price template', 'special-pdf': 'Exported Special Price PDF', copy: 'Copied table', revise: 'Revised', duplicate: 'Duplicated', status: 'Status change', note: 'Note' };
var EXPORT_ACTIONS = { table: 1, text: 1, image: 1, xlsx: 1, pdf: 1, special: 1, 'special-pdf': 1, copy: 1 };

function cleanLines_(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 150).map(function (l) {
    return { sku: HXPricing.baseSku(l.sku || ''), desc: String(l.desc || '').slice(0, 140), cat: String(l.cat || '').slice(0, 40), qty: Math.max(1, Math.min(100000, Math.round(Number(l.qty) || 1))),
      price: HXPricing.num(l.price), reg: HXPricing.num(l.reg), basis: String(l.basis || '').slice(0, 20) };
  }).filter(function (l) { return l.sku; });
}
function linesHash_(lines) {
  return b64u_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(lines.map(function (l) { return [l.sku, l.qty, l.price]; })))).slice(0, 16);
}
function seenIdem_(idem) {
  if (!idem) return false;
  var k = 'idem:' + idem;
  try { if (cache_().get(k)) return true; cache_().put(k, '1', 21600); } catch (e) {}
  return false;
}
function newPipeId_() {
  var props = PropertiesService.getScriptProperties(), dk = 'PIPE_' + Utilities.formatDate(new Date(), 'Asia/Manila', 'yyMMdd'), n = Number(props.getProperty(dk) || 0) + 1;
  props.setProperty(dk, String(n));
  return 'P' + dk.slice(5) + '-' + ('00' + n).slice(-3);
}
/** Creates the quotation on first contact (by client key), then appends activity. Repeat exports add events, never value. */
function recordPipe_(actor, b) {
  var action = PIPE_ACTIONS[b.act] && b.act !== 'status' && b.act !== 'note' ? String(b.act) : 'table';
  var lines = cleanLines_(b.lines);
  if (!lines.length) return { ok: false, error: 'bad_request', detail: 'The quote is empty.' };
  var key = String(b.quoteKey || '').replace(/[^\w\-]/g, '').slice(0, 40), idem = String(b.idem || '').slice(0, 60);
  if (idem && seenIdem_(idem + ':' + actor.email)) return { ok: true, duplicate: true, id: String(b.knownId || '') };
  var units = 0, total = 0; lines.forEach(function (l) { units += l.qty; if (l.price != null) total += l.qty * l.price; });
  total = Math.round(total * 100) / 100;
  var hash = linesHash_(lines), now = new Date(), events = [], id, created = false;
  var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var sh = ensureTab_(TAB.pipes, H.pipes), v = sh.getDataRange().getValues(), C = {}; H.pipes.forEach(function (k, i) { C[k] = i; });
    var at = -1;
    if (key) for (var i = v.length - 1; i >= 1 && i >= v.length - 3000; i--) {
      if (String(v[i][C['Client key']]) === key && (normEmail_(v[i][C['Email']]) === actor.email || (actor.guest && String(v[i][C['Guest ref']]) === actor.guestRef))) { at = i; break; }
    }
    var exports = {}, row;
    if (at < 0) {
      id = newPipeId_(); created = true;
      row = new Array(H.pipes.length); for (var z = 0; z < row.length; z++) row[z] = '';
      row[C['ID']] = id; row[C['Created']] = now; row[C['Email']] = actor.guest ? '' : actor.email; row[C['Name']] = actor.guest ? 'Guest' : actor.name; row[C['Role']] = actor.guest ? 'guest' : actor.role;
      row[C['Status']] = EXPORT_ACTIONS[action] ? 'Quoted' : 'Draft'; row[C['Group']] = actor.group || ''; row[C['Team']] = actor.team || ''; row[C['Guest ref']] = actor.guestRef || '';
      row[C['Client key']] = key; row[C['Idempotency key']] = idem;
      events.push([id, now, actor, 'created', '', b.type === 'special' ? 'Special price quotation' : '']);
    } else {
      row = v[at].slice(0, H.pipes.length); while (row.length < H.pipes.length) row.push('');
      id = String(row[C['ID']]);
      String(row[C['Exports']] || '').split(',').forEach(function (x) { if (x) exports[x] = 1; });
      if (String(row[C['Lines hash']]) && String(row[C['Lines hash']]) !== hash) events.push([id, now, actor, 'revise', '', units + ' units · ₱' + total]);
      if (EXPORT_ACTIONS[action] && (!row[C['Status']] || row[C['Status']] === 'Draft')) row[C['Status']] = 'Quoted';
    }
    if (action !== 'created') events.push([id, now, actor, action, String(b.format || ''), String(b.detail || '').slice(0, 200)]);
    if (EXPORT_ACTIONS[action]) exports[action] = 1;
    row[C['Customer']] = String(b.customer || row[C['Customer']] || '').slice(0, 120);
    if (b.dealerId !== undefined) { row[C['Dealer ID']] = String(b.dealerId || ''); row[C['Dealer name']] = String(b.dealerName || ''); }
    row[C['Price basis']] = String(b.basis || row[C['Price basis']] || '').slice(0, 30);
    row[C['Lines']] = JSON.stringify(lines); row[C['Units']] = units; row[C['Total']] = total; row[C['Items']] = lines.length; row[C['Lines hash']] = hash;
    row[C['Note']] = String(b.note != null ? b.note : row[C['Note']] || '').slice(0, 300); row[C['Page']] = String(b.page || row[C['Page']] || '').slice(0, 40);
    row[C['Last activity']] = now; row[C['Type']] = String(b.type || row[C['Type']] || 'standard').slice(0, 20); row[C['Source']] = String(b.source || row[C['Source']] || 'cart').slice(0, 30);
    if (b.template) row[C['Template']] = String(b.template).slice(0, 60);
    row[C['Exports']] = Object.keys(exports).join(',');
    if (at < 0) sh.getRange(v.length + 1, 1, 1, row.length).setValues([row]); else sh.getRange(at + 1, 1, 1, row.length).setValues([row]);
    appendEvents_(events, idem);
  } finally { lock.releaseLock(); }
  return { ok: true, id: id, created: created };
}
function appendEvents_(events, idem) {
  if (!events.length) return;
  var sh = ensureTab_(TAB.pevents, H.pevents), start = sh.getLastRow() + 1;
  var rows = events.map(function (e, i) { var a = e[2]; return ['E' + Date.now().toString(36) + i, e[0], e[1], a.guest ? '' : a.email, a.guest ? 'Guest' : a.name, e[3], e[4] || '', e[5] || '', i === events.length - 1 ? idem || '' : '']; });
  sh.getRange(start, 1, rows.length, H.pevents.length).setValues(rows);
}
function actorOf_(ctx) {
  var teams = teamsOf_(ctx.user.email);
  return { email: ctx.user.email, name: ctx.user.name, role: ctx.user.role, group: ctx.user.group || '', team: teams.map(function (t) { return t.name; }).join(', ') };
}
function logPipe_(ctx) {
  if (!INTERNAL[ctx.user.role]) return { ok: false, error: 'not_allowed_here' };
  var b = ctx.body, dealerId = String(b.dealerId || '');
  if (dealerId) {
    var d = dealerRows_().filter(function (x) { return x.id === dealerId; })[0];
    if (!d || !canSeeDealer_(ctx.user, d)) return { ok: false, error: 'dealer_not_allowed' };
    b.dealerName = d.name;
  }
  return recordPipe_(actorOf_(ctx), b);
}
/** Public quote cart, no sign-in. Prices are re-read from the public feed (SRP/DP only); nothing restricted is accepted or stored. */
function guestLog_(body) {
  var ref = String(body.guestRef || '').replace(/[^\w\-]/g, '').slice(0, 40);
  if (ref.length < 12) return { ok: false, error: 'bad_request' };
  var c = cache_(), mk = 'gl:' + ref, gk = 'gl:all:' + Math.floor(Date.now() / 60000);
  var mine = Number(c.get(mk) || 0), all = Number(c.get(gk) || 0);
  if (mine >= 40 || all >= 150) return { ok: false, error: 'rate_limited' };
  c.put(mk, String(mine + 1), 900); c.put(gk, String(all + 1), 120);
  var pub = publicData_(), basis = body.basis === 'dp' ? 'dp' : 'srp';
  var lines = cleanLines_(body.lines).map(function (l) { var p = pub.prices && pub.prices[l.sku]; l.price = p ? (basis === 'dp' ? p.dp : p.srp) : null; l.reg = null; l.basis = basis; return l; })
    .filter(function (l) { return l.price != null; });
  if (!lines.length) return { ok: false, error: 'bad_request' };
  var b = { quoteKey: body.quoteKey, idem: body.idem, act: EXPORT_ACTIONS[body.act] ? body.act : 'table', format: body.format, lines: lines, basis: basis.toUpperCase(),
    customer: String(body.customer || '').slice(0, 80), type: 'guest', source: 'public', page: body.page };
  return recordPipe_({ guest: true, guestRef: ref, email: 'guest:' + ref, name: 'Guest', role: 'guest' }, b);
}

/* ---------- reading the pipeline */
function pipeScope_(ctx) {
  var u = ctx.user;
  if (ctx.isAdmin || u.role === 'csomgr') return { all: true };
  var emails = {}; emails[u.email] = 1;
  if (u.role === 'sm') {
    if (u.group) rows_(TAB.allow).forEach(function (r) { if (normGroup_(r['Group']) === u.group) emails[normEmail_(r['Email'])] = 1; });
    teamsOf_(u.email).forEach(function (t) { t.members.forEach(function (e) { emails[e] = 1; }); if (t.lead) emails[t.lead] = 1; });
  }
  return { all: false, emails: emails };
}
function pipeRecords_(ctx) {
  if (!ss_().getSheetByName(TAB.pipes)) return [];
  var scope = pipeScope_(ctx), v = sheetValues_(TAB.pipes); if (v.length < 2) return [];
  var h = v[0].map(function (x) { return String(x).trim(); }), C = {}; h.forEach(function (k, i) { C[k] = i; });
  var g = function (r, k) { return C[k] == null ? '' : r[C[k]]; };
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i]; if (!g(r, 'ID')) continue;
    var email = normEmail_(g(r, 'Email')), role = String(g(r, 'Role') || '');
    if (!scope.all && !scope.emails[email]) continue;
    var cr = g(r, 'Created'), la = g(r, 'Last activity'); cr = cr instanceof Date ? cr : new Date(cr); la = la instanceof Date ? la : (la ? new Date(la) : cr);
    var lines = parseJson_(g(r, 'Lines'), []);
    out.push({ id: String(g(r, 'ID')), created: isNaN(cr) ? '' : cr.toISOString(), last: isNaN(la) ? '' : la.toISOString(), email: email, name: String(g(r, 'Name') || (role === 'guest' ? 'Guest' : '')),
      role: role || 'sales', guest: role === 'guest', customer: String(g(r, 'Customer') || ''), dealerId: String(g(r, 'Dealer ID') || ''), dealer: String(g(r, 'Dealer name') || ''),
      basis: String(g(r, 'Price basis') || ''), units: Number(g(r, 'Units')) || 0, total: Number(g(r, 'Total')) || 0, items: Number(g(r, 'Items')) || lines.length,
      status: String(g(r, 'Status') || 'Quoted'), type: String(g(r, 'Type') || 'standard'), source: String(g(r, 'Source') || 'cart'), template: String(g(r, 'Template') || ''),
      group: String(g(r, 'Group') || ''), team: String(g(r, 'Team') || ''), exports: String(g(r, 'Exports') || '').split(',').filter(Boolean), note: String(g(r, 'Note') || ''),
      skus: lines.map(function (l) { return l.sku; }), cats: lines.map(function (l) { return l.cat || ''; }), lines: lines });
  }
  return out;
}
function filterPipes_(list, f) {
  f = f || {};
  var q = String(f.q || '').toLowerCase().trim(), from = f.from ? new Date(f.from + 'T00:00:00+08:00').getTime() : 0, to = f.to ? new Date(f.to + 'T23:59:59+08:00').getTime() : 0;
  var minV = f.minVal === '' || f.minVal == null ? null : Number(f.minVal), maxV = f.maxVal === '' || f.maxVal == null ? null : Number(f.maxVal);
  var sku = String(f.sku || '').toUpperCase().trim(), cat = String(f.cat || '').toLowerCase();
  return list.filter(function (p) {
    var t = new Date(p.created).getTime();
    if (from && t < from) return false; if (to && t > to) return false;
    if (f.user && p.email !== f.user && !(f.user === 'guest' && p.guest)) return false;
    if (f.role && p.role !== f.role) return false;
    if (f.group && p.group !== f.group) return false;
    if (f.team && (p.team || '').split(', ').indexOf(f.team) < 0) return false;
    if (f.dealer && p.dealerId !== f.dealer) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.type && p.type !== f.type) return false;
    if (f.exportType && p.exports.indexOf(f.exportType) < 0) return false;
    if (f.who === 'guest' && !p.guest) return false; if (f.who === 'auth' && p.guest) return false;
    if (sku && !p.skus.some(function (s) { return s.indexOf(sku) >= 0; })) return false;
    if (cat && !p.cats.some(function (c) { return String(c).toLowerCase() === cat; })) return false;
    if (minV != null && p.total < minV) return false; if (maxV != null && p.total > maxV) return false;
    if (q && (p.id + ' ' + p.name + ' ' + p.email + ' ' + p.customer + ' ' + p.dealer + ' ' + p.skus.join(' ') + ' ' + p.note).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
}
function listPipes_(ctx) {
  if (!INTERNAL[ctx.user.role]) return { ok: false, error: 'not_allowed_here' };
  var b = ctx.body, f = b.filters || {}, list = filterPipes_(pipeRecords_(ctx), f);
  var sort = String(b.sort || 'last'), dir = b.dir === 'asc' ? 1 : -1;
  var key = { last: 'last', created: 'created', total: 'total', items: 'items', name: 'name', status: 'status', dealer: 'dealer' }[sort] || 'last';
  list.sort(function (a, z) { var x = a[key], y = z[key]; return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  var size = Math.max(10, Math.min(b.export && ctx.isAdmin ? 5000 : 100, Number(b.size) || 25)), page = Math.max(1, Number(b.page) || 1);
  var rows = list.slice((page - 1) * size, page * size).map(function (p) {
    var o = {}; for (var k in p) if (k !== 'lines' && k !== 'cats') o[k] = p[k];
    o.preview = p.lines.slice(0, 3).map(function (l) { return l.sku + ' ×' + l.qty; }).join(', ');
    if (b.export) o.lines = p.lines;
    return o;
  });
  var people = {}, dealers = {}, teams = {};
  pipeRecords_(ctx).forEach(function (p) { if (!p.guest) people[p.email] = p.name || p.email; if (p.dealerId) dealers[p.dealerId] = p.dealer; (p.team || '').split(', ').forEach(function (t) { if (t) teams[t] = 1; }); });
  return { rows: rows, total: list.length, page: page, size: size, statuses: PIPE_STATUSES, actions: PIPE_ACTIONS,
    facets: { people: people, dealers: dealers, teams: Object.keys(teams).sort() }, canExport: ctx.isAdmin };
}
function pipeDetail_(ctx) {
  if (!INTERNAL[ctx.user.role]) return { ok: false, error: 'not_allowed_here' };
  var id = String(ctx.body.id || ''), p = pipeRecords_(ctx).filter(function (x) { return x.id === id; })[0];
  if (!p) return { ok: false, error: 'not_found' };
  var ev = ss_().getSheetByName(TAB.pevents) ? rows_(TAB.pevents).filter(function (r) { return String(r['Quote ID']) === id; }).map(function (r) {
    var w = r['When'] instanceof Date ? r['When'] : new Date(r['When']);
    return { when: isNaN(w) ? '' : w.toISOString(), email: normEmail_(r['Email']), name: String(r['Name'] || ''), action: String(r['Action'] || ''), label: PIPE_ACTIONS[r['Action']] || String(r['Action'] || ''), format: String(r['Format'] || ''), detail: String(r['Detail'] || '') };
  }) : [];
  return { quote: p, events: ev, canEdit: canEditPipe_(ctx, p) };
}
function canEditPipe_(ctx, p) {
  if (ctx.isAdmin || ctx.user.role === 'csomgr') return true;
  if (!p.guest && p.email === ctx.user.email) return true;
  return ctx.user.role === 'sm' && !p.guest && !!pipeScope_(ctx).emails[p.email];
}
function setPipeStatus_(ctx) {
  if (!INTERNAL[ctx.user.role]) return { ok: false, error: 'not_allowed_here' };
  var b = ctx.body, id = String(b.id || ''), st = String(b.status || ''), note = String(b.note || '').slice(0, 300);
  if (st && PIPE_STATUSES.indexOf(st) < 0) return { ok: false, error: 'bad_request' };
  CACHE_OFF_ = true; MEMO_ = {};
  var p = pipeRecords_(ctx).filter(function (x) { return x.id === id; })[0];
  if (!p) return { ok: false, error: 'not_found' };
  if (!canEditPipe_(ctx, p)) return { ok: false, error: 'not_allowed_here' };
  var lock = LockService.getScriptLock(); if (!lock.tryLock(15000)) return { ok: false, error: 'busy' };
  try {
    var sh = ensureTab_(TAB.pipes, H.pipes), v = sh.getDataRange().getValues(), cs = H.pipes.indexOf('Status'), cl = H.pipes.indexOf('Last activity');
    for (var i = 1; i < v.length; i++) if (String(v[i][0]) === id) {
      var from = String(v[i][cs] || 'Quoted');
      if (st) sh.getRange(i + 1, cs + 1).setValue(st);
      sh.getRange(i + 1, cl + 1).setValue(new Date());
      appendEvents_([[id, new Date(), actorOf_(ctx), st ? 'status' : 'note', '', (st ? from + ' → ' + st : '') + (note ? (st ? ' · ' : '') + note : '')]], '');
      break;
    }
  } finally { lock.releaseLock(); }
  return { ok: true };
}
function pipeStats_(ctx) {
  if (!INTERNAL[ctx.user.role]) return { ok: false, error: 'not_allowed_here' };
  var list = filterPipes_(pipeRecords_(ctx), ctx.body.filters || {});
  var won = { Won: 1 }, closed = { Won: 1, Lost: 1, Cancelled: 1 };
  var s = { quotes: list.length, exported: 0, quoted: 0, open: 0, wonValue: 0, wonCount: 0, lostCount: 0, guest: 0, auth: 0, special: 0, byRep: {}, byTeam: {}, bySku: {}, byDealer: {}, byDay: {}, byStatus: {} };
  list.forEach(function (p) {
    s.quoted += p.total; if (p.exports.length) s.exported++;
    if (!closed[p.status]) s.open += p.total;
    if (won[p.status]) { s.wonValue += p.total; s.wonCount++; } if (p.status === 'Lost') s.lostCount++;
    if (p.guest) s.guest++; else s.auth++;
    if (p.type === 'special' || p.exports.indexOf('special') >= 0 || p.exports.indexOf('special-pdf') >= 0) s.special++;
    var rep = p.guest ? 'Guest' : (p.name || p.email); var r = s.byRep[rep] = s.byRep[rep] || { n: 0, v: 0 }; r.n++; r.v += p.total;
    (p.team || '').split(', ').forEach(function (t) { if (!t) return; var x = s.byTeam[t] = s.byTeam[t] || { n: 0, v: 0 }; x.n++; x.v += p.total; });
    if (p.dealer) { var d = s.byDealer[p.dealer] = s.byDealer[p.dealer] || { n: 0, v: 0 }; d.n++; d.v += p.total; }
    p.lines.forEach(function (l) { var k = s.bySku[l.sku] = s.bySku[l.sku] || { n: 0, qty: 0, desc: l.desc }; k.n++; k.qty += l.qty; });
    var day = p.created ? Utilities.formatDate(new Date(p.created), 'Asia/Manila', 'yyyy-MM-dd') : ''; if (day) { var y = s.byDay[day] = s.byDay[day] || { n: 0, v: 0 }; y.n++; y.v += p.total; }
    s.byStatus[p.status] = (s.byStatus[p.status] || 0) + 1;
  });
  s.avg = list.length ? s.quoted / list.length : 0;
  var decided = s.wonCount + s.lostCount; s.conversion = decided >= 5 ? s.wonCount / decided : null;   // only when there is enough confirmed outcome data
  var top = function (o, k, n) { return Object.keys(o).map(function (x) { var r = o[x]; r.key = x; return r; }).sort(function (a, b) { return b[k] - a[k]; }).slice(0, n); };
  s.byRep = top(s.byRep, 'n', 12); s.byTeam = top(s.byTeam, 'n', 12); s.byDealer = top(s.byDealer, 'n', 10); s.bySku = top(s.bySku, 'n', 10);
  return { stats: s };
}

/* ================================================================== router extension */

/** Actions added by this layer. Returns undefined when the action is not ours. */
function platformRoute_(action, ctx) {
  var admin = ctx.isAdmin;
  switch (action) {
    case 'session': return { session: true };
    case 'templates': return listTemplates_(ctx);
    case 'saveTemplate': return saveTemplate_(ctx);
    case 'deleteTemplate': return deleteTemplate_(ctx);
    case 'pipe': return pipeDetail_(ctx);
    case 'pipeStats': return pipeStats_(ctx);
    case 'setPipeStatus': return setPipeStatus_(ctx);
    case 'saveTeam': return admin ? saveTeam_(ctx) : { ok: false, error: 'admin_only' };
    case 'deleteTeam': return admin ? deleteTeam_(ctx) : { ok: false, error: 'admin_only' };
    case 'assignDealers': return admin ? assignDealers_(ctx) : { ok: false, error: 'admin_only' };
    case 'revokeSessions': return admin ? revokeSessions_(ctx) : { ok: false, error: 'admin_only' };
  }
  return undefined;
}

/* ================================================================== measurement (run from the Apps Script editor; not reachable from the web) */
/** Times the main read requests as the owner account: cold (cache just invalidated) then warm (cache filled). See View → Logs. */
function perfProbe() {
  var who = { email: String(Session.getEffectiveUser().getEmail()).toLowerCase(), name: 'perf probe' }, sess = issueSession_(who).token, out = [];
  var d0 = dealerRows_().filter(function (d) { return d.active; })[0];
  var actions = ['whoami', 'prices', 'dealer', 'admin', 'pipes', 'pipeStats', 'templates'];
  function pass(label) {
    actions.forEach(function (a) {
      SS_ = null; MEMO_ = {}; CACHE_OFF_ = false; VER_ = null;
      var t = Date.now(), r = route_({ action: a, session: sess, page: 'probe', dealerId: d0 ? d0.id : '' });
      out.push(label + ' ' + a + ': ' + (Date.now() - t) + ' ms' + (r && r.ok === false ? ' (' + r.error + ')' : ''));
    });
  }
  bumpVer_(); pass('cold'); pass('warm'); pass('warm');
  Logger.log(out.join('\n'));
  return out.join('\n');
}
