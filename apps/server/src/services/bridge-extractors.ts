/**
 * Per-site readers for the browser bridge, as plain browser JavaScript (they are pasted into the
 * userscript and the bookmarklet, and run by the tests against recorded page fixtures).
 *
 * Each reader gets a `view` of the page the player is looking at:
 *   view.url                    the page address
 *   view.meta(name)             an og:/name= meta value
 *   view.title() / view.h1()    the page title / first heading
 *   view.links()                every link's absolute href
 *   view.json(selector)         parsed JSON from a <script> (Next.js data, JSON-LD), or null
 *   view.getText(url, opts)     GET a URL as text (opts.credentials for the site's own API), or null
 *   view.getBytes(url)          GET a URL as base64, or null
 *
 * and returns the bridge payload ({ page, site, file | card, hidden, nsfw, avatar | avatarUrl }) or
 * null when the page isn't a character. Readers only use what the page itself loads for the
 * player. A creator's "hide definition" choice is always followed: a hidden card sends its public
 * profile only.
 */
export const EXTRACTORS_JS = String.raw`
var EVERLOOM_SITES = [
  { id: 'janitor', hosts: ['janitorai.com'], character: /^\/characters\/([0-9a-f-]{36})/i, list: /\/characters\/[0-9a-f-]{36}/i, read: readJanitor },
  { id: 'jannyai', hosts: ['jannyai.com'], character: /^\/characters\/([^/?#]+)/i, list: /\/characters\/[^/?#]+$/i, read: readGeneric },
  { id: 'botbooru', hosts: ['botbooru.com'], character: /^\/(?:post|posts)\/(\d+)/i, list: /\/post\/\d+/i, read: readBotbooru },
  { id: 'aicc', hosts: ['aicharactercards.com'], character: /^\/(?:[a-z]{2}\/)?cards\/(\d+)/i, list: /\/cards\/\d+$/i, read: readAicc },
  { id: 'chub', hosts: ['chub.ai', 'venus.chub.ai', 'characterhub.org'], character: /^\/characters\/([^/]+\/[^/?#]+)/i, list: /\/characters\/[^/]+\/[^/?#]+$/i, read: readChub },
  { id: 'ctavern', hosts: ['character-tavern.com'], character: /^\/character\/([^/]+\/[^/?#]+)/i, list: /\/character\/[^/]+\/[^/?#]+$/i, read: readCtavern },
  { id: 'risu', hosts: ['realm.risuai.net'], character: /^\/character\/([0-9a-f-]{36})/i, list: /\/character\/[0-9a-f-]{36}$/i, read: readRisu },
  { id: 'datacat', hosts: ['datacat.run'], character: /^\/(?:c|character|characters)\/([^/?#]+)/i, list: /\/(?:c|character|characters)\/[^/?#]+$/i, read: readGeneric },
  { id: 'saucepan', hosts: ['saucepan.ai'], character: /^\/(?:companion|c)\/([0-9a-f-]{36})/i, list: /\/companion\/[0-9a-f-]{36}$/i, read: readGeneric },
  { id: 'pygmalion', hosts: ['pygmalion.chat'], character: /^\/character\/([0-9a-f-]{36})/i, list: /\/character\/[0-9a-f-]{36}$/i, read: readGeneric },
  { id: 'wyvern', hosts: ['app.wyvern.chat', 'wyvern.chat'], character: /^\/characters\/([A-Za-z0-9_-]{8,})/i, list: /\/characters\/[A-Za-z0-9_-]{8,}$/i, read: readGeneric }
];

function everloomSite(url) {
  var u = new URL(url);
  var host = u.hostname.replace(/^www\./, '');
  for (var i = 0; i < EVERLOOM_SITES.length; i++) {
    var s = EVERLOOM_SITES[i];
    if (s.hosts.indexOf(host) >= 0) {
      var m = s.character.exec(u.pathname);
      return { site: s, key: m ? decodeURIComponent(m[1]) : null };
    }
  }
  return { site: null, key: null };
}

/** Character links on a listing page (search, creator profile), for "Import all". */
function everloomCharacterLinks(view) {
  var here = everloomSite(view.url);
  var seen = {};
  var out = [];
  view.links().forEach(function (h) {
    try {
      var u = new URL(h, view.url);
      var s = everloomSite(u.href);
      if (!s.site || !s.key || s.site !== here.site || seen[s.key]) return;
      seen[s.key] = 1;
      out.push(u.origin + u.pathname);
    } catch (e) {}
  });
  return out;
}

async function everloomExtract(view) {
  var s = everloomSite(view.url);
  if (s.site && s.key) {
    var r = await s.site.read(view, s.key, s.site.id);
    if (r) return r;
  }
  return readGeneric(view, s.key, s.site ? s.site.id : new URL(view.url).hostname.replace(/^www\./, ''));
}

function stripHtml(h) {
  return String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
function parseJson(t) {
  try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
}
async function picture(view, url) {
  if (!url) return {};
  var abs = new URL(url, view.url).href;
  var data = await view.getBytes(abs);
  return data ? { avatar: data } : { avatarUrl: abs };
}
async function cardFile(view, url, site, extra) {
  var data = await view.getBytes(new URL(url, view.url).href);
  if (!data) return null;
  var name = decodeURIComponent(String(url).split('/').pop().split('?')[0] || 'card');
  return Object.assign({ page: view.url, site: site, file: { name: name, data: data } }, extra || {});
}

/** JanitorAI: the site's own character endpoint; "show definition" off means public profile only. */
async function readJanitor(view, id) {
  var c = parseJson(await view.getText('/hampter/characters/' + id, { credentials: true }));
  if (!c || !c.name) return null;
  var hidden = c.showdefinition === false;
  var pic = await picture(view, c.avatar ? 'https://ella.janitorai.com/bot-avatars/' + c.avatar : view.meta('image'));
  return Object.assign({
    page: view.url, site: 'janitor', hidden: hidden, nsfw: !!c.is_nsfw,
    card: {
      name: c.name, creator: c.creator_name || '', creator_notes: stripHtml(c.description),
      description: hidden ? '' : (c.personality || ''), scenario: hidden ? '' : (c.scenario || ''),
      first_mes: hidden ? '' : (c.first_message || ''), mes_example: hidden ? '' : (c.example_dialogs || ''),
      tags: (c.tags || []).map(function (t) { return t && t.name ? t.name : String(t); }).slice(0, 40)
    }
  }, pic);
}

/** Botbooru: its own card download. */
async function readBotbooru(view, id) {
  return cardFile(view, '/download/png/' + id, 'botbooru');
}

/** AI Character Cards: the current version of the card file, as its page lists it. */
async function readAicc(view, id) {
  var d = parseJson(await view.getText('https://api.aicharactercards.com/api/cards/' + id));
  d = d && (d.data || d);
  if (!d || !d.versions) return null;
  var cur = d.versions.filter(function (v) { return v.isCurrent; })[0] || d.versions[d.versions.length - 1];
  if (!cur || !cur.fileUrl) return null;
  return cardFile(view, new URL(cur.fileUrl, 'https://api.aicharactercards.com').href, 'aicc', { nsfw: !!d.isNsfw });
}

/** Chub: the card PNG it serves for download. */
async function readChub(view, path) {
  return cardFile(view, 'https://avatars.charhub.io/avatars/' + path + '/chara_card_v2.png', 'chub');
}

/** Character Tavern: the card PNG on its card host. */
async function readCtavern(view, path) {
  return cardFile(view, 'https://ct-cards.storage.character-tavern.com/' + path + '.png', 'ctavern');
}

/** RisuRealm: its own download (PNG with the card inside, or the CHARX for cards stored that way). */
async function readRisu(view, id) {
  return (await cardFile(view, '/api/v1/download/png-v3/' + id, 'risu')) || cardFile(view, '/api/v1/download/charx-v3/' + id, 'risu');
}

/** Anything else: a card file the page links to, else the public profile only. */
async function readGeneric(view, key, site) {
  var links = view.links();
  var file = links.filter(function (h) { return /\.(png|json|charx)(\?|#|$)/i.test(h) && /(card|download|chara|character|export)/i.test(h); })[0];
  if (file) {
    var f = await cardFile(view, file, site);
    if (f) return f;
  }
  var ld = view.json('script[type="application/ld+json"]');
  var name = view.meta('title') || (ld && ld.name) || view.h1() || view.title();
  if (!name) return null;
  var pic = await picture(view, view.meta('image') || (ld && ld.image));
  return Object.assign({ page: view.url, site: site, hidden: true, card: { name: String(name).slice(0, 200), creator_notes: String(view.meta('description') || (ld && ld.description) || '').slice(0, 4000) } }, pic);
}
`;

/**
 * The view the userscript and bookmarklet build from the real page. `get` does the requests:
 * the userscript passes one using GM_xmlhttpRequest (no CORS or page CSP in the way), the
 * bookmarklet plain fetch.
 */
export const PAGE_VIEW_JS = String.raw`
function everloomView(get) {
  return {
    url: location.href,
    meta: function (p) {
      var el = document.querySelector('meta[property="og:' + p + '"],meta[name="og:' + p + '"],meta[name="' + p + '"],meta[name="twitter:' + p + '"]');
      return el ? el.getAttribute('content') || '' : '';
    },
    title: function () { return document.title || ''; },
    h1: function () { var h = document.querySelector('h1'); return h ? (h.textContent || '').trim() : ''; },
    links: function () { return Array.prototype.map.call(document.querySelectorAll('a[href]'), function (a) { return a.href; }); },
    json: function (sel) { var el = document.querySelector(sel); try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; } },
    getText: function (url, opts) { return get(new URL(url, location.href).href, false, opts && opts.credentials); },
    getBytes: function (url) { return get(new URL(url, location.href).href, true, false); }
  };
}
`;
