/* HyperX × IONTECH styled price-list export (Excel), modeled on the
   "PCX SP KT-HP HyperX Price List Showcase" workbook.
   HXXlsx.pricelist(opts) -> Promise<Blob>
   opts: { title, dealer, subtitle, items:[{sku,cat,series,desc,srp,price,tier,isNew,unitsLeft,note,img}],
           catOrder:[], showcase:true, banner:"assets/pricelist-banner.jpg", notes:[...] }
   Never put cost, NDP, rebate or margin in here: this file goes to dealers. */
(function (g) {
  "use strict";
  var CDN = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
  var RED = "FFC00000", NEWRED = "FF8A0000", SRPRED = "FFFF0000", INK = "FF1A1A1A", WHITE = "FFFFFFFF", GRID = "FFBFBFBF";
  var HFONT = "RBNo3.1 Medium", BFONT = "Aptos Narrow";
  var PHP = '_([$PHP] * #,##0_);_([$PHP] * (#,##0);_([$PHP] * "-"_);_(@_)';
  var thin = { style: "thin", color: { argb: GRID } }, BOX = { top: thin, left: thin, bottom: thin, right: thin };

  function load() {
    if (g.ExcelJS) return Promise.resolve();
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = CDN; s.onload = res; s.onerror = function () { rej(new Error("Could not load the Excel library")); }; document.head.appendChild(s); });
  }
  function b64(buf) { var s = "", a = new Uint8Array(buf); for (var i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }
  function fetchB64(u) { return fetch(u).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(b64).catch(function () { return null; }); }
  /* webp/png -> square white-background jpeg (ExcelJS only takes png/jpeg/gif) */
  function thumb(u, size) {
    return new Promise(function (res) {
      if (!u) return res(null);
      var im = new Image(); im.crossOrigin = "anonymous";
      im.onload = function () {
        try {
          var c = document.createElement("canvas"); c.width = c.height = size; var x = c.getContext("2d");
          x.fillStyle = "#fff"; x.fillRect(0, 0, size, size);
          var k = Math.min(size / im.naturalWidth, size / im.naturalHeight) * 0.92, w = im.naturalWidth * k, h = im.naturalHeight * k;
          x.drawImage(im, (size - w) / 2, (size - h) / 2, w, h);
          res(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
        } catch (e) { res(null); }
      };
      im.onerror = function () { res(null); }; im.src = u;
    });
  }
  function px(w) { return Math.round(w * 7 + 5); }               // column width (chars) -> pixels
  function tierLabel(i) { return i.tier === "limited" ? "LIMITED QTY PRICE" : i.tier === "special" ? "SPECIAL PRICE" : "DEALER PRICE"; }
  function remarks(i) {
    var r = [];
    if (i.tier === "limited") r.push(i.unitsLeft === 0 ? "None left, confirm before quoting" : (i.unitsLeft != null ? i.unitsLeft + " unit" + (i.unitsLeft === 1 ? "" : "s") + " left, " : "") + "while stocks last");
    else if (i.unitsLeft != null) r.push("Up to " + i.unitsLeft + " units");
    if (i.note) r.push(i.note);
    return r.join(" · ");
  }
  function sortCats(list, order) { return list.sort(function (a, b) { var i = order.indexOf(a), j = order.indexOf(b); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || a.localeCompare(b); }); }

  function banner(wb, ws, img, cols, lastCol) {
    var totalPx = 0; for (var c = 1; c <= lastCol; c++) totalPx += px(cols[c - 1]);
    var h = img ? Math.round(totalPx * 284 / 964) : 60;                // banner is 964×284
    ws.mergeCells(1, 1, 1, lastCol); ws.getRow(1).height = h * 0.75;
    ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    if (img) ws.addImage(wb.addImage({ base64: img, extension: "jpeg" }), { tl: { col: 0, row: 0 }, ext: { width: totalPx, height: h }, editAs: "oneCell" });
  }
  function infoBar(ws, row, lastCol, text, sub) {
    ws.mergeCells(row, 1, row, lastCol);
    var c = ws.getCell(row, 1);
    c.value = { richText: [{ text: text, font: { name: HFONT, size: 16, bold: true, color: { argb: WHITE } } }].concat(sub ? [{ text: "     " + sub, font: { name: BFONT, size: 11, color: { argb: "FFD9D9D9" } } }] : []) };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(row).height = 30;
  }

  function listSheet(wb, o, img, cats) {
    var ST = !!o.stock;
    var cols = ST ? [18, 24, 13, 40, 13, 13, 14, 19, 11, 11, 11, 11, 44] : [22, 26, 15, 44, 15, 17, 20, 34], last = cols.length;
    var ws = wb.addWorksheet("Orderable Price List", {
      views: [{ state: "frozen", xSplit: 4, ySplit: 3, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "3:3", margins: { left: .3, right: .3, top: .4, bottom: .4, header: .2, footer: .2 } },
      headerFooter: { oddFooter: "&L&8" + (o.dealer || "") + " · Confidential&R&8Page &P of &N" }
    });
    cols.forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    banner(wb, ws, img, cols, last);
    infoBar(ws, 2, last, (o.title || "HYPERX PRICE LIST").toUpperCase(), o.subtitle);
    var H = ST ? ["Product Category", "Sub-Categories/Series", "SKU Number", "SKU Description", "SRP", "Base DP", "Special DP", "Price Type", "On Hand", "Available", "Incoming", "Next ETA", "Incoming detail / Remarks"]
               : ["Product Category", "Sub-Categories/Series", "SKU Number", "SKU Description", "SRP", "Dealer Price", "Price Type", "Remarks"];
    var cP = ST ? 7 : 6, cT = ST ? 8 : 7, cR = last;
    var hr = ws.getRow(3); hr.values = H; hr.height = 30;
    hr.eachCell(function (c) { c.font = { name: HFONT, size: 12, bold: true, color: { argb: WHITE } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = BOX; });
    var r = 4, band = false;
    cats.forEach(function (cat) {
      band = !band;
      o.byCat[cat].forEach(function (i) {
        var row = ws.getRow(r++);
        row.values = ST ? [cat, i.series || "", i.sku, i.desc, i.srp == null ? null : i.srp, i.dp, i.price, tierLabel(i), i.onHand, i.atp, i.incoming || 0, i.nextEta || "", [i.incDetail, remarks(i)].filter(Boolean).join(" · ")]
                        : [cat, i.series || "", i.sku, i.desc, i.srp == null ? null : i.srp, i.price, tierLabel(i), remarks(i)];
        row.height = 20;
        row.eachCell({ includeEmpty: true }, function (c, n) {
          c.font = { name: BFONT, size: 12 }; c.border = BOX; c.alignment = { vertical: "middle", wrapText: n === cR };
          if (band) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7F7" } };
        });
        row.getCell(3).font = { name: BFONT, size: 12, bold: true };
        row.getCell(5).numFmt = PHP; row.getCell(6).numFmt = PHP; row.getCell(cP).numFmt = PHP;
        if (ST) {
          [9, 10, 11].forEach(function (k) { var c = row.getCell(k); c.numFmt = "#,##0"; c.alignment = { horizontal: "center", vertical: "middle" }; });
          row.getCell(9).font = { name: BFONT, size: 12, bold: true };
          var av = row.getCell(10), q = i.atp || 0;
          av.font = { name: BFONT, size: 11, bold: true, color: { argb: q > 5 && q <= 20 ? INK : WHITE } };
          av.fill = { type: "pattern", pattern: "solid", fgColor: { argb: q <= 0 ? "FF808080" : q <= 5 ? RED : q <= 20 ? "FFFFC000" : "FF548235" } };
          if (i.incoming) row.getCell(11).font = { name: BFONT, size: 12, bold: true, color: { argb: "FF1F4E79" } };
          row.getCell(12).alignment = { horizontal: "center", vertical: "middle" };
          row.getCell(13).font = { name: BFONT, size: 10, color: { argb: "FF404040" } };
        }
        row.getCell(cP).font = { name: BFONT, size: 13, bold: true, color: { argb: i.tier === "limited" ? RED : INK } };
        var t = row.getCell(cT); t.alignment = { horizontal: "center", vertical: "middle" };
        if (i.tier === "limited") { t.font = { name: BFONT, size: 11, bold: true, color: { argb: WHITE } }; t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } }; }
        else if (i.tier === "special") t.font = { name: BFONT, size: 11, bold: true, color: { argb: RED } };
        else t.font = { name: BFONT, size: 11, color: { argb: "FF595959" } };
        if (i.isNew) { var d = row.getCell(4); d.value = { richText: [{ text: "NEW  ", font: { name: BFONT, size: 10, bold: true, color: { argb: NEWRED } } }, { text: i.desc || "", font: { name: BFONT, size: 12 } }] }; }
      });
    });
    var lastRow = r - 1;
    if (lastRow >= 4) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: lastRow, column: last } };
    r++;
    (o.notes || []).forEach(function (n) { ws.mergeCells(r, 1, r, last); var c = ws.getCell(r, 1); c.value = n; c.font = { name: BFONT, size: 10, italic: true, color: { argb: "FF595959" } }; c.alignment = { wrapText: true, vertical: "top" }; ws.getRow(r).height = 16; r++; });
    return ws;
  }

  function showcaseSheet(wb, o, cat, items, img, thumbs) {
    var name = cat.replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31);
    var n = items.length, cols = [24].concat(items.map(function () { return 30; })), last = n + 1;
    var ws = wb.addWorksheet(name, {
      views: [{ state: "frozen", xSplit: 1, ySplit: 0, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: .3, right: .3, top: .4, bottom: .4, header: .2, footer: .2 } }
    });
    cols.forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    banner(wb, ws, img, cols.slice(0, Math.min(cols.length, 6)), Math.min(last, 6));
    if (last > 6) ws.getCell(1, 7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    infoBar(ws, 2, last, cat.toUpperCase(), o.dealer ? o.dealer + (o.asOf ? " · as of " + o.asOf : "") : "");
    var L = [["Product Category", 30], ["Sub-Categories/Series", 34], ["Image", 170], ["SKU Number", 26], ["SKU Description", 46], ["SRP", 34], ["Dealer Price", 40], ["Price Type", 24], ["Remarks", 40]];
    L.forEach(function (l, k) {
      var row = ws.getRow(3 + k); row.height = l[1];
      var c = row.getCell(1); c.value = l[0]; c.font = { name: HFONT, size: 13, bold: true, color: { argb: WHITE } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: l[0] === "SRP" ? SRPRED : INK } }; c.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true }; c.border = BOX;
    });
    items.forEach(function (i, k) {
      var col = k + 2, head = i.isNew ? NEWRED : RED;
      var vals = [cat + (i.isNew ? " NEW" : ""), i.series || "", null, i.sku, i.desc, i.srp == null ? null : i.srp, i.price, tierLabel(i), remarks(i)];
      vals.forEach(function (v, j) {
        var c = ws.getCell(3 + j, col); c.value = v; c.border = BOX; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        c.font = { name: HFONT, size: 12, color: { argb: INK } };
        if (j <= 1) { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: head } }; c.font = { name: HFONT, size: j ? 12 : 13, bold: !j, color: { argb: WHITE } }; }
        if (j === 3) c.font = { name: HFONT, size: 14, bold: true, color: { argb: INK } };
        if (j === 4) c.font = { name: HFONT, size: 13, bold: true, color: { argb: INK } };
        if (j === 5) { c.numFmt = PHP; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SRPRED } }; c.font = { name: HFONT, size: 18, bold: true, color: { argb: WHITE } }; }
        if (j === 6) { c.numFmt = PHP; c.font = { name: HFONT, size: 20, bold: true, color: { argb: i.tier === "limited" ? RED : INK } }; }
        if (j === 7) c.font = { name: BFONT, size: 11, bold: true, color: { argb: i.tier === "base" ? "FF595959" : RED } };
        if (j === 8) c.font = { name: BFONT, size: 11, color: { argb: "FF404040" } };
      });
      var t = thumbs[i.sku];
      if (t) {
        var cw = px(30), ih = 200, sz = Math.min(cw - 12, ih - 12);
        ws.addImage(wb.addImage({ base64: t, extension: "jpeg" }), { tl: { col: col - 1 + (cw - sz) / 2 / cw, row: 5 + (ih - sz) / 2 / ih }, ext: { width: sz, height: sz }, editAs: "oneCell" });
      }
    });
    return ws;
  }

  function pricelist(o) {
    o.catOrder = o.catOrder || [];
    o.byCat = {}; (o.items || []).forEach(function (i) { (o.byCat[i.cat || "Other"] = o.byCat[i.cat || "Other"] || []).push(i); });
    var cats = sortCats(Object.keys(o.byCat), o.catOrder);
    cats.forEach(function (c) { o.byCat[c].sort(function (a, b) { return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || String(a.series || a.desc).localeCompare(String(b.series || b.desc)) || String(a.desc).localeCompare(String(b.desc)); }); });
    return load().then(function () { return fetchB64(o.banner || "assets/pricelist-banner.jpg"); }).then(function (img) {
      var thumbs = {}, jobs = [];
      if (o.showcase !== false) (o.items || []).forEach(function (i) { if (i.img) jobs.push(thumb(i.img, 360).then(function (t) { if (t) thumbs[i.sku] = t; })); });
      return Promise.all(jobs).then(function () {
        var wb = new g.ExcelJS.Workbook(); wb.creator = "HyperX · IONTECH"; wb.created = new Date();
        listSheet(wb, o, img, cats);
        if (o.showcase !== false) cats.forEach(function (c) { showcaseSheet(wb, o, c, o.byCat[c], img, thumbs); });
        return wb.xlsx.writeBuffer();
      });
    }).then(function (buf) { return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); });
  }
  g.HXXlsx = { pricelist: pricelist, load: load };
})(window);
