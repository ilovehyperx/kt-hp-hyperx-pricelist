/* HyperX quote cart (v2).
   Add SKUs from any page → review → pick a quotation template → preview/edit details → export
   (email table, Viber text, image, Excel, PDF, Special Price template). Every export is logged to the quotation
   pipeline under one quotation ID (signed-in staff by name; public visitors as Guest, public prices only).
   HXCart.init({ context, basis, page,
                 dealer(): {id,name}|null            fixed dealer (dealer pages)
                 dealers(): [{id,name}]|null         optional searchable dealer picker (signed-in staff)
                 reprice(dealerId): Promise<{sku:{price,reg}}>   prices for another dealer, applied only when the user confirms
                 canLog(): bool, user(): {name,email,role}|null })
   HXCart.add({ sku, desc, price, srp, reg, cat, qty }) */
(function (g) {
  "use strict";
  var C = null, OPT = {}, KEY = "", TPL = { company: [], mine: [], loaded: false }, QL = null;
  var BUILTIN = [{ id: "builtin:standard", name: "Standard quote table", kind: "standard" }, { id: "builtin:special", name: "Special Price (Iontech format)", kind: "special" }];
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function peso(n) { return n == null || isNaN(n) ? "—" : "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function rid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function acct() { try { return (g.HXAuth && HXAuth.email && HXAuth.email()) || "guest"; } catch (e) { return "guest"; } }
  function blank() { return { lines: [], customer: "", note: "", quoteKey: rid("qk-"), dealerId: "", dealerName: "", priceDealer: "", tpl: "", fields: {}, pipeId: "" }; }
  function load() { try { C = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { C = null; } if (!C || !Array.isArray(C.lines)) C = blank(); if (!C.quoteKey) C.quoteKey = rid("qk-"); if (!C.fields) C.fields = {}; }
  function save() { C.updated = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(C)); } catch (e) {} badge(); }
  function units() { return C.lines.reduce(function (a, l) { return a + l.qty; }, 0); }
  function total() { return C.lines.reduce(function (a, l) { return a + (l.price || 0) * l.qty; }, 0); }
  function toast(t) { var e = $("#hxcToast"); e.textContent = t; e.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove("show"); }, 2800); }
  function signedIn() { return !!(OPT.canLog && OPT.canLog()); }
  function quoteLib() {
    if (g.HXQuote) return Promise.resolve(g.HXQuote);
    if (QL) return QL;
    var src = (document.currentScript && document.currentScript.src) || "";
    return (QL = new Promise(function (res, rej) { var s = document.createElement("script"); s.src = "assets/hx-quote.js?v=20261125"; s.onload = function () { res(g.HXQuote); }; s.onerror = function () { QL = null; rej(new Error("Could not load the quotation templates")); }; document.head.appendChild(s); }));
  }

  var CSS = '.hxc-fab{position:fixed;right:18px;bottom:18px;z-index:70;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;background:#e3192b;color:#fff;font:700 14px Inter,system-ui,sans-serif;padding:12px 18px;box-shadow:0 10px 30px rgba(0,0,0,.35);cursor:pointer}' +
    '.hxc-fab b{background:#fff;color:#e3192b;border-radius:999px;padding:0 8px;font-size:12px;min-width:12px;text-align:center}.hxc-fab[hidden]{display:none}' +
    '.hxc-dr{position:fixed;top:0;right:0;bottom:0;z-index:90;width:min(580px,100vw);background:var(--surface,#151515);color:var(--ink,#eee);border-left:1px solid var(--line,#333);box-shadow:-20px 0 50px rgba(0,0,0,.35);display:flex;flex-direction:column;font:14px Inter,system-ui,sans-serif}' +
    '.hxc-dr[hidden],.hxc-mo[hidden]{display:none}.hxc-hd{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line,#333)}.hxc-hd h3{margin:0;font-size:17px;flex:1}' +
    '.hxc-x{border:0;background:none;color:inherit;font-size:24px;cursor:pointer;line-height:1}.hxc-bd{flex:1;overflow:auto;padding:10px 18px}' +
    '.hxc-in{width:100%;box-sizing:border-box;height:36px;border:1px solid var(--line,#333);border-radius:9px;background:var(--surface-2,#1e1e1e);color:inherit;padding:0 10px;font-size:13.5px}select.hxc-in{padding-right:4px}textarea.hxc-in{height:auto;padding:8px 10px;resize:vertical;font:13.5px Inter,system-ui,sans-serif}' +
    '.hxc-l{display:grid;grid-template-columns:1fr 64px 100px 22px;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line-2,#262626)}.hxc-l small{display:block;color:var(--faint,#888);font-size:11.5px}' +
    '.hxc-l input{height:30px;border:1px solid var(--line,#333);border-radius:7px;background:var(--surface-2,#1e1e1e);color:inherit;text-align:right;padding:0 6px;font-size:13px;width:100%;box-sizing:border-box}' +
    '.hxc-ft{border-top:1px solid var(--line,#333);padding:12px 18px;display:grid;gap:10px}.hxc-tot{display:flex;justify-content:space-between;font-weight:800;font-size:16px}' +
    '.hxc-b{border:1px solid var(--line,#333);background:var(--surface-2,#1e1e1e);color:inherit;border-radius:10px;padding:8px 13px;font:600 13px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}.hxc-b.p{background:#e3192b;border-color:#e3192b;color:#fff}.hxc-b:disabled{opacity:.5;cursor:default}.hxc-b:focus-visible,.hxc-in:focus-visible{outline:2px solid #e3192b;outline-offset:1px}' +
    '.hxc-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.hxc-lab{font-size:11.5px;font-weight:700;color:var(--muted,#aaa);display:block;margin:10px 0 4px}.hxc-g2{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}' +
    '.hxc-mo{position:fixed;inset:0;z-index:95;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:14px}.hxc-card{background:var(--surface,#151515);color:var(--ink,#eee);border-radius:16px;width:min(1180px,100%);max-height:94vh;display:flex;flex-direction:column;font:14px Inter,system-ui,sans-serif;overflow:hidden}' +
    '.hxc-split{display:grid;grid-template-columns:minmax(0,1fr) 330px;min-height:0;flex:1}.hxc-split>div{overflow:auto;padding:14px 18px}.hxc-side{border-left:1px solid var(--line,#333)}' +
    '.hxc-prev{background:#fff;border-radius:10px;padding:14px;overflow:auto}.hxc-note{font-size:12.5px;color:var(--muted,#aaa)}.hxc-empty{color:var(--faint,#888);padding:30px 0;text-align:center}' +
    '.hxc-warn{border:1px solid #b7791f;background:rgba(183,121,31,.12);border-radius:10px;padding:10px 12px;font-size:12.5px;margin-top:8px}' +
    '.hxc-pill{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:700;background:var(--surface-2,#222);border:1px solid var(--line,#333)}.hxc-pill.d{background:rgba(227,25,43,.14);border-color:rgba(227,25,43,.5);color:#ff5a6e}' +
    '.hxc-toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%) translateY(20px);opacity:0;z-index:99;background:#111;color:#fff;border-radius:10px;padding:10px 16px;font:600 13px Inter,system-ui,sans-serif;transition:.2s;pointer-events:none}.hxc-toast.show{opacity:1;transform:translateX(-50%)}' +
    '.hxc-add{border:1px solid var(--line,#333);background:transparent;color:inherit;border-radius:8px;font:700 12px Inter,system-ui,sans-serif;padding:3px 8px;cursor:pointer;white-space:nowrap}.hxc-add:hover{border-color:#e3192b;color:#e3192b}.hxc-add.in{background:#e3192b;border-color:#e3192b;color:#fff}' +
    '.hxc-cols label{display:flex;align-items:center;gap:6px;padding:4px 0;font-size:12.5px}.hxc-cols input[type=text]{flex:1;height:28px;border:1px solid var(--line,#333);border-radius:6px;background:var(--surface-2,#1e1e1e);color:inherit;padding:0 6px;font-size:12.5px}.hxc-cols button{border:1px solid var(--line,#333);background:none;color:inherit;border-radius:6px;width:24px;height:24px;cursor:pointer}' +
    '.hxc-tl{display:grid;gap:4px}.hxc-tl button{display:flex;justify-content:space-between;gap:8px;text-align:left;border:1px solid var(--line,#333);background:transparent;color:inherit;border-radius:9px;padding:8px 10px;font:500 13px Inter,system-ui,sans-serif;cursor:pointer}.hxc-tl button[aria-current=true]{border-color:#e3192b;background:rgba(227,25,43,.1)}.hxc-tl small{color:var(--faint,#888)}' +
    '.hxc-fl{width:100%;border-collapse:collapse;font-size:12.5px}.hxc-fl td{padding:4px 2px;border-bottom:1px solid var(--line-2,#262626)}.hxc-fl input{width:90px;height:28px;border:1px solid var(--line,#333);border-radius:6px;background:var(--surface-2,#1e1e1e);color:inherit;text-align:right;padding:0 6px}' +
    '@media(max-width:860px){.hxc-split{grid-template-columns:1fr}.hxc-side{border-left:0;border-top:1px solid var(--line,#333)}}';

  function build() {
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    var w = document.createElement("div");
    w.innerHTML = '<button type="button" class="hxc-fab" id="hxcFab" hidden aria-label="View quote"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M3 4h2.5l2.2 11h11l2-8H6.4"/></svg>View quote <b id="hxcN">0</b></button>' +
      '<aside class="hxc-dr" id="hxcDr" hidden role="dialog" aria-label="Your quote"><div class="hxc-hd"><h3>Your quote</h3><span class="hxc-pill" id="hxcCtx"></span><button class="hxc-x" type="button" data-hxc="close" aria-label="Close">×</button></div>' +
      '<div class="hxc-bd"><div id="hxcDealerBox" hidden><span class="hxc-lab">Dealer (optional)</span><div class="hxc-row" style="flex-wrap:nowrap"><input class="hxc-in" id="hxcDQ" placeholder="Search your dealers…" autocomplete="off" style="flex:1"><select class="hxc-in" id="hxcDealer" style="flex:1.4"></select></div><div id="hxcRep"></div></div>' +
      '<span class="hxc-lab">Customer / account</span><input class="hxc-in" id="hxcCust" maxlength="120" placeholder="e.g. PCX, SM Megamall branch, Acme Corp">' +
      '<div id="hxcLines"></div><span class="hxc-lab">Note (optional)</span><input class="hxc-in" id="hxcNote" maxlength="300" placeholder="e.g. Prices valid until Nov 30, subject to stock"></div>' +
      '<div class="hxc-ft"><div class="hxc-tot"><span id="hxcU"></span><span id="hxcT"></span></div><div class="hxc-row"><label class="hxc-note" for="hxcTpl">Template</label><select class="hxc-in" id="hxcTpl" style="flex:1;height:34px"></select><button class="hxc-b" type="button" data-hxc="tpls">My templates</button></div>' +
      '<div class="hxc-row"><button class="hxc-b" type="button" data-hxc="clear">Clear</button><button class="hxc-b" type="button" data-hxc="new" title="Start a fresh quotation (keeps this one in the pipeline)">New quote</button><span style="flex:1"></span><button class="hxc-b p" type="button" data-hxc="make" id="hxcMake">Preview &amp; export</button></div></div></aside>' +
      '<div class="hxc-mo" id="hxcMo" hidden role="dialog" aria-label="Quotation preview"><div class="hxc-card"><div class="hxc-hd"><h3 id="hxcMoT">Preview</h3><span class="hxc-note" id="hxcLog"></span><button class="hxc-x" type="button" data-hxc="mclose" aria-label="Close">×</button></div>' +
      '<div class="hxc-split"><div><div class="hxc-prev" id="hxcPrev"></div></div><div class="hxc-side" id="hxcSide"></div></div>' +
      '<div class="hxc-ft"><div class="hxc-row"><button class="hxc-b p" type="button" data-x="table">Copy email table</button><button class="hxc-b" type="button" data-x="text">Copy Viber text</button><button class="hxc-b" type="button" data-x="image">Copy image</button><button class="hxc-b" type="button" data-x="imagedl">Download image</button><span style="flex:1"></span><button class="hxc-b" type="button" data-x="xlsx" id="hxcXl">Excel (.xlsx)</button><button class="hxc-b" type="button" data-x="pdf">PDF</button></div></div></div></div>' +
      '<div class="hxc-mo" id="hxcTm" hidden role="dialog" aria-label="My quotation templates"><div class="hxc-card"><div class="hxc-hd"><h3>My quotation templates</h3><span class="hxc-note" id="hxcTmMsg"></span><button class="hxc-x" type="button" data-hxc="tclose" aria-label="Close">×</button></div>' +
      '<div class="hxc-split" style="grid-template-columns:250px minmax(0,1fr) 340px"><div id="hxcTlist"></div><div><div class="hxc-prev" id="hxcTprev"></div></div><div class="hxc-side" id="hxcTed"></div></div>' +
      '<div class="hxc-ft"><div class="hxc-row"><button class="hxc-b" type="button" data-t="reset">Reset to company standard</button><button class="hxc-b" type="button" data-t="delete" id="hxcTdel">Delete</button><span style="flex:1"></span><label class="hxc-note" id="hxcTmasterL" hidden><input type="checkbox" id="hxcTmaster"> Save as company template</label><button class="hxc-b" type="button" data-t="default">Set as my default</button><button class="hxc-b" type="button" data-t="dup">Save as new</button><button class="hxc-b p" type="button" data-t="save" id="hxcTsave">Save</button><button class="hxc-b" type="button" data-t="use">Use for this quote</button></div></div></div></div>' +
      '<div class="hxc-toast" id="hxcToast" role="status" aria-live="polite"></div>';
    document.body.appendChild(w);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { if (!$("#hxcTm").hidden) $("#hxcTm").hidden = true; else if (!$("#hxcMo").hidden) $("#hxcMo").hidden = true; else if (!$("#hxcDr").hidden) $("#hxcDr").hidden = true; }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !$("#hxcDr").hidden && C.lines.length) { e.preventDefault(); make(); }
    });
    $("#hxcLines").addEventListener("change", function (e) {
      var r = e.target.closest("[data-i]"); if (!r) return; var l = C.lines[+r.dataset.i], f = e.target.dataset.f;
      if (f === "qty") { var q = Math.round(+e.target.value); l.qty = q > 0 ? q : 1; }
      if (f === "price") { var v = String(e.target.value).replace(/[₱,\s]/g, ""); l.price = v === "" ? null : (+v > 0 ? +v : l.price); l.edited = true; }
      save(); draw();
    });
    $("#hxcCust").addEventListener("change", function () { C.customer = this.value.trim(); save(); });
    $("#hxcNote").addEventListener("change", function () { C.note = this.value.trim(); save(); });
    $("#hxcTpl").addEventListener("change", function () { C.tpl = this.value; save(); });
    $("#hxcDQ").addEventListener("input", dealerOptions);
    $("#hxcDealer").addEventListener("change", function () { pickDealer(this.value); });
    window.addEventListener("online", flush);
  }
  function badge() { $("#hxcN").textContent = units(); $("#hxcFab").hidden = !C.lines.length; mark(); try { g.dispatchEvent(new CustomEvent("hxcart:change", { detail: { units: units(), lines: C.lines.length } })); } catch (e) {} }
  function mark() { var inCart = {}; C.lines.forEach(function (l) { inCart[l.sku] = 1; }); $$(".hxc-add[data-sku]").forEach(function (b) { var on = !!inCart[b.dataset.sku]; b.classList.toggle("in", on); b.textContent = on ? "✓ In quote" : "+ Add"; }); }

  /* ---------- dealer (optional) + explicit repricing ---------- */
  function fixedDealer() { return OPT.dealer && OPT.dealer(); }
  function dealerList() { return (OPT.dealers && OPT.dealers()) || null; }
  function dealerOptions() {
    var L = dealerList() || [], q = ($("#hxcDQ").value || "").toLowerCase().trim();
    var shown = L.filter(function (d) { return !q || (d.name + " " + (d.code || "") + " " + d.id).toLowerCase().indexOf(q) >= 0 || d.id === C.dealerId; });
    $("#hxcDealer").innerHTML = '<option value="">— No dealer (optional) —</option>' + shown.map(function (d) { return '<option value="' + esc(d.id) + '"' + (d.id === C.dealerId ? " selected" : "") + '>' + esc(d.name) + '</option>'; }).join("");
  }
  function pickDealer(id) {
    var d = (dealerList() || []).filter(function (x) { return x.id === id; })[0];
    C.dealerId = d ? d.id : ""; C.dealerName = d ? d.name : ""; save(); drawReprice();
  }
  function drawReprice() {
    var box = $("#hxcRep"); if (!box) return;
    var need = OPT.reprice && C.lines.length && (C.dealerId || "") !== (C.priceDealer || "");
    if (!need) { box.innerHTML = ""; return; }
    box.innerHTML = '<div class="hxc-warn">These lines still carry <b>' + esc(C.priceDealer ? C.priceDealerName || C.priceDealer : "standard") + '</b> prices. Nothing changes until you choose.<div class="hxc-row" style="margin-top:8px"><button class="hxc-b p" type="button" data-hxc="reprice">Reprice for ' + esc(C.dealerId ? C.dealerName : "standard prices") + '</button><button class="hxc-b" type="button" data-hxc="keep">Keep current prices</button></div></div>';
  }
  function reprice() {
    var target = C.dealerId || "", b = $("[data-hxc=reprice]"); if (b) { b.disabled = true; b.textContent = "Repricing…"; }
    var ask = target;
    OPT.reprice(target).then(function (map) {
      if ((C.dealerId || "") !== ask) return;                         // the user switched again: ignore this stale answer
      var changed = 0, missing = 0;
      C.lines.forEach(function (l) { var p = map && map[l.sku]; if (p && p.price != null) { if (l.price !== p.price) changed++; l.price = p.price; if (p.reg != null) l.reg = p.reg; l.edited = false; } else missing++; });
      C.priceDealer = target; C.priceDealerName = C.dealerName; save(); draw();
      toast(changed + " price" + (changed === 1 ? "" : "s") + " updated" + (missing ? " · " + missing + " SKU(s) have no price for this dealer — left as they were" : ""));
    }).catch(function (e) { toast("Could not load prices: " + (e.message || e)); drawReprice(); });
  }

  function tplOptions() {
    var sel = $("#hxcTpl"), cur = C.tpl || defaultTplId();
    var o = '<optgroup label="Built-in">' + BUILTIN.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join("") + '</optgroup>';
    if (TPL.company.length) o += '<optgroup label="Company">' + TPL.company.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>'; }).join("") + '</optgroup>';
    if (TPL.mine.length) o += '<optgroup label="Mine">' + TPL.mine.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + (t.isDefault ? " ★" : "") + '</option>'; }).join("") + '</optgroup>';
    sel.innerHTML = o; sel.value = cur; if (sel.value !== cur) sel.value = "builtin:standard";
  }
  function draw() {
    var fd = fixedDealer(), dl = dealerList();
    $("#hxcCtx").textContent = (C.priceDealer ? "Prices: " + (C.priceDealerName || "dealer") : fd ? "Prices: " + fd.name : "Prices: " + (OPT.basis || "standard"));
    $("#hxcCtx").className = "hxc-pill" + (C.priceDealer || fd ? " d" : "");
    $("#hxcDealerBox").hidden = !(dl && dl.length) || !!fd; if (dl && dl.length && !fd) { dealerOptions(); drawReprice(); }
    $("#hxcCust").value = C.customer || (fd ? fd.name : C.dealerName || ""); $("#hxcNote").value = C.note || "";
    $("#hxcLines").innerHTML = C.lines.map(function (l, i) {
      return '<div class="hxc-l" data-i="' + i + '"><div>' + esc(l.desc) + '<small>' + esc(l.sku) + (l.reg != null && l.reg !== l.price ? ' · Reg. DP ' + peso(l.reg) : l.srp ? ' · SRP ' + peso(l.srp) : '') + (l.edited ? ' · edited' : '') + '</small></div><input data-f="qty" inputmode="numeric" value="' + l.qty + '" aria-label="Quantity for ' + esc(l.sku) + '"><input data-f="price" inputmode="decimal" value="' + (l.price == null ? "" : l.price) + '" aria-label="Unit price for ' + esc(l.sku) + '"><button class="hxc-x" style="font-size:18px" type="button" data-hxc="del" data-i="' + i + '" aria-label="Remove ' + esc(l.sku) + '">×</button></div>';
    }).join("") || '<p class="hxc-empty">Your quote is empty — pick a variant and tap “Add to quote” on any product.</p>';
    $("#hxcU").textContent = C.lines.length + " SKU" + (C.lines.length === 1 ? "" : "s") + " · " + units() + " units";
    $("#hxcT").textContent = peso(total()); $("#hxcMake").disabled = !C.lines.length;
    tplOptions();
  }
  function open() { draw(); $("#hxcDr").hidden = false; loadTemplates(); quoteLib().catch(function () {}); setTimeout(function () { var f = $("#hxcCust"); if (f) f.focus(); }, 30); }
  function add(it) {
    var l = C.lines.filter(function (x) { return x.sku === it.sku; })[0], n = Math.max(1, Math.round(+it.qty) || 1);
    if (l) { l.qty += n; toast(it.sku + " × " + l.qty + " in your quote"); }
    else {
      if (!C.lines.length) { var fd = fixedDealer(); C.priceDealer = fd ? fd.id : (OPT.priceDealer ? OPT.priceDealer() : "") || ""; C.priceDealerName = fd ? fd.name : (OPT.priceDealerName ? OPT.priceDealerName() : ""); }
      C.lines.push({ sku: it.sku, desc: it.desc, cat: it.cat || "", price: it.price == null || it.price === "" ? null : +it.price, srp: it.srp == null || it.srp === "" ? null : +it.srp, reg: it.reg == null || it.reg === "" ? null : +it.reg, qty: n });
      toast("Added " + n + " × " + it.sku + " to your quote");
    }
    save(); if (!$("#hxcDr").hidden) draw();
  }

  /* ---------- templates (personal templates follow the account; guests keep theirs on this device) ---------- */
  function tplKey() { return "hx-tpl:" + acct(); }
  function loadTemplates() {
    try { var c = JSON.parse(localStorage.getItem(tplKey()) || "null"); if (c) { TPL.company = c.company || []; TPL.mine = c.mine || []; } } catch (e) {}
    if (!signedIn() || !g.HXAuth) { TPL.loaded = true; if (!$("#hxcDr").hidden) tplOptions(); return Promise.resolve(); }
    return HXAuth.api("templates").then(function (d) { if (d.ok) { TPL.company = d.company || []; TPL.mine = d.mine || []; TPL.loaded = true; try { localStorage.setItem(tplKey(), JSON.stringify({ company: TPL.company, mine: TPL.mine })); } catch (e) {} if (!$("#hxcDr").hidden) tplOptions(); } }).catch(function () {});
  }
  function defaultTplId() { var d = TPL.mine.filter(function (t) { return t.isDefault; })[0]; return d ? d.id : "builtin:standard"; }
  function tplById(id) {
    var b = BUILTIN.filter(function (t) { return t.id === id; })[0];
    if (b) return { id: b.id, name: b.name, builtin: true, config: g.HXQuote ? HXQuote.defaults(b.kind) : { kind: b.kind } };
    var t = TPL.mine.concat(TPL.company).filter(function (x) { return x.id === id; })[0];
    return t ? { id: t.id, name: t.name, owner: t.owner, isDefault: t.isDefault, config: t.config } : tplById("builtin:standard");
  }
  function companyStandard(kind) {
    var c = TPL.company.filter(function (t) { return (t.config || {}).kind === kind; })[0];
    return c ? JSON.parse(JSON.stringify(c.config)) : HXQuote.defaults(kind);
  }

  /* ---------- quote → render model ---------- */
  function today(add) { var d = new Date(Date.now() + (add || 0) * 864e5); return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }); }
  function user() { return (OPT.user && OPT.user()) || null; }
  function model(cfg) {
    cfg = HXQuote.normalize(cfg); var u = user(), f = cfg.fields || {}, o = C.fields || {}, fd = fixedDealer();
    var ref = C.pipeId || ("Q-" + new Date().toISOString().slice(2, 10).replace(/-/g, "") + "-" + C.quoteKey.slice(-4).toUpperCase());
    var F = {
      ref: ref, date: today(0), validUntil: f.validityDays ? today(+f.validityDays) : "",
      customer: C.customer || (fd ? fd.name : C.dealerName || ""), attention: o.attention != null ? o.attention : f.attention || "",
      preparedBy: o.preparedBy != null ? o.preparedBy : (u && u.name) || "", sr: o.sr != null ? o.sr : (u && u.name ? u.name.toUpperCase() : ""),
      approvedBy: o.approvedBy != null ? o.approvedBy : f.approvedBy || "", paymentTerm: o.paymentTerm != null ? o.paymentTerm : f.paymentTerm || "",
      drInvoice: o.drInvoice != null ? o.drInvoice : f.drInvoice || "", delivery: o.delivery != null ? o.delivery : f.delivery || "",
      remarks: o.remarks != null ? o.remarks : (f.remarks || C.note || "")
    };
    if (o.validUntil) F.validUntil = o.validUntil;
    return { lines: C.lines.map(function (l) { return { sku: l.sku, desc: l.desc, qty: l.qty, price: l.price, reg: l.reg, srp: l.srp, final: (C.fields.final || {})[l.sku] }; }), fields: F, basis: OPT.basis };
  }
  function curTpl() { return tplById($("#hxcTpl").value || C.tpl || defaultTplId()); }
  function sidePanel(cfg, F) {
    var sp = cfg.kind === "special";
    var fld = function (k, lab, ph) { return '<div><span class="hxc-lab">' + lab + '</span><input class="hxc-in" data-qf="' + k + '" value="' + esc(F[k] || "") + '" placeholder="' + esc(ph || "") + '"></div>'; };
    var h = '<p class="hxc-note" style="margin:0 0 4px">Edits here apply to this quote only. Template defaults change under <b>My templates</b>.</p>' +
      '<div class="hxc-g2">' + fld("customer", "Customer / dealer") + fld("attention", "Attention to") + fld("preparedBy", "Prepared by") + fld("sr", "SR") +
      fld("approvedBy", "Approved by") + fld("paymentTerm", "Payment term", "P30F") + fld("drInvoice", "DR / Invoice?", "DR") + fld("validUntil", "Valid until") + '</div>' +
      fld("delivery", "Delivery terms") + '<div><span class="hxc-lab">Remarks</span><textarea class="hxc-in" rows="2" data-qf="remarks">' + esc(F.remarks || "") + '</textarea></div>';
    if (sp || cfg.columns.some(function (c) { return c.k === "final" && c.on; })) {
      h += '<span class="hxc-lab">Final DR/SI price per item</span><table class="hxc-fl">' + C.lines.map(function (l) { var fv = (C.fields.final || {})[l.sku]; return '<tr><td>' + esc(l.sku) + '<br><span class="hxc-note">SP ' + peso(l.price) + '</span></td><td style="text-align:right"><input data-final="' + esc(l.sku) + '" inputmode="decimal" value="' + (fv == null ? "" : fv) + '" placeholder="' + (l.price == null ? "" : l.price) + '"></td></tr>'; }).join("") + '</table>';
    }
    return h;
  }
  function make() {
    quoteLib().then(function () {
      if (!TPL.loaded) loadTemplates();
      var t = curTpl(), cfg = HXQuote.normalize(t.config), m = model(cfg);
      $("#hxcMoT").textContent = "Preview · " + t.name; $("#hxcPrev").innerHTML = HXQuote.html(m, cfg); $("#hxcSide").innerHTML = sidePanel(cfg, m.fields);
      $("#hxcMo").hidden = false; $("#hxcLog").textContent = signedIn() ? "Exports are logged to the quotation pipeline." : "Exports are logged anonymously (Guest).";
      log("table", "preview", true);
    }).catch(function (e) { toast(e.message); });
  }
  function refreshPreview() { var t = curTpl(), cfg = HXQuote.normalize(t.config); $("#hxcPrev").innerHTML = HXQuote.html(model(cfg), cfg); }
  function onSide(e) {
    var k = e.target.dataset.qf, sku = e.target.dataset.final;
    if (k) { C.fields[k] = e.target.value; if (k === "customer") { C.customer = e.target.value; } save(); refreshPreview(); }
    if (sku) { C.fields.final = C.fields.final || {}; var v = String(e.target.value).replace(/[₱,\s]/g, ""); if (v === "") delete C.fields.final[sku]; else if (!isNaN(+v)) C.fields.final[sku] = +v; save(); refreshPreview(); }
  }

  /* ---------- export actions ---------- */
  function fileBase(t) { var m = model(t.config); return ((t.config && t.config.kind === "special" ? "Special-Price-" : "Quote-") + (m.fields.customer || "HyperX") + "-" + m.fields.ref).replace(/[^\w\-]+/g, "-"); }
  function download(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }
  function doExport(kind, btn) {
    var t = curTpl(), cfg = HXQuote.normalize(t.config), m = model(cfg), sp = cfg.kind === "special";
    var label = btn ? btn.textContent : ""; if (btn) { btn.disabled = true; }
    var done = function (msg, act, fmt) { toast(msg); log(act, fmt); };
    var p;
    if (kind === "table") { var h = HXQuote.html(m, cfg), tx = HXQuote.text(m, cfg); p = (g.ClipboardItem ? navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([tx], { type: "text/plain" }) })]) : navigator.clipboard.writeText(tx)).then(function () { done("Table copied — paste into your email", sp ? "special" : "table", "email"); }); }
    else if (kind === "text") p = navigator.clipboard.writeText(HXQuote.text(m, cfg)).then(function () { done("Text copied — paste into Viber", "text", "viber"); });
    else if (kind === "image" || kind === "imagedl") p = HXQuote.canvas(m, cfg).then(function (cv) { return new Promise(function (res) { cv.toBlob(res, "image/png"); }); }).then(function (bl) {
      if (kind === "image" && g.ClipboardItem) return navigator.clipboard.write([new ClipboardItem({ "image/png": bl })]).then(function () { done("Image copied — paste into Viber or email", "image", "png"); });
      download(bl, fileBase(t) + ".png"); done("Image downloaded", "image", "png");
    });
    else if (kind === "xlsx") p = HXQuote.xlsx(m, cfg).then(function (bl) { download(bl, fileBase(t) + ".xlsx"); done("Excel file downloaded", sp ? "special" : "xlsx", "xlsx"); });
    else if (kind === "pdf") p = HXQuote.pdf(m, cfg, fileBase(t)).then(function () { done("Choose “Save as PDF” in the print window", sp ? "special-pdf" : "pdf", "pdf"); });
    Promise.resolve(p).catch(function (e) { toast((e && e.message) || "That did not work — try again"); }).then(function () { if (btn) { btn.disabled = false; btn.textContent = label; } });
  }

  /* ---------- pipeline logging: never blocks the export; failed sends wait in an outbox and retry ---------- */
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function outbox() { try { return JSON.parse(localStorage.getItem("hx-outbox") || "[]"); } catch (e) { return []; } }
  function setOutbox(a) { try { localStorage.setItem("hx-outbox", JSON.stringify(a.slice(-30))); } catch (e) {} }
  function log(act, fmt, previewOnly) {
    if (previewOnly) return;                                           // opening the preview is not an export
    if (!g.HXAuth || !C.lines.length) return;
    var t = curTpl(), lines = C.lines.map(function (l) { var fv = (C.fields.final || {})[l.sku]; return { sku: l.sku, desc: l.desc, cat: l.cat || "", qty: l.qty, price: fv != null ? fv : l.price, reg: l.reg }; });
    var sig = hash(JSON.stringify(lines.map(function (l) { return [l.sku, l.qty, l.price]; })));
    var p = { quoteKey: C.quoteKey, act: act, format: fmt || "", lines: lines, customer: C.customer || "", dealerId: fixedDealer() ? fixedDealer().id : C.dealerId || "", basis: OPT.basis || "",
      note: C.note || "", template: t.name, type: (t.config && t.config.kind === "special") || act === "special" || act === "special-pdf" ? "special" : "standard", source: OPT.page || "", idem: C.quoteKey + ":" + act + ":" + sig };
    var job = { auth: signedIn(), p: p, acct: acct(), at: Date.now() };
    if (!job.auth) { var gr = localStorage.getItem("hx-guest-ref"); if (!gr) { gr = rid("g-") + rid(""); try { localStorage.setItem("hx-guest-ref", gr); } catch (e) {} } p.guestRef = gr; p.basis = /dp|dealer/i.test(OPT.basis || "") ? "dp" : "srp"; }
    send(job);
  }
  function send(job) {
    var call = job.auth ? HXAuth.api("logPipe", job.p) : HXAuth.publicApi("guestLog", job.p);
    return call.then(function (r) {
      if (r && r.ok) { if (r.id && job.p.quoteKey === C.quoteKey && !C.pipeId) { C.pipeId = r.id; save(); } $("#hxcLog").textContent = "Logged to the pipeline" + (r.id ? " as " + r.id : "") + "."; return true; }
      if (r && /rate_limited|busy/.test(r.error)) throw new Error(r.error);
      $("#hxcLog").textContent = "Not logged: " + (HXAuth.message ? HXAuth.message(r && r.error) : r && r.error); return true;   // permanent refusal: don't retry
    }).catch(function () { var ob = outbox(); if (!ob.some(function (j) { return j.p.idem === job.p.idem; })) { ob.push(job); setOutbox(ob); } $("#hxcLog").textContent = "Offline or busy — this export will be logged automatically when the connection is back."; return false; });
  }
  function flush() {
    var ob = outbox(); if (!ob.length || !g.HXAuth) return; var me = acct();
    var mine = ob.filter(function (j) { return j.acct === me && Date.now() - j.at < 3 * 864e5; }), keep = ob.filter(function (j) { return j.acct !== me && Date.now() - j.at < 3 * 864e5; });
    setOutbox(keep);
    mine.forEach(function (j) { if (j.auth && !signedIn()) { keep.push(j); setOutbox(keep); return; } send(j); });
  }

  /* ---------- My quotation templates ---------- */
  var ED = null;
  function openTemplates() {
    quoteLib().then(function () { return TPL.loaded ? null : loadTemplates(); }).then(function () {
      var t = curTpl(); edit(t); $("#hxcTm").hidden = false;
      $("#hxcTmasterL").hidden = !(user() && user().role === "admin");
      $("#hxcTmMsg").textContent = signedIn() ? "Saved to your account — available on any device." : "Saved on this device (sign in to keep templates on your account).";
    }).catch(function (e) { toast(e.message); });
  }
  function edit(t) { ED = { id: t.builtin ? "" : t.id, from: t.id, name: t.builtin ? t.name + " (my copy)" : t.name, owner: t.owner, isDefault: !!t.isDefault, builtin: !!t.builtin, config: HXQuote.normalize(JSON.parse(JSON.stringify(t.config || {}))) }; drawTm(); }
  function drawTm() {
    var me = acct(), list = function (arr, own) { return arr.map(function (t) { return '<button type="button" data-tpick="' + esc(t.id) + '" aria-current="' + (t.id === ED.from) + '">' + esc(t.name) + '<small>' + (own ? (t.isDefault ? "★ default" : "") : "company") + '</small></button>'; }).join(""); };
    $("#hxcTlist").innerHTML = '<span class="hxc-lab" style="margin-top:0">Built-in</span><div class="hxc-tl">' + BUILTIN.map(function (t) { return '<button type="button" data-tpick="' + t.id + '" aria-current="' + (t.id === ED.from) + '">' + esc(t.name) + '<small>start here</small></button>'; }).join("") + '</div>' +
      (TPL.company.length ? '<span class="hxc-lab">Company</span><div class="hxc-tl">' + list(TPL.company, false) + '</div>' : "") +
      '<span class="hxc-lab">Mine</span><div class="hxc-tl">' + (list(TPL.mine, true) || '<p class="hxc-note">None yet — edit a template and press “Save as new”.</p>') + '</div>';
    var c = ED.config, mine = !!ED.id && TPL.mine.some(function (t) { return t.id === ED.id; }), co = !!ED.id && TPL.company.some(function (t) { return t.id === ED.id; }), admin = user() && user().role === "admin";
    $("#hxcTsave").disabled = !(mine || (co && admin)); $("#hxcTdel").disabled = !(mine || (co && admin));
    var inp = function (path, lab, val, ph) { return '<div><span class="hxc-lab">' + lab + '</span><input class="hxc-in" data-tp="' + path + '" value="' + esc(val == null ? "" : val) + '" placeholder="' + esc(ph || "") + '"></div>'; };
    var chk = function (path, lab, val) { return '<label class="hxc-note" style="display:flex;gap:6px;align-items:center;margin:6px 0"><input type="checkbox" data-tp="' + path + '"' + (val ? " checked" : "") + '> ' + lab + '</label>'; };
    $("#hxcTed").innerHTML = inp("name", "Template name", ED.name) +
      '<div class="hxc-g2"><div><span class="hxc-lab">Layout</span><select class="hxc-in" data-tp="config.kind"><option value="standard"' + (c.kind !== "special" ? " selected" : "") + '>Standard quote</option><option value="special"' + (c.kind === "special" ? " selected" : "") + '>Special Price</option></select></div><div><span class="hxc-lab">Header colour</span><input class="hxc-in" type="color" data-tp="config.color" value="' + esc(c.color) + '" style="padding:2px"></div></div>' +
      '<span class="hxc-lab">Header</span>' + chk("config.header.show", "Show company header", c.header.show) + chk("config.header.logos", "HyperX + Iontech logos", c.header.logos) +
      inp("config.header.company", "Company name", c.header.company) + inp("config.header.companyInfo", "Company information", c.header.companyInfo) + inp("config.header.title", "Document title", c.header.title) +
      '<span class="hxc-lab">Defaults for new quotes</span><div class="hxc-g2">' + inp("config.fields.approvedBy", "Approved by", c.fields.approvedBy) + inp("config.fields.paymentTerm", "Payment term", c.fields.paymentTerm, "P30F") +
      inp("config.fields.drInvoice", "DR / Invoice?", c.fields.drInvoice, "DR") + inp("config.fields.validityDays", "Valid for (days)", c.fields.validityDays) + inp("config.fields.attention", "Attention to", c.fields.attention) + inp("config.fields.delivery", "Delivery terms", c.fields.delivery) + '</div>' +
      inp("config.fields.remarks", "Remarks", c.fields.remarks) +
      '<span class="hxc-lab">Columns (tick to show, rename, reorder)</span><div class="hxc-cols">' + c.columns.map(function (col, i) { return '<label><input type="checkbox" data-col="' + i + '"' + (col.on ? " checked" : "") + ' aria-label="Show ' + esc(col.t) + '"><input type="text" data-colt="' + i + '" value="' + esc(col.t) + '" aria-label="Column title"><button type="button" data-up="' + i + '" aria-label="Move up">↑</button><button type="button" data-dn="' + i + '" aria-label="Move down">↓</button></label>'; }).join("") + '</div>' +
      chk("config.totals", "Totals row", c.totals) + chk("config.remarksRow", "Remarks as a merged table row", c.remarksRow) +
      '<span class="hxc-lab">Footer</span>' + chk("config.footer.show", "Show footer", c.footer.show) + inp("config.footer.text", "Footer / disclaimer", c.footer.text) + chk("config.footer.signatures", "Signature lines", c.footer.signatures);
    var m = model(c); if (!m.lines.length) m.lines = [{ sku: "AJ0T1AA", desc: "Cloud Jet Wireless BK", qty: 1, price: 2600, reg: 3140 }];
    $("#hxcTprev").innerHTML = HXQuote.html(m, c);
  }
  function setPath(o, path, v) { var p = path.split("."), x = o; for (var i = 0; i < p.length - 1; i++) x = x[p[i]]; x[p[p.length - 1]] = v; }
  function onTm(e) {
    var el = e.target;
    if (el.dataset.tp) { var v = el.type === "checkbox" ? el.checked : el.value; if (el.dataset.tp === "config.fields.validityDays") v = Math.max(0, Math.round(+v) || 0); setPath(ED, el.dataset.tp, v);
      if (el.dataset.tp === "config.kind") ED.config = Object.assign(HXQuote.defaults(v), { color: ED.config.color });
      if (el.type === "checkbox" || el.tagName === "SELECT" || el.type === "color") drawTm(); else tprev(); return; }
    if (el.dataset.col != null) { ED.config.columns[+el.dataset.col].on = el.checked; drawTm(); }
    if (el.dataset.colt != null) { ED.config.columns[+el.dataset.colt].t = el.value; tprev(); }
  }
  function tprev() { var m = model(ED.config); if (!m.lines.length) m.lines = [{ sku: "AJ0T1AA", desc: "Cloud Jet Wireless BK", qty: 1, price: 2600, reg: 3140 }]; $("#hxcTprev").innerHTML = HXQuote.html(m, ED.config); }
  function saveTpl(asNew, setDefault) {
    var master = $("#hxcTmaster") && $("#hxcTmaster").checked;
    var body = { id: asNew ? "" : ED.id, name: String(ED.name || "My template").slice(0, 60), config: ED.config, isDefault: setDefault || ED.isDefault, master: master && asNew };
    if (!asNew && TPL.company.some(function (t) { return t.id === ED.id; })) body.master = true;
    if (signedIn()) {
      return HXAuth.api("saveTemplate", { template: body }).then(function (d) {
        if (!d.ok) { toast(HXAuth.message(d.error) + (d.detail ? " — " + d.detail : "")); return; }
        TPL.company = d.company || []; TPL.mine = d.mine || []; try { localStorage.setItem(tplKey(), JSON.stringify({ company: TPL.company, mine: TPL.mine })); } catch (e) {}
        ED.id = d.id; ED.from = d.id; ED.isDefault = body.isDefault; drawTm(); tplOptions(); toast(setDefault ? "Set as your default template" : "Template saved");
      });
    }
    var id = body.id || rid("TL-"), rec = { id: id, owner: "guest", name: body.name, isDefault: body.isDefault, config: body.config };
    if (body.isDefault) TPL.mine.forEach(function (t) { t.isDefault = false; });
    TPL.mine = TPL.mine.filter(function (t) { return t.id !== id; }).concat([rec]); try { localStorage.setItem(tplKey(), JSON.stringify({ company: [], mine: TPL.mine })); } catch (e) {}
    ED.id = id; ED.from = id; drawTm(); tplOptions(); toast("Template saved on this device"); return Promise.resolve();
  }
  function onTmClick(e) {
    var pk = e.target.closest("[data-tpick]"); if (pk) { edit(tplById(pk.dataset.tpick)); return; }
    var up = e.target.dataset.up, dn = e.target.dataset.dn, cols = ED && ED.config.columns;
    if (up != null && +up > 0) { var a = cols.splice(+up, 1)[0]; cols.splice(+up - 1, 0, a); drawTm(); return; }
    if (dn != null && +dn < cols.length - 1) { var b = cols.splice(+dn, 1)[0]; cols.splice(+dn + 1, 0, b); drawTm(); return; }
    var t = e.target.closest("[data-t]"); if (!t) return; var a2 = t.dataset.t;
    if (a2 === "save") saveTpl(false);
    if (a2 === "dup") { if (/\(my copy\)$/.test(ED.name) === false && ED.id) ED.name = ED.name + " (copy)"; saveTpl(true); }
    if (a2 === "default") saveTpl(!TPL.mine.some(function (x) { return x.id === ED.id; }), true);
    if (a2 === "use") { if (ED.from) { C.tpl = ED.from; save(); tplOptions(); } $("#hxcTm").hidden = true; if (!$("#hxcMo").hidden) make(); }
    if (a2 === "reset") { ED.config = HXQuote.normalize(companyStandard(ED.config.kind)); drawTm(); toast("Reset to the company standard — press Save to keep it"); }
    if (a2 === "delete" && ED.id && confirm("Delete template “" + ED.name + "”?")) {
      if (signedIn()) HXAuth.api("deleteTemplate", { id: ED.id }).then(function (d) { if (!d.ok) { toast(HXAuth.message(d.error)); return; } TPL.company = d.company || []; TPL.mine = d.mine || []; if (C.tpl === ED.id) { C.tpl = ""; save(); } edit(tplById("builtin:standard")); tplOptions(); toast("Template deleted"); });
      else { TPL.mine = TPL.mine.filter(function (x) { return x.id !== ED.id; }); try { localStorage.setItem(tplKey(), JSON.stringify({ company: [], mine: TPL.mine })); } catch (e) {} edit(tplById("builtin:standard")); tplOptions(); }
    }
  }

  function onClick(e) {
    if (e.target.closest("#hxcTm")) { onTmClick(e); if (!e.target.closest("[data-hxc]")) return; }
    var x = e.target.closest("[data-x]"); if (x && e.target.closest("#hxcMo")) { doExport(x.dataset.x, x); return; }
    var b = e.target.closest("[data-hxc],#hxcFab,.hxc-add"); if (!b) return;
    if (b.id === "hxcFab") return open();
    if (b.classList.contains("hxc-add")) { e.preventDefault(); e.stopPropagation(); return add({ sku: b.dataset.sku, desc: b.dataset.desc, price: b.dataset.price, srp: b.dataset.srp, reg: b.dataset.reg, cat: b.dataset.cat }); }
    var a = b.dataset.hxc;
    if (a === "close") $("#hxcDr").hidden = true;
    if (a === "mclose") $("#hxcMo").hidden = true;
    if (a === "tclose") $("#hxcTm").hidden = true;
    if (a === "tpls") openTemplates();
    if (a === "del") { C.lines.splice(+b.dataset.i, 1); save(); draw(); }
    if (a === "clear" && confirm("Clear the items in this quote?")) { var k = C.tpl; C = blank(); C.tpl = k; save(); draw(); }
    if (a === "new" && (!C.lines.length || confirm("Start a new quotation? This one stays in the pipeline if it was exported."))) { var k2 = C.tpl; C = blank(); C.tpl = k2; save(); draw(); }
    if (a === "make") make();
    if (a === "reprice") reprice();
    if (a === "keep") { C.priceDealer = C.dealerId || ""; C.priceDealerName = C.dealerName; C.keptPrices = true; save(); draw(); toast("Kept the current prices"); }
  }
  function btn(it) { return '<button type="button" class="hxc-add" data-sku="' + esc(it.sku) + '" data-desc="' + esc(it.desc) + '" data-price="' + (it.price == null ? "" : it.price) + '" data-srp="' + (it.srp == null ? "" : it.srp) + '" data-reg="' + (it.reg == null ? "" : it.reg) + '" data-cat="' + esc(it.cat || "") + '">+ Add</button>'; }
  function keyFor(ctx) { return "hx-cart:" + acct() + ":" + ctx; }
  function init(o) {
    OPT = o || {}; KEY = keyFor(OPT.context || "default");
    if (!$("#hxcFab")) { build(); $("#hxcSide").addEventListener("input", onSide); $("#hxcTed").addEventListener("change", onTm); $("#hxcTed").addEventListener("input", function (e) { var el = e.target; if (el.type === "checkbox" || el.tagName === "SELECT" || el.type === "color") return; onTm(e); }); }
    load(); badge(); setTimeout(flush, 1500);
  }
  function setContext(ctx) { OPT.context = ctx; KEY = keyFor(ctx); load(); badge(); if (!$("#hxcDr").hidden) draw(); }
  /** Call after sign-in / sign-out so drafts and templates follow the account. */
  function refreshAccount() { KEY = keyFor(OPT.context || "default"); TPL = { company: [], mine: [], loaded: false }; load(); badge(); if (!$("#hxcDr").hidden) draw(); flush(); }
  function setOptions(o) { Object.assign(OPT, o || {}); if (!$("#hxcDr").hidden) draw(); }
  g.HXCart = { init: init, add: add, btn: btn, mark: mark, open: open, openTemplates: openTemplates, setContext: setContext, refreshAccount: refreshAccount, setOptions: setOptions, lines: function () { return C ? C.lines.slice() : []; } };
})(window);
