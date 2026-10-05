/**
 * The "Send to Everloom" userscript and bookmarklet. Both read only what the page in front of the
 * player shows, through the per-site readers in bridge-extractors.ts. Neither tries to reveal a
 * definition the creator hid.
 *
 * The userscript runs on whole sites (they are single-page apps, so it watches the address and shows
 * its button only on character pages), makes its requests with GM_xmlhttpRequest (so the page's own
 * security policy doesn't block them), can send every character on a listing page, and has a small
 * settings panel. Installed from a pairing link it signs itself in; otherwise it asks for a token.
 *
 * The bookmarklet opens Everloom's receive page first (popup blockers only allow that straight from
 * the click), then reads the page and hands the card over with postMessage. If the window can't open
 * it copies the card to the clipboard for "Paste from bridge".
 */
import { EXTRACTORS_JS, PAGE_VIEW_JS } from './bridge-extractors.js';

/** Sites the userscript runs on: every site with a reader. */
export const BRIDGE_MATCHES = [
  'https://janitorai.com/*',
  'https://jannyai.com/*',
  'https://botbooru.com/*',
  'https://aicharactercards.com/*',
  'https://chub.ai/*',
  'https://venus.chub.ai/*',
  'https://character-tavern.com/*',
  'https://realm.risuai.net/*',
  'https://datacat.run/*',
  'https://saucepan.ai/*',
  'https://pygmalion.chat/*',
  'https://app.wyvern.chat/*',
];

export const USERSCRIPT_VERSION = '2.0';

export function userscript(origin: string, pairCode?: string | null): string {
  return `// ==UserScript==
// @name         Send to Everloom
// @namespace    everloom
// @version      ${USERSCRIPT_VERSION}
// @description  Send the character card on this page to your Everloom library.
${BRIDGE_MATCHES.map((m) => `// @match        ${m}`).join('\n')}
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==
(function () {
  'use strict';
  var DEFAULT_ORIGIN = ${JSON.stringify(origin)};
  var PAIR_CODE = ${JSON.stringify(pairCode ?? '')};
  ${EXTRACTORS_JS}
  ${PAGE_VIEW_JS}
  var cfg = {
    get origin() { return GM_getValue('everloom_origin', '') || DEFAULT_ORIGIN; },
    get token() { return GM_getValue('everloom_token', ''); },
    get debug() { return !!GM_getValue('everloom_debug', false); }
  };
  function log() { if (cfg.debug) console.log.apply(console, ['[Everloom bridge]'].concat([].slice.call(arguments))); }

  function gm(url, binary, credentials) {
    // The site's own API (same origin) goes through fetch so the player's session cookie is used.
    if (credentials && new URL(url).origin === location.origin) {
      return fetch(url, { credentials: 'include' }).then(function (r) { return r.ok ? r.text() : null; }).catch(function () { return null; });
    }
    return new Promise(function (resolve) {
      GM_xmlhttpRequest({ method: 'GET', url: url, responseType: binary ? 'arraybuffer' : 'text', timeout: 60000, anonymous: !credentials,
        onload: function (r) {
          if (r.status !== 200) { log('GET', url, r.status); return resolve(null); }
          if (!binary) return resolve(r.responseText);
          var b = new Uint8Array(r.response), s = '';
          for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
          resolve(btoa(s));
        },
        onerror: function () { resolve(null); }, ontimeout: function () { resolve(null); } });
    });
  }
  function call(method, path, body, token) {
    return new Promise(function (resolve) {
      GM_xmlhttpRequest({ method: method, url: cfg.origin + path, headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), data: body ? JSON.stringify(body) : undefined, timeout: 120000,
        onload: function (r) { var j = {}; try { j = JSON.parse(r.responseText); } catch (e) {} resolve({ status: r.status, json: j }); },
        onerror: function () { resolve({ status: 0, json: { error: 'Could not reach Everloom at ' + cfg.origin } }); },
        ontimeout: function () { resolve({ status: 0, json: { error: 'Everloom took too long to answer' } }); } });
    });
  }

  // Pairing: a script installed from Everloom's pairing link exchanges its one-time code for a token.
  async function ensureToken() {
    if (cfg.token) return cfg.token;
    if (PAIR_CODE && !GM_getValue('everloom_paired_' + PAIR_CODE, false)) {
      GM_setValue('everloom_paired_' + PAIR_CODE, true);
      var r = await call('POST', '/api/bridge/pair', { code: PAIR_CODE });
      if (r.status === 200 && r.json.token) { GM_setValue('everloom_token', r.json.token); note('Paired with Everloom.', true); return r.json.token; }
      note(r.json.error || 'Pairing failed; paste a device token in the settings panel.', false);
    }
    openPanel();
    return '';
  }

  function note(text, ok) {
    var n = document.createElement('div');
    n.textContent = text;
    n.setAttribute('role', 'status');
    n.style.cssText = 'position:fixed;right:16px;bottom:72px;z-index:2147483647;max-width:340px;padding:10px 14px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;color:#fff;background:' + (ok ? '#2f6f4f' : '#8a2f2f') + ';box-shadow:0 6px 24px rgba(0,0,0,.25)';
    document.body.appendChild(n); setTimeout(function () { n.remove(); }, 7000);
  }

  async function sendOne(view) {
    var payload = await everloomExtract(view);
    if (!payload) return { ok: false, error: 'No character found on this page' };
    log('payload', payload.file ? { file: payload.file.name, bytes: payload.file.data.length } : payload);
    if (cfg.debug) {
      // Bridge debug: what was found, without file contents and with no token, copied for a bug report.
      var report = JSON.stringify({ page: payload.page, site: payload.site, hidden: !!payload.hidden, nsfw: !!payload.nsfw, file: payload.file ? { name: payload.file.name, base64Length: payload.file.data.length } : null, card: payload.card || null, avatar: payload.avatar ? 'base64 (' + payload.avatar.length + ')' : payload.avatarUrl || null, script: '${USERSCRIPT_VERSION}' }, null, 1);
      try { GM_setClipboard(report, 'text'); } catch (e) {}
    }
    if (cfg.debug && !confirm('Everloom bridge (debug)\\n\\n' + JSON.stringify(Object.assign({}, payload, payload.file ? { file: { name: payload.file.name, base64Length: payload.file.data.length } } : {}, payload.avatar ? { avatar: '(' + payload.avatar.length + ' base64 chars)' } : {}), null, 1).slice(0, 1500) + '\\n\\nSend it?')) return { ok: false, error: 'Cancelled' };
    var t = await ensureToken();
    if (!t) return { ok: false, error: 'Not paired yet' };
    var r = await call('POST', '/api/bridge/import', payload, t);
    if (r.status === 401) GM_setValue('everloom_token', '');
    return r.status === 200 ? { ok: true, name: r.json.name, hidden: payload.hidden } : { ok: false, error: r.status === 401 ? 'Everloom did not accept this device. Pair it again.' : (r.json.error || 'Everloom answered ' + r.status) };
  }

  // One button on character pages; "Send all" on pages that list characters.
  var bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;display:none;gap:8px;font:600 14px system-ui,sans-serif';
  function button(label) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.style.cssText = 'padding:9px 14px;border:0;border-radius:999px;color:#1c1917;background:#e8b04b;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.2);font:inherit';
    bar.appendChild(b); return b;
  }
  var one = button('Send to Everloom');
  var many = button('Send all');
  var gear = button('⚙');
  gear.setAttribute('aria-label', 'Everloom bridge settings');
  gear.style.padding = '9px 12px';

  one.addEventListener('click', async function () {
    one.disabled = true; one.textContent = 'Sending…';
    try {
      var r = await sendOne(everloomView(gm));
      note(r.ok ? (r.name || 'Character') + ' is in your Everloom library' + (r.hidden ? ' (definition hidden by creator).' : '.') : r.error, r.ok);
    } catch (e) { note('Could not read this page: ' + e.message, false); }
    finally { one.disabled = false; one.textContent = 'Send to Everloom'; }
  });
  many.addEventListener('click', async function () {
    var links = everloomCharacterLinks(everloomView(gm)).slice(0, 50);
    if (!links.length) return note('No characters found on this page.', false);
    if (!confirm('Send ' + links.length + ' characters to Everloom? They are fetched one at a time, slowly.')) return;
    var done = 0, failed = 0;
    for (var i = 0; i < links.length; i++) {
      many.textContent = 'Sending ' + (i + 1) + '/' + links.length + '…';
      var r = await sendOne(await linkView(links[i]));
      if (r.ok) done++; else { failed++; log('failed', links[i], r.error); }
      await new Promise(function (res) { setTimeout(res, 1500); });
    }
    many.textContent = 'Send all';
    note(done + ' sent' + (failed ? ', ' + failed + ' could not be read' : '') + '.', !failed);
  });
  gear.addEventListener('click', openPanel);
  GM_registerMenuCommand('Everloom bridge settings', openPanel);

  /** A character on another page, read without opening it: its own page's meta, plus the site reader. */
  async function linkView(url) {
    var doc = null;
    var v = everloomView(gm);
    v.url = url;
    // Generic pages need the other page's markup; site readers use the APIs and don't call these.
    v.meta = function (p) { if (!doc) return ''; var el = doc.querySelector('meta[property="og:' + p + '"],meta[name="' + p + '"]'); return el ? el.getAttribute('content') || '' : ''; };
    v.title = function () { return doc ? doc.title : ''; };
    v.h1 = function () { var h = doc && doc.querySelector('h1'); return h ? h.textContent.trim() : ''; };
    v.links = function () { return doc ? Array.prototype.map.call(doc.querySelectorAll('a[href]'), function (a) { return new URL(a.getAttribute('href'), url).href; }) : []; };
    v.json = function (sel) { var el = doc && doc.querySelector(sel); try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; } };
    var site = everloomSite(url);
    if (!site.site || site.site.read === readGeneric) doc = new DOMParser().parseFromString((await gm(url, false, true)) || '', 'text/html');
    return v;
  }

  function openPanel() {
    if (document.getElementById('everloom-bridge-panel')) return;
    var p = document.createElement('div');
    p.id = 'everloom-bridge-panel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Everloom bridge settings');
    p.style.cssText = 'position:fixed;right:16px;bottom:72px;z-index:2147483647;width:320px;padding:16px;border-radius:12px;background:#1c1917;color:#f5f5f4;font:14px/1.4 system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.35)';
    p.innerHTML = '<b>Everloom bridge</b>' +
      '<label style="display:block;margin-top:10px">Everloom address<input data-k="origin" style="width:100%;margin-top:4px;padding:6px;border-radius:6px;border:1px solid #444;background:#292524;color:inherit"></label>' +
      '<label style="display:block;margin-top:10px">Device token<input data-k="token" type="password" placeholder="evb_…" style="width:100%;margin-top:4px;padding:6px;border-radius:6px;border:1px solid #444;background:#292524;color:inherit"></label>' +
      '<label style="display:flex;gap:6px;align-items:center;margin-top:10px"><input data-k="debug" type="checkbox"> Debug: show and copy what is found</label>' +
      '<div style="display:flex;gap:8px;margin-top:12px"><button data-a="test">Test</button><button data-a="save">Save</button><button data-a="close">Close</button></div>' +
      '<p data-k="out" style="margin:8px 0 0;font-size:12px;color:#d6d3d1"></p>';
    p.querySelectorAll('button').forEach(function (b) { b.style.cssText = 'flex:1;padding:6px;border:0;border-radius:6px;background:#e8b04b;color:#1c1917;font:600 13px system-ui;cursor:pointer'; });
    var q = function (k) { return p.querySelector('[data-k="' + k + '"]'); };
    q('origin').value = cfg.origin; q('token').value = cfg.token; q('debug').checked = cfg.debug;
    p.querySelector('[data-a="close"]').onclick = function () { p.remove(); };
    p.querySelector('[data-a="save"]').onclick = function () {
      GM_setValue('everloom_origin', q('origin').value.trim().replace(/\\/+$/, ''));
      GM_setValue('everloom_token', q('token').value.trim());
      GM_setValue('everloom_debug', q('debug').checked);
      q('out').textContent = 'Saved.';
    };
    p.querySelector('[data-a="test"]').onclick = async function () {
      q('out').textContent = 'Checking…';
      var r = await call('POST', '/api/bridge/ping', {}, q('token').value.trim());
      q('out').textContent = r.status === 200 ? 'Connected to ' + (r.json.name || 'Everloom') + '.' : (r.json.error || 'No answer');
    };
    document.body.appendChild(p);
  }

  // Single-page sites change the address without reloading: re-check whenever it changes.
  var last = '';
  function update() {
    if (location.href === last) return;
    last = location.href;
    var s = everloomSite(location.href);
    var onCharacter = !!(s.site && s.key);
    one.style.display = onCharacter ? '' : 'none';
    many.style.display = !onCharacter && s.site ? '' : 'none';
    bar.style.display = s.site ? 'flex' : 'none';
  }
  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k];
    history[k] = function () { var r = orig.apply(this, arguments); setTimeout(update, 0); return r; };
  });
  addEventListener('popstate', update);
  setInterval(update, 1000);
  document.body.appendChild(bar);
  update();
  if (PAIR_CODE && !cfg.token) ensureToken();
})();
`;
}

/** The bookmarklet. No token: the player is signed in to Everloom in the window it opens. */
export function bookmarklet(origin: string): string {
  const src = `(function(){var O=${JSON.stringify(origin)};
var w=window.open(O+'/bridge/receive','everloom-bridge');
${EXTRACTORS_JS}
${PAGE_VIEW_JS}
function get(u,bin,cred){return fetch(u,{credentials:cred&&new URL(u).origin===location.origin?'include':'omit'}).then(function(r){if(!r.ok)return null;if(!bin)return r.text();return r.arrayBuffer().then(function(a){var b=new Uint8Array(a),s='';for(var i=0;i<b.length;i+=32768)s+=String.fromCharCode.apply(null,b.subarray(i,i+32768));return btoa(s)})}).catch(function(){return null})}
everloomExtract(everloomView(get)).then(function(p){
if(!p){alert('Everloom: no character found on this page.');if(w)w.close();return}
var msg={type:'everloom-bridge-card',payload:p};
if(!w||w.closed){var t=JSON.stringify(msg);(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){alert('Everloom: your browser blocked the window, so the card was copied instead. In Everloom, open Characters, Browse online, Import from a link, then Paste from bridge.')},function(){prompt('Everloom: copy this and use Paste from bridge in Everloom.',t)});return}
var sent=false;function on(e){if(e.origin===O&&e.data==='everloom-bridge-ready'&&!sent){sent=true;w.postMessage(msg,O);removeEventListener('message',on)}}
addEventListener('message',on);
var n=0,iv=setInterval(function(){if(sent||++n>40){clearInterval(iv);return}try{w.postMessage('everloom-bridge-ping',O)}catch(e){}},500)
})})()`;
  return `javascript:${encodeURIComponent(src.replace(/\n\s*/g, '\n'))}`;
}
