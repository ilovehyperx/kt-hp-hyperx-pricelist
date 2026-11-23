/* Google sign-in + API calls for the Iontech HyperX sales pages.
 * Config lives in data/sales-config.json: { "clientId": "...apps.googleusercontent.com", "apiUrl": "https://script.google.com/macros/s/.../exec" }
 * The ID token is kept in sessionStorage for this tab only (it expires after ~1 hour) and is sent in a POST body,
 * never in a URL. The Apps Script backend checks the token and the allowlist on every request.
 */
var HXAuth = (function () {
  var CFG = null, TOKEN = null, onToken = null, KEY = 'hx-idtoken';

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
  function init(el, cb) {
    onToken = cb;
    return loadConfig().then(function () {
      if (!configured()) throw new Error('not_configured');
      var t = saved();
      if (t) { TOKEN = t; cb(t); }
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
        if (!t) google.accounts.id.prompt();
      });
    });
  }

  function signOut() {
    clear();
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
  }

  /** POST to the Apps Script API. text/plain avoids a CORS preflight, which Apps Script cannot answer. */
  function api(action, payload) {
    if (!TOKEN) return Promise.reject(new Error('no_token'));
    var body = Object.assign({ action: action, idToken: TOKEN, page: location.pathname.split('/').pop() }, payload || {});
    return fetch(CFG.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        if (!d.ok && (d.error === 'expired' || d.error === 'invalid_token')) clear();
        return d;
      });
  }

  var MESSAGES = {
    not_allowed: 'This Google account is not on the Iontech sales list yet. Ask the HyperX brand manager to add it.',
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
    server_error: 'The pricing server hit an error.'
  };
  function message(code) { return MESSAGES[code] || ('Something went wrong (' + code + ').'); }

  return { init: init, api: api, signOut: signOut, message: message, loadConfig: loadConfig };
})();
