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
if (typeof module !== 'undefined') module.exports = HXPricing;
