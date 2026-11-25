/* Shared compact header for the internal pages: official logos, page title, one role-aware "Sales tools" menu
   and an account menu (admin items live there). Menus are keyboard and touch friendly.
   HXShell.mount({ title, page })      — call on load (renders brand + title only)
   HXShell.setUser(user, can)          — call after sign-in; shows only what the role may open (the server still enforces it)
   HXShell.onSignOut(fn)                — page-specific sign-out handling */
(function (g) {
  "use strict";
  var ST = { title: "", page: "", user: null, can: {}, signOut: null };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var ROLE = { admin: "Admin", csomgr: "CSO manager", sm: "Sales manager", sales: "Sales", csa: "Sales assistant", cso: "Channel sales", hplead: "HP lead", dealer: "Dealer" };
  var CSS = '.hxs{position:sticky;top:0;z-index:60;background:var(--hdr-bg,rgba(13,14,16,.88));backdrop-filter:saturate(1.4) blur(10px);-webkit-backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}' +
    '.hxs-in{max-width:1400px;margin:0 auto;height:56px;display:flex;align-items:center;gap:12px;padding:0 18px}' +
    '.hxs-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;min-width:0}.hxs-brand img.hx{height:22px;width:auto;display:block}.hxs-brand img.ion{height:24px;width:24px;border-radius:5px;display:block}' +
    '.hxs-div{width:1px;height:22px;background:var(--line)}.hxs-title{font-weight:700;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.hxs-sp{flex:1}.hxs-m{position:relative}.hxs-b{display:inline-flex;align-items:center;gap:6px;height:34px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:0 12px;font:600 13px var(--f,Inter,system-ui,sans-serif);cursor:pointer;white-space:nowrap}' +
    '.hxs-b:hover{border-color:var(--red-line,#a33)}.hxs-b:focus-visible,.hxs-pop a:focus-visible,.hxs-pop button:focus-visible{outline:2px solid var(--red,#e3001b);outline-offset:2px}.hxs-b svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2}' +
    '.hxs-pop{position:absolute;right:0;top:calc(100% + 6px);min-width:240px;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 40px rgba(0,0,0,.35);padding:6px;display:none}.hxs-m.open .hxs-pop{display:block}' +
    '.hxs-pop a,.hxs-pop button{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:none;color:var(--ink);text-decoration:none;padding:8px 10px;border-radius:9px;font:500 13.5px var(--f,Inter,system-ui,sans-serif);cursor:pointer}' +
    '.hxs-pop a:hover,.hxs-pop button:hover,.hxs-pop a[aria-current=page]{background:var(--surface-2)}.hxs-pop a[aria-current=page]{font-weight:700}.hxs-pop small{color:var(--faint);font-size:11.5px;margin-left:auto}' +
    '.hxs-pop h6{margin:6px 10px 4px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}.hxs-pop hr{border:0;border-top:1px solid var(--line);margin:6px 4px}' +
    '.hxs-av{width:26px;height:26px;border-radius:50%;background:var(--red,#e3001b);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:800}.hxs-who{display:flex;flex-direction:column;line-height:1.15;padding:6px 10px 8px}.hxs-who b{font-size:13.5px}.hxs-who span{font-size:12px;color:var(--muted)}' +
    '@media(max-width:720px){.hxs-title{display:none}.hxs-b .lbl{display:none}.hxs-in{padding:0 12px}}';
  function links() {
    var u = ST.user, c = ST.can || {}, r = u ? u.role : "", admin = r === "admin", internal = /^(admin|csomgr|sm|sales|csa|cso)$/.test(r);
    var tools = [
      { h: "index.html", t: "Price list", s: "catalogue", on: true },
      { h: "sales.html", t: "Special pricing", on: !!c.sales },
      { h: "dealer.html", t: "Dealer pages", on: !!c.dealers || admin },
      { h: "index.html#quote", t: "Quotation builder", s: "cart", on: true },
      { h: "index.html#templates", t: "My quotation templates", on: !!c.quote },
      { h: "quote.html", t: "Formal quotation (PDF)", on: !!c.quote },
      { h: "pipeline.html", t: "Quotation pipeline", on: internal },
      { h: "stock.html", t: "Stock & commitments", on: internal },
      { h: "admin.html#dealers", t: "Dealer management", on: admin },
      { h: "admin.html#data", t: "Inventory & data uploads", on: admin }
    ];
    var adm = [
      { h: "admin.html#users", t: "Users, dealer assignments & teams" }, { h: "admin.html#requests", t: "Access requests" },
      { h: "editor.html", t: "Price list management" }, { h: "admin.html#settings", t: "System settings" }, { h: "admin.html#activity", t: "Activity logs" }];
    return { tools: tools.filter(function (x) { return x.on; }), admin: admin ? adm : [] };
  }
  function cur(h) { var here = location.pathname.split("/").pop() || "index.html"; return h.split("#")[0] === here && (!h.split("#")[1] || location.hash === "#" + h.split("#")[1]); }
  function item(x) { return '<a role="menuitem" href="' + x.h + '"' + (cur(x.h) ? ' aria-current="page"' : '') + '>' + esc(x.t) + (x.s ? '<small>' + esc(x.s) + '</small>' : '') + '</a>'; }
  function render() {
    var el = document.getElementById("hxShell"); if (!el) return;
    var L = links(), u = ST.user;
    el.innerHTML = '<div class="hxs-in"><a class="hxs-brand" href="index.html" aria-label="HyperX price list home"><img class="hx" src="assets/brand/hyperx-sm.webp" alt="HyperX" width="75" height="22"><img class="ion" src="assets/brand/iontech-sm.webp" alt="Iontech" width="24" height="24"></a><span class="hxs-div" aria-hidden="true"></span><span class="hxs-title">' + esc(ST.title) + '</span><span class="hxs-sp"></span>' +
      (u ? '<div class="hxs-m"><button class="hxs-b" type="button" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span class="lbl">Sales tools</span></button><div class="hxs-pop" role="menu">' + L.tools.map(item).join("") + '</div></div>' : '') +
      (u ? '<div class="hxs-m"><button class="hxs-b" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Account"><span class="hxs-av">' + esc((u.name || u.email || "?").charAt(0).toUpperCase()) + '</span><span class="lbl">' + esc((u.name || u.email).split(" ")[0]) + '</span></button><div class="hxs-pop" role="menu"><div class="hxs-who"><b>' + esc(u.name || u.email) + '</b><span>' + esc(ROLE[u.role] || u.role) + (u.group ? " · " + esc(u.group) : "") + '</span><span>' + esc(u.email) + '</span></div>' +
        (L.admin.length ? '<hr><h6>Administration</h6>' + L.admin.map(item).join("") : '') + '<hr><button role="menuitem" type="button" data-shell="theme">Switch light / dark</button><button role="menuitem" type="button" data-shell="signout">Sign out</button></div></div>' : '') + '</div>';
  }
  function closeAll(except) { [].forEach.call(document.querySelectorAll(".hxs-m.open"), function (m) { if (m !== except) { m.classList.remove("open"); m.querySelector(".hxs-b").setAttribute("aria-expanded", "false"); } }); }
  function onClick(e) {
    var b = e.target.closest(".hxs-b"); var m = b && b.closest(".hxs-m");
    if (m) { var open = !m.classList.contains("open"); closeAll(m); m.classList.toggle("open", open); b.setAttribute("aria-expanded", String(open)); if (open) { var f = m.querySelector(".hxs-pop a,.hxs-pop button"); if (f && e.detail === 0) f.focus(); } return; }
    var a = e.target.closest("[data-shell]");
    if (a && a.dataset.shell === "theme") { var t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"; document.documentElement.setAttribute("data-theme", t); try { localStorage.setItem("hxpl-theme", t); } catch (x) {} }
    if (a && a.dataset.shell === "signout") { if (ST.signOut) ST.signOut(); else { if (g.HXAuth) HXAuth.signOut(); location.reload(); } }
    if (!e.target.closest(".hxs-pop")) closeAll();
  }
  function onKey(e) {
    var m = e.target.closest && e.target.closest(".hxs-m"); if (!m) return;
    var items = [].slice.call(m.querySelectorAll(".hxs-pop a,.hxs-pop button")), i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { closeAll(); m.querySelector(".hxs-b").focus(); }
    if (e.key === "ArrowDown") { e.preventDefault(); if (!m.classList.contains("open")) m.querySelector(".hxs-b").click(); (items[i + 1] || items[0]).focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
  }
  function mount(o) {
    ST.title = o.title || ""; ST.page = o.page || "";
    if (!document.getElementById("hxShellCss")) { var s = document.createElement("style"); s.id = "hxShellCss"; s.textContent = CSS; document.head.appendChild(s); }
    var el = document.getElementById("hxShell");
    if (!el) { el = document.createElement("header"); el.id = "hxShell"; el.className = "hxs"; document.body.insertBefore(el, document.body.firstChild); }
    render(); document.addEventListener("click", onClick); document.addEventListener("keydown", onKey);
  }
  /* Attach mode for pages that keep their own header + sign-in chip: logos in, permanent link buttons folded into one menu. */
  function attach(o) {
    o = o || {}; ST.title = o.title || ""; ST.attached = true;
    if (!document.getElementById("hxShellCss")) { var s = document.createElement("style"); s.id = "hxShellCss"; s.textContent = CSS + ".site-header .hdr-link{display:none!important}.site-header .brand .wm-hx,.site-header .brand .wm-ion{display:none}.site-header .brand img{display:block}.hxs-slot{display:flex;align-items:center}"; document.head.appendChild(s); }
    var hi = document.querySelector(".site-header .header-inner"); if (!hi) return;
    var br = hi.querySelector(".brand");
    if (br && !br.querySelector("img")) { br.insertAdjacentHTML("afterbegin", '<img src="assets/brand/hyperx-sm.webp" alt="HyperX" width="75" height="22" style="height:22px;width:auto"><img src="assets/brand/iontech-sm.webp" alt="Iontech" width="24" height="24" style="height:24px;width:24px;border-radius:5px">'); }
    var slot = document.createElement("div"); slot.className = "hxs-slot"; slot.id = "hxSlot";
    var chip = hi.querySelector(".user-chip"); if (chip) hi.insertBefore(slot, chip); else hi.appendChild(slot);
    document.addEventListener("click", onClick); document.addEventListener("keydown", onKey);
    renderSlot();
    if (g.HXAuth && !HXAuth.__shell) {                                      // pick up the signed-in user from any API answer
      var api = HXAuth.api; HXAuth.__shell = true;
      HXAuth.api = function () { return api.apply(HXAuth, arguments).then(function (d) { if (d && d.ok && d.user && (!ST.user || ST.user.email !== d.user.email || !ST.can.sales && d.can)) { ST.user = d.user; ST.can = d.can || ST.can; renderSlot(); } return d; }); };
    }
  }
  function renderSlot() {
    var el = document.getElementById("hxSlot"); if (!el) return;
    if (!ST.user) { el.innerHTML = ""; return; }
    var L = links(), all = L.tools.concat(L.admin.length ? [{ sep: 1 }].concat(L.admin) : []);
    el.innerHTML = '<div class="hxs-m"><button class="hxs-b" type="button" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span class="lbl">Sales tools</span></button><div class="hxs-pop" role="menu">' +
      all.map(function (x) { return x.sep ? '<hr><h6>Administration</h6>' : item(x); }).join("") + '</div></div>';
  }
  g.HXShell = { mount: mount, attach: attach, setUser: function (u, can) { ST.user = u; ST.can = can || {}; if (ST.attached) renderSlot(); else render(); }, onSignOut: function (fn) { ST.signOut = fn; } };
})(window);
