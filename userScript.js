// ==UserScript==
// @name         Rezka без рекламы (TizenBrew / Tampermonkey)
// @namespace    rezka-noads
// @version      0.2.2
// @description  Режет пре-роллы, попапы и баннеры на rezka. На ТВ добавляет навигацию пультом.
// @include      /^https?:\/\/([^\/]*\.)?(hd)?rezka[^\/]*\//
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.__rzNoAds) return;
  window.__rzNoAds = true;

  // ===================== НАСТРОЙКИ =====================
  var CFG = {
    DEBUG: false,          // true - пишет в консоль и показывает на экране, что заблокировано
    SEEK_STEP: 10,         // перемотка стрелками в плеере, сек
    SEEK_BIG: 60,          // перемотка кнопками FF / REW, сек
    FORCE_NAV: false,      // true - включить навигацию стрелками и на ПК (для теста)
    CURSOR_DEFAULT: false, // true - режим курсора (мышка стрелками) включён сразу
    LONGPRESS_MS: 700,     // сколько держать OK, чтобы переключить режим курсора
    CURSOR_STEP: 5,        // шаг курсора при коротком нажатии, px
    CURSOR_MAX: 40,        // максимальный шаг при удержании стрелки, px

    // Домены рекламных сетей: всё, что отсюда, режется целиком
    AD_HOSTS: [
      'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'imasdk.googleapis.com',
      'adfox.ru', 'adfox.yandex.ru', 'an.yandex.ru', 'yandexadexchange.net', 'adriver.ru',
      'betweendigital.com', 'buzzoola.com', 'videonow.ru', 'moevideo.biz', 'moevideo.net',
      'vidroll.ru', 'otm-r.com', 'mediasniper.ru', 'hybrid.ai', 'adhigh.net', 'getintent.com',
      'exoclick.com', 'exosrv.com', 'exdynsrv.com', 'magsrv.com', 'tsyndicate.com', 'realsrv.com',
      'popads.net', 'popcash.net', 'propellerads.com', 'onclicka.com', 'adsterra.com',
      'hilltopads.net', 'clickadu.com', 'a-ads.com', 'trafficstars.com', 'juicyads.com',
      'mgid.com', 'marketgid.com', 'adskeeper.com', 'smi2.ru', 'relap.io', 'directadvert.ru',
      'adnxs.com', 'criteo.com', 'criteo.net', 'rubiconproject.com', 'pubmatic.com', 'openx.net',
      'adform.net', 'smartadserver.com', 'advertising.com', 'adsafeprotected.com', 'moatads.com'
    ],

    // Признаки рекламы в адресе запроса (VAST/VPAID и т.п.)
    AD_URL_PATTERNS: [
      /[\/?&=_.-]vast[\/?&=_.\d-]/i, /vpaid/i, /preroll/i, /midroll/i, /pauseroll/i,
      /[\/.]ads?[\/.?]/i, /adserver/i, /adsystem/i, /\/advert/i, /[?&]ad_?type=/i
    ],

    // Что спрятать на странице (баннеры). Можно дописывать свои селекторы.
    HIDE_SELECTORS: [
      'ins.adsbygoogle', '[id^="adfox_"]', '[id^="yandex_rtb"]', '[id^="google_ads"]',
      '[id*="ScriptRoot"]', '[id^="mgid"]', '[class*="mgbox"]',
      'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]', 'iframe[src*="adfox"]',
      'iframe[src*="yandex.ru/ads"]', 'iframe[src*="exoclick"]', 'iframe[src*="tsyndicate"]'
    ]
  };
  // =====================================================

  var IS_TOP = window.top === window;
  var IS_TV = /Tizen|SMART-TV|SmartTV/i.test(navigator.userAgent) || typeof window.tizen !== 'undefined';
  var EMPTY_VAST = '<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>';
  var EMPTY_VAST_URL = 'data:text/xml;charset=utf-8,' + encodeURIComponent(EMPTY_VAST);
  var MEDIA_FILE = /\.(m3u8|mp4|ts|m4s|vtt|srt)(\?|#|$)/i;
  var blocked = 0;

  function log() {
    if (!CFG.DEBUG) return;
    var a = ['[rezka-noads]'].concat([].slice.call(arguments));
    try { console.log.apply(console, a); } catch (e) {}
  }

  function hostOf(url) {
    try { return new URL(url, location.href).hostname.toLowerCase(); } catch (e) { return ''; }
  }

  function isAdUrl(url) {
    if (!url) return false;
    url = String(url);
    if (url.indexOf('data:') === 0 || url.indexOf('blob:') === 0 || url.indexOf('about:') === 0) return false;
    var h = hostOf(url);
    for (var i = 0; i < CFG.AD_HOSTS.length; i++) {
      var d = CFG.AD_HOSTS[i];
      if (h === d || h.slice(-(d.length + 1)) === '.' + d) return true;
    }
    if (MEDIA_FILE.test(url) && h.indexOf('ad') !== 0) return false; // поток фильма не трогаем
    for (var j = 0; j < CFG.AD_URL_PATTERNS.length; j++) {
      if (CFG.AD_URL_PATTERNS[j].test(url)) return true;
    }
    return false;
  }

  function hit(kind, what) {
    blocked++;
    log('BLOCK', kind, what);
    if (CFG.DEBUG && IS_TOP) toast('Блок #' + blocked + ' (' + kind + ')');
  }

  // ---------- 1. Сеть: XHR и fetch получают пустой VAST ----------
  (function hookXHR() {
    var XHR = window.XMLHttpRequest;
    if (!XHR) return;
    var open = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      try {
        if (isAdUrl(url)) {
          hit('xhr', url);
          var args = [].slice.call(arguments);
          args[0] = 'GET';
          args[1] = EMPTY_VAST_URL;
          return open.apply(this, args);
        }
        if (CFG.DEBUG && /xml|vast|ad/i.test(String(url))) log('xhr pass', url);
      } catch (e) {}
      return open.apply(this, arguments);
    };
  })();

  (function hookFetch() {
    if (!window.fetch) return;
    var f = window.fetch;
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (isAdUrl(url)) {
          hit('fetch', url);
          return Promise.resolve(new Response(EMPTY_VAST, { status: 200, headers: { 'Content-Type': 'text/xml' } }));
        }
      } catch (e) {}
      return f.apply(this, arguments);
    };
  })();

  // ---------- 2. Элементы: script / iframe / video с рекламным src ----------
  function safeSrc(el) {
    var tag = el.tagName;
    if (tag === 'SCRIPT') return 'data:text/javascript,';
    if (tag === 'IFRAME') return 'about:blank';
    return 'data:,'; // video/source/img - отдаём битый файл, плеер сам пропустит рекламу
  }

  function patchSrc(proto) {
    if (!proto) return;
    var d = Object.getOwnPropertyDescriptor(proto, 'src');
    if (!d || !d.set) return;
    Object.defineProperty(proto, 'src', {
      configurable: true,
      enumerable: d.enumerable,
      get: d.get,
      set: function (v) {
        if (isAdUrl(v)) { hit(this.tagName.toLowerCase(), v); v = safeSrc(this); }
        return d.set.call(this, v);
      }
    });
  }
  patchSrc(window.HTMLScriptElement && HTMLScriptElement.prototype);
  patchSrc(window.HTMLIFrameElement && HTMLIFrameElement.prototype);
  patchSrc(window.HTMLMediaElement && HTMLMediaElement.prototype);
  patchSrc(window.HTMLSourceElement && HTMLSourceElement.prototype);

  var setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    try {
      if (String(name).toLowerCase() === 'src' && /^(SCRIPT|IFRAME|VIDEO|SOURCE)$/.test(this.tagName) && isAdUrl(value)) {
        hit(this.tagName.toLowerCase() + '@attr', value);
        value = safeSrc(this);
      }
    } catch (e) {}
    return setAttr.call(this, name, value);
  };

  // То, что пришло прямо из HTML (мимо сеттеров), ловим наблюдателем
  function killNode(n) {
    if (n.nodeType !== 1) return;
    var tag = n.tagName;
    if ((tag === 'SCRIPT' || tag === 'IFRAME') && isAdUrl(n.getAttribute('src'))) {
      hit(tag.toLowerCase() + '@html', n.getAttribute('src'));
      if (tag === 'SCRIPT') n.type = 'javascript/blocked';
      if (n.parentNode) n.parentNode.removeChild(n);
    }
  }
  // Проверяем только добавленный узел; вложенные script/iframe ищем одним проходом раз в 400 мс
  // (раньше querySelectorAll гонялся по каждому добавленному узлу - на ТВ это сильно тормозило загрузку)
  var scanT = 0;
  function scanInner() {
    scanT = 0;
    var inner = document.querySelectorAll('script[src],iframe[src]');
    for (var k = 0; k < inner.length; k++) killNode(inner[k]);
  }
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) killNode(added[j]);
    }
    if (!scanT) scanT = setTimeout(scanInner, 400);
  }).observe(document.documentElement || document, { childList: true, subtree: true });

  // ---------- 3. Попапы и клики-перехватчики ----------
  var fakeWin = {
    closed: true, close: function () {}, focus: function () {}, blur: function () {},
    postMessage: function () {}, document: { write: function () {}, close: function () {} }, location: {}
  };
  window.open = function (u) { hit('popup', String(u || '')); return fakeWin; };

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var h = hostOf(a.href);
    var foreign = h && h !== location.hostname && h.indexOf('rezka') === -1;
    if ((a.target === '_blank' && foreign) || isAdUrl(a.href)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      hit('link', a.href);
    }
  }, true);

  // ---------- 4. Конфиг плеера: вычищаем preroll/vast ----------
  var AD_KEY = /^((pre|mid|post|pause)rolls?|vast\w*|vpaid\w*|ads?|adv|advert\w*|advertising)$/i;
  function scrub(o, depth) {
    if (!o || typeof o !== 'object' || depth > 3) return o;
    Object.keys(o).forEach(function (k) {
      if (AD_KEY.test(k)) { hit('config', k); try { delete o[k]; } catch (e) {} }
      else if (o[k] && typeof o[k] === 'object') scrub(o[k], depth + 1);
    });
    return o;
  }

  function wrapCtor(fn) {
    if (typeof fn !== 'function' || fn.__rz) return fn;
    var W = function () {
      for (var i = 0; i < arguments.length; i++) scrub(arguments[i], 0);
      if (!(this instanceof W)) return fn.apply(this, arguments);
      var args = [null].concat([].slice.call(arguments));
      return new (Function.prototype.bind.apply(fn, args))();
    };
    W.prototype = fn.prototype;
    Object.keys(fn).forEach(function (k) { W[k] = fn[k]; });
    W.__rz = true;
    return W;
  }

  function wrapInits(obj) {
    if (!obj || typeof obj !== 'object' || obj.__rz) return;
    obj.__rz = true;
    Object.keys(obj).forEach(function (k) {
      if (typeof obj[k] === 'function' && /^init/i.test(k)) {
        var orig = obj[k];
        obj[k] = function () {
          for (var i = 0; i < arguments.length; i++) scrub(arguments[i], 0);
          return orig.apply(this, arguments);
        };
      }
    });
  }

  function patchPlayerGlobals() {
    try {
      if (typeof window.Playerjs === 'function' && !window.Playerjs.__rz) window.Playerjs = wrapCtor(window.Playerjs);
      if (window.sof && window.sof.tv) wrapInits(window.sof.tv);
    } catch (e) {}
  }
  // load у <script> срабатывает сразу после его выполнения и до следующего скрипта,
  // так что успеваем обернуть плеер до того, как сайт вызовет new Playerjs({...})
  document.addEventListener('load', function (e) {
    if (e.target && e.target.tagName === 'SCRIPT') patchPlayerGlobals();
  }, true);
  document.addEventListener('DOMContentLoaded', patchPlayerGlobals);

  // ---------- 5. Страховка: если реклама всё же заиграла ----------
  var AD_BOX = /(^|[\s_-])(ad|ads|vast|vpaid|preroll|advert|reklama)([\s_-]|$)/i;
  function inAdBox(el) {
    for (var i = 0; el && i < 6; i++, el = el.parentElement) {
      var s = (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '');
      if (AD_BOX.test(s)) return true;
    }
    return false;
  }
  function isAdVideo(v) {
    return isAdUrl(v.currentSrc || v.src) || inAdBox(v);
  }
  function playerBoxOf(v) {
    return v.closest('#cdnplayer,#oframecdnplayer') ||
      (v.parentElement && v.parentElement.parentElement) || v.parentElement;
  }
  function watchdog() {
    var vids = document.getElementsByTagName('video');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if (isAdVideo(v)) {
        v.muted = true;
        if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.3) {
          v.currentTime = v.duration - 0.1;
          hit('video-skip', v.currentSrc || v.src);
        }
      }
      // кнопка "Пропустить" внутри плеера
      // кнопка есть только пока идёт реклама, в начале ролика; дальше не тратим время
      if (!(isAdVideo(v) || v.currentTime < 30)) continue;
      var box = playerBoxOf(v);
      if (!box) continue;
      var btns = box.querySelectorAll('div,span,a,button');
      for (var j = 0; j < btns.length; j++) {
        var b = btns[j];
        if (b.children.length > 1 || b.__rzClicked || !b.offsetParent) continue;
        var t = (b.textContent || '').trim();
        if (t.length < 25 && /^(пропустить|skip)/i.test(t)) {
          b.__rzClicked = true;
          b.click();
          hit('skip-btn', t);
        }
      }
    }
  }
  setInterval(watchdog, 1000);

  // ---------- 6. CSS ----------
  // На старте документа ещё нет даже <html>, ждём его появления
  function whenRoot(cb) {
    if (document.documentElement) return cb();
    var mo = new MutationObserver(function () {
      if (document.documentElement) { mo.disconnect(); cb(); }
    });
    mo.observe(document, { childList: true });
  }
  function addCss(css) {
    whenRoot(function () {
      var s = document.createElement('style');
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    });
  }
  if (IS_TOP) {
    addCss(
      CFG.HIDE_SELECTORS.join(',') + '{display:none!important}' +
      '.rz-focus{outline:4px solid #ffcc00!important;outline-offset:2px!important;' +
        'box-shadow:0 0 0 7px rgba(0,0,0,.55)!important;border-radius:4px}' +
      '.rz-full{position:fixed!important;left:0!important;top:0!important;width:100vw!important;' +
        'height:100vh!important;z-index:2147483646!important;background:#000!important;margin:0!important}' +
      '.rz-full video{width:100%!important;height:100%!important;object-fit:contain}' +
      '#rz-toast{position:fixed;left:50%;bottom:6vh;transform:translateX(-50%);z-index:2147483647;' +
        'background:rgba(0,0,0,.8);color:#fff;font:600 28px/1.3 sans-serif;padding:14px 28px;' +
        'border-radius:12px;pointer-events:none;opacity:0;transition:opacity .25s}' +
      '#rz-toast.on{opacity:1}' +
      '#rz-cursor{position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483647;' +
        'pointer-events:none;display:none;margin:0;padding:0}'
    );
  }

  var toastEl, toastT;
  function toast(text) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'rz-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.className = 'on';
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.className = ''; }, 1600);
  }

  // ---------- 7. Пульт (только на ТВ или с FORCE_NAV) ----------
  if (!IS_TOP || !(IS_TV || CFG.FORCE_NAV)) return;

  var K = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27,
    PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412,
    CH_UP: 427, CH_DOWN: 428, RED: 403
  };
  var FOCUSABLE = [
    'a[href]', 'button', 'input', 'select', 'textarea', '[tabindex]', '[onclick]', '[role="button"]',
    'li[data-translator_id]', 'li[data-tab_id]', 'li[data-season_id]', 'li[data-episode_id]',
    '#cdnplayer', '#oframecdnplayer'
  ].join(',');

  var cur = null;
  var fullBox = null;

  function visible(el) {
    if (!el.getClientRects().length) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0' && !el.disabled;
  }

  function player() {
    var v = document.querySelector('#cdnplayer video, #oframecdnplayer video') || document.querySelector('video');
    if (!v || isAdVideo(v)) return null;
    var box = document.getElementById('cdnplayer') || document.getElementById('oframecdnplayer') || v.parentElement;
    return { v: v, box: box };
  }

  function setFocus(el) {
    if (!el) return;
    if (cur) cur.classList.remove('rz-focus');
    cur = el;
    if (!el.matches('a[href],button,input,select,textarea,[tabindex]')) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    el.classList.add('rz-focus');
    var r = el.getBoundingClientRect();
    if (r.top < 60 || r.bottom > innerHeight - 60) {
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { el.scrollIntoView(); }
    }
  }

  function move(dir) {
    var all = document.querySelectorAll(FOCUSABLE);
    var list = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === cur || el.getAttribute('tabindex') === '-2' || !visible(el)) continue;
      if (cur && (el.contains(cur) || cur.contains(el))) continue;
      list.push(el);
    }
    if (!list.length) return;

    if (!cur || !document.contains(cur)) {
      // первый шаг: ближайший к верхнему левому углу видимой области
      var best0 = null, s0 = Infinity;
      list.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        var s = r.top * 2 + r.left;
        if (s < s0) { s0 = s; best0 = el; }
      });
      setFocus(best0 || list[0]);
      return;
    }

    var a = cur.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    var vertical = dir === 'up' || dir === 'down';
    var best = null, bestScore = Infinity;
    list.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var bx = r.left + r.width / 2, by = r.top + r.height / 2;
      var main;
      if (dir === 'down') { if (r.top < a.bottom - 4 && by <= ay + 4) return; main = Math.max(0, r.top - a.bottom); }
      else if (dir === 'up') { if (r.bottom > a.top + 4 && by >= ay - 4) return; main = Math.max(0, a.top - r.bottom); }
      else if (dir === 'right') { if (r.left < a.right - 4 && bx <= ax + 4) return; main = Math.max(0, r.left - a.right); }
      else { if (r.right > a.left + 4 && bx >= ax - 4) return; main = Math.max(0, a.left - r.right); }
      // зазор по поперечной оси: 0, если элементы друг напротив друга
      var gap = vertical
        ? Math.max(0, Math.max(r.left, a.left) - Math.min(r.right, a.right))
        : Math.max(0, Math.max(r.top, a.top) - Math.min(r.bottom, a.bottom));
      var edge = vertical ? Math.abs(r.left - a.left) : Math.abs(r.top - a.top);
      var score = main + (gap > 0 ? 200 + gap * 2.5 : 0) + edge * 0.01;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) setFocus(best);
    else if (dir === 'down' || dir === 'up') window.scrollBy(0, dir === 'down' ? innerHeight * 0.6 : -innerHeight * 0.6);
  }

  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function seek(p, d) {
    var v = p.v;
    if (!isFinite(v.duration)) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + d), v.duration - 1);
    toast((d > 0 ? '» ' : '« ') + fmt(v.currentTime) + ' / ' + fmt(v.duration));
  }

  function togglePlay(p) {
    if (p.v.paused) { var pr = p.v.play(); if (pr && pr.catch) pr.catch(function () {}); toast('▶'); }
    else { p.v.pause(); toast('❚❚  ' + fmt(p.v.currentTime) + ' / ' + fmt(p.v.duration)); }
  }

  function enterFull(p) {
    fullBox = p.box;
    var req = p.box.requestFullscreen || p.box.webkitRequestFullscreen;
    var done = false;
    if (req) {
      try {
        var pr = req.call(p.box);
        done = true;
        if (pr && pr.catch) pr.catch(function () { p.box.classList.add('rz-full'); });
      } catch (e) { done = false; }
    }
    if (!done) p.box.classList.add('rz-full');
  }

  function exitFull() {
    if (fullBox) fullBox.classList.remove('rz-full');
    var fe = document.fullscreenElement || document.webkitFullscreenElement;
    if (fe) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {} }
    fullBox = null;
  }

  function isFull() {
    return !!(fullBox && (fullBox.classList.contains('rz-full') || document.fullscreenElement || document.webkitFullscreenElement));
  }

  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && fullBox && !fullBox.classList.contains('rz-full')) fullBox = null;
  });

  function eat(e) { e.preventDefault(); e.stopPropagation(); }

  // ---------- Режим курсора (стрелка-мышка) ----------
  var cursorOn = false, curEl = null, cx = 200, cy = 200, lastDir = '', holdN = 0, lastMoveT = 0;
  var enterArmed = false, enterT = 0, enterLong = false, enterTimer = 0;

  function ensureCursor() {
    if (curEl && document.contains(curEl)) return curEl;
    if (!document.body) return null;
    curEl = document.createElement('div');
    curEl.id = 'rz-cursor';
    curEl.innerHTML = '<svg width="34" height="34" viewBox="0 0 34 34"><path d="M4 2 L4 26 L10 20 L15 31 L20 29 L15 18 L24 18 Z" ' +
      'fill="#fff" stroke="#000" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.body.appendChild(curEl);
    return curEl;
  }
  function drawCursor() {
    var c = ensureCursor();
    if (!c) return;
    c.style.display = cursorOn ? 'block' : 'none';
    c.style.transform = 'translate(' + cx + 'px,' + cy + 'px)';
  }
  function fire(el, type) {
    try {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy }));
    } catch (e) {}
  }
  function setCursor(on) {
    cursorOn = on;
    if (on) {
      if (cur) { cur.classList.remove('rz-focus'); cur = null; }
      cx = Math.min(Math.max(cx, 0), innerWidth - 2);
      cy = Math.min(Math.max(cy, 0), innerHeight - 2);
    }
    drawCursor();
    toast(on ? 'Курсор: вкл (удерживай OK - выкл)' : 'Курсор: выкл (удерживай OK - вкл)');
  }
  function cursorMove(dir) {
    var now = Date.now();
    holdN = (dir === lastDir && now - lastMoveT < 300) ? holdN + 1 : 0;
    lastDir = dir; lastMoveT = now;
    var step = Math.min(CFG.CURSOR_STEP + holdN * 2, CFG.CURSOR_MAX); // короткое нажатие - точный шаг, удержание - разгон
    var edge = 6, scrollStep = 90;
    if (dir === 'left') cx -= step;
    else if (dir === 'right') cx += step;
    else if (dir === 'up') {
      if (cy <= edge) window.scrollBy(0, -scrollStep); else cy -= step;
    } else {
      if (cy >= innerHeight - edge - 2) window.scrollBy(0, scrollStep); else cy += step;
    }
    cx = Math.min(Math.max(cx, 0), innerWidth - 2);
    cy = Math.min(Math.max(cy, 0), innerHeight - 2);
    drawCursor();
    var el = document.elementFromPoint(cx, cy);
    if (el && el !== curEl) { fire(el, 'mousemove'); fire(el, 'mouseover'); }
  }
  function cursorClick() {
    var el = document.elementFromPoint(cx, cy);
    if (!el) return;
    var p = player();
    if (p && (p.box === el || p.box.contains(el))) {
      if (p.v.paused) togglePlay(p);
      enterFull(p);
      return;
    }
    fire(el, 'mousedown'); fire(el, 'mouseup');
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) { try { el.focus(); } catch (e) {} setFocus(el); }
    el.click();
  }
  function enterAction(p) {
    if (cursorOn) return cursorClick();
    if (!cur) return;
    if (p && (cur === p.box || p.box.contains(cur) || cur.contains(p.box))) {
      if (p.v.paused) togglePlay(p);
      enterFull(p);
    } else {
      cur.click();
    }
  }
  if (CFG.CURSOR_DEFAULT) whenRoot(function () { setTimeout(function () { setCursor(true); }, 800); });

  window.addEventListener('keyup', function (e) {
    if (e.keyCode !== K.ENTER || !enterArmed) return;
    enterArmed = false;
    clearTimeout(enterTimer);
    eat(e);
    if (!enterLong) enterAction(player());
  }, true);

  window.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    var p = player();
    var typing = cur && /^(INPUT|TEXTAREA|SELECT)$/.test(cur.tagName) && document.activeElement === cur;

    // Медиа-кнопки работают всегда, если есть фильм
    if (p) {
      if (k === K.PLAYPAUSE || (k === K.PLAY && p.v.paused) || (k === K.PAUSE && !p.v.paused)) { eat(e); togglePlay(p); return; }
      if (k === K.FF || (k === K.CH_UP && isFull())) { eat(e); seek(p, CFG.SEEK_BIG); return; }
      if (k === K.RW || (k === K.CH_DOWN && isFull())) { eat(e); seek(p, -CFG.SEEK_BIG); return; }
      if (k === K.STOP) { eat(e); p.v.pause(); exitFull(); return; }
    }

    // Режим плеера (полный экран)
    if (p && isFull()) {
      if (k === K.LEFT) { eat(e); seek(p, -CFG.SEEK_STEP); return; }
      if (k === K.RIGHT) { eat(e); seek(p, CFG.SEEK_STEP); return; }
      if (k === K.ENTER) { eat(e); togglePlay(p); return; }
      if (k === K.UP || k === K.DOWN) { eat(e); toast(fmt(p.v.currentTime) + ' / ' + fmt(p.v.duration)); return; }
      if (k === K.BACK || k === K.ESC) { eat(e); exitFull(); if (cur) setFocus(cur); return; }
      return;
    }

    // Обычная навигация по сайту
    // Качелька каналов - листать страницу целым экраном
    if (k === K.CH_UP || k === K.CH_DOWN) {
      eat(e);
      window.scrollBy(0, (k === K.CH_DOWN ? 1 : -1) * innerHeight * 0.85);
      if (cur) cur.classList.remove('rz-focus');
      cur = null; // следующая стрелка возьмёт ближайший элемент на новом экране
      return;
    }
    if (k === K.RED) { eat(e); setCursor(!cursorOn); return; }
    var dirName = k === K.UP ? 'up' : k === K.DOWN ? 'down' : k === K.LEFT ? 'left' : k === K.RIGHT ? 'right' : '';
    if (dirName && (!typing || dirName === 'up' || dirName === 'down')) {
      eat(e);
      if (cursorOn) cursorMove(dirName); else move(dirName);
      return;
    }

    // OK: короткое нажатие - клик (срабатывает при отпускании), долгое - переключить курсор
    // Таймер, а не e.repeat: ТВ может не присылать повторные keydown при удержании
    if (k === K.ENTER && !typing) {
      eat(e);
      if (!enterArmed) {
        enterArmed = true; enterLong = false; enterT = Date.now();
        clearTimeout(enterTimer);
        enterTimer = setTimeout(function () {
          if (enterArmed && !enterLong) { enterLong = true; setCursor(!cursorOn); }
        }, CFG.LONGPRESS_MS);
      }
      return;
    }

    if (k === K.BACK) {
      if (typing) { eat(e); cur.blur(); return; }
      eat(e);
      history.back();
    }
  }, true);

  log('ready', IS_TV ? 'TV' : 'desktop');
})();
