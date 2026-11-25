/* Google sign-in + API calls for the Iontech HyperX sales pages.
 * Config lives in data/sales-config.json: { "clientId": "...apps.googleusercontent.com", "apiUrl": "https://script.google.com/macros/s/.../exec" }
 * Sign in once with Google; the server then issues a signed 12-hour session (localStorage) so every page and tab
 * works without signing in again. Tokens travel in a POST body, never in a URL. The backend still checks the
 * session signature and re-reads the allowlist (role, group, dealer access) on every request.
 */
var HXAuth = (function () {
  var CFG = null, TOKEN = null, onToken = null, KEY = 'hx-idtoken', SKEY = 'hx-session', SESSION = null, inflight = {};

  function loadConfig() {
    if (CFG) return Promise.resolve(CFG);
    return fetch('data/sales-config.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) { CFG = c; return c; });
  }
  function configured() { return CFG && /apps\.googleusercontent\.com$/.test(CFG.clientId || '') && /^https:\/\/script\.google\.com\//.test(CFG.apiUrl || ''); }

  function tokenExp(t) {
    try { var p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.exp * 1000; } catch (e) { return 0; }
  }
  function saved() {
    try { var t = sessionStorage.getItem(KEY); if (t && tokenExp(t) - Date.now() > 60000) return t; } catch (e) {}
    return null;
  }
  function save(t) { TOKEN = t; try { sessionStorage.setItem(KEY, t); } catch (e) {} }
  function clear() { TOKEN = null; try { sessionStorage.removeItem(KEY); } catch (e) {} }
  function savedSession() {
    if (SESSION && SESSION.exp - Date.now() > 120000) return SESSION;
    try { var o = JSON.parse(localStorage.getItem(SKEY) || 'null'); if (o && o.token && o.exp - Date.now() > 120000) return (SESSION = o); } catch (e) {}
    return null;
  }
  function saveSession(o) { if (!o || !o.token) return; SESSION = o; try { localStorage.setItem(SKEY, JSON.stringify(o)); } catch (e) {} }
  function clearSession() { SESSION = null; try { localStorage.removeItem(SKEY); } catch (e) {} }
  /** Email of the signed-in account (for per-account drafts/preferences), or "" */
  function email() {
    var s = savedSession(); if (s) return s.email || '';
    var t = TOKEN || saved(); if (!t) return '';
    try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch (e) { return ''; }
  }

  function waitForGsi() {
    return new Promise(function (res, rej) {
      var n = 0;
      (function tick() {
        if (window.google && google.accounts && google.accounts.id) return res();
        if (++n > 100) return rej(new Error('Google sign-in did not load. Check your connection or ad blocker.'));
        setTimeout(tick, 100);
      })();
    });
  }

  /** Renders the Google button into `el` and calls cb(token) after sign-in. Reuses a still-valid token. */
  function init(el, cb, opts) {
    onToken = cb; opts = opts || {};
    return loadConfig().then(function () {
      if (!configured()) throw new Error('not_configured');
      var t = saved(), ss = savedSession();
      if (t) TOKEN = t;
      if (t || ss) cb(t || ss.token);
      return waitForGsi().then(function () {
        google.accounts.id.initialize({
          client_id: CFG.clientId,
          callback: function (resp) { save(resp.credential); onToken && onToken(resp.credential); },
          auto_select: true,
          cancel_on_tap_outside: true,
          context: 'signin',
          ux_mode: 'popup'
        });
        if (el) google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left', width: 280 });
        if (!t && !ss && !opts.noPrompt) google.accounts.id.prompt();
      });
    });
  }

  function signOut() {
    clear(); clearSession();
    try { Object.keys(localStorage).forEach(function (k) { if (/^hx-(dealer-ctx|pipe-filters)/.test(k)) localStorage.removeItem(k); }); } catch (e) {}
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
  }

  /** POST to the Apps Script API. text/plain avoids a CORS preflight, which Apps Script cannot answer. */
  function post(body) {
    return loadConfig().then(function () {
      return fetch(CFG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' });
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function api(action, payload) {
    var ss = savedSession();
    if (!TOKEN && !ss) return Promise.reject(new Error('no_token'));
    var body = Object.assign({ action: action, page: location.pathname.split('/').pop() }, payload || {});
    if (ss) body.session = ss.token; else body.idToken = TOKEN;
    // identical read requests in flight share one network call
    var key = /^(save|log|set|assign|delete|upload|decide|request|release|create|revoke|register)/.test(action) ? null : action + '|' + JSON.stringify(payload || {});
    if (key && inflight[key]) return inflight[key];
    var pr = post(body).then(function (d) {
      if (d.session) saveSession(d.session);
      if (!d.ok && (d.error === 'expired' || d.error === 'invalid_token')) {
        if (body.session) { clearSession(); if (TOKEN) return api(action, payload); }
        clear();
      }
      return d;
    });
    if (key) { inflight[key] = pr; pr.then(function () { delete inflight[key]; }, function () { delete inflight[key]; }); }
    return pr;
  }
  /** Public, sign-in-free call (guest quote logging). */
  function publicApi(action, payload) { return post(Object.assign({ action: action, page: location.pathname.split('/').pop() }, payload || {})); }

  var MESSAGES = {
    not_allowed: 'This Google account is not on the Iontech sales list yet. Request access on the Register page (link below).',
    admin_only: 'This page is for the HyperX brand manager only.',
    expired: 'Your sign-in expired. Please sign in again.',
    invalid_token: 'Sign-in could not be verified. Please sign in again.',
    wrong_audience: 'Sign-in is set up with a different client ID. Check the CLIENT_ID setting.',
    server_not_configured: 'The pricing server is not set up yet (missing CLIENT_ID in Settings).',
    not_configured: 'Sign-in is not set up yet: data/sales-config.json needs the client ID and API URL.',
    email_not_verified: 'Please verify this Google account’s email first.',
    busy: 'Someone else is saving right now. Try again in a few seconds.',
    dealer_not_allowed: 'You are not assigned to that dealer page.',
    cso_dealers_only: 'Your account can open dealer pages only.',
    owner_locked: 'The owner account must stay an active admin.',
    need_admin: 'Keep at least one active admin.',
    self_lockout: 'You cannot remove your own admin access here.',
    bad_email: 'Check the email address.',
    duplicate_email: 'That email is listed twice.',
    bad_paste: 'That paste could not be read.',
    bad_request: 'Some details are missing.',
    rate_limited: 'Too many requests. Wait a minute and try again.',
    not_found: 'That record was not found or you cannot open it.',
    server_error: 'The pricing server hit an error.'
  };
  function message(code) { return MESSAGES[code] || ('Something went wrong (' + code + ').'); }

  return { init: init, api: api, publicApi: publicApi, signOut: signOut, message: message, loadConfig: loadConfig, email: email, hasSession: function () { return !!(saved() || savedSession()); } };
})();
