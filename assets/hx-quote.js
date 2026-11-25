/* HyperX × Iontech quotation templates — one renderer for preview, email table, Viber text, image, Excel and PDF.
   Loaded on demand by hx-cart.js. Never renders cost, NDP, rebate or margin: only the prices on the quote lines.
   HXQuote.defaults(kind) -> template config
   HXQuote.html(q, cfg) / text(q, cfg) / canvas(q, cfg) / xlsx(q, cfg) -> Promise<Blob> / pdf(q, cfg)
   q = { lines:[{sku,desc,qty,price,reg,srp,final}], fields:{customer,attention,preparedBy,sr,approvedBy,paymentTerm,drInvoice,remarks,ref,date,validUntil,delivery}, basis } */
(function (g) {
  "use strict";
  var LOGO = { hyperx: "assets/brand/hyperx.png", iontech: "assets/brand/iontech.png" };
  var SP_COLS = [
    { k: "customer", t: "Customer Name", on: true }, { k: "sku", t: "SKU", on: false }, { k: "desc", t: "Item Description", on: true }, { k: "qty", t: "Qty", on: true },
    { k: "reg", t: "Reg. DP", on: true }, { k: "sp", t: "Special Price (by PM)", on: true }, { k: "final", t: "Final DR/ SI price", on: true }, { k: "pmf", t: "PMF+/- per Unit", on: true },
    { k: "amount", t: "Amount", on: false }, { k: "term", t: "Payment Term", on: true }, { k: "dr", t: "DR / Invoice?", on: true }, { k: "sr", t: "SR", on: true }, { k: "appr", t: "Approved by", on: true }];
  var STD_COLS = [
    { k: "no", t: "#", on: true }, { k: "desc", t: "Product", on: true }, { k: "sku", t: "SKU", on: true }, { k: "qty", t: "Qty", on: true },
    { k: "sp", t: "Price", on: true }, { k: "srp", t: "SRP", on: false }, { k: "amount", t: "Amount", on: true }];
  var NUM = { qty: 1, reg: 1, sp: 1, final: 1, pmf: 1, amount: 1, srp: 1 };
  var MONEY = { reg: 1, sp: 1, final: 1, pmf: 1, amount: 1, srp: 1 };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function defaults(kind) {
    if (kind === "special") return {
      kind: "special", name: "Special Price (Iontech standard)", color: "#104861",
      header: { show: false, logos: true, company: "IONTECH INC.", companyInfo: "Authorized HyperX distributor · Philippines", title: "SPECIAL PRICE REQUEST" },
      fields: { approvedBy: "TRISTEN KEVIN CO", paymentTerm: "P30F", drInvoice: "DR", remarks: "Special Price DR Client", validityDays: 7, delivery: "", attention: "" },
      columns: clone(SP_COLS), totals: false, remarksRow: true,
      footer: { show: false, text: "Prices are VAT-inclusive and subject to stock availability.", signatures: true }
    };
    return {
      kind: "standard", name: "Standard quote table", color: "#c00000",
      header: { show: true, logos: true, company: "IONTECH INC.", companyInfo: "Authorized HyperX distributor · Philippines", title: "QUOTATION" },
      fields: { approvedBy: "", paymentTerm: "", drInvoice: "", remarks: "", validityDays: 7, delivery: "", attention: "" },
      columns: clone(STD_COLS), totals: true, remarksRow: false,
      footer: { show: true, text: "Prices in PHP, VAT-inclusive, subject to stock availability.", signatures: false }
    };
  }
  /** Fill in anything an older saved template is missing. */
  function normalize(cfg) {
    var d = defaults(cfg && cfg.kind === "special" ? "special" : "standard"), o = Object.assign({}, d, cfg || {});
    ["header", "fields", "footer"].forEach(function (k) { o[k] = Object.assign({}, d[k], (cfg || {})[k] || {}); });
    var known = {}; (o.columns || []).forEach(function (c) { known[c.k] = 1; });
    o.columns = (o.columns && o.columns.length ? o.columns : d.columns).concat(d.columns.filter(function (c) { return !known[c.k]; }).map(function (c) { c = clone(c); c.on = false; return c; }));
    return o;
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(n) { return n == null || n === "" || isNaN(n) ? null : Number(n); }
  function fmt(n) { return n == null ? "" : Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function peso(n) { return n == null ? "—" : "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function itemDesc(l, cfg) {
    var d = String(l.desc || "").trim();
    if (cfg.kind !== "special") return d;
    d = d.replace(/\s*·\s*/g, " ");
    if (/^HP\b/i.test(d) && d.indexOf(l.sku) >= 0) return d.toUpperCase();
    return ("HP HX " + l.sku + " " + d.replace(/^HyperX\s+/i, "")).toUpperCase();
  }
  /** Value of one cell: numbers for numeric columns, text otherwise. */
  function cell(k, l, i, q, cfg) {
    var f = q.fields || {}, sp = num(l.price), fin = num(l.final) != null ? num(l.final) : sp;
    switch (k) {
      case "no": return i + 1;
      case "customer": return f.customer || "";
      case "sku": return l.sku;
      case "desc": return itemDesc(l, cfg);
      case "qty": return l.qty;
      case "reg": return num(l.reg);
      case "sp": return sp;
      case "final": return fin;
      case "pmf": return fin != null && sp != null ? Math.round((fin - sp) * 100) / 100 : null;
      case "amount": return fin != null ? fin * l.qty : null;
      case "srp": return num(l.srp);
      case "term": return f.paymentTerm || "";
      case "dr": return f.drInvoice || "";
      case "sr": return f.sr || "";
      case "appr": return f.approvedBy || "";
    }
    return "";
  }
  function cols(cfg) { return cfg.columns.filter(function (c) { return c.on; }); }
  function totals(q, cfg) {
    var u = 0, t = 0; q.lines.forEach(function (l) { var p = num(l.final) != null ? num(l.final) : num(l.price); u += l.qty; if (p != null) t += p * l.qty; });
    return { units: u, amount: Math.round(t * 100) / 100 };
  }
  function metaRows(q, cfg) {
    var f = q.fields || {}, r = [];
    if (f.ref) r.push(["Quotation no.", f.ref]); if (f.date) r.push(["Date", f.date]); if (f.validUntil) r.push(["Valid until", f.validUntil]);
    if (f.customer) r.push(["Customer", f.customer]); if (f.attention) r.push(["Attention", f.attention]); if (f.preparedBy) r.push(["Prepared by", f.preparedBy]);
    if (f.delivery) r.push(["Delivery", f.delivery]); if (cfg.kind !== "special" && f.paymentTerm) r.push(["Payment terms", f.paymentTerm]);
    return r;
  }
  function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return u; } }

  /* ---------- HTML (preview + email; inline styles so Outlook/Gmail keep them) ---------- */
  function html(q, cfg, opt) {
    cfg = normalize(cfg); opt = opt || {};
    var C = cols(cfg), hc = cfg.color || "#104861", tot = totals(q, cfg), sp = cfg.kind === "special";
    var th = 'style="background:' + hc + ';color:#fff;border:1px solid #6b7c88;padding:6px 10px;font:bold 13px Calibri,Arial,sans-serif;text-align:center;vertical-align:middle"';
    var td = function (k) { return 'style="border:1px solid #9aa3aa;padding:5px 10px;font:13px Calibri,Arial,sans-serif;color:#111;text-align:' + (sp ? (k === "desc" ? "center" : NUM[k] ? "right" : "center") : (NUM[k] ? "right" : "left")) + ';white-space:' + (k === "desc" && !sp ? "normal" : "nowrap") + '"'; };
    var out = '<div style="font:13px Calibri,Arial,sans-serif;color:#111;background:#fff">';
    if (cfg.header.show) {
      out += '<table style="border-collapse:collapse;width:100%;margin-bottom:10px"><tr>' +
        (cfg.header.logos ? '<td style="vertical-align:middle;padding:0 12px 0 0;width:1%"><img src="' + abs(LOGO.hyperx) + '" alt="HyperX" height="34" style="height:34px;display:block"></td>' : '') +
        '<td style="vertical-align:middle"><div style="font:bold 15px Calibri,Arial,sans-serif">' + esc(cfg.header.company) + '</div><div style="color:#555;font-size:12px">' + esc(cfg.header.companyInfo) + '</div></td>' +
        (cfg.header.logos ? '<td style="vertical-align:middle;text-align:right;width:1%"><img src="' + abs(LOGO.iontech) + '" alt="Iontech" height="40" style="height:40px;display:block;border-radius:6px"></td>' : '') + '</tr></table>' +
        (cfg.header.title ? '<div style="font:bold 17px Calibri,Arial,sans-serif;color:' + hc + ';margin:4px 0 8px;letter-spacing:.04em">' + esc(cfg.header.title) + '</div>' : '');
      var mr = metaRows(q, cfg);
      if (mr.length) out += '<table style="border-collapse:collapse;margin-bottom:10px">' + mr.map(function (r) { return '<tr><td style="padding:2px 14px 2px 0;color:#555;font-size:12.5px">' + esc(r[0]) + '</td><td style="padding:2px 0;font-weight:bold;font-size:12.5px">' + esc(r[1]) + '</td></tr>'; }).join("") + '</table>';
    }
    out += '<table style="border-collapse:collapse"><tr>' + C.map(function (c) { return '<th ' + th + '>' + esc(c.t) + '</th>'; }).join("") + '</tr>';
    q.lines.forEach(function (l, i) {
      out += '<tr>' + C.map(function (c) { var v = cell(c.k, l, i, q, cfg); return '<td ' + td(c.k) + '>' + (MONEY[c.k] ? (v == null ? "" : sp ? fmt(v) : peso(v)) : esc(v)) + '</td>'; }).join("") + '</tr>';
    });
    if (cfg.totals) {
      out += '<tr>' + C.map(function (c, j) {
        var v = c.k === "qty" ? tot.units : c.k === "amount" ? (sp ? fmt(tot.amount) : peso(tot.amount)) : j === 0 ? "<b>Total</b>" : "";
        return '<td ' + td(c.k) + ' bgcolor="#f2f2f2"><b>' + v + '</b></td>';
      }).join("") + '</tr>';
    }
    if (cfg.remarksRow && (q.fields || {}).remarks) out += '<tr><td colspan="' + C.length + '" style="border:1px solid #9aa3aa;padding:5px 10px;font:13px Calibri,Arial,sans-serif;text-align:center">Remarks: ' + esc(q.fields.remarks) + '</td></tr>';
    out += '</table>';
    if (!cfg.remarksRow && (q.fields || {}).remarks) out += '<div style="margin-top:8px">' + esc(q.fields.remarks) + '</div>';
    if (cfg.footer.show) {
      if (cfg.footer.text) out += '<div style="margin-top:10px;color:#555;font-size:12px">' + esc(cfg.footer.text) + '</div>';
      if (cfg.footer.signatures) out += '<table style="border-collapse:collapse;margin-top:28px"><tr><td style="padding-right:60px;font-size:12px"><div style="border-top:1px solid #333;width:200px;padding-top:4px">Prepared by: ' + esc((q.fields || {}).preparedBy || "") + '</div></td><td style="font-size:12px"><div style="border-top:1px solid #333;width:200px;padding-top:4px">Approved by: ' + esc((q.fields || {}).approvedBy || "") + '</div></td></tr></table>';
    }
    return out + '</div>';
  }

  /* ---------- plain text (Viber) ---------- */
  function text(q, cfg) {
    cfg = normalize(cfg); var f = q.fields || {}, tot = totals(q, cfg), sp = cfg.kind === "special";
    var head = (cfg.header.title || (sp ? "SPECIAL PRICE" : "QUOTATION")) + (f.customer ? " — " + f.customer : "") + "\n" + [f.ref, f.date, f.validUntil ? "valid until " + f.validUntil : ""].filter(Boolean).join(" · ");
    var body = q.lines.map(function (l, i) {
      var spv = num(l.price), fin = num(l.final) != null ? num(l.final) : spv;
      return (i + 1) + ") " + itemDesc(l, cfg) + (sp ? "" : " (" + l.sku + ")") + "\n    " + l.qty + " × " + peso(fin) + (fin == null ? "" : " = " + peso(fin * l.qty)) + (sp && l.reg != null ? "  (Reg. DP " + peso(l.reg) + ")" : "");
    }).join("\n");
    var tail = "\n\nTOTAL: " + tot.units + " units · " + peso(tot.amount);
    if (sp) tail += "\n" + [f.paymentTerm ? "Payment: " + f.paymentTerm : "", f.drInvoice ? f.drInvoice : "", f.sr ? "SR: " + f.sr : "", f.approvedBy ? "Approved by: " + f.approvedBy : ""].filter(Boolean).join(" · ");
    if (f.remarks) tail += "\nRemarks: " + f.remarks;
    return head + "\n\n" + body + tail;
  }

  /* ---------- image (canvas) ---------- */
  var IMG = {};
  function img(u) { if (IMG[u]) return IMG[u]; return (IMG[u] = new Promise(function (res) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = u; })); }
  function canvas(q, cfg) {
    cfg = normalize(cfg);
    return Promise.all([img(LOGO.hyperx), img(LOGO.iontech)]).then(function (lg) {
      var C = cols(cfg), sp = cfg.kind === "special", pad = 24, rowH = 36, hc = cfg.color || "#104861";
      var probe = document.createElement("canvas").getContext("2d"); probe.font = "600 13px Inter,Arial,sans-serif";
      var widths = C.map(function (c, k) {
        var w = probe.measureText(c.t).width + 22;
        q.lines.forEach(function (l, i) { var v = cell(c.k, l, i, q, cfg); var t = MONEY[c.k] ? (v == null ? "" : sp ? fmt(v) : peso(v)) : String(v); w = Math.max(w, probe.measureText(t).width + 22); });
        return Math.min(c.k === "desc" ? 380 : 190, Math.max(44, w));
      });
      var tw = widths.reduce(function (a, b) { return a + b; }, 0), W = Math.max(640, tw + pad * 2);
      var head = cfg.header.show ? 110 : 20, mr = cfg.header.show ? metaRows(q, cfg) : [], rows = q.lines.length + 1 + (cfg.totals ? 1 : 0) + (cfg.remarksRow && q.fields.remarks ? 1 : 0);
      var H = head + mr.length * 18 + (mr.length ? 10 : 0) + rows * rowH + pad + (cfg.footer.show && cfg.footer.text ? 26 : 0);
      var c = document.createElement("canvas"), s = 2; c.width = W * s; c.height = H * s; var x = c.getContext("2d"); x.scale(s, s);
      x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
      var y = pad;
      if (cfg.header.show) {
        if (cfg.header.logos && lg[0]) x.drawImage(lg[0], pad, y, 34 * lg[0].width / lg[0].height, 34);
        if (cfg.header.logos && lg[1]) x.drawImage(lg[1], W - pad - 42, y - 4, 42, 42);
        var tx = pad + (cfg.header.logos && lg[0] ? 34 * lg[0].width / lg[0].height + 14 : 0);
        x.fillStyle = "#111"; x.font = "700 15px Inter,Arial,sans-serif"; x.fillText(cfg.header.company || "", tx, y + 15);
        x.fillStyle = "#666"; x.font = "500 12px Inter,Arial,sans-serif"; x.fillText(cfg.header.companyInfo || "", tx, y + 32);
        x.fillStyle = hc; x.font = "800 17px Inter,Arial,sans-serif"; x.fillText(cfg.header.title || "", pad, y + 66);
        y += 82;
        mr.forEach(function (r) { x.fillStyle = "#666"; x.font = "500 12px Inter,Arial,sans-serif"; x.fillText(r[0], pad, y + 12); x.fillStyle = "#111"; x.font = "700 12px Inter,Arial,sans-serif"; x.fillText(String(r[1]), pad + 110, y + 12); y += 18; });
        if (mr.length) y += 10;
      }
      var ox = (W - tw) / 2;
      function row(vals, bg, font, color, align) {
        var cx = ox; vals.forEach(function (v, k) {
          x.fillStyle = bg; x.fillRect(cx, y, widths[k], rowH); x.strokeStyle = "#9aa3aa"; x.lineWidth = 1; x.strokeRect(cx + .5, y + .5, widths[k], rowH);
          x.fillStyle = color; x.font = font; var t = String(v == null ? "" : v); while (x.measureText(t).width > widths[k] - 12 && t.length > 3) t = t.slice(0, -2) + "…";
          var al = align(k); x.textAlign = al; x.fillText(t, al === "right" ? cx + widths[k] - 8 : al === "center" ? cx + widths[k] / 2 : cx + 8, y + rowH / 2 + 5); cx += widths[k];
        }); x.textAlign = "left"; y += rowH;
      }
      row(C.map(function (c) { return c.t; }), hc, "700 13px Inter,Arial,sans-serif", "#fff", function () { return "center"; });
      q.lines.forEach(function (l, i) {
        row(C.map(function (c) { var v = cell(c.k, l, i, q, cfg); return MONEY[c.k] ? (v == null ? "" : sp ? fmt(v) : peso(v)) : v; }), "#fff", "500 13px Inter,Arial,sans-serif", "#111",
          function (k) { var key = C[k].k; return sp ? (NUM[key] ? "right" : "center") : (NUM[key] ? "right" : "left"); });
      });
      if (cfg.totals) { var tt = totals(q, cfg); row(C.map(function (c, j) { return c.k === "qty" ? tt.units : c.k === "amount" ? (sp ? fmt(tt.amount) : peso(tt.amount)) : j === 0 ? "Total" : ""; }), "#f2f2f2", "800 13px Inter,Arial,sans-serif", "#111", function (k) { return NUM[C[k].k] ? "right" : "left"; }); }
      if (cfg.remarksRow && q.fields.remarks) { x.fillStyle = "#fff"; x.fillRect(ox, y, tw, rowH); x.strokeStyle = "#9aa3aa"; x.strokeRect(ox + .5, y + .5, tw, rowH); x.fillStyle = "#111"; x.font = "500 13px Inter,Arial,sans-serif"; x.textAlign = "center"; x.fillText("Remarks: " + q.fields.remarks, ox + tw / 2, y + rowH / 2 + 5); x.textAlign = "left"; y += rowH; }
      if (cfg.footer.show && cfg.footer.text) { x.fillStyle = "#666"; x.font = "500 12px Inter,Arial,sans-serif"; x.fillText(cfg.footer.text, pad, y + 20); }
      return c;
    });
  }

  /* ---------- Excel (ExcelJS, real .xlsx with the template's colors, logos and merged remarks row) ---------- */
  var CDN = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
  function loadXL() { if (g.ExcelJS) return Promise.resolve(); return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = CDN; s.onload = res; s.onerror = function () { rej(new Error("Could not load the Excel library")); }; document.head.appendChild(s); }); }
  function b64(u) { return fetch(u).then(function (r) { return r.arrayBuffer(); }).then(function (buf) { var s = "", a = new Uint8Array(buf); for (var i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }).catch(function () { return null; }); }
  function argb(hex) { return "FF" + String(hex || "#104861").replace("#", "").toUpperCase(); }
  function xlsx(q, cfg) {
    cfg = normalize(cfg);
    return Promise.all([loadXL(), cfg.header.show && cfg.header.logos ? b64(LOGO.hyperx) : null, cfg.header.show && cfg.header.logos ? b64(LOGO.iontech) : null]).then(function (r) {
      var C = cols(cfg), sp = cfg.kind === "special", wb = new g.ExcelJS.Workbook(); wb.creator = "Iontech HyperX"; wb.created = new Date();
      var ws = wb.addWorksheet(sp ? "Special Price" : "Quotation", { views: [{ showGridLines: false }], pageSetup: { orientation: C.length > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
      var thin = { style: "thin", color: { argb: "FF7F8C96" } }, BOX = { top: thin, left: thin, bottom: thin, right: thin }, font = { name: "Calibri", size: 11 };
      var W = { customer: 18, sku: 12, desc: 44, qty: 7, reg: 13, sp: 14, final: 14, pmf: 12, amount: 15, term: 12, dr: 11, sr: 22, appr: 22, no: 5, srp: 13 };
      ws.columns = C.map(function (c) { return { width: W[c.k] || 14 }; });
      var row = 1, last = C.length;
      if (cfg.header.show) {
        ws.getRow(1).height = 34; ws.getRow(2).height = 18;
        if (r[1]) { var id1 = wb.addImage({ base64: r[1], extension: "png" }); ws.addImage(id1, { tl: { col: 0, row: 0.15 }, ext: { width: 120, height: 35 } }); }
        if (r[2]) { var id2 = wb.addImage({ base64: r[2], extension: "png" }); ws.addImage(id2, { tl: { col: Math.max(0, last - 1) + 0.35, row: 0.05 }, ext: { width: 44, height: 44 } }); }
        var cc = last >= 3 ? 2 : 1; if (last >= 4) ws.mergeCells(1, 2, 1, last - 1);
        var hcell = ws.getCell(1, cc); hcell.value = cfg.header.company || ""; hcell.font = { name: "Calibri", size: 14, bold: true }; hcell.alignment = { vertical: "middle", horizontal: "center" };
        ws.mergeCells(2, 1, 2, last); var ic = ws.getCell(2, 1); ic.value = cfg.header.companyInfo || ""; ic.font = { name: "Calibri", size: 10, color: { argb: "FF595959" } }; ic.alignment = { horizontal: "center" };
        row = 4;
        if (cfg.header.title) { ws.mergeCells(row, 1, row, last); var t = ws.getCell(row, 1); t.value = cfg.header.title; t.font = { name: "Calibri", size: 15, bold: true, color: { argb: argb(cfg.color) } }; t.alignment = { horizontal: "center" }; row += 2; }
        metaRows(q, cfg).forEach(function (m) { ws.getCell(row, 1).value = m[0]; ws.getCell(row, 1).font = { name: "Calibri", size: 10, color: { argb: "FF595959" } }; var v = ws.getCell(row, 2); v.value = String(m[1]); v.font = { name: "Calibri", size: 11, bold: true }; if (last > 2) ws.mergeCells(row, 2, row, Math.min(last, 4)); row++; });
        row++;
      }
      var hr = ws.getRow(row); hr.height = 32;
      C.forEach(function (c, j) { var x = hr.getCell(j + 1); x.value = c.t; x.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } }; x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(cfg.color) } }; x.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; x.border = BOX; });
      var first = row + 1;
      q.lines.forEach(function (l, i) {
        row++; var rr = ws.getRow(row); rr.height = 18;
        C.forEach(function (c, j) {
          var x = rr.getCell(j + 1), v = cell(c.k, l, i, q, cfg);
          if (c.k === "amount") { var fc = C.map(function (z) { return z.k; }).indexOf("final"), sc = C.map(function (z) { return z.k; }).indexOf("sp"), qc = C.map(function (z) { return z.k; }).indexOf("qty"); var pc = fc >= 0 ? fc : sc; if (pc >= 0 && qc >= 0) v = { formula: ws.getColumn(pc + 1).letter + row + "*" + ws.getColumn(qc + 1).letter + row, result: v }; }
          if (c.k === "pmf") { var fc2 = C.map(function (z) { return z.k; }).indexOf("final"), sc2 = C.map(function (z) { return z.k; }).indexOf("sp"); if (fc2 >= 0 && sc2 >= 0) v = { formula: ws.getColumn(fc2 + 1).letter + row + "-" + ws.getColumn(sc2 + 1).letter + row, result: v }; }
          x.value = v == null ? "" : v; x.font = font; x.border = BOX;
          x.alignment = { horizontal: sp ? (NUM[c.k] ? "right" : "center") : (NUM[c.k] ? "right" : "left"), vertical: "middle", wrapText: c.k === "desc" };
          if (MONEY[c.k]) x.numFmt = sp ? '#,##0.00' : '"₱"#,##0.00';
        });
      });
      if (cfg.totals && q.lines.length) {
        row++; var tr = ws.getRow(row);
        C.forEach(function (c, j) {
          var x = tr.getCell(j + 1); x.border = BOX; x.font = { name: "Calibri", size: 11, bold: true }; x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
          var L = ws.getColumn(j + 1).letter;
          if (c.k === "qty" || c.k === "amount") { x.value = { formula: "SUM(" + L + first + ":" + L + (row - 1) + ")" }; x.alignment = { horizontal: "right" }; if (c.k === "amount") x.numFmt = sp ? '#,##0.00' : '"₱"#,##0.00'; }
          else if (j === 0) x.value = "Total";
        });
      }
      if (cfg.remarksRow && q.fields.remarks) { row++; ws.mergeCells(row, 1, row, last); var rc = ws.getCell(row, 1); rc.value = "Remarks: " + q.fields.remarks; rc.font = font; rc.alignment = { horizontal: "center" }; for (var j = 1; j <= last; j++) ws.getCell(row, j).border = BOX; }
      if (!cfg.remarksRow && q.fields.remarks) { row += 2; ws.mergeCells(row, 1, row, last); ws.getCell(row, 1).value = q.fields.remarks; }
      if (cfg.footer.show) {
        if (cfg.footer.text) { row += 2; ws.mergeCells(row, 1, row, last); var fcl = ws.getCell(row, 1); fcl.value = cfg.footer.text; fcl.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF595959" } }; }
        if (cfg.footer.signatures) { row += 3; var half = Math.max(1, Math.floor(last / 2)); ws.getCell(row, 1).value = "Prepared by: " + (q.fields.preparedBy || ""); ws.getCell(row, 1).border = { top: thin }; ws.getCell(row, Math.min(last, half + 1)).value = "Approved by: " + (q.fields.approvedBy || ""); ws.getCell(row, Math.min(last, half + 1)).border = { top: thin }; }
      }
      return wb.xlsx.writeBuffer().then(function (buf) { return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); });
    });
  }

  /* ---------- PDF: the same HTML in a print window (Save as PDF), A4, logos embedded as files the browser already has ---------- */
  function pdf(q, cfg, title) {
    cfg = normalize(cfg);
    var w = g.open("", "_blank"); if (!w) return Promise.reject(new Error("Allow pop-ups for this site to save the PDF"));
    var C = cols(cfg);
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(title || "Quotation") + '</title><style>@page{size:A4 ' + (C.length > 7 ? "landscape" : "portrait") + ';margin:12mm}body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}table{page-break-inside:auto}tr{page-break-inside:avoid}</style></head><body>' + html(q, cfg) + '<script>window.onload=function(){setTimeout(function(){window.focus();window.print()},250)}<\/script></body></html>');
    w.document.close();
    return Promise.resolve();
  }

  g.HXQuote = { defaults: defaults, normalize: normalize, html: html, text: text, canvas: canvas, xlsx: xlsx, pdf: pdf, totals: totals, logos: LOGO, SP_COLS: SP_COLS, STD_COLS: STD_COLS };
})(window);
