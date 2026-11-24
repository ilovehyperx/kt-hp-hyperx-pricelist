/* HyperX quote cart: add SKUs from any page, then "Make me a table" →
   - copy as an email table (HTML) or Viber text, or copy/download as an image
   - logs the table to the Pipes sheet (signed-in Iontech staff) so the brand manager sees what's being quoted.
   HXCart.init({ context, basis, dealer(): {id,name}|null, canLog(): bool, page })
   HXCart.add({ sku, desc, price, srp }) */
(function (g) {
  "use strict";
  var C = null, OPT = {}, KEY = "";
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function peso(n) { return n == null || isNaN(n) ? "—" : "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function load() { try { C = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { C = null; } if (!C || !Array.isArray(C.lines)) C = { lines: [], customer: "", note: "" }; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(C)); } catch (e) {} badge(); }
  function total() { return C.lines.reduce(function (a, l) { return a + (l.price || 0) * l.qty; }, 0); }
  function units() { return C.lines.reduce(function (a, l) { return a + l.qty; }, 0); }
  function toast(t) { var e = $("#hxcToast"); e.textContent = t; e.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove("show"); }, 2600); }

  var CSS = '.hxc-fab{position:fixed;right:18px;bottom:18px;z-index:70;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;background:#e3192b;color:#fff;font:700 14px Inter,system-ui,sans-serif;padding:12px 18px;box-shadow:0 10px 30px rgba(0,0,0,.35);cursor:pointer}' +
    '.hxc-fab b{background:#fff;color:#e3192b;border-radius:999px;padding:0 8px;font-size:12px;min-width:12px;text-align:center}.hxc-fab[hidden]{display:none}' +
    '.hxc-dr{position:fixed;top:0;right:0;bottom:0;z-index:90;width:min(560px,100vw);background:var(--surface,#151515);color:var(--ink,#eee);border-left:1px solid var(--line,#333);box-shadow:-20px 0 50px rgba(0,0,0,.35);display:flex;flex-direction:column;font:14px Inter,system-ui,sans-serif}' +
    '.hxc-dr[hidden],.hxc-mo[hidden]{display:none}.hxc-hd{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line,#333)}.hxc-hd h3{margin:0;font-size:17px;flex:1}' +
    '.hxc-x{border:0;background:none;color:inherit;font-size:24px;cursor:pointer;line-height:1}.hxc-bd{flex:1;overflow:auto;padding:12px 18px}' +
    '.hxc-in{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--line,#333);border-radius:9px;background:var(--surface-2,#1e1e1e);color:inherit;padding:0 10px;font-size:13.5px}' +
    '.hxc-l{display:grid;grid-template-columns:1fr 64px 96px 22px;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line-2,#262626)}.hxc-l small{display:block;color:var(--faint,#888);font-size:11.5px}' +
    '.hxc-l input{height:30px;border:1px solid var(--line,#333);border-radius:7px;background:var(--surface-2,#1e1e1e);color:inherit;text-align:right;padding:0 6px;font-size:13px;width:100%;box-sizing:border-box}' +
    '.hxc-ft{border-top:1px solid var(--line,#333);padding:14px 18px;display:grid;gap:10px}.hxc-tot{display:flex;justify-content:space-between;font-weight:800;font-size:16px}' +
    '.hxc-b{border:1px solid var(--line,#333);background:var(--surface-2,#1e1e1e);color:inherit;border-radius:10px;padding:9px 14px;font:600 13.5px Inter,system-ui,sans-serif;cursor:pointer}.hxc-b.p{background:#e3192b;border-color:#e3192b;color:#fff}.hxc-b:disabled{opacity:.5;cursor:default}' +
    '.hxc-row{display:flex;gap:8px;flex-wrap:wrap}.hxc-lab{font-size:11.5px;font-weight:700;color:var(--muted,#aaa);display:block;margin:10px 0 4px}' +
    '.hxc-mo{position:fixed;inset:0;z-index:95;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px}.hxc-card{background:var(--surface,#151515);color:var(--ink,#eee);border-radius:16px;max-width:760px;width:100%;max-height:92vh;overflow:auto;padding:18px 20px;font:14px Inter,system-ui,sans-serif}' +
    '.hxc-prev{background:#fff;border-radius:10px;padding:12px;overflow:auto;margin:12px 0}.hxc-note{font-size:12.5px;color:var(--muted,#aaa)}.hxc-empty{color:var(--faint,#888);padding:30px 0;text-align:center}' +
    '.hxc-toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%) translateY(20px);opacity:0;z-index:99;background:#111;color:#fff;border-radius:10px;padding:10px 16px;font:600 13px Inter,system-ui,sans-serif;transition:.2s;pointer-events:none}.hxc-toast.show{opacity:1;transform:translateX(-50%)}' +
    '.hxc-add{border:1px solid var(--line,#333);background:transparent;color:inherit;border-radius:8px;font:700 12px Inter,system-ui,sans-serif;padding:3px 8px;cursor:pointer;white-space:nowrap}.hxc-add:hover{border-color:#e3192b;color:#e3192b}.hxc-add.in{background:#e3192b;border-color:#e3192b;color:#fff}';

  function build() {
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    var w = document.createElement("div");
    w.innerHTML = '<button type="button" class="hxc-fab" id="hxcFab" hidden>Quote table <b id="hxcN">0</b></button>' +
      '<aside class="hxc-dr" id="hxcDr" hidden aria-label="Quote table"><div class="hxc-hd"><h3>Quote table</h3><span class="hxc-note" id="hxcBasis"></span><button class="hxc-x" type="button" data-hxc="close" aria-label="Close">×</button></div>' +
      '<div class="hxc-bd"><span class="hxc-lab">Customer / account</span><input class="hxc-in" id="hxcCust" maxlength="120" placeholder="e.g. SM Megamall branch, Acme Corp">' +
      '<div id="hxcLines"></div><span class="hxc-lab">Note on the table (optional)</span><input class="hxc-in" id="hxcNote" maxlength="300" placeholder="e.g. Prices valid until Nov 30, subject to stock"></div>' +
      '<div class="hxc-ft"><div class="hxc-tot"><span id="hxcU"></span><span id="hxcT"></span></div><div class="hxc-row"><button class="hxc-b" type="button" data-hxc="clear">Clear</button><span style="flex:1"></span><button class="hxc-b p" type="button" data-hxc="make" id="hxcMake">Make me a table</button></div></div></aside>' +
      '<div class="hxc-mo" id="hxcMo" hidden><div class="hxc-card"><div class="hxc-hd" style="padding:0 0 10px"><h3>Your table</h3><button class="hxc-x" type="button" data-hxc="mclose">×</button></div>' +
      '<p class="hxc-note" id="hxcLog"></p><div class="hxc-prev" id="hxcPrev"></div>' +
      '<div class="hxc-row"><button class="hxc-b p" type="button" data-hxc="cphtml">Copy table (email)</button><button class="hxc-b" type="button" data-hxc="cptext">Copy text (Viber)</button><button class="hxc-b" type="button" data-hxc="cpimg">Copy image</button><button class="hxc-b" type="button" data-hxc="dlimg">Download image</button></div>' +
      '<p class="hxc-note" style="margin-top:10px">Email: paste straight into Outlook/Gmail. Viber: paste the text, or paste/attach the image.</p></div></div><div class="hxc-toast" id="hxcToast"></div>';
    document.body.appendChild(w);
    document.addEventListener("click", onClick);
    $("#hxcLines").addEventListener("change", function (e) {
      var r = e.target.closest("[data-i]"); if (!r) return; var l = C.lines[+r.dataset.i], f = e.target.dataset.f;
      if (f === "qty") { var q = Math.round(+e.target.value); l.qty = q > 0 ? q : 1; }
      if (f === "price") { var v = String(e.target.value).replace(/[₱,\s]/g, ""); l.price = v === "" ? null : (+v > 0 ? +v : l.price); }
      C.idem = null; save(); draw();
    });
    $("#hxcCust").addEventListener("change", function () { C.customer = this.value.trim(); C.idem = null; save(); });
    $("#hxcNote").addEventListener("change", function () { C.note = this.value.trim(); C.idem = null; save(); });
  }
  function badge() { var n = C.lines.length; $("#hxcN").textContent = units(); $("#hxcFab").hidden = !n; mark(); }
  function mark() { var inCart = {}; C.lines.forEach(function (l) { inCart[l.sku] = 1; }); [].forEach.call(document.querySelectorAll(".hxc-add[data-sku]"), function (b) { var on = !!inCart[b.dataset.sku]; b.classList.toggle("in", on); b.textContent = on ? "✓ In table" : "+ Table"; }); }
  function draw() {
    $("#hxcBasis").textContent = OPT.basis || ""; var d = OPT.dealer && OPT.dealer();
    $("#hxcCust").value = C.customer || (d ? d.name : ""); $("#hxcNote").value = C.note || "";
    $("#hxcLines").innerHTML = C.lines.map(function (l, i) {
      return '<div class="hxc-l" data-i="' + i + '"><div>' + esc(l.desc) + '<small>' + esc(l.sku) + (l.srp ? ' · SRP ' + peso(l.srp) : '') + '</small></div><input data-f="qty" inputmode="numeric" value="' + l.qty + '" aria-label="Quantity"><input data-f="price" inputmode="decimal" value="' + (l.price == null ? "" : l.price) + '" aria-label="Unit price"><button class="hxc-x" style="font-size:18px" type="button" data-hxc="del" data-i="' + i + '" aria-label="Remove">×</button></div>';
    }).join("") || '<p class="hxc-empty">Nothing yet — tap “+ Table” on any SKU.</p>';
    $("#hxcU").textContent = C.lines.length + " SKU" + (C.lines.length === 1 ? "" : "s") + " · " + units() + " units";
    $("#hxcT").textContent = peso(total()); $("#hxcMake").disabled = !C.lines.length;
  }
  function open() { draw(); $("#hxcDr").hidden = false; }
  function add(it) {
    var l = C.lines.filter(function (x) { return x.sku === it.sku; })[0];
    if (l) { l.qty++; toast(it.sku + " × " + l.qty); } else { C.lines.push({ sku: it.sku, desc: it.desc, price: it.price == null ? null : +it.price, srp: it.srp == null ? null : +it.srp, qty: 1 }); toast("Added " + it.sku + " to the quote table"); }
    C.idem = null; save(); if (!$("#hxcDr").hidden) draw();
  }

  /* ---- output formats ---- */
  function meta() { var d = OPT.dealer && OPT.dealer(), today = new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
    return { title: "HyperX quote" + (C.customer || (d && d.name) ? " — " + (C.customer || d.name) : ""), date: today, basis: OPT.basis || "Price" }; }
  function html() {
    var m = meta(), th = 'style="background:#c00000;color:#fff;border:1px solid #999;padding:6px 10px;font:bold 13px Calibri,Arial,sans-serif;text-align:left"',
      td = 'style="border:1px solid #bbb;padding:6px 10px;font:13px Calibri,Arial,sans-serif;color:#111"', tdr = td.replace('"', '"text-align:right;');
    return '<div style="font:13px Calibri,Arial,sans-serif;color:#111"><div style="font:bold 15px Calibri,Arial,sans-serif;margin-bottom:6px">' + esc(m.title) + '</div><div style="color:#555;margin-bottom:8px">' + esc(m.date) + ' · prices in PHP, VAT-inclusive</div>' +
      '<table style="border-collapse:collapse"><tr><th ' + th + '>#</th><th ' + th + '>Product</th><th ' + th + '>SKU</th><th ' + th + '>Qty</th><th ' + th + '>' + esc(m.basis) + '</th><th ' + th + '>Amount</th></tr>' +
      C.lines.map(function (l, i) { return '<tr><td ' + td + '>' + (i + 1) + '</td><td ' + td + '>' + esc(l.desc) + '</td><td ' + td + '>' + esc(l.sku) + '</td><td ' + tdr + '>' + l.qty + '</td><td ' + tdr + '>' + peso(l.price) + '</td><td ' + tdr + '><b>' + (l.price == null ? "—" : peso(l.price * l.qty)) + '</b></td></tr>'; }).join("") +
      '<tr><td ' + td + ' colspan="3"><b>Total</b></td><td ' + tdr + '><b>' + units() + '</b></td><td ' + td + '></td><td ' + tdr + '><b>' + peso(total()) + '</b></td></tr></table>' +
      (C.note ? '<div style="margin-top:8px;color:#333">' + esc(C.note) + '</div>' : '') + '</div>';
  }
  function text() {
    var m = meta();
    return m.title + "\n" + m.date + " · PHP, VAT-incl.\n\n" + C.lines.map(function (l, i) { return (i + 1) + ") " + l.desc + " (" + l.sku + ")\n    " + l.qty + " × " + peso(l.price) + (l.price == null ? "" : " = " + peso(l.price * l.qty)); }).join("\n") +
      "\n\nTOTAL: " + units() + " units · " + peso(total()) + (C.note ? "\n" + C.note : "");
  }
  function canvas() {
    var m = meta(), W = 900, pad = 28, rowH = 40, cols = [34, 340, 110, 56, 140, 164], hdr = 110, h = hdr + 4 + rowH * (C.lines.length + 2) + (C.note ? 44 : 0) + pad;
    var c = document.createElement("canvas"), s = 2; c.width = W * s; c.height = h * s; var x = c.getContext("2d"); x.scale(s, s);
    x.fillStyle = "#fff"; x.fillRect(0, 0, W, h); x.fillStyle = "#0b0b0b"; x.fillRect(0, 0, W, 74); x.fillStyle = "#e3192b"; x.fillRect(0, 74, W, 4);
    x.fillStyle = "#fff"; x.font = "800 26px Inter,Arial,sans-serif"; x.fillText("Hyper", pad, 46); var hw = x.measureText("Hyper").width; x.fillStyle = "#e3192b"; x.fillText("X", pad + hw, 46);
    x.fillStyle = "#bbb"; x.font = "700 13px Inter,Arial,sans-serif"; x.fillText("IONTECH", pad + hw + 26, 46);
    x.fillStyle = "#fff"; x.font = "600 13px Inter,Arial,sans-serif"; x.textAlign = "right"; x.fillText(m.date + " · PHP, VAT-inclusive", W - pad, 46); x.textAlign = "left";
    x.fillStyle = "#111"; x.font = "700 17px Inter,Arial,sans-serif"; x.fillText(m.title, pad, 102);
    var y = hdr + 4, heads = ["#", "Product", "SKU", "Qty", m.basis, "Amount"], right = [false, false, false, true, true, true];
    function row(vals, bg, font, color) {
      var cx = pad; x.fillStyle = bg; x.fillRect(pad, y, W - pad * 2, rowH); x.strokeStyle = "#d0d0d0"; x.strokeRect(pad, y, W - pad * 2, rowH);
      vals.forEach(function (v, k) { x.fillStyle = color; x.font = font; var t = String(v); while (x.measureText(t).width > cols[k] - 14 && t.length > 3) t = t.slice(0, -2) + "…";
        x.textAlign = right[k] ? "right" : "left"; x.fillText(t, right[k] ? cx + cols[k] - 8 : cx + 8, y + 25); cx += cols[k]; }); x.textAlign = "left"; y += rowH;
    }
    row(heads, "#c00000", "700 13px Inter,Arial,sans-serif", "#fff");
    C.lines.forEach(function (l, i) { row([i + 1, l.desc, l.sku, l.qty, peso(l.price), l.price == null ? "—" : peso(l.price * l.qty)], i % 2 ? "#f6f6f6" : "#fff", "500 13px Inter,Arial,sans-serif", "#111"); });
    row(["", "Total", "", units(), "", peso(total())], "#efefef", "800 14px Inter,Arial,sans-serif", "#111");
    if (C.note) { x.fillStyle = "#444"; x.font = "500 13px Inter,Arial,sans-serif"; x.fillText(C.note, pad, y + 26); }
    return c;
  }
  function blob(cb) { canvas().toBlob(cb, "image/png"); }

  function make() {
    $("#hxcPrev").innerHTML = html(); $("#hxcMo").hidden = false; $("#hxcLog").textContent = "";
    if (!(OPT.canLog && OPT.canLog()) || typeof HXAuth === "undefined") { $("#hxcLog").textContent = "Not logged to Pipes (sign in as Iontech sales to track it)."; return; }
    if (!C.idem) { C.idem = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); save(); }
    var d = OPT.dealer && OPT.dealer();
    $("#hxcLog").textContent = "Saving to Pipes…";
    HXAuth.api("logPipe", { idem: C.idem, customer: C.customer || (d ? d.name : ""), dealerId: d ? d.id : "", basis: OPT.basis || "", note: C.note, page: OPT.page || location.pathname.split("/").pop(),
      lines: C.lines.map(function (l) { return { sku: l.sku, desc: l.desc, qty: l.qty, price: l.price }; }) })
      .then(function (r) { $("#hxcLog").textContent = r.ok ? "Logged to Pipes as " + r.id + "." : "Not logged: " + (HXAuth.message ? HXAuth.message(r.error) : r.error); })
      .catch(function (e) { $("#hxcLog").textContent = "Not logged (" + e.message + "). The table still works — try Make me a table again to log it."; });
  }
  function onClick(e) {
    var b = e.target.closest("[data-hxc],#hxcFab,.hxc-add"); if (!b) return;
    if (b.id === "hxcFab") return open();
    if (b.classList.contains("hxc-add")) { e.preventDefault(); e.stopPropagation(); return add({ sku: b.dataset.sku, desc: b.dataset.desc, price: b.dataset.price === "" ? null : b.dataset.price, srp: b.dataset.srp === "" ? null : b.dataset.srp }); }
    var a = b.dataset.hxc;
    if (a === "close") $("#hxcDr").hidden = true;
    if (a === "mclose") $("#hxcMo").hidden = true;
    if (a === "del") { C.lines.splice(+b.dataset.i, 1); C.idem = null; save(); draw(); }
    if (a === "clear" && confirm("Clear the quote table?")) { C = { lines: [], customer: "", note: "" }; save(); draw(); }
    if (a === "make") make();
    if (a === "cphtml") { var h = html(), t = text(); (g.ClipboardItem ? navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([t], { type: "text/plain" }) })]) : navigator.clipboard.writeText(t)).then(function () { toast("Table copied — paste into your email"); }, function () { toast("Copy blocked by the browser"); }); }
    if (a === "cptext") navigator.clipboard.writeText(text()).then(function () { toast("Text copied — paste into Viber"); }, function () { toast("Copy blocked by the browser"); });
    if (a === "cpimg") blob(function (bl) { if (!g.ClipboardItem) { toast("This browser can't copy images — use Download image"); return; } navigator.clipboard.write([new ClipboardItem({ "image/png": bl })]).then(function () { toast("Image copied — paste into Viber or email"); }, function () { toast("Copy blocked — use Download image"); }); });
    if (a === "dlimg") blob(function (bl) { var u = URL.createObjectURL(bl), l = document.createElement("a"); l.href = u; l.download = (meta().title.replace(/[^\w]+/g, "-") || "quote") + ".png"; l.click(); toast("Image downloaded"); });
  }
  function btn(it) { return '<button type="button" class="hxc-add" data-sku="' + esc(it.sku) + '" data-desc="' + esc(it.desc) + '" data-price="' + (it.price == null ? "" : it.price) + '" data-srp="' + (it.srp == null ? "" : it.srp) + '">+ Table</button>'; }
  function init(o) { OPT = o || {}; KEY = "hx-cart:" + (OPT.context || "default"); if (!$("#hxcFab")) build(); load(); badge(); }
  function setContext(ctx) { KEY = "hx-cart:" + ctx; OPT.context = ctx; load(); badge(); if (!$("#hxcDr").hidden) draw(); }
  g.HXCart = { init: init, add: add, btn: btn, mark: mark, open: open, setContext: setContext, _text: text, _html: html };
})(window);
