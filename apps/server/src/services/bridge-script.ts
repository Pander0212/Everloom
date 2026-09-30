/**
 * The "Send to Everloom" userscript and bookmarklet. Both read only what the page in front of the
 * player shows (a linked card file, or the public profile). Neither tries to reveal a definition
 * the creator hid: for JanitorAI the site's own "show definition" flag decides, and a hidden card
 * sends its public profile only.
 */

/** Sites the userscript runs on (the bridge-only sites from the capability matrix). */
export const BRIDGE_MATCHES = ['https://janitorai.com/characters/*', 'https://jannyai.com/characters/*', 'https://botbooru.com/*', 'https://aicharactercards.com/*', 'https://datacat.run/*'];

/**
 * Page reader shared by both. `get(url, binary)` returns text or base64 (or null); the userscript
 * passes one that can read cross-origin files, the bookmarklet uses fetch.
 */
const COLLECT = String.raw`
async function everloomCollect(get) {
  const page = location.href;
  const host = location.hostname.replace(/^www\./, '');
  const meta = (p) => document.querySelector('meta[property="og:' + p + '"],meta[name="og:' + p + '"],meta[name="' + p + '"]')?.getAttribute('content') || '';
  const strip = (h) => { const d = document.createElement('div'); d.innerHTML = String(h || ''); return (d.textContent || '').trim(); };
  const pic = async (u) => (u ? await get(new URL(u, page).href, true) : null);
  if (host === 'janitorai.com') {
    const id = (/\/characters\/([0-9a-f-]{36})/.exec(location.pathname) || [])[1];
    if (id) {
      const raw = await get('/hampter/characters/' + id, false);
      if (raw) {
        const c = JSON.parse(raw);
        // The creator's choice: a hidden definition stays hidden.
        const hidden = c.showdefinition === false;
        return { page, site: 'janitor', hidden, nsfw: !!c.is_nsfw, card: {
          name: c.name || meta('title'), creator_notes: strip(c.description), creator: c.creator_name || '',
          description: hidden ? '' : (c.personality || ''), scenario: hidden ? '' : (c.scenario || ''),
          first_mes: hidden ? '' : (c.first_message || ''), mes_example: hidden ? '' : (c.example_dialogs || ''),
          tags: (c.tags || []).map((t) => t.name || String(t)).slice(0, 40) },
          avatar: await pic(c.avatar ? 'https://ella.janitorai.com/bot-avatars/' + c.avatar : meta('image')) };
      }
    }
  }
  // A card file the page links to (its own download button).
  const links = [...document.querySelectorAll('a[href]')].map((a) => a.href);
  const file = links.find((h) => /\.(png|json|charx)(\?|#|$)/i.test(h) && /(card|download|chara|character|export)/i.test(h));
  if (file) {
    const data = await get(file, true);
    if (data) return { page, site: host, file: { name: decodeURIComponent(file.split('/').pop().split('?')[0]), data } };
  }
  // Otherwise the public profile only.
  const name = meta('title') || document.querySelector('h1')?.textContent?.trim() || document.title;
  return { page, site: host, hidden: true, card: { name: name.slice(0, 200), creator_notes: (meta('description') || '').slice(0, 4000) }, avatar: await pic(meta('image')) };
}`;

export function userscript(origin: string): string {
  const host = new URL(origin).host.replace(/:\d+$/, '');
  return `// ==UserScript==
// @name         Send to Everloom
// @namespace    everloom
// @version      1.0
// @description  Send the character card on this page to your Everloom library (${origin}).
${BRIDGE_MATCHES.map((m) => `// @match        ${m}`).join('\n')}
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      ${host}
// @connect      *
// ==/UserScript==
(function () {
  'use strict';
  const ORIGIN = ${JSON.stringify(origin)};
  ${COLLECT}
  function gm(url, binary) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({ method: 'GET', url, responseType: binary ? 'arraybuffer' : 'text', timeout: 30000,
        onload: (r) => {
          if (r.status !== 200) return resolve(null);
          if (!binary) return resolve(r.responseText);
          const b = new Uint8Array(r.response); let s = '';
          for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
          resolve(btoa(s));
        }, onerror: () => resolve(null), ontimeout: () => resolve(null) });
    });
  }
  function token() {
    let t = GM_getValue('everloom_token', '');
    if (!t) { t = (prompt('Paste your Everloom device token (Settings → Characters → Browser bridge):') || '').trim(); if (t) GM_setValue('everloom_token', t); }
    return t;
  }
  GM_registerMenuCommand('Everloom: change device token', () => { GM_setValue('everloom_token', ''); token(); });
  function note(text, ok) {
    const n = document.createElement('div');
    n.textContent = text;
    n.setAttribute('role', 'status');
    n.style.cssText = 'position:fixed;right:16px;bottom:64px;z-index:2147483647;max-width:320px;padding:10px 14px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;color:#fff;background:' + (ok ? '#2f6f4f' : '#8a2f2f') + ';box-shadow:0 6px 24px rgba(0,0,0,.25)';
    document.body.appendChild(n); setTimeout(() => n.remove(), 6000);
  }
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = 'Send to Everloom';
  b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:9px 14px;border:0;border-radius:999px;font:600 14px system-ui,sans-serif;color:#1c1917;background:#e8b04b;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.2)';
  b.addEventListener('click', async () => {
    const t = token(); if (!t) return;
    b.disabled = true; b.textContent = 'Sending…';
    try {
      const payload = await everloomCollect((u, bin) => (u.startsWith('/') ? fetch(u, { credentials: 'include' }).then((r) => (r.ok ? r.text() : null)).catch(() => null) : gm(u, bin)));
      GM_xmlhttpRequest({ method: 'POST', url: ORIGIN + '/api/bridge/import', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, data: JSON.stringify(payload), timeout: 60000,
        onload: (r) => { let j = {}; try { j = JSON.parse(r.responseText); } catch (e) {}
          if (r.status === 200) note((j.name || 'Character') + ' is in your Everloom library' + (payload.hidden ? ' (definition hidden by creator)' : '') + '.', true);
          else if (r.status === 401) { GM_setValue('everloom_token', ''); note('Everloom did not accept this device token. Add the device again in Settings.', false); }
          else note(j.error || ('Everloom answered ' + r.status), false); },
        onerror: () => note('Could not reach Everloom at ' + ORIGIN, false) });
    } catch (e) { note('Could not read this page: ' + e.message, false); }
    finally { b.disabled = false; b.textContent = 'Send to Everloom'; }
  });
  document.body.appendChild(b);
})();
`;
}

/**
 * The bookmarklet: reads the page, opens Everloom's receive page and hands the card over with
 * postMessage. No token is needed because the player is signed in to Everloom in that tab.
 */
export function bookmarklet(origin: string): string {
  const src = `(async()=>{const O=${JSON.stringify(origin)};${COLLECT}
const get=async(u,bin)=>{try{const r=await fetch(u,{credentials:u.startsWith('/')?'include':'omit'});if(!r.ok)return null;if(!bin)return await r.text();const b=new Uint8Array(await r.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode.apply(null,b.subarray(i,i+32768));return btoa(s)}catch(e){return null}};
const p=await everloomCollect(get);const w=window.open(O+'/bridge/receive','everloom-bridge');
const on=(e)=>{if(e.origin===O&&e.data==='everloom-bridge-ready'){w.postMessage({type:'everloom-bridge-card',payload:p},O);removeEventListener('message',on)}};addEventListener('message',on)})()`;
  return `javascript:${encodeURIComponent(src.replace(/\n\s*/g, '\n'))}`;
}
