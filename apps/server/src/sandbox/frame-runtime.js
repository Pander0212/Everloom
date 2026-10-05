/*
 * Everloom script sandbox: the runtime inside every script, panel and message frame.
 *
 * The frame is sandboxed (allow-scripts only: an opaque origin with no cookies, storage or access to
 * the app) and its policy forbids every network request. The only way out is postMessage to the
 * app, which checks each call against the permissions the owner approved. This file sets up that
 * bridge, the `everloom` API, a few design-system styles, and (when asked) globals compatible with
 * Tavern Helper's documented function names, written for Everloom from the public documentation.
 *
 * Plain ES2020; no build step. Served inline in /api/sandbox/frame.
 */
(function () {
  'use strict';
  var parentWin = window.parent;
  var ready = false;
  var seq = 0;
  var pending = new Map();
  var handlers = new Map(); // event name -> [fn]
  var callables = new Map(); // "slash:name" etc -> fn
  var init = null;
  var subscribed = new Set();

  function post(msg) {
    msg.ev = 1;
    try {
      parentWin.postMessage(msg, '*');
    } catch (e) {
      /* the app went away */
    }
  }

  function fmt(a) {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'string') return a;
    try {
      return JSON.stringify(a);
    } catch (e) {
      return String(a);
    }
  }
  // Logs go to the script's console in Everloom (and the browser's).
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var orig = console[level] ? console[level].bind(console) : function () {};
    console[level] = function () {
      var args = Array.prototype.slice.call(arguments);
      post({ t: 'log', level: level === 'debug' ? 'log' : level, args: args.map(fmt).map(function (s) { return s.slice(0, 4000); }) });
      orig.apply(null, args);
    };
  });
  window.addEventListener('error', function (e) {
    post({ t: 'log', level: 'error', args: [(e.error && e.error.stack) || e.message || 'Script error'] });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    post({ t: 'log', level: 'error', args: ['Unhandled: ' + ((r && (r.stack || r.message)) || fmt(r))] });
  });

  function rpc(method, args) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject });
      post({ t: 'rpc', id: id, method: method, args: args === undefined ? null : args });
    });
  }

  function emitLocal(name, data) {
    var list = handlers.get(name);
    if (!list) return [];
    return list.slice().map(function (fn) {
      try {
        return fn(data);
      } catch (e) {
        console.error(e);
        return undefined;
      }
    });
  }

  function on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError('everloom.on needs a function');
    var list = handlers.get(name) || [];
    list.push(fn);
    handlers.set(name, list);
    if (!subscribed.has(name)) {
      subscribed.add(name);
      post({ t: 'subscribe', name: name });
    }
    return function () {
      off(name, fn);
    };
  }
  function off(name, fn) {
    var list = handlers.get(name);
    if (!list) return;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  // ------------------------------------------------------------ height
  var lastH = 0;
  function reportHeight() {
    var h = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
    if (Math.abs(h - lastH) > 1) {
      lastH = h;
      post({ t: 'height', h: h });
    }
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(reportHeight).observe(document.documentElement);

  // ------------------------------------------------------------ theme and kit
  var KIT =
    ':root{color-scheme:light dark}' +
    'html,body{margin:0;padding:0;background:transparent;color:var(--text,#222);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Inter Variable","Inter",system-ui,sans-serif;overflow-wrap:anywhere;-webkit-font-smoothing:antialiased}' +
    'body{padding:2px}' +
    'a{color:var(--accent-text,#b86b00)}' +
    'img,video,canvas{max-width:100%;height:auto}' +
    '.ev-card{background:var(--surface,#fff);border:1px solid var(--border,#e3e1db);border-radius:12px;padding:12px}' +
    '.ev-stack{display:flex;flex-direction:column;gap:8px}.ev-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}' +
    '.ev-muted{color:var(--text-2,#666);font-size:13px}.ev-title{font-weight:600;font-size:16px;margin:0 0 4px}' +
    '.ev-btn{appearance:none;border:0;border-radius:10px;min-height:40px;padding:0 14px;font:inherit;font-weight:500;cursor:pointer;background:var(--surface-2,#f1f1f1);color:var(--text,#222)}' +
    '.ev-btn:hover{filter:brightness(.97)}.ev-btn:focus-visible{outline:2px solid var(--accent,#d8a24a);outline-offset:2px}' +
    '.ev-btn.primary{background:var(--accent,#d8a24a);color:var(--accent-fg,#1b1408)}.ev-btn.danger{background:var(--danger-soft,#fde8e8);color:var(--danger,#b42318)}' +
    '.ev-btn:disabled{opacity:.5;cursor:default}' +
    '.ev-input,.ev-select,textarea.ev-input{width:100%;box-sizing:border-box;min-height:40px;border:1px solid transparent;border-radius:10px;padding:8px 12px;font:inherit;background:var(--surface-2,#f1f1f1);color:var(--text,#222)}' +
    '.ev-input:focus,.ev-select:focus{outline:none;box-shadow:0 0 0 2px var(--accent-soft,#f3e1bd)}' +
    '.ev-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 10px;font-size:13px;background:var(--surface-2,#f1f1f1)}' +
    '.ev-bar{height:8px;border-radius:99px;background:var(--surface-3,#e6e6e6);overflow:hidden}.ev-bar>span{display:block;height:100%;background:var(--accent,#d8a24a);border-radius:inherit;transition:width .3s}' +
    '@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}';
  var themeEl = document.createElement('style');
  var kitEl = document.createElement('style');
  kitEl.textContent = KIT;
  document.head.appendChild(kitEl);
  document.head.appendChild(themeEl);
  function applyTheme(vars, dark) {
    var css = ':root{';
    for (var k in vars) if (/^--[\w-]+$/.test(k)) css += k + ':' + String(vars[k]).replace(/[;{}<]/g, '') + ';';
    themeEl.textContent = css + 'color-scheme:' + (dark ? 'dark' : 'light') + '}';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  // ------------------------------------------------------------ running code and HTML
  function runScript(code) {
    var s = document.createElement('script');
    s.textContent = code;
    document.body.appendChild(s);
  }

  /** Put HTML into the document, running its scripts in order (inline only; the policy blocks the rest). */
  function mountHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    // Styles and scripts from <head> first.
    Array.prototype.forEach.call(doc.head.children, function (el) {
      if (el.tagName === 'STYLE') document.head.appendChild(document.importNode(el, true));
      else if (el.tagName === 'SCRIPT') pendingScripts.push(el);
      else if (el.tagName === 'LINK' || el.tagName === 'META' || el.tagName === 'BASE') return;
    });
    var scripts = [];
    Array.prototype.forEach.call(doc.body.childNodes, function (n) {
      document.body.appendChild(document.importNode(n, true));
    });
    Array.prototype.forEach.call(document.body.querySelectorAll('script'), function (el) {
      scripts.push(el);
    });
    var all = pendingScripts.concat(scripts);
    pendingScripts = [];
    all.forEach(function (old) {
      var type = (old.getAttribute('type') || '').toLowerCase();
      if (type && type !== 'text/javascript' && type !== 'module' && type !== 'application/javascript') return;
      var s = document.createElement('script');
      if (type === 'module') s.type = 'module';
      s.textContent = old.textContent;
      // Body scripts run where they stood; head scripts run (first) at the end of the body.
      if (old.parentNode && document.contains(old)) old.parentNode.replaceChild(s, old);
      else document.body.appendChild(s);
    });
    document.dispatchEvent(new Event('DOMContentLoaded'));
    window.dispatchEvent(new Event('load'));
    setTimeout(reportHeight, 0);
  }
  var pendingScripts = [];

  // ------------------------------------------------------------ the everloom API
  var ctx = {};
  var everloom = {
    version: 1,
    get context() {
      return Object.assign({}, ctx);
    },
    on: on,
    off: off,
    once: function (name, fn) {
      var stop = on(name, function (d) {
        stop();
        return fn(d);
      });
      return stop;
    },
    chat: {
      messages: function (opts) {
        return rpc('chat.messages', opts || {});
      },
      get: function (id) {
        return rpc('chat.get', { id: id });
      },
      send: function (text, opts) {
        return rpc('chat.send', Object.assign({ text: String(text) }, opts || {}));
      },
      add: function (m) {
        return rpc('chat.add', m);
      },
      edit: function (id, text) {
        return rpc('chat.edit', { id: id, text: String(text) });
      },
      hide: function (id, hidden) {
        return rpc('chat.hide', { id: id, hidden: hidden !== false });
      },
      delete: function (id) {
        return rpc('chat.delete', { id: id });
      },
      swipe: function (id, to) {
        return rpc('chat.swipe', { id: id, to: to });
      },
      current: function () {
        return rpc('chat.current');
      },
    },
    generate: function (opts) {
      opts = opts || {};
      if (typeof opts.onToken === 'function') {
        var cb = opts.onToken;
        var tag = 'gen' + ++seq;
        var stop = on('generate.' + tag, function (d) {
          cb(d.text, d.full);
        });
        return rpc('generate', Object.assign({}, opts, { onToken: undefined, stream: tag })).then(
          function (r) {
            stop();
            return r;
          },
          function (e) {
            stop();
            throw e;
          },
        );
      }
      return rpc('generate', opts);
    },
    vars: {
      get: function (key, opts) {
        return rpc('vars.get', Object.assign({ key: key }, opts || {}));
      },
      all: function (opts) {
        return rpc('vars.all', opts || {});
      },
      set: function (key, value, opts) {
        return rpc('vars.set', Object.assign({ key: key, value: value === undefined ? null : value }, opts || {}));
      },
      delete: function (key, opts) {
        return rpc('vars.set', Object.assign({ key: key, value: null }, opts || {}));
      },
    },
    lore: {
      list: function () {
        return rpc('lore.list');
      },
      entries: function (book) {
        return rpc('lore.entries', { book: book });
      },
      setEntry: function (book, entry) {
        return rpc('lore.setEntry', { book: book, entry: entry });
      },
      createEntry: function (book, entry) {
        return rpc('lore.createEntry', { book: book, entry: entry });
      },
      deleteEntry: function (book, uid) {
        return rpc('lore.deleteEntry', { book: book, uid: uid });
      },
    },
    characters: {
      current: function () {
        return rpc('characters.current');
      },
    },
    persona: {
      current: function () {
        return rpc('persona.current');
      },
    },
    state: {
      get: function () {
        return rpc('state.get');
      },
      propose: function (ops) {
        return rpc('state.propose', { ops: Array.isArray(ops) ? ops : [ops] });
      },
    },
    ui: {
      toast: function (message, opts) {
        return rpc('ui.toast', Object.assign({ message: String(message) }, opts || {}));
      },
      panel: function (opts) {
        return rpc('ui.panel', opts || {});
      },
      closePanel: function () {
        return rpc('ui.closePanel');
      },
      modal: function (opts) {
        return rpc('ui.modal', opts || {});
      },
      resize: reportHeight,
    },
    audio: {
      play: function (src, opts) {
        return rpc('audio.play', Object.assign({ src: src }, opts || {}));
      },
      stop: function (id) {
        return rpc('audio.stop', { id: id });
      },
    },
    storage: {
      get: function (k) {
        return rpc('storage.get', { k: k });
      },
      all: function () {
        return rpc('storage.get', {});
      },
      set: function (k, v) {
        return rpc('storage.set', { k: k, value: v === undefined ? null : v });
      },
      delete: function (k) {
        return rpc('storage.set', { k: k, value: null });
      },
    },
    net: {
      fetch: function (url, opts) {
        return rpc('net.fetch', Object.assign({ url: String(url) }, opts || {}));
      },
    },
    slash: {
      run: function (line) {
        return rpc('slash.run', { line: String(line) });
      },
      register: function (name, opts, fn) {
        if (typeof opts === 'function') {
          fn = opts;
          opts = {};
        }
        name = String(name).toLowerCase().replace(/^\//, '');
        callables.set('slash:' + name, fn);
        return rpc('slash.register', { name: name, help: (opts && opts.help) || '', usage: (opts && opts.usage) || '' });
      },
    },
    macros: {
      set: function (name, value) {
        return rpc('macros.set', { name: String(name), value: value === undefined || value === null ? '' : String(value) });
      },
    },
    log: function () {
      console.log.apply(console, arguments);
    },
  };

  // ------------------------------------------------------------ Tavern Helper compatibility
  // A smaller, independent implementation of the most used Tavern Helper globals, mapped onto the
  // bridge above (same permissions, same sandbox). Reads that Tavern Helper answers synchronously
  // are served from a snapshot the app keeps current; writes go through the bridge.
  function installCompat(snap) {
    var cache = {
      chat: snap.vars.chat || {},
      global: snap.vars.global || {},
      character: snap.vars.character || {},
      script: snap.vars.script || {},
      messages: snap.messages || [],
    };
    function clone(v) {
      return v === undefined ? v : JSON.parse(JSON.stringify(v));
    }
    function isObj(v) {
      return v && typeof v === 'object' && !Array.isArray(v);
    }
    function merge(a, b) {
      var out = isObj(a) ? clone(a) : {};
      for (var k in b) out[k] = isObj(b[k]) && isObj(out[k]) ? merge(out[k], b[k]) : clone(b[k]);
      return out;
    }
    function path(p) {
      return String(p).replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
    }
    function getPath(o, p, d) {
      var parts = path(p);
      for (var i = 0; i < parts.length; i++) {
        if (o == null) return d;
        o = o[parts[i]];
      }
      return o === undefined ? d : o;
    }
    function setPath(o, p, v) {
      var parts = path(p);
      var cur = o;
      for (var i = 0; i < parts.length - 1; i++) {
        if (!isObj(cur[parts[i]]) && !Array.isArray(cur[parts[i]])) cur[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = v;
      return o;
    }
    function unsetPath(o, p) {
      var parts = path(p);
      var cur = o;
      for (var i = 0; i < parts.length - 1; i++) {
        if (cur == null) return false;
        cur = cur[parts[i]];
      }
      if (cur == null || !(parts[parts.length - 1] in cur)) return false;
      delete cur[parts[parts.length - 1]];
      return true;
    }
    function msgIndex(id) {
      if (id === undefined || id === null || id === 'latest') return cache.messages.length - 1;
      var n = Number(id);
      return n < 0 ? cache.messages.length + n : n;
    }
    function scopeOf(opt) {
      var t = (opt && opt.type) || 'chat';
      return t === 'message' || t === 'chat' || t === 'global' || t === 'character' || t === 'script' ? t : 'chat';
    }
    function readScope(opt) {
      var t = scopeOf(opt);
      if (t === 'message') {
        var m = cache.messages[msgIndex(opt && opt.message_id !== undefined ? opt.message_id : ctx.messageIndex)];
        return m ? m.data || {} : {};
      }
      return cache[t] || {};
    }
    function writeScope(opt, value) {
      var t = scopeOf(opt);
      if (t === 'message') {
        var idx = msgIndex(opt && opt.message_id !== undefined ? opt.message_id : ctx.messageIndex);
        var m = cache.messages[idx];
        if (!m) throw new Error('No message ' + idx);
        m.data = value;
        return rpc('vars.replace', { scope: 'message', messageId: m.id, value: value });
      }
      cache[t] = value;
      if (t === 'script') return rpc('storage.set', { k: '__variables', value: value });
      return rpc('vars.replace', { scope: t, value: value });
    }

    var g = window;
    g.getVariables = function (opt) {
      return clone(readScope(opt));
    };
    g.replaceVariables = function (vars, opt) {
      writeScope(opt, clone(vars || {}));
    };
    g.insertOrAssignVariables = function (vars, opt) {
      var v = merge(readScope(opt), vars || {});
      writeScope(opt, v);
      return v;
    };
    g.insertVariables = function (vars, opt) {
      var cur = readScope(opt);
      var v = merge(vars || {}, cur);
      writeScope(opt, v);
      return v;
    };
    g.updateVariablesWith = function (fn, opt) {
      var v = fn(clone(readScope(opt)));
      var apply = function (res) {
        writeScope(opt, res);
        return res;
      };
      return v && typeof v.then === 'function' ? v.then(apply) : apply(v);
    };
    g.deleteVariable = function (p, opt) {
      var v = clone(readScope(opt));
      var did = unsetPath(v, p);
      if (did) writeScope(opt, v);
      return { variables: v, delete_occurred: did };
    };
    g.getChatMessages = function (range, opt) {
      opt = opt || {};
      var list = cache.messages;
      var from = 0;
      var to = list.length - 1;
      if (typeof range === 'number') from = to = msgIndex(range);
      else if (typeof range === 'string') {
        var r = range.replace(/\{\{lastMessageId\}\}/g, String(list.length - 1)).trim();
        var m = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(r);
        if (m) {
          from = msgIndex(Number(m[1]));
          to = msgIndex(Number(m[2]));
        } else if (/^-?\d+$/.test(r)) from = to = msgIndex(Number(r));
      }
      var out = [];
      for (var i = Math.max(0, from); i <= Math.min(to, list.length - 1); i++) {
        var x = list[i];
        if (opt.role && opt.role !== 'all' && opt.role !== x.role) continue;
        if (opt.hide_state === 'hidden' && !x.hidden) continue;
        if (opt.hide_state === 'unhidden' && x.hidden) continue;
        var o = { message_id: i, name: x.name, role: x.role, is_hidden: !!x.hidden, message: x.text, data: clone(x.data || {}), extra: {}, swipe_id: x.swipeId };
        if (opt.include_swipes) {
          o.swipes = x.swipes.slice();
          o.swipes_data = x.swipes.map(function () {
            return {};
          });
        }
        out.push(o);
      }
      return out;
    };
    g.setChatMessages = function (list, opt) {
      return Promise.all(
        (list || []).map(function (c) {
          var x = cache.messages[msgIndex(c.message_id)];
          if (!x) return null;
          var jobs = [];
          if (typeof c.message === 'string') {
            x.text = c.message;
            jobs.push(rpc('chat.edit', { id: x.id, text: c.message }));
          }
          if (c.data) {
            x.data = clone(c.data);
            jobs.push(rpc('vars.replace', { scope: 'message', messageId: x.id, value: c.data }));
          }
          if (typeof c.is_hidden === 'boolean') jobs.push(rpc('chat.hide', { id: x.id, hidden: c.is_hidden }));
          return Promise.all(jobs);
        }),
      ).then(function () {});
    };
    g.setChatMessage = function (fields, id, opt) {
      var c = { message_id: id };
      if (typeof fields === 'string') c.message = fields;
      else Object.assign(c, fields);
      return g.setChatMessages([c], opt);
    };
    g.createChatMessages = function (list, opt) {
      return (list || []).reduce(function (p, c) {
        return p.then(function () {
          return rpc('chat.add', { role: c.role || 'assistant', name: c.name, text: c.message || '', hidden: !!c.is_hidden, data: c.data });
        });
      }, Promise.resolve());
    };
    g.deleteChatMessages = function (ids) {
      return Promise.all(
        (ids || []).map(function (i) {
          var x = cache.messages[msgIndex(i)];
          return x ? rpc('chat.delete', { id: x.id }) : null;
        }),
      ).then(function () {});
    };
    g.getCurrentMessageId = function () {
      if (ctx.messageIndex === undefined) throw new Error('getCurrentMessageId works in message frames only');
      return ctx.messageIndex;
    };
    g.getLastMessageId = function () {
      return cache.messages.length - 1;
    };
    g.getMessageId = function () {
      return g.getCurrentMessageId();
    };
    g.getIframeName = function () {
      return ctx.frameName || '';
    };
    g.getScriptId = function () {
      return ctx.scriptId || '';
    };
    g.triggerSlash = function (cmd) {
      return rpc('slash.run', { line: String(cmd) });
    };
    g.triggerSlashWithResult = g.triggerSlash;
    g.substitudeMacros = function (text) {
      return String(text)
        .replace(/\{\{user\}\}/gi, ctx.userName || 'User')
        .replace(/\{\{char\}\}/gi, ctx.charName || '')
        .replace(/\{\{lastMessageId\}\}/gi, String(cache.messages.length - 1))
        .replace(/\{\{getvar::([^}]+)\}\}/gi, function (_m, k) {
          var v = cache.chat[k.trim()];
          return v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        })
        .replace(/\{\{getglobalvar::([^}]+)\}\}/gi, function (_m, k) {
          var v = cache.global[k.trim()];
          return v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        });
    };
    g.substituteMacros = g.substitudeMacros;
    function genStream(o, raw) {
      var tag = 'th' + ++seq;
      var full = '';
      var stop = on('generate.' + tag, function (d) {
        full = d.full;
        emitLocal(g.iframe_events.STREAM_TOKEN_RECEIVED_INCREMENTALLY, d.text);
        emitLocal(g.iframe_events.STREAM_TOKEN_RECEIVED_FULLY, full);
      });
      emitLocal(g.iframe_events.GENERATION_STARTED, tag);
      return rpc('generate', Object.assign(o, { stream: tag })).then(
        function (r) {
          stop();
          emitLocal(g.iframe_events.GENERATION_ENDED, r, tag);
          return r;
        },
        function (e) {
          stop();
          throw e;
        },
      );
    }
    g.generate = function (cfg) {
      cfg = cfg || {};
      var o = { chat: true, userInput: cfg.user_input || cfg.injects_text || '', maxTokens: cfg.max_tokens };
      return cfg.should_stream ? genStream(o) : rpc('generate', o);
    };
    g.generateRaw = function (cfg) {
      cfg = cfg || {};
      var msgs = [];
      (cfg.ordered_prompts || ['user_input']).forEach(function (p) {
        if (p && typeof p === 'object' && p.content !== undefined) msgs.push({ role: p.role || 'system', content: String(p.content) });
        else if (p === 'user_input' && cfg.user_input) msgs.push({ role: 'user', content: String(cfg.user_input) });
        else if (p === 'chat_history')
          cache.messages.forEach(function (m) {
            if (!m.hidden) msgs.push({ role: m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant', content: m.text });
          });
      });
      if (!msgs.length && cfg.user_input) msgs.push({ role: 'user', content: String(cfg.user_input) });
      var o = { messages: msgs, maxTokens: cfg.max_tokens };
      return cfg.should_stream ? genStream(o, true) : rpc('generate', o);
    };
    g.stopAllGeneration = function () {
      return false;
    };
    // Events: Tavern Helper's names mapped onto Everloom's.
    g.tavern_events = {
      APP_READY: 'app_ready',
      MESSAGE_RECEIVED: 'message_received',
      MESSAGE_SENT: 'message_sent',
      MESSAGE_SWIPED: 'message_swiped',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_DELETED: 'message_deleted',
      MESSAGE_UPDATED: 'message_updated',
      CHAT_CHANGED: 'chat_id_changed',
      GENERATION_STARTED: 'generation_started',
      GENERATION_ENDED: 'generation_ended',
      GENERATION_STOPPED: 'generation_stopped',
      CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
      USER_MESSAGE_RENDERED: 'user_message_rendered',
      GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts',
    };
    g.iframe_events = {
      MESSAGE_IFRAME_RENDER_STARTED: 'message_iframe_render_started',
      MESSAGE_IFRAME_RENDER_ENDED: 'message_iframe_render_ended',
      GENERATION_STARTED: 'js_generation_started',
      STREAM_TOKEN_RECEIVED_FULLY: 'js_stream_token_received_fully',
      STREAM_TOKEN_RECEIVED_INCREMENTALLY: 'js_stream_token_received_incrementally',
      GENERATION_ENDED: 'js_generation_ended',
    };
    var MAP = {
      message: ['message_received', 'character_message_rendered'],
      messageSent: ['message_sent', 'user_message_rendered'],
      swipe: ['message_swiped'],
      edit: ['message_edited', 'message_updated'],
      delete: ['message_deleted'],
      chatOpen: ['chat_id_changed', 'app_ready'],
      generationStart: ['generation_started'],
      generationEnd: ['generation_ended'],
    };
    // Everloom events update the snapshot and fan out under the Tavern Helper names.
    Object.keys(MAP).forEach(function (name) {
      on(name, function (d) {
        if (d && d.messages) cache.messages = d.messages;
        if (d && d.vars) Object.assign(cache, d.vars);
        var idx = d && d.messageIndex !== undefined ? d.messageIndex : cache.messages.length - 1;
        MAP[name].forEach(function (th) {
          emitLocal(th, th === 'chat_id_changed' ? ctx.chatId : th === 'generation_ended' ? idx : idx);
        });
      });
    });
    on('vars', function (d) {
      if (d) Object.assign(cache, d);
    });
    g.eventOn = function (type, fn) {
      var list = handlers.get(type) || [];
      if (list.indexOf(fn) < 0) list.push(fn);
      handlers.set(type, list);
      return {
        stop: function () {
          off(type, fn);
        },
      };
    };
    g.eventMakeLast = g.eventOn;
    g.eventMakeFirst = function (type, fn) {
      var list = handlers.get(type) || [];
      list.unshift(fn);
      handlers.set(type, list);
      return {
        stop: function () {
          off(type, fn);
        },
      };
    };
    g.eventOnce = function (type, fn) {
      var w = function (a, b, c) {
        off(type, w);
        return fn(a, b, c);
      };
      return g.eventOn(type, w);
    };
    g.eventEmit = function (type) {
      var args = Array.prototype.slice.call(arguments, 1);
      var list = handlers.get(type) || [];
      return Promise.all(
        list.slice().map(function (fn) {
          try {
            return fn.apply(null, args);
          } catch (e) {
            console.error(e);
          }
        }),
      ).then(function () {});
    };
    g.eventRemoveListener = function (type, fn) {
      off(type, fn);
    };
    g.eventClearEvent = function (type) {
      handlers.delete(type);
    };
    g.eventClearListener = function (fn) {
      handlers.forEach(function (_l, k) {
        off(k, fn);
      });
    };
    g.eventClearAll = function () {
      handlers.clear();
    };
    // Lorebooks (by name, as Tavern Helper addresses them).
    g.getLorebooks = function () {
      return rpc('lore.list').then(function (l) {
        return l.map(function (b) {
          return b.name;
        });
      });
    };
    g.getCharLorebooks = function () {
      return rpc('lore.list').then(function (l) {
        var mine = l.filter(function (b) {
          return b.scope === 'character';
        });
        return { primary: mine[0] ? mine[0].name : null, additional: mine.slice(1).map(function (b) { return b.name; }) };
      });
    };
    g.getCurrentCharPrimaryLorebook = function () {
      return g.getCharLorebooks().then(function (r) {
        return r.primary;
      });
    };
    g.getLorebookEntries = function (name) {
      return rpc('lore.entries', { book: name });
    };
    g.setLorebookEntries = function (name, entries) {
      return (entries || []).reduce(function (p, e) {
        return p.then(function () {
          return rpc('lore.setEntry', { book: name, entry: e });
        });
      }, Promise.resolve());
    };
    g.createLorebookEntries = function (name, entries) {
      var uids = [];
      return (entries || [])
        .reduce(function (p, e) {
          return p.then(function () {
            return rpc('lore.createEntry', { book: name, entry: e }).then(function (r) {
              uids.push(r.uid);
            });
          });
        }, Promise.resolve())
        .then(function () {
          return { new_uids: uids };
        });
    };
    g.deleteLorebookEntries = function (name, uids) {
      return Promise.all(
        (uids || []).map(function (u) {
          return rpc('lore.deleteEntry', { book: name, uid: u });
        }),
      ).then(function () {
        return { delete_occurred: true };
      });
    };
    // Small conveniences many cards call.
    g.errorCatched = function (fn) {
      return function () {
        try {
          var r = fn.apply(this, arguments);
          if (r && typeof r.catch === 'function')
            r.catch(function (e) {
              console.error(e);
            });
          return r;
        } catch (e) {
          console.error(e);
        }
      };
    };
    var toast = function (tone) {
      return function (msg, title) {
        everloom.ui.toast(title ? title + ': ' + msg : msg, { tone: tone }).catch(function () {
          console.log(msg);
        });
      };
    };
    g.toastr = { success: toast('success'), info: toast('info'), warning: toast('warning'), error: toast('danger'), clear: function () {} };
    g.SillyTavern = {
      getContext: function () {
        return {
          chat: cache.messages.map(function (m) {
            return { name: m.name, is_user: m.role === 'user', is_system: m.role === 'system', mes: m.text, swipe_id: m.swipeId, swipes: m.swipes.slice() };
          }),
          name1: ctx.userName || 'User',
          name2: ctx.charName || '',
          chatId: ctx.chatId,
        };
      },
    };
    Object.defineProperty(g.SillyTavern, 'chat', {
      get: function () {
        return g.SillyTavern.getContext().chat;
      },
    });
    installMiniLibs();
  }

  /** A tiny subset of jQuery and lodash that card scripts commonly lean on (not the full libraries). */
  function installMiniLibs() {
    if (!window.$) {
      var Q = function (sel, root) {
        if (!(this instanceof Q)) return new Q(sel, root);
        if (typeof sel === 'function') {
          if (document.readyState !== 'loading') setTimeout(sel, 0);
          else document.addEventListener('DOMContentLoaded', sel);
          this.els = [];
        } else if (typeof sel === 'string') {
          if (/^\s*</.test(sel)) {
            var t = document.createElement('template');
            t.innerHTML = sel.trim();
            this.els = Array.prototype.slice.call(t.content.childNodes);
          } else this.els = Array.prototype.slice.call((root || document).querySelectorAll(sel));
        } else if (sel instanceof Q) this.els = sel.els.slice();
        else if (sel && sel.nodeType) this.els = [sel];
        else if (sel === window || sel === document) this.els = [sel];
        else this.els = sel && sel.length !== undefined ? Array.prototype.slice.call(sel) : [];
        this.length = this.els.length;
        for (var i = 0; i < this.els.length; i++) this[i] = this.els[i];
      };
      var P = Q.prototype;
      P.each = function (fn) {
        this.els.forEach(function (el, i) {
          fn.call(el, i, el);
        });
        return this;
      };
      P.on = function (ev, a, b) {
        var sel = typeof a === 'string' ? a : null;
        var fn = sel ? b : a;
        return this.each(function () {
          var el = this;
          ev.split(/\s+/).forEach(function (e) {
            el.addEventListener(e, function (event) {
              if (!sel) return fn.call(el, event);
              var t = event.target.closest && event.target.closest(sel);
              if (t && el.contains(t)) fn.call(t, event);
            });
          });
        });
      };
      P.click = function (fn) {
        return fn ? this.on('click', fn) : this.each(function () { this.click(); });
      };
      P.text = function (v) {
        if (v === undefined) return this.els[0] ? this.els[0].textContent : '';
        return this.each(function () { this.textContent = v; });
      };
      P.html = function (v) {
        if (v === undefined) return this.els[0] ? this.els[0].innerHTML : '';
        return this.each(function () { this.innerHTML = v; });
      };
      P.val = function (v) {
        if (v === undefined) return this.els[0] ? this.els[0].value : undefined;
        return this.each(function () { this.value = v; });
      };
      P.attr = function (k, v) {
        if (v === undefined) return this.els[0] ? this.els[0].getAttribute(k) : undefined;
        return this.each(function () { this.setAttribute(k, v); });
      };
      P.css = function (k, v) {
        if (typeof k === 'object') return this.each(function () { Object.assign(this.style, k); });
        if (v === undefined) return this.els[0] ? getComputedStyle(this.els[0])[k] : undefined;
        return this.each(function () { this.style[k] = v; });
      };
      ['addClass', 'removeClass', 'toggleClass'].forEach(function (m) {
        var op = m === 'addClass' ? 'add' : m === 'removeClass' ? 'remove' : 'toggle';
        P[m] = function (c, f) {
          return this.each(function () {
            var el = this;
            String(c).split(/\s+/).filter(Boolean).forEach(function (x) { f === undefined ? el.classList[op](x) : el.classList.toggle(x, f); });
          });
        };
      });
      P.hasClass = function (c) {
        return this.els.some(function (el) { return el.classList.contains(c); });
      };
      P.append = function (x) {
        return this.each(function () {
          var el = this;
          (x instanceof Q ? x.els : typeof x === 'string' ? Q(x).els : [x]).forEach(function (n) { el.appendChild(n); });
        });
      };
      P.prepend = function (x) {
        return this.each(function () {
          var el = this;
          (x instanceof Q ? x.els : typeof x === 'string' ? Q(x).els : [x]).reverse().forEach(function (n) { el.insertBefore(n, el.firstChild); });
        });
      };
      P.find = function (sel) {
        var out = [];
        this.els.forEach(function (el) { out.push.apply(out, Array.prototype.slice.call(el.querySelectorAll(sel))); });
        return Q(out);
      };
      P.remove = function () {
        return this.each(function () { this.remove(); });
      };
      P.empty = function () {
        return this.each(function () { this.innerHTML = ''; });
      };
      P.hide = function () {
        return this.each(function () { this.style.display = 'none'; });
      };
      P.show = function () {
        return this.each(function () { this.style.display = ''; });
      };
      P.toggle = function (on) {
        return this.each(function () { var h = on === undefined ? this.style.display !== 'none' : !on; this.style.display = h ? 'none' : ''; });
      };
      P.data = function (k, v) {
        if (v === undefined) return this.els[0] ? this.els[0].dataset[k] : undefined;
        return this.each(function () { this.dataset[k] = v; });
      };
      P.prop = function (k, v) {
        if (v === undefined) return this.els[0] ? this.els[0][k] : undefined;
        return this.each(function () { this[k] = v; });
      };
      P.closest = function (sel) {
        return Q(this.els.map(function (el) { return el.closest(sel); }).filter(Boolean));
      };
      P.parent = function () {
        return Q(this.els.map(function (el) { return el.parentElement; }).filter(Boolean));
      };
      P.children = function () {
        var out = [];
        this.els.forEach(function (el) { out.push.apply(out, Array.prototype.slice.call(el.children)); });
        return Q(out);
      };
      P.first = function () {
        return Q(this.els.slice(0, 1));
      };
      P.eq = function (i) {
        return Q(this.els.slice(i, i + 1));
      };
      P.trigger = function (ev) {
        return this.each(function () { this.dispatchEvent(new Event(ev, { bubbles: true })); });
      };
      Q.fn = P;
      Q.extend = Object.assign;
      Q.each = function (o, fn) {
        if (Array.isArray(o)) o.forEach(function (v, i) { fn(i, v); });
        else for (var k in o) fn(k, o[k]);
      };
      window.$ = window.jQuery = Q;
    }
    if (!window._) {
      var parts = function (p) {
        return Array.isArray(p) ? p : String(p).replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
      };
      window._ = {
        get: function (o, p, d) {
          var ps = parts(p);
          for (var i = 0; i < ps.length; i++) {
            if (o == null) return d;
            o = o[ps[i]];
          }
          return o === undefined ? d : o;
        },
        set: function (o, p, v) {
          var ps = parts(p);
          var cur = o;
          for (var i = 0; i < ps.length - 1; i++) {
            if (cur[ps[i]] == null || typeof cur[ps[i]] !== 'object') cur[ps[i]] = /^\d+$/.test(ps[i + 1]) ? [] : {};
            cur = cur[ps[i]];
          }
          cur[ps[ps.length - 1]] = v;
          return o;
        },
        has: function (o, p) {
          var ps = parts(p);
          for (var i = 0; i < ps.length; i++) {
            if (o == null || !(ps[i] in Object(o))) return false;
            o = o[ps[i]];
          }
          return true;
        },
        unset: function (o, p) {
          var ps = parts(p);
          var cur = o;
          for (var i = 0; i < ps.length - 1; i++) {
            if (cur == null) return true;
            cur = cur[ps[i]];
          }
          if (cur != null) delete cur[ps[ps.length - 1]];
          return true;
        },
        cloneDeep: function (v) {
          return v === undefined ? v : JSON.parse(JSON.stringify(v));
        },
        isEqual: function (a, b) {
          return JSON.stringify(a) === JSON.stringify(b);
        },
        merge: function (t) {
          var isO = function (x) { return x && typeof x === 'object' && !Array.isArray(x); };
          var m = function (a, b) {
            for (var k in b) {
              if (isO(b[k])) {
                if (!isO(a[k])) a[k] = {};
                m(a[k], b[k]);
              } else if (b[k] !== undefined) a[k] = b[k];
            }
            return a;
          };
          for (var i = 1; i < arguments.length; i++) m(t, arguments[i] || {});
          return t;
        },
        clamp: function (n, lo, hi) {
          return Math.min(hi, Math.max(lo, n));
        },
        isPlainObject: function (v) {
          return !!v && Object.prototype.toString.call(v) === '[object Object]';
        },
        isEmpty: function (v) {
          return v == null || (typeof v === 'object' ? Object.keys(v).length === 0 : String(v).length === 0);
        },
        debounce: function (fn, ms) {
          var t;
          return function () {
            var a = arguments;
            var self = this;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(self, a); }, ms || 0);
          };
        },
        uniq: function (a) {
          return Array.from(new Set(a));
        },
        sum: function (a) {
          return a.reduce(function (s, x) { return s + Number(x || 0); }, 0);
        },
      };
    }
  }

  // ------------------------------------------------------------ messages from the app
  window.addEventListener('message', function (e) {
    if (e.source !== parentWin) return;
    var m = e.data;
    if (!m || m.ev !== 1) return;
    if (m.t === 'ping') return post({ t: 'pong', n: m.n });
    if (m.t === 'res') {
      var p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else {
        var err = new Error(m.error || 'Failed');
        err.code = m.code;
        p.reject(err);
      }
      return;
    }
    if (m.t === 'event') {
      emitLocal(m.name, m.data);
      return;
    }
    if (m.t === 'theme') {
      applyTheme(m.vars || {}, !!m.dark);
      return;
    }
    if (m.t === 'call') {
      // The app asks for something only this frame can answer: a slash command it registered, or a
      // hook that may change things before a reply.
      Promise.resolve()
        .then(function () {
          if (m.name.indexOf('event:') === 0) {
            var results = emitLocal(m.name.slice(6), m.args && m.args[0]);
            return Promise.all(results).then(function () { return null; });
          }
          var fn = callables.get(m.name);
          if (!fn) throw new Error('Nothing registered as ' + m.name);
          return fn.apply(null, m.args || []);
        })
        .then(
          function (v) {
            post({ t: 'reply', id: m.id, ok: true, value: v === undefined ? null : typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v });
          },
          function (err) {
            post({ t: 'reply', id: m.id, ok: false, error: (err && err.message) || String(err) });
          },
        );
      return;
    }
    if (m.t === 'init' && !init) {
      init = m;
      ctx = m.ctx || {};
      applyTheme(m.theme || {}, !!m.dark);
      // The loop guard comes first and can't be replaced by the code that follows.
      runScript(m.guard || '');
      Object.defineProperty(window, 'everloom', { value: Object.freeze(everloom), writable: false, configurable: false });
      if (m.compat) installCompat(m.snapshot || { vars: {}, messages: [] });
      if (m.html) mountHtml(m.html);
      if (m.code) runScript('(async function(){\n' + m.code + '\n})().catch(function(e){console.error(e)});');
      setTimeout(reportHeight, 0);
      setTimeout(reportHeight, 300);
      ready = true;
    }
  });
  post({ t: 'ready' });
  void ready;
})();
