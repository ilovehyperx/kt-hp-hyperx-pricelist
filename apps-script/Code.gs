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
function ss_() { return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive(); }

var TAB = {
  settings: 'Settings', allow: 'Allowlist', rules: 'MarginRules', pricing: 'Pricing', rebate: 'Rebate',
  sellout: 'SellOut', dealers: 'Dealers', dprices: 'DealerPrices', log: 'AccessLog', edits: 'EditLog'
};
var H = {
  allow: ['Email', 'Name', 'Role', 'Active', 'Updated by', 'Updated on'],
  rules: ['Category', 'Segment', 'DP margin', 'DP rounding', 'Threshold margin', 'Threshold rounding', 'Limited below'],
  pricing: ['SKU', 'Material', 'Description', 'Category', 'New', 'Release date', 'OPG added', 'NDP', 'SRP', 'DP override', 'Threshold override', 'On hand', 'MOQ', 'Active'],
  rebate: ['Deal', 'Program', 'SKU', 'Description', 'Max Qty', 'Rebate per unit', 'Start', 'End'],
  sellout: ['Txn Date', 'Your Customer Name', 'Txn Doc ID', 'HP Product ID', 'Ship Out Quantity'],
  dealers: ['Dealer ID', 'Dealer name', 'Customer code', 'HP Partner ID', 'HP lead', 'CSO manager', 'Favorite', 'Assigned emails', 'Valid until', 'Note', 'Active', 'Updated by', 'Updated on'],
  dprices: ['Dealer ID', 'SKU', 'Special price', 'Qty cap', 'Note'],
  log: ['Timestamp', 'Email', 'Name', 'Role', 'Result', 'Page'],
  edits: ['Timestamp', 'Email', 'Summary', 'Details']
};
var ROLES = ['admin', 'csomgr', 'sales', 'csa', 'cso', 'hplead', 'dealer'];
/* Capability matrix (server-side; the UI only mirrors it):
 *  admin  : everything, incl. cost/margin
 *  csomgr : sales prices, every active dealer page, quotes for any dealer, sees all quotes (no cost)
 *  sales / csa : sales prices, every active dealer page, quotes for any active dealer (own history)
 *  cso    : only assigned dealer pages; quotes for assigned dealers (own history)
 *  hplead : only assigned dealer pages, view only (no quotes) until permissions are defined
 *  dealer : only its own assigned dealer page, read-only, stock as levels only, no quotes
 */
var ALL_DEALERS = { admin: 1, csomgr: 1, sales: 1, csa: 1 };
var CAN_QUOTE = { admin: 1, csomgr: 1, sales: 1, csa: 1, cso: 1 };
var SEES_SALES = { admin: 1, csomgr: 1, sales: 1, csa: 1 };
H.quotes = ['Quote ID', 'Created', 'Email', 'Name', 'Role', 'Dealer ID', 'Dealer name', 'Source', 'Status', 'Lines', 'Total', 'Note', 'Idempotency key'];
H.qlines = ['Quote ID', 'Line', 'SKU', 'Description', 'Qty', 'SRP', 'Regular DP', 'SP', 'Line total', 'Price source'];
TAB.quotes = 'Quotes'; TAB.qlines = 'QuoteLines';
var EDITABLE_SETTINGS = ['MIN_MARGIN', 'NEW_DAYS', 'SALES_NOTE', 'DEALER_NOTE', 'PRICES_AS_OF'];

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
    prices[s] = { srp: p.srp, dp: p.dp };
    if (p.onHand != null) levels[s] = p.onHand <= 0 ? 'out' : p.onHand <= very ? 'very' : p.onHand < lim ? 'limited' : 'ok';
  });
  var out = { ok: true, updated: new Date().toISOString(), pricesAsOf: settings.PRICES_AS_OF || '', source: 'HyperX Sales Pricing sheet', prices: prices, levels: levels };
  try { cache.put('public_v1', JSON.stringify(out), 300); } catch (err) {}
  return out;
}
function bustPublic_() { try { CacheService.getScriptCache().remove('public_v1'); } catch (err) {} }

function route_(body) {
  var settings = readSettings_();
  var action = String(body.action || 'prices');
  var who = verifyToken_(body.idToken, settings.CLIENT_ID);
  if (!who.ok) { log_(who.email || '', '', '', action + ' rejected: ' + who.error, body.page); return { ok: false, error: who.error }; }
  var m = findMember_(who.email);
  if (!m) { log_(who.email, who.name, '', action + ' · not on allowlist', body.page); return { ok: false, error: 'not_allowed', email: who.email }; }
  var user = { email: who.email, name: m.name || who.name, role: m.role, picture: who.picture || '' };
  var isAdmin = m.role === 'admin';
  var ctx = { settings: settings, user: user, isAdmin: isAdmin, body: body };
  var adminOnly = { editor: 1, save: 1, admin: 1, saveUsers: 1, saveDealer: 1, setFavorite: 1, uploadSellout: 1, uploadStock: 1, uploadRebate: 1, saveSettings: 1 };
  if (adminOnly[action] && !isAdmin) { log_(who.email, user.name, m.role, action + ' denied (not admin)', body.page); return { ok: false, error: 'admin_only', user: user }; }

  var out;
  switch (action) {
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
    case 'setFavorite': out = setFavorite_(ctx); break;
    case 'uploadSellout': out = uploadSellout_(ctx); break;
    case 'uploadStock': out = uploadStock_(ctx); break;
    case 'uploadRebate': out = uploadRebate_(ctx); break;
    case 'saveSettings': out = saveSettings_(ctx); break;
    case 'createQuote': out = createQuote_(ctx); break;
    case 'quotes': out = listQuotes_(ctx); break;
    default: out = { ok: false, error: 'unknown_action' };
  }
  log_(who.email, user.name, m.role, action + (out && out.ok === false ? ' · ' + out.error : '') + (body.dealerId ? ' ' + body.dealerId : ''), body.page);
  if (out && out.ok !== false) { out.ok = true; out.user = user; out.can = caps_(user); }
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
      return { name: r['Name'] || '', role: ROLES.indexOf(role) >= 0 ? role : 'sales' };
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
      onHand: r['On hand'], moq: r['MOQ'], active: !/^n/i.test(String(r['Active'] || 'Y')) };
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
    p.active = it.active; p.moq = HXPricing.num(it.moq); p.material = it.material;
    priced[it.sku] = p; order.push(it.sku);
  });
  opts.newDays = newDays; opts.today = iso_(today);
  return { rules: rules, items: items, priced: priced, order: order, rebateBySku: st.bySku, deal: deal, selloutAsOf: iso_(st.latest), opts: opts };
}

function salesData_(ctx) {
  var all = loadAll_(ctx.settings), admin = ctx.isAdmin;
  var items = all.order.map(function (s) { return all.priced[s]; }).filter(function (p) { return p.active && p.sp; }).map(function (p) {
    var o = { sku: p.sku, desc: p.desc, cat: p.cat, isNew: p.isNew, srp: p.srp, dp: p.dp, sp: p.sp,
      tier: p.limited ? 'limited' : 'special', unitsLeft: p.unitsLeft, rebateBacked: p.rebateBacked };
    if (admin) { o.ndp = p.ndp; o.cost = p.cost; o.thr = p.thr; o.rebate = p.rebate; o.rebateLeft = p.rebateLeft; o.marginNoRebate = p.marginNoRebate; o.marginWithRebate = p.marginWithRebate; o.noRebateCover = p.noRebateCover; }
    return o;
  });
  return { asOf: ctx.settings.PRICES_AS_OF || '', minMargin: all.opts.minMargin, note: ctx.settings.SALES_NOTE || '',
    deal: all.deal, selloutAsOf: all.selloutAsOf, items: items, dealers: dealersFor_(ctx.user, false) };
}

function editorData_(ctx) {
  var all = loadAll_(ctx.settings), reb = {};
  Object.keys(all.rebateBySku).forEach(function (s) { var b = all.rebateBySku[s]; reb[s] = { rebate: b.rebate, max: b.max, sold: b.sold, left: b.left }; });
  return { asOf: ctx.settings.PRICES_AS_OF || '', opts: all.opts, rules: all.rules, items: all.items, rebate: reb, deal: all.deal, selloutAsOf: all.selloutAsOf };
}

/* ================================================================== dealer pages */

function dealerRows_() {
  return rows_(TAB.dealers).filter(function (r) { return r['Dealer ID']; }).map(function (r) {
    return { id: String(r['Dealer ID']).trim(), name: String(r['Dealer name'] || ''), code: String(r['Customer code'] || ''),
      partnerId: String(r['HP Partner ID'] || ''), hpLead: String(r['HP lead'] || ''), csoManager: String(r['CSO manager'] || ''), favorite: /^y/i.test(String(r['Favorite'] || '')),
      emails: splitEmails_(r['Assigned emails']), validUntil: iso_(toDate_(r['Valid until'])), note: String(r['Note'] || ''),
      active: !/^n/i.test(String(r['Active'] || 'Y')), updatedBy: String(r['Updated by'] || ''), updatedOn: r['Updated on'] instanceof Date ? r['Updated on'].toISOString() : String(r['Updated on'] || '') };
  });
}

/** Dealers this user may open, favorites first. Admins: all (inactive too when includeInactive). CSO managers: all active. Others: active ones that list their email. */
function dealersFor_(user, includeInactive) {
  var counts = {};
  rows_(TAB.dprices).forEach(function (r) { var id = String(r['Dealer ID']).trim(); if (id && r['SKU']) counts[id] = (counts[id] || 0) + 1; });
  return dealerRows_().filter(function (d) {
    if (user.role === 'admin') return includeInactive || d.active;
    if (ALL_DEALERS[user.role]) return d.active;
    return d.active && d.emails.indexOf(user.email) >= 0;
  }).map(function (d) {
    return { id: d.id, name: d.name, code: d.code, partnerId: d.partnerId, hpLead: d.hpLead, csoManager: d.csoManager, favorite: d.favorite, validUntil: d.validUntil, active: d.active, skus: counts[d.id] || 0 };
  }).sort(function (a, b) { return (b.favorite - a.favorite) || a.name.localeCompare(b.name); });
}
function canSeeDealer_(user, d) { return user.role === 'admin' || (d.active && (!!ALL_DEALERS[user.role] || d.emails.indexOf(user.email) >= 0)); }

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
  var items = all.order.filter(function (s) { return all.priced[s].active && (all.priced[s].dp || ov[s]); }).map(function (sku) {
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
      override: over != null, tier: over == null ? 'base' : (limited ? 'limited' : 'special'), unitsLeft: units,
      level: p.onHand == null ? 'unknown' : p.onHand <= 0 ? 'out' : p.onHand <= very ? 'very' : p.onHand < lim ? 'limited' : 'ok' };
    if (isDealer) { o.unitsLeft = null; o.qtyCap = null; }
    if (admin) { o.cost = p.cost; o.thr = p.thr; o.sp = p.sp; o.rebate = rebateUsable ? reb.rebate : 0; o.rebateLeft = reb ? reb.left : null; o.marginNoRebate = mNo; o.marginWithRebate = mWith; o.limitBelow = limBelow; o.belowWithRebate = mWith != null && mWith < limBelow; }
    return o;
  }).filter(Boolean);
  var info = { id: d.id, name: d.name, code: d.code, partnerId: d.partnerId, hpLead: d.hpLead, csoManager: d.csoManager, favorite: d.favorite, validUntil: d.validUntil, note: d.note, expired: !!expired, active: d.active };
  if (admin) info.emails = d.emails;
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
    var keyCol = H.quotes.length;
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
    qsh.appendRow([id, new Date(), u.email, u.name, u.role, dd.dealer.id, dd.dealer.name, String(b.source || 'Website').slice(0, 20), 'Issued', n, total, String(b.note || '').slice(0, 300), key]);
    return quoteById_(ctx, id);
  } finally { lock.releaseLock(); }
}

function quoteRows_() {
  var qs = rows_(TAB.quotes).filter(function (r) { return r['Quote ID']; });
  return qs.map(function (r) {
    return { id: String(r['Quote ID']), created: r['Created'] instanceof Date ? r['Created'].toISOString() : String(r['Created']), email: String(r['Email']), name: String(r['Name'] || ''),
      dealerId: String(r['Dealer ID']), dealer: String(r['Dealer name']), source: String(r['Source'] || ''), status: String(r['Status'] || ''), lines: Number(r['Lines']) || 0, total: Number(r['Total']) || 0, note: String(r['Note'] || '') };
  });
}
function canSeeQuote_(u, q) { return u.role === 'admin' || u.role === 'csomgr' || q.email === u.email; }

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

/* ================================================================== admin: console data */

function adminData_(ctx) {
  var all = loadAll_(ctx.settings);
  var users = rows_(TAB.allow).filter(function (r) { return r['Email']; }).map(function (r) {
    return { email: normEmail_(r['Email']), name: String(r['Name'] || ''), role: String(r['Role'] || 'sales').toLowerCase(), active: !/^n/i.test(String(r['Active'] || 'Y')),
      updatedBy: String(r['Updated by'] || ''), updatedOn: r['Updated on'] instanceof Date ? r['Updated on'].toISOString() : String(r['Updated on'] || '') };
  });
  var prices = {};
  rows_(TAB.dprices).forEach(function (r) {
    var id = String(r['Dealer ID']).trim(); if (!id || !r['SKU']) return;
    (prices[id] = prices[id] || []).push({ sku: HXPricing.baseSku(r['SKU']), price: HXPricing.num(r['Special price']), qtyCap: HXPricing.num(r['Qty cap']), note: String(r['Note'] || '') });
  });
  var dealers = dealerRows_().map(function (d) { d.prices = prices[d.id] || []; return d; });
  var catalog = all.order.map(function (s) {
    var p = all.priced[s];
    return { sku: p.sku, desc: p.desc, cat: p.cat, isNew: p.isNew, active: p.active, srp: p.srp, dp: p.dp, thr: p.thr, sp: p.sp, cost: p.cost, ndp: p.ndp,
      rebate: p.rebate, rebateLeft: p.rebateLeft, rebateMax: p.rebateMax, onHand: p.onHand, limited: p.limited, limitBelow: p.limitBelow };
  });
  var settings = {};
  EDITABLE_SETTINGS.forEach(function (k) { settings[k] = ctx.settings[k] == null ? '' : ctx.settings[k]; });
  settings.OWNER_EMAIL = ctx.settings.OWNER_EMAIL || '';
  settings.CLIENT_ID_SET = !!ctx.settings.CLIENT_ID;
  return { users: users, dealers: dealers, catalog: catalog, settings: settings, opts: all.opts, deal: all.deal, selloutAsOf: all.selloutAsOf,
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
    var changed = !b || String(b['Role']).toLowerCase() !== role || (!/^n/i.test(String(b['Active'] || 'Y'))) !== active || String(b['Name'] || '') !== String(u.name || '');
    rows.push([email, String(u.name || '').slice(0, 80), role, active ? 'Y' : 'N', changed ? ctx.user.email : (b['Updated by'] || ''), changed ? now : (b['Updated on'] || '')]);
  }
  if (owner && !rows.some(function (r) { return r[0] === owner && r[2] === 'admin' && r[3] === 'Y'; }))
    return { ok: false, error: 'owner_locked', detail: owner + ' is the owner account and must stay an active admin.' };
  if (!rows.some(function (r) { return r[2] === 'admin' && r[3] === 'Y'; })) return { ok: false, error: 'need_admin' };
  if (!rows.some(function (r) { return r[0] === ctx.user.email && r[2] === 'admin' && r[3] === 'Y'; }))
    return { ok: false, error: 'self_lockout', detail: 'You cannot remove your own admin access here. Ask another admin, or edit the Sheet.' };
  var removed = Object.keys(before).filter(function (e) { return e && !seen[e]; });
  writeRows_(TAB.allow, H.allow, rows);
  editLog_(ctx.user.email, 'users: ' + rows.length + ' on list' + (removed.length ? ', removed ' + removed.join(' ') : ''), { users: rows.map(function (r) { return r.slice(0, 4); }) });
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
      emails.join(', '), d.validUntil ? String(d.validUntil) : '', String(d.note || '').slice(0, 300), d.active === false ? 'N' : 'Y', ctx.user.email, new Date()];
    if (at > 0) sh.getRange(at + 1, 1, 1, row.length).setValues([row]); else sh.appendRow(row);

    // users assigned to a dealer must be able to sign in: add missing emails as CSOs
    var added = [];
    if (emails.length) {
      var known = {}; rows_(TAB.allow).forEach(function (r) { known[normEmail_(r['Email'])] = 1; });
      var ash = sheet_(TAB.allow);
      emails.forEach(function (e) { if (!known[e]) { ash.appendRow([e, '', 'cso', 'Y', ctx.user.email, new Date()]); added.push(e); } });
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
  editLog_(ctx.user.email, 'stock: ' + matched + ' SAP lines matched, ' + changed + ' SKUs changed' + (unknown.length ? ', ' + unknown.length + ' unknown materials' : ''), { unknown: unknown.slice(0, 50) });
  var out = adminData_(ctx); out.uploaded = { matched: matched, changed: changed, unknown: unknown.slice(0, 30) };
  return out;
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
      var c = { sku: h.indexOf('SKU'), nw: h.indexOf('New'), rel: h.indexOf('Release date'), opg: h.indexOf('OPG added'), dpo: h.indexOf('DP override'), tho: h.indexOf('Threshold override'), act: h.indexOf('Active') };
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
        n++;
      });
      psh.getRange(1, 1, v.length, h.length).setValues(v);
      changes.push(n + ' SKU edits');
    }
    if (body.pricesAsOf) setSetting_('PRICES_AS_OF', String(body.pricesAsOf));
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
  var out = {}, sh = ss_().getSheetByName(TAB.settings);
  if (!sh) return out;
  sh.getDataRange().getValues().slice(1).forEach(function (r) { if (r[0]) out[String(r[0]).trim()] = r[1]; });
  if (out.PRICES_AS_OF instanceof Date) out.PRICES_AS_OF = iso_(out.PRICES_AS_OF);
  return out;
}

function setSetting_(key, value) {
  var sh = sheet_(TAB.settings), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim() === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  sh.appendRow([key, value, '']);
}

function rows_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), h = v[0].map(function (x) { return String(x).trim(); });
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
