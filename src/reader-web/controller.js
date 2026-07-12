/* eslint-disable */
/**
 * In-WebView reader controller for revpdf. Runs inside reader.html alongside
 * vendored epub.js (global `ePub`) and JSZip (global `JSZip`).
 *
 * Exposes window.RP.* commands (called from RN) and posts JSON messages back.
 * EPUB is handled here; PDF/DOCX are wired in a later phase (report unsupported).
 */
(function () {
  var book = null;
  var rendition = null;
  var locationsReady = false;
  var lastTypography = null;
  var suppressTapUntil = 0;

  var mode = null; // 'epub' | 'pdf'
  var lastTheme = null;
  var hlCfi = {}; // highlight id -> cfiRange (epub.js keys annotations by CFI)
  var pdf = {
    doc: null,
    total: 0,
    scale: 1, // baseScale * zoom — the scale pages are rasterized at
    baseScale: 1, // scale at which page 1 fits the viewer width
    zoom: 1, // user zoom on top of baseScale (pinch, or the font-size setting)
    baseUnscaledW: 0,
    baseUnscaledH: 0,
    estW: 0,
    estH: 0,
    current: 1,
    theme: null,
    observer: null,
    pagesEl: null, // transform target for live pinch feedback
  };

  // epub.js positions annotation overlays once, so they drift out of place after
  // a resize, theme change, font (re)flow or section re-render — the classic
  // "highlight is in the wrong spot after reopening" bug. Re-rendering each
  // view's annotation pane snaps them back onto the text.
  // See https://github.com/johnfactotum/epubjs-tips
  function redrawAnnotations() {
    try {
      if (rendition && rendition.views) {
        rendition.views().forEach(function (view) {
          if (view && view.pane && view.pane.render) view.pane.render();
        });
      }
    } catch (e) {}
  }

  function post(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }
  function err(message) {
    post({ type: 'error', message: String(message) });
  }

  // Walk up from a clicked node to the enclosing <a href>, if any. The click
  // target can be a text node (some WebView builds), so we tolerate any node
  // type and only test elements on the way up.
  function closestAnchor(node) {
    while (node) {
      if (
        node.nodeType === 1 &&
        node.tagName &&
        node.tagName.toLowerCase() === 'a' &&
        node.getAttribute('href')
      ) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }
  // Links we hand back to RN to open in the in-app / system browser.
  function isExternalHref(href) {
    return /^(https?:|mailto:|tel:)/i.test(href || '');
  }

  window.onerror = function (message, source, line) {
    post({ type: 'error', message: 'JS error: ' + message + ' @' + line });
    return false;
  };
  window.addEventListener('unhandledrejection', function (e) {
    post({ type: 'error', message: 'Promise: ' + (e && e.reason ? e.reason : 'unknown') });
  });

  function base64ToArrayBuffer(b64) {
    var binary = atob(b64);
    var len = binary.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function lineHeightFrom(spacing) {
    // 0..100 -> 1.2..2.0
    return (1.2 + (Number(spacing) / 100) * 0.8).toFixed(2);
  }

  function applyTypographyInternal(t) {
    if (!t) return;
    lastTypography = t; // remember even before the rendition exists
    if (!rendition) return;
    try {
      rendition.themes.fontSize(t.fontSizePct + '%');
      if (t.fontStack && t.fontStack !== 'inherit') rendition.themes.font(t.fontStack);
      else rendition.themes.font('');
      rendition.themes.override('font-weight', String(t.fontWeight), true);
      rendition.themes.override('text-align', t.textAlign, true);
      rendition.themes.override('line-height', lineHeightFrom(t.lineSpacing), true);
      rendition.themes.override('hyphens', t.hyphenation ? 'auto' : 'manual', true);
      rendition.themes.override('-webkit-hyphens', t.hyphenation ? 'auto' : 'manual', true);
      rendition.themes.override(
        'padding-left',
        t.pageMargins ? '16px' : '0px',
        true,
      );
      rendition.themes.override('padding-right', t.pageMargins ? '16px' : '0px', true);
      if (rendition.flow && rendition.settings.flow !== t.flow) rendition.flow(t.flow);
    } catch (e) {
      err(e);
    }
  }

  function wireContents(contents) {
    try {
      var doc = contents.document;
      // Guard: epub.js fires both the `rendered` event and the content hook for
      // each section, so without this the click listener is attached twice and
      // every tap toggles the chrome twice — the "flashing" toolbar.
      if (doc.__rpWired) return;
      doc.__rpWired = true;
      // Capture phase so we intercept external-link taps before epub.js' own
      // handler (which rewrites absolute links to target="_blank" — a no-op in
      // this WebView since multiple windows are disabled, so the tap looked dead).
      doc.addEventListener(
        'click',
        function (ev) {
          var a = closestAnchor(ev.target);
          if (a) {
            var href = a.getAttribute('href') || '';
            if (isExternalHref(href)) {
              ev.preventDefault();
              ev.stopPropagation();
              suppressTapUntil = Date.now() + 400;
              post({ type: 'link', href: href });
            }
            // Internal links fall through to epub.js for in-book navigation;
            // either way a link tap never toggles the reader chrome.
            return;
          }
          if (Date.now() < suppressTapUntil) return;
          var w = (contents.window && contents.window.innerWidth) || 0;
          var x = ev.clientX || 0;
          var zone = 'center';
          if (w > 0) {
            if (x < w * 0.3) zone = 'left';
            else if (x > w * 0.7) zone = 'right';
          }
          post({ type: 'tap', zone: zone });
        },
        true,
      );
    } catch (e) {}
  }

  // ---------- selection engine ----------
  //
  // We never let the platform own text selection. Android's native selection
  // drags in its own handles and floating copy/paste bar: they can't be
  // restyled, they cover our bottom sheet, and suppressing the bar by wiping the
  // range (what this file used to do) meant the user never saw what they'd
  // selected at all.
  //
  // So content is marked user-select:none — which kills the OS selection UI
  // outright — and we drive selection ourselves. A long-press resolves a word to
  // a Range; we paint the selection rects and the two drag handles into a fixed
  // overlay. Crucially we never call window.getSelection(): the Range is our own
  // object, so range.toString() and range.getClientRects() keep working even
  // though the platform believes nothing is selectable. One implementation then
  // serves all three hosts — the PDF text layer, the reflow article, and every
  // EPUB chapter iframe (each is a separate document, so each gets its own).
  // !important throughout: the reader-mode theme override (see applyTheme) strips
  // background-color from `*` with !important, which would otherwise erase our
  // own selection paint along with the document's.
  var SEL_CSS = [
    // Out of flow and zero-sized: this div is appended to the chapter <body>, and
    // EPUB paginates that body with CSS columns — an in-flow child would shift
    // the pagination. Its children are position:fixed, so they escape anyway.
    '#rp-sel-layer{position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0}',
    '.rp-sel-rect{position:fixed;background:rgba(66,133,244,0.28)!important;',
    'pointer-events:none;z-index:2147483000}',
    '.rp-sel-h{position:fixed;width:28px;pointer-events:auto;touch-action:none;z-index:2147483001}',
    '.rp-sel-h i{position:absolute;left:7px;width:14px;height:14px;border-radius:50%;',
    'background:#4285F4!important}',
    '.rp-sel-h b{position:absolute;left:13px;width:2px;background:#4285F4!important}',
    '.rp-nosel,.rp-nosel *{-webkit-user-select:none!important;user-select:none!important;',
    '-webkit-touch-callout:none!important}',
  ].join('');

  var selHosts = []; // every document we've installed the engine into
  var selCur = null; // { host, range }
  var selLastHost = null; // host of the most recent touch — the target for selectAll
  var selDrag = null; // 'start' | 'end' while a handle is being dragged
  var selDragOff = { x: 0, y: 0 }; // finger→caret offset, captured at drag start
  var selRaf = 0;

  function selInstallCss(doc) {
    if (doc.getElementById('rp-sel-css')) return;
    var st = doc.createElement('style');
    st.id = 'rp-sel-css';
    st.textContent = SEL_CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  /**
   * The caret position under a point — but only ever a *text* position.
   *
   * The handles are `pointer-events: auto` (they have to be, to be draggable),
   * so while you drag one your finger is over them and caretRangeFromPoint
   * hit-tests the handle instead of the words beneath it. It then answers with a
   * position in <body> rather than in a text node, and the range built from it
   * spans half the document — that was the paragraph-wide blue flash, and the
   * reason a handle would suddenly fly off-screen (it was being drawn at the
   * first rect of a range that now started at the top of the chapter).
   *
   * So: make the overlay transparent to hit-testing for the duration of the
   * probe, and reject anything that doesn't come back as a text node.
   */
  function caretRangeAt(host, x, y) {
    var doc = host.doc;
    var hide = [host.startH, host.endH];
    var prev = hide.map(function (el) {
      return el ? el.style.pointerEvents : '';
    });
    hide.forEach(function (el) {
      if (el) el.style.pointerEvents = 'none';
    });
    var r = null;
    try {
      if (doc.caretRangeFromPoint) {
        r = doc.caretRangeFromPoint(x, y);
      } else if (doc.caretPositionFromPoint) {
        var p = doc.caretPositionFromPoint(x, y);
        if (p && p.offsetNode) {
          r = doc.createRange();
          r.setStart(p.offsetNode, p.offset);
          r.collapse(true);
        }
      }
    } catch (e) {
      r = null;
    } finally {
      hide.forEach(function (el, i) {
        if (el) el.style.pointerEvents = prev[i];
      });
    }
    // A caret in an element (rather than a text node) means we hit chrome, not
    // prose. Refusing it is what keeps a bad probe from selecting the document.
    if (!r || !r.startContainer || r.startContainer.nodeType !== 3) return null;
    return r;
  }

  // ---- word snapping ----
  //
  // Selection is word-granular, like every native reader. Two reasons:
  //
  //  - Justified text stretches the spaces between words, so a caret dropped in
  //    one of those wide gaps is genuinely ambiguous — and a range that ends in
  //    such a gap paints a selection reading " Boy" or "Boy ", with the space
  //    included. Snapping outward to word edges (and trimming whitespace) makes
  //    the selection exactly the words you pointed at.
  //  - Dragging a handle character-by-character on a touchscreen is miserable.
  //
  // The work happens in a flattened copy of the host's text, so a word that
  // straddles two text nodes (an <em> mid-word, say) still snaps correctly.

  var SEL_BREAK = /[\s.,;:!?()[\]{}"'“”‘’—–…/\\|]/;

  /** The subtree a selection may span: the chapter, the article, or one PDF page. */
  function selRootFor(host, node) {
    if (host.kind === 'reflow') {
      return document.getElementById('rp-article') || host.doc.body;
    }
    if (host.kind === 'pdf') {
      // Bounded to the page under the caret — flattening every rendered page
      // would let a drag run away across a page break.
      var el = node && (node.nodeType === 3 ? node.parentElement : node);
      var layer = el && el.closest ? el.closest('.textLayer') : null;
      return layer || pdf.pagesEl || host.doc.body;
    }
    return host.doc.body || host.doc.documentElement;
  }

  /** Text nodes of `root`, concatenated, with an index back to each node. */
  function selFlatten(root) {
    var doc = root.ownerDocument;
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [];
    var starts = [];
    var text = '';
    var n;
    while ((n = walker.nextNode())) {
      if (!n.data.length) continue;
      starts.push(text.length);
      nodes.push(n);
      text += n.data;
    }
    return { root: root, nodes: nodes, starts: starts, text: text };
  }

  function selToGlobal(flat, node, offset) {
    var i = flat.nodes.indexOf(node);
    if (i < 0) return -1;
    return flat.starts[i] + offset;
  }

  function selFromGlobal(flat, g) {
    for (var i = flat.nodes.length - 1; i >= 0; i--) {
      if (g >= flat.starts[i]) {
        return {
          node: flat.nodes[i],
          offset: Math.max(0, Math.min(g - flat.starts[i], flat.nodes[i].data.length)),
        };
      }
    }
    return null;
  }

  /** Grow [gs,ge) out to whole words and drop any whitespace at the edges. */
  function selSnap(flat, doc, gs, ge) {
    var t = flat.text;
    var len = t.length;
    var s = Math.max(0, Math.min(gs, len));
    var e = Math.max(0, Math.min(ge, len));
    if (e < s) {
      var tmp = s;
      s = e;
      e = tmp;
    }

    // Start: skip forward off any whitespace, then grow left to the word's head.
    while (s < len && /\s/.test(t.charAt(s))) s++;
    while (s > 0 && !SEL_BREAK.test(t.charAt(s - 1))) s--;

    // End: pull back off any trailing whitespace, then grow right to the tail.
    while (e > s && /\s/.test(t.charAt(e - 1))) e--;
    while (e < len && !SEL_BREAK.test(t.charAt(e))) e++;

    // Landed in a gap with nothing behind it — take the word ahead instead.
    if (e <= s) {
      e = s;
      while (e < len && !SEL_BREAK.test(t.charAt(e))) e++;
      if (e <= s) return null;
    }

    var a = selFromGlobal(flat, s);
    var b = selFromGlobal(flat, e);
    if (!a || !b) return null;
    try {
      var r = doc.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      return r.collapsed ? null : r;
    } catch (err) {
      return null;
    }
  }

  function selRects(range) {
    var out = [];
    try {
      var list = range.getClientRects();
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (r.width > 0.5 && r.height > 0.5) out.push(r);
      }
    } catch (e) {}
    return out;
  }

  function selBounds(rects) {
    var l = Infinity,
      t = Infinity,
      rr = -Infinity,
      bb = -Infinity;
    rects.forEach(function (r) {
      l = Math.min(l, r.left);
      t = Math.min(t, r.top);
      rr = Math.max(rr, r.right);
      bb = Math.max(bb, r.bottom);
    });
    return { left: l, top: t, width: rr - l, height: bb - t };
  }

  /**
   * Where this host's viewport sits inside the WebView's viewport. EPUB chapters
   * render in an iframe, so their client coords need the iframe's offset added
   * before RN can position anything over them.
   */
  function selHostOffset(host) {
    if (!host.frame) return { x: 0, y: 0 };
    try {
      var r = host.frame.getBoundingClientRect();
      return { x: r.left, y: r.top };
    } catch (e) {
      return { x: 0, y: 0 };
    }
  }

  function selClearPaint(host) {
    if (!host || !host.layer) return;
    host.rects.forEach(function (d) {
      d.style.display = 'none';
    });
    host.startH.style.display = 'none';
    host.endH.style.display = 'none';
  }

  /**
   * Move the overlay onto the current range.
   *
   * Nothing here creates or destroys a node that a gesture might be touching.
   * The previous version rebuilt the handles on every repaint, and since a drag
   * repaints on each move, the very node the touch was dispatched to was ripped
   * out of the document on the first frame — after which `touchmove` had no
   * ancestor path to the document listener and the drag silently died. That was
   * the "handles don't extend the selection" bug. Handles are now permanent and
   * rect divs are pooled; we only ever set styles.
   */
  function selPaint() {
    selHosts.forEach(function (h) {
      if (!selCur || h !== selCur.host) selClearPaint(h);
    });
    if (!selCur) return;
    var host = selCur.host;
    var doc = host.doc;
    var rects = selRects(selCur.range);
    if (!rects.length) {
      selClearPaint(host);
      return;
    }

    while (host.rects.length < rects.length) {
      var d = doc.createElement('div');
      d.className = 'rp-sel-rect';
      host.layer.appendChild(d);
      host.rects.push(d);
    }
    host.rects.forEach(function (el, i) {
      var r = rects[i];
      if (!r) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.left = r.left + 'px';
      el.style.top = r.top + 'px';
      el.style.width = r.width + 'px';
      el.style.height = r.height + 'px';
    });

    // Per the reference: a dot above the caret bar at the start of the
    // selection, and a dot below the bar at the end.
    var first = rects[0];
    var last = rects[rects.length - 1];

    var s = host.startH;
    s.style.display = 'block';
    s.style.left = first.left - 14 + 'px';
    s.style.top = first.top - 14 + 'px';
    s.style.height = first.height + 14 + 'px';
    s.firstChild.style.top = '0px'; // <i> dot
    s.lastChild.style.top = '14px'; // <b> bar
    s.lastChild.style.height = first.height + 'px';

    var e = host.endH;
    e.style.display = 'block';
    e.style.left = last.right - 14 + 'px';
    e.style.top = last.top + 'px';
    e.style.height = last.height + 14 + 'px';
    e.firstChild.style.top = '0px'; // <b> bar
    e.firstChild.style.height = last.height + 'px';
    e.lastChild.style.top = last.height + 'px'; // <i> dot
  }

  // Repaint only. The actions are parked bottom-right now, so a moved selection
  // doesn't move any RN chrome — and re-posting `selection` on every scroll frame
  // would churn RN state (and close an open search sheet).
  function selRepaint() {
    if (selRaf) return;
    selRaf = requestAnimationFrame(function () {
      selRaf = 0;
      selPaint();
    });
  }

  function selClear(silent) {
    selCur = null;
    selDrag = null;
    selHosts.forEach(selClearPaint);
    if (!silent) post({ type: 'selectionCleared' });
  }

  function selPost() {
    if (!selCur) return;
    var host = selCur.host;
    var range = selCur.range;
    var text = String(range.toString() || '').trim();
    if (!text) return;
    var rects = selRects(range);
    if (!rects.length) return;
    var b = selBounds(rects);
    var off = selHostOffset(host);
    var anchor = selAnchor(host, range, rects);
    post({
      type: 'selection',
      text: text,
      // EPUB keeps using CFI so highlights already in the DB stay resolvable;
      // PDF and reflow get their own anchor shapes (see selAnchor).
      cfiRange: host.kind === 'epub' ? anchor : '',
      anchor: anchor,
      // Where to hang the action buttons, in WebView-viewport CSS px. RN adds
      // its own safe-area inset on top of this.
      rect: {
        x: Math.round(b.left + off.x),
        y: Math.round(b.top + off.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
      },
    });
  }

  function selBeginDrag(host, which, touch) {
    selDrag = which;
    var rects = selRects(selCur.range);
    if (!rects.length) return;
    var r = which === 'start' ? rects[0] : rects[rects.length - 1];
    // Anchor the caret to the edge the handle represents, and remember how far
    // the finger is from it so the text doesn't jump on the first move.
    var cx = which === 'start' ? r.left : r.right;
    var cy = r.top + r.height / 2;
    selDragOff = { x: cx - touch.clientX, y: cy - touch.clientY };
  }

  function selMoveDrag(host, touch) {
    if (!selCur || !selCur.flat) return;
    var doc = host.doc;
    var flat = selCur.flat;
    var hit = caretRangeAt(host, touch.clientX + selDragOff.x, touch.clientY + selDragOff.y);
    if (!hit) return; // probe missed the text — keep the range we have

    var moving = selToGlobal(flat, hit.startContainer, hit.startOffset);
    // Outside the subtree this selection lives in (a different page, the chrome).
    if (moving < 0) return;

    var rng = selCur.range;
    var fixed =
      selDrag === 'start'
        ? selToGlobal(flat, rng.endContainer, rng.endOffset)
        : selToGlobal(flat, rng.startContainer, rng.startOffset);
    if (fixed < 0) return;

    var next = selSnap(flat, doc, Math.min(fixed, moving), Math.max(fixed, moving));
    if (!next) return;

    // Dragging one handle past the other flips which end it now controls.
    if (moving < fixed) selDrag = 'start';
    else selDrag = 'end';

    selCur.range = next;
    selPaint();
  }

  /**
   * Install the engine into a document. `kind` picks the anchor format;
   * `frame` is the owning iframe element for EPUB chapters (null otherwise).
   */
  function selInstall(doc, kind, frame, contents) {
    for (var i = 0; i < selHosts.length; i++) if (selHosts[i].doc === doc) return selHosts[i];
    selInstallCss(doc);

    var body = doc.body || doc.documentElement;
    var host = {
      doc: doc,
      kind: kind,
      frame: frame || null,
      contents: contents || null,
      layer: null,
      rects: [], // pooled selection rectangles
      startH: null,
      endH: null,
    };

    var layer = doc.createElement('div');
    layer.id = 'rp-sel-layer';
    body.appendChild(layer);
    host.layer = layer;

    // Built once, moved forever. See selPaint() for why this matters.
    host.startH = doc.createElement('div');
    host.startH.className = 'rp-sel-h';
    host.startH.setAttribute('data-h', 'start');
    host.startH.innerHTML = '<i></i><b></b>';
    host.endH = doc.createElement('div');
    host.endH.className = 'rp-sel-h';
    host.endH.setAttribute('data-h', 'end');
    host.endH.innerHTML = '<b></b><i></i>';
    layer.appendChild(host.startH);
    layer.appendChild(host.endH);
    selClearPaint(host);

    // Suppresses Android's own selection handles and floating copy bar. Copy /
    // share / select-all are provided by RN instead (see RP.selectAll).
    body.classList.add('rp-nosel');

    var lpTimer = null;
    var sx = 0;
    var sy = 0;
    var moved = false;

    function cancelLp() {
      if (lpTimer) {
        clearTimeout(lpTimer);
        lpTimer = null;
      }
    }

    // Capture phase throughout: epub.js installs its own swipe handling on the
    // chapter document, and a bubble-phase listener can be starved by it.
    doc.addEventListener(
      'touchstart',
      function (e) {
        var t = e.touches[0];
        if (!t) return;
        selLastHost = host;

        var handle = e.target && e.target.closest ? e.target.closest('.rp-sel-h') : null;
        if (handle && selCur) {
          selBeginDrag(host, handle.getAttribute('data-h'), t);
          suppressTapUntil = Date.now() + 600;
          return;
        }

        // A tap anywhere else dismisses the selection rather than toggling the
        // reader chrome.
        if (selCur) {
          selClear(false);
          suppressTapUntil = Date.now() + 400;
          return;
        }

        if (e.touches.length !== 1) return;
        sx = t.clientX;
        sy = t.clientY;
        moved = false;
        cancelLp();
        lpTimer = setTimeout(function () {
          lpTimer = null;
          if (moved) return;
          var hit = caretRangeAt(host, sx, sy);
          if (!hit) return;
          // The flattened text is computed once here and reused for the whole
          // gesture — rebuilding it on every drag frame would walk the chapter
          // hundreds of times a second.
          var flat = selFlatten(selRootFor(host, hit.startContainer));
          var g = selToGlobal(flat, hit.startContainer, hit.startOffset);
          if (g < 0) return;
          var r = selSnap(flat, doc, g, g);
          if (!r) return;
          selCur = { host: host, range: r, flat: flat };
          selDrag = null;
          suppressTapUntil = Date.now() + 600;
          selPaint();
          selPost();
        }, 380);
      },
      { passive: true, capture: true },
    );

    doc.addEventListener(
      'touchmove',
      function (e) {
        var t = e.touches[0];
        if (!t) return;
        if (selDrag && selCur) {
          e.preventDefault(); // dragging a handle must not scroll the document
          e.stopPropagation(); // ...nor page the book
          selMoveDrag(host, t);
          return;
        }
        if (lpTimer && (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10)) {
          moved = true;
          cancelLp();
        }
      },
      { passive: false, capture: true },
    );

    function endTouch() {
      cancelLp();
      if (selDrag) {
        selDrag = null;
        selPost(); // commit the dragged range to RN
      }
    }
    doc.addEventListener('touchend', endTouch, { passive: true, capture: true });
    doc.addEventListener('touchcancel', endTouch, { passive: true, capture: true });

    // The selection is painted in fixed coords, so anything that scrolls it must
    // repaint. (Page turns clear it instead — see the EPUB relocated hook.)
    doc.addEventListener('scroll', selRepaint, true);
    if (frame && frame.contentWindow) {
      frame.contentWindow.addEventListener('scroll', selRepaint, true);
    }

    selHosts.push(host);
    return host;
  }

  // ---------- highlight anchors ----------
  //
  // EPUB has CFIs. PDF and reflow don't, which is why highlighting used to be
  // EPUB-only: the controller posted an empty cfiRange and RN's `canHighlight`
  // gate stayed false. They get their own anchor shapes here, both serialized
  // into the existing highlights.anchor TEXT column.

  /** Character offset of (node,offset) within root's text content. */
  function textOffsetIn(root, node, offset) {
    var walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var acc = 0;
    var n;
    while ((n = walker.nextNode())) {
      if (n === node) return acc + offset;
      acc += n.data.length;
    }
    return -1;
  }

  /** Inverse of textOffsetIn: rebuild a Range from character offsets. */
  function rangeFromOffsets(root, start, end) {
    var doc = root.ownerDocument;
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var acc = 0;
    var range = doc.createRange();
    var haveStart = false;
    var n;
    while ((n = walker.nextNode())) {
      var len = n.data.length;
      if (!haveStart && acc + len >= start) {
        range.setStart(n, Math.max(0, start - acc));
        haveStart = true;
      }
      if (haveStart && acc + len >= end) {
        range.setEnd(n, Math.max(0, end - acc));
        return range;
      }
      acc += len;
    }
    return haveStart ? range : null;
  }

  function pdfPageOf(range) {
    var node = range.startContainer;
    var el = node.nodeType === 3 ? node.parentElement : node;
    return el && el.closest ? el.closest('.pdf-page') : null;
  }

  function selAnchor(host, range, rects) {
    if (host.kind === 'epub') {
      try {
        return host.contents && host.contents.cfiFromRange
          ? host.contents.cfiFromRange(range)
          : '';
      } catch (e) {
        return '';
      }
    }
    if (host.kind === 'pdf') {
      var pageDiv = pdfPageOf(range);
      if (!pageDiv) return '';
      var pr = pageDiv.getBoundingClientRect();
      // Store rects unscaled and page-relative so they survive zoom and reflow
      // of the viewer. Only keep the rects that actually land on this page — a
      // selection dragged across a page break anchors to where it started.
      var out = [];
      rects.forEach(function (r) {
        if (r.bottom < pr.top || r.top > pr.bottom) return;
        out.push([
          Math.round(((r.left - pr.left) / pdf.scale) * 100) / 100,
          Math.round(((r.top - pr.top) / pdf.scale) * 100) / 100,
          Math.round((r.width / pdf.scale) * 100) / 100,
          Math.round((r.height / pdf.scale) * 100) / 100,
        ]);
      });
      if (!out.length) return '';
      return JSON.stringify({
        t: 'pdf',
        p: parseInt(pageDiv.getAttribute('data-page'), 10),
        r: out,
      });
    }
    // reflow
    var article = document.getElementById('rp-article');
    if (!article) return '';
    var s = textOffsetIn(article, range.startContainer, range.startOffset);
    var e2 = textOffsetIn(article, range.endContainer, range.endOffset);
    if (s < 0 || e2 < 0 || e2 <= s) return '';
    // `v` pins the anchor to the view it was made in: the rendered page and the
    // source listing are different DOM, so the same character offsets point at
    // completely different text. A highlight only redraws in its own view.
    return JSON.stringify({ t: 'txt', v: reflowView, s: s, e: e2 });
  }

  function parseAnchor(anchor) {
    if (!anchor || anchor.charAt(0) !== '{') return null;
    try {
      return JSON.parse(anchor);
    } catch (e) {
      return null;
    }
  }

  // ---------- PDF (fixed-layout) ----------
  function isDarkBg(hex) {
    try {
      var c = hex.replace('#', '');
      if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
      var r = parseInt(c.substr(0, 2), 16);
      var g = parseInt(c.substr(2, 2), 16);
      var b = parseInt(c.substr(4, 2), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.4;
    } catch (e) {
      return false;
    }
  }

  function applyPdfTheme(theme) {
    pdf.theme = theme;
    var viewer = document.getElementById('viewer');
    if (!viewer) return;
    viewer.style.background = theme.background;
    // A PDF page is a baked white image, so the only way a reader theme can
    // reach it is a CSS filter on the canvas. Drive it off the theme key so
    // sepia/twilight actually tint the page (not just the margins).
    ['t-light', 't-sepia', 't-dark', 't-twilight'].forEach(function (c) {
      viewer.classList.remove(c);
    });
    viewer.classList.add('t-' + (theme.key || (isDarkBg(theme.background) ? 'dark' : 'light')));
  }

  var PDF_MIN_ZOOM = 0.5;
  var PDF_MAX_ZOOM = 6;

  function clampZoom(z) {
    return Math.max(PDF_MIN_ZOOM, Math.min(PDF_MAX_ZOOM, z));
  }

  /**
   * Re-rasterize every page at a new zoom level.
   *
   * `anchor` (optional) is a point in the viewer's client box that should stay
   * put across the zoom — the pinch midpoint. Without it we anchor on the centre
   * of the viewport so a font-size change doesn't fling the reader elsewhere in
   * the document.
   */
  function setPdfZoom(nextZoom, anchor) {
    if (!pdf.doc) return;
    var zoom = clampZoom(nextZoom);
    if (Math.abs(zoom - pdf.zoom) < 0.001) return;

    var viewer = document.getElementById('viewer');
    var pages = pdf.pagesEl;
    if (!viewer || !pages) return;

    var ax = anchor ? anchor.x : viewer.clientWidth / 2;
    var ay = anchor ? anchor.y : viewer.clientHeight / 2;
    // The content point currently under the anchor, in pre-zoom layout px.
    var px = viewer.scrollLeft + ax;
    var py = viewer.scrollTop + ay;
    var k = zoom / pdf.zoom;

    pdf.zoom = zoom;
    pdf.scale = pdf.baseScale * zoom;
    pdf.estW = Math.round(pdf.baseUnscaledW * pdf.scale);
    pdf.estH = Math.round(pdf.baseUnscaledH * pdf.scale);

    // Drop the live pinch transform (if any) before we re-lay-out at real size.
    pages.style.transform = '';
    pages.style.transformOrigin = '';

    var divs = pages.querySelectorAll('.pdf-page');
    divs.forEach(function (div) {
      if (div.__rpTask) {
        try {
          div.__rpTask.cancel();
        } catch (e) {}
        div.__rpTask = null;
      }
      div.innerHTML = '';
      div.removeAttribute('data-rendered');
      div.style.width = pdf.estW + 'px';
      div.style.height = pdf.estH + 'px';
    });

    // Keep the anchor point under the finger now the layout has grown/shrunk.
    viewer.scrollLeft = px * k - ax;
    viewer.scrollTop = py * k - ay;

    // Rasterize what's on screen right now; the IntersectionObserver picks up
    // the rest as they scroll in.
    divs.forEach(function (div) {
      var r = div.getBoundingClientRect();
      if (r.bottom > -300 && r.top < viewer.clientHeight + 300) {
        renderPdfPage(parseInt(div.getAttribute('data-page'), 10), div);
      }
    });
  }

  // The font-size setting doubles as PDF zoom (a fixed-layout page has no text
  // to reflow), so route it through the same re-rasterizing path.
  function applyPdfZoom(t) {
    if (!pdf.doc || !t) return;
    setPdfZoom((t.fontSizePct || 100) / 100, null);
  }

  // ---------- PDF pinch-to-zoom ----------
  //
  // Browser pinch-zoom magnifies the *rasterized* canvas — it never asks pdf.js
  // to redraw — so zooming in turned the page to mush. We take the gesture over:
  // a CSS transform follows the fingers during the pinch (cheap, and blurry only
  // while it's moving), then on release we re-rasterize at the new scale so the
  // page settles crisp. That's the same "transform while dragging, re-render on
  // commit" trick a native reader uses.
  var pinch = { active: false, startDist: 0, startZoom: 1, k: 1, ax: 0, ay: 0 };

  function touchDist(t) {
    var dx = t[0].clientX - t[1].clientX;
    var dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function wirePdfPinch(viewer) {
    viewer.addEventListener(
      'touchstart',
      function (e) {
        if (e.touches.length !== 2 || !pdf.pagesEl) return;
        var box = viewer.getBoundingClientRect();
        var t = e.touches;
        pinch.active = true;
        pinch.startDist = touchDist(t) || 1;
        pinch.startZoom = pdf.zoom;
        pinch.k = 1;
        pinch.ax = (t[0].clientX + t[1].clientX) / 2 - box.left;
        pinch.ay = (t[0].clientY + t[1].clientY) / 2 - box.top;
        // Scale about the content point under the fingers, so the live preview
        // lands exactly where the re-rendered layout will.
        pdf.pagesEl.style.transformOrigin =
          viewer.scrollLeft + pinch.ax + 'px ' + (viewer.scrollTop + pinch.ay) + 'px';
        suppressTapUntil = Date.now() + 600;
      },
      { passive: false },
    );

    viewer.addEventListener(
      'touchmove',
      function (e) {
        if (!pinch.active || e.touches.length !== 2) return;
        e.preventDefault(); // we own this gesture; don't also scroll the page
        var k = touchDist(e.touches) / pinch.startDist;
        // Clamp against the zoom limits so the preview can't rubber-band past
        // where the committed zoom will actually land.
        pinch.k = clampZoom(pinch.startZoom * k) / pinch.startZoom;
        pdf.pagesEl.style.transform = 'scale(' + pinch.k + ')';
      },
      { passive: false },
    );

    function endPinch() {
      if (!pinch.active) return;
      pinch.active = false;
      suppressTapUntil = Date.now() + 400;
      var target = pinch.startZoom * pinch.k;
      // setPdfZoom no-ops when the zoom didn't actually move (a two-finger tap),
      // and it's the thing that drops the preview transform — so clear it here
      // too, or the pages stay stuck under a stale scale().
      if (pdf.pagesEl) {
        pdf.pagesEl.style.transform = '';
        pdf.pagesEl.style.transformOrigin = '';
      }
      setPdfZoom(target, { x: pinch.ax, y: pinch.ay });
    }
    viewer.addEventListener('touchend', endPinch);
    viewer.addEventListener('touchcancel', endPinch);
  }

  function ensurePdfWorker() {
    if (pdfjsLib.GlobalWorkerOptions.workerSrc) return;
    try {
      var blob = new Blob([window.__PDF_WORKER_SRC__ || ''], { type: 'application/javascript' });
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
    } catch (e) {
      err(e);
    }
  }

  function allowPinchZoom() {
    // The base reader locks scale (good for paginated EPUB). PDF/reflow are
    // fixed/long documents where pinch-to-zoom is expected, so relax it.
    var vp = document.querySelector('meta[name=viewport]');
    if (vp) {
      vp.setAttribute(
        'content',
        'width=device-width, initial-scale=1, maximum-scale=6, user-scalable=yes, viewport-fit=cover',
      );
    }
  }

  function loadPdf(buffer, location) {
    ensurePdfWorker();
    // Note: no allowPinchZoom() here. PDF pages are canvases, so browser zoom
    // would just magnify pixels — wirePdfPinch() drives zoom instead.
    var viewer = document.getElementById('viewer');
    viewer.innerHTML = '';
    viewer.className = 'pdf';
    // Pages hang off a wrapper: a scroll container can't transform itself, and
    // the pinch preview needs something to scale.
    var pagesEl = document.createElement('div');
    pagesEl.id = 'pdf-pages';
    viewer.appendChild(pagesEl);
    pdf.pagesEl = pagesEl;
    wirePdfPinch(viewer);
    viewer.addEventListener('click', function () {
      if (Date.now() < suppressTapUntil) return;
      post({ type: 'tap', zone: 'center' });
    });
    selInstall(document, 'pdf', null, null);
    wireHighlightTaps(viewer);
    viewer.addEventListener('scroll', selRepaint, { passive: true });

    pdfjsLib
      // isEvalSupported:false disables the font/JS eval path abused by
      // CVE-2024-4367 (arbitrary JS execution from a crafted PDF).
      .getDocument({ data: new Uint8Array(buffer), isEvalSupported: false })
      .promise.then(function (doc) {
        pdf.doc = doc;
        pdf.total = doc.numPages;
        return doc.getPage(1).then(function (p1) {
          var unscaled = p1.getViewport({ scale: 1 });
          // Fit the page to the viewport width. Falling back to the page's own
          // width (the old last resort) guarantees an oversized page that spills
          // off-screen, so try the window before giving up on measuring.
          var avail = viewer.clientWidth || window.innerWidth || unscaled.width;
          pdf.baseUnscaledW = unscaled.width;
          pdf.baseUnscaledH = unscaled.height;
          pdf.baseScale = avail / unscaled.width;
          // Font-size setting acts as zoom for fixed-layout PDF.
          pdf.zoom = lastTypography ? (lastTypography.fontSizePct || 100) / 100 : 1;
          pdf.scale = pdf.baseScale * pdf.zoom;
          pdf.estW = Math.round(unscaled.width * pdf.scale);
          pdf.estH = Math.round(unscaled.height * pdf.scale);
          buildPdfPages();
          if (pdf.theme) applyPdfTheme(pdf.theme);
          doc
            .getOutline()
            .then(function (outline) {
              var toc = (outline || []).map(function (o) {
                return { label: o.title || '', href: '' };
              });
              post({ type: 'loaded', toc: toc, chapterCount: pdf.total });
            })
            .catch(function () {
              post({ type: 'loaded', toc: [], chapterCount: pdf.total });
            });
          if (location && location.indexOf('page:') === 0) {
            var n = parseInt(location.split(':')[1], 10) || 1;
            setTimeout(function () {
              scrollToPdfPage(n);
            }, 80);
          }
        });
      })
      .catch(function (e) {
        err(e);
      });
  }

  function buildPdfPages() {
    var viewer = document.getElementById('viewer');
    pdf.observer = new IntersectionObserver(onPdfIntersect, {
      root: viewer,
      rootMargin: '300px 0px',
      threshold: [0, 0.25, 0.6, 1],
    });
    for (var i = 1; i <= pdf.total; i++) {
      var div = document.createElement('div');
      div.className = 'pdf-page';
      div.setAttribute('data-page', String(i));
      div.style.width = pdf.estW + 'px';
      div.style.height = pdf.estH + 'px';
      pdf.pagesEl.appendChild(div);
      pdf.observer.observe(div);
    }
  }

  function onPdfIntersect(entries) {
    entries.forEach(function (e) {
      var n = parseInt(e.target.getAttribute('data-page'), 10);
      if (e.isIntersecting) {
        renderPdfPage(n, e.target);
        if (e.intersectionRatio >= 0.6) updateCurrentPage(n);
      }
    });
  }

  // Rasterize a page at device-pixel resolution.
  //
  // The canvas is sized CSS-px * devicePixelRatio and the DPR is handed to
  // pdf.js as a render `transform`. Pre-scaling the 2D context instead (the old
  // approach) lets the backing store and the CSS box disagree whenever the
  // viewport is fractional, so the browser resamples the page — which is why
  // PDF text looked soft even before any zoom.
  function renderPdfPage(n, div) {
    if (!div || div.getAttribute('data-rendered')) return;
    div.setAttribute('data-rendered', '1');
    var scale = pdf.scale;
    pdf.doc.getPage(n).then(function (page) {
      // A pinch can land while getPage() is still resolving. Painting now would
      // bake in the stale scale, so drop this pass and let the re-render sweep
      // pick the page up at the current one.
      if (scale !== pdf.scale) {
        div.removeAttribute('data-rendered');
        return;
      }
      var viewport = page.getViewport({ scale: scale });
      var dpr = window.devicePixelRatio || 1;
      var cssW = Math.floor(viewport.width);
      var cssH = Math.floor(viewport.height);
      div.style.width = cssW + 'px';
      div.style.height = cssH + 'px';

      var canvas = document.createElement('canvas');
      canvas.className = 'pdf-canvas';
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      div.appendChild(canvas);

      var task = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      });
      div.__rpTask = task;
      task.promise.catch(function () {});

      // Replay any highlights anchored to this page at the new scale.
      pdfDrawPage(div, n);

      var textDiv = document.createElement('div');
      textDiv.className = 'textLayer';
      textDiv.style.width = cssW + 'px';
      textDiv.style.height = cssH + 'px';
      // pdf.js v3 sizes/positions the selectable text spans from this CSS var.
      // Without it the text layer is mis-scaled, so selection grabs the wrong
      // words (or nothing) — the root cause of the broken PDF selection.
      textDiv.style.setProperty('--scale-factor', String(viewport.scale));
      div.appendChild(textDiv);
      page.getTextContent().then(function (tc) {
        if (scale !== pdf.scale) return;
        try {
          pdfjsLib.renderTextLayer({
            textContentSource: tc,
            container: textDiv,
            viewport: viewport,
            textDivs: [],
          });
        } catch (e) {}
      });
    });
  }

  function updateCurrentPage(n) {
    if (n === pdf.current) return;
    pdf.current = n;
    post({ type: 'location', cfi: 'page:' + n, progress: pdf.total ? n / pdf.total : 0, chapter: '' });
  }

  function scrollToPdfPage(n) {
    var root = pdf.pagesEl || document.getElementById('viewer');
    var el = root && root.querySelector('[data-page="' + n + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView();
  }

  // ---------- PDF highlights ----------
  // Anchors are page-relative and unscaled, so a redraw at any zoom is just a
  // multiply by pdf.scale. Every page re-render replays the highlights that
  // belong to it.
  var pdfHls = {}; // id -> { p, r, color }

  // A marker sits *over* the text, like real ink over paper: multiply darkens
  // nicely on a light page but disappears on a dark one, so dark surfaces screen
  // instead. (Same rule the EPUB annotations use.)
  function hlBlend() {
    var dark = lastTheme && (lastTheme.key === 'dark' || lastTheme.key === 'twilight');
    return dark ? 'screen' : 'multiply';
  }

  function pdfDrawPage(div, n) {
    var layer = div.querySelector('.pdf-hl');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'pdf-hl';
      // Insert under the text layer so it never intercepts caret hit-testing.
      div.insertBefore(layer, div.firstChild ? div.firstChild.nextSibling : null);
    }
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    Object.keys(pdfHls).forEach(function (id) {
      var h = pdfHls[id];
      if (h.p !== n) return;
      h.r.forEach(function (r) {
        var d = document.createElement('div');
        d.className = 'pdf-hl-rect';
        d.style.left = r[0] * pdf.scale + 'px';
        d.style.top = r[1] * pdf.scale + 'px';
        d.style.width = r[2] * pdf.scale + 'px';
        d.style.height = r[3] * pdf.scale + 'px';
        d.style.background = h.color;
        d.style.mixBlendMode = hlBlend();
        layer.appendChild(d);
      });
    });
  }

  function pdfRedrawHighlights() {
    if (!pdf.pagesEl) return;
    pdf.pagesEl.querySelectorAll('.pdf-page[data-rendered]').forEach(function (div) {
      pdfDrawPage(div, parseInt(div.getAttribute('data-page'), 10));
    });
  }

  /** Highlight whose painted rect contains this client point, if any. */
  function pdfHlAt(x, y) {
    if (!pdf.pagesEl) return null;
    var found = null;
    pdf.pagesEl.querySelectorAll('.pdf-page[data-rendered]').forEach(function (div) {
      if (found) return;
      var n = parseInt(div.getAttribute('data-page'), 10);
      var pr = div.getBoundingClientRect();
      Object.keys(pdfHls).forEach(function (id) {
        if (found) return;
        var h = pdfHls[id];
        if (h.p !== n) return;
        h.r.forEach(function (r) {
          if (found) return;
          var l = pr.left + r[0] * pdf.scale;
          var t = pr.top + r[1] * pdf.scale;
          if (x >= l && x <= l + r[2] * pdf.scale && y >= t && y <= t + r[3] * pdf.scale) {
            found = id;
          }
        });
      });
    });
    return found;
  }

  // ---------- reflow highlights ----------
  var reflowHls = {}; // id -> { s, e, color }

  function reflowRedrawHighlights() {
    var article = document.getElementById('rp-article');
    if (!article) return;
    var layer = document.getElementById('rp-hl');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'rp-hl';
      article.appendChild(layer);
    }
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    var base = article.getBoundingClientRect();
    Object.keys(reflowHls).forEach(function (id) {
      var h = reflowHls[id];
      // Offsets only mean anything in the view they were captured in.
      if (h.v && h.v !== reflowView) return;
      var range = rangeFromOffsets(article, h.s, h.e);
      if (!range) return;
      selRects(range).forEach(function (r) {
        var d = document.createElement('div');
        d.className = 'rp-hl-rect';
        d.style.left = r.left - base.left + 'px';
        d.style.top = r.top - base.top + 'px';
        d.style.width = r.width + 'px';
        d.style.height = r.height + 'px';
        d.style.background = h.color;
        d.style.mixBlendMode = hlBlend();
        layer.appendChild(d);
      });
    });
  }

  function reflowHlAt(x, y) {
    var article = document.getElementById('rp-article');
    if (!article) return null;
    var found = null;
    Object.keys(reflowHls).forEach(function (id) {
      if (found) return;
      var h = reflowHls[id];
      if (h.v && h.v !== reflowView) return;
      var range = rangeFromOffsets(article, h.s, h.e);
      if (!range) return;
      selRects(range).forEach(function (r) {
        if (found) return;
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) found = id;
      });
    });
    return found;
  }

  /** Short tap with no selection → did the user tap an existing highlight? */
  function wireHighlightTaps(el) {
    el.addEventListener(
      'touchend',
      function (e) {
        if (selCur || selDrag) return;
        var t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        var id = mode === 'pdf' ? pdfHlAt(t.clientX, t.clientY) : reflowHlAt(t.clientX, t.clientY);
        if (!id) return;
        var h = mode === 'pdf' ? pdfHls[id] : reflowHls[id];
        suppressTapUntil = Date.now() + 400;
        post({ type: 'highlightTapped', id: id, cfiRange: (h && h.anchor) || '' });
      },
      { passive: true },
    );
  }

  // ---------- Reflow (txt / md / json / csv / html / docx) ----------
  var REFLOW_FORMATS = ['txt', 'md', 'json', 'csv', 'html'];
  var reflowEl = null;
  // 'rendered' = the page as the author meant it; 'source' = the syntax-
  // highlighted file. HTML exposes both via the File/Browser tabs; JSON is only
  // ever source; everything else is only ever rendered.
  var reflowView = 'rendered';
  // Kept so a tab switch can re-render without re-reading the file.
  var reflowRaw = { text: '', format: '' };

  function base64ToText(b64) {
    try {
      return new TextDecoder('utf-8').decode(new Uint8Array(base64ToArrayBuffer(b64)));
    } catch (e) {
      return atob(b64);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Untrusted document HTML (Markdown output and raw .html files) is run through
  // DOMPurify before it ever touches innerHTML, so embedded <script>, inline
  // event handlers (onerror/onload/...), javascript: URLs and other XSS vectors
  // are stripped while ordinary formatting is preserved. If the sanitizer failed
  // to load we fail closed and render the markup as escaped text rather than
  // injecting it raw.
  function sanitizeHtml(html) {
    try {
      if (window.DOMPurify && window.DOMPurify.sanitize) {
        // Default DOMPurify is already XSS-safe; we additionally drop the
        // script/navigation-capable containers (iframe/object/embed/form) as
        // defence in depth. Inline styles are kept so document formatting still
        // renders faithfully — CSP blocks any network egress they could attempt.
        return window.DOMPurify.sanitize(String(html), {
          USE_PROFILES: { html: true },
          FORBID_TAGS: ['iframe', 'object', 'embed', 'form'],
        });
      }
    } catch (e) {}
    return '<pre>' + escapeHtml(html) + '</pre>';
  }

  function csvToHtml(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inq = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inq) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inq = false;
        } else field += c;
      } else if (c === '"') inq = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c !== '\r') field += c;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    if (!rows.length) return '<p>(empty)</p>';
    var html = '<table class="rp-table"><thead><tr>';
    rows[0].forEach(function (h) {
      html += '<th>' + escapeHtml(h) + '</th>';
    });
    html += '</tr></thead><tbody>';
    for (var r = 1; r < rows.length; r++) {
      html += '<tr>';
      rows[r].forEach(function (cell) {
        html += '<td>' + escapeHtml(cell) + '</td>';
      });
      html += '</tr>';
    }
    return html + '</tbody></table>';
  }

  function formatToHtml(text, format) {
    if (format === 'md') {
      try {
        return window.marked
          ? sanitizeHtml(window.marked.parse(text))
          : '<pre>' + escapeHtml(text) + '</pre>';
      } catch (e) {
        return '<pre>' + escapeHtml(text) + '</pre>';
      }
    }
    if (format === 'json') {
      try {
        return '<pre class="rp-code">' + escapeHtml(JSON.stringify(JSON.parse(text), null, 2)) + '</pre>';
      } catch (e) {
        return '<pre class="rp-code">' + escapeHtml(text) + '</pre>';
      }
    }
    if (format === 'csv') return csvToHtml(text);
    if (format === 'html') return sanitizeHtml(text);
    return text
      .split(/\n{2,}/)
      .map(function (p) {
        return '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>';
      })
      .join('');
  }

  // ---------- code view (JSON / HTML source) ----------
  //
  // A hand-rolled tokenizer rather than pulling in a highlighter: reader.html is
  // already 2 MB, and this only needs two grammars. It is XSS-safe by
  // construction — the raw source is tokenized, each token's text is escaped,
  // and only then is it wrapped in a span. No document text ever reaches
  // innerHTML unescaped.

  var VOID_TAGS = [
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ];

  /** Re-indent HTML source so the File tab is readable even if the file is minified. */
  function formatHtmlSource(src) {
    var parts = String(src)
      .replace(/>\s+</g, '><')
      .split(/(<[^>]+>)/g)
      .filter(function (p) {
        return p !== '';
      });
    var depth = 0;
    var out = [];
    var IND = '  ';
    parts.forEach(function (p) {
      if (/^<\//.test(p)) {
        depth = Math.max(0, depth - 1);
        out.push(new Array(depth + 1).join(IND) + p);
      } else if (/^<[!?]/.test(p)) {
        out.push(new Array(depth + 1).join(IND) + p);
      } else if (/^</.test(p)) {
        out.push(new Array(depth + 1).join(IND) + p);
        var name = (p.match(/^<\s*([\w:-]+)/) || [])[1] || '';
        var selfClosing = /\/>$/.test(p) || VOID_TAGS.indexOf(name.toLowerCase()) !== -1;
        if (!selfClosing) depth++;
      } else {
        var t = p.trim();
        if (t) out.push(new Array(depth + 1).join(IND) + t);
      }
    });
    return out.join('\n');
  }

  function prettyJson(src) {
    try {
      return JSON.stringify(JSON.parse(src), null, 2);
    } catch (e) {
      return String(src); // not valid JSON — show it as-is rather than failing
    }
  }

  // Token classes: k=key s=string n=number b=literal p=punctuation
  //                g=tag a=attribute c=comment d=doctype t=plain
  function jsonTokens(src) {
    var out = [];
    var re =
      /("(?:\\.|[^"\\])*")(\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;
    var last = 0;
    var m;
    while ((m = re.exec(src))) {
      if (m.index > last) out.push(['t', src.slice(last, m.index)]);
      if (m[1] !== undefined) {
        out.push(['k', m[1]]);
        out.push(['p', m[2]]);
      } else if (m[3] !== undefined) out.push(['s', m[3]]);
      else if (m[4] !== undefined) out.push(['n', m[4]]);
      else if (m[5] !== undefined) out.push(['b', m[5]]);
      else out.push(['p', m[6]]);
      last = re.lastIndex;
    }
    if (last < src.length) out.push(['t', src.slice(last)]);
    return out;
  }

  function htmlTokens(src) {
    var out = [];
    var re = /(<!--[\s\S]*?-->)|(<![^>]*>)|(<\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?>)/g;
    var last = 0;
    var m;
    while ((m = re.exec(src))) {
      if (m.index > last) out.push(['t', src.slice(last, m.index)]);
      if (m[1] !== undefined) out.push(['c', m[1]]);
      else if (m[2] !== undefined) out.push(['d', m[2]]);
      else {
        out.push(['p', m[3]]); // < or </
        out.push(['g', m[4]]); // tag name
        // Attributes: name, =, then a quoted or bare value.
        var attrs = m[5] || '';
        var ar = /([\w:-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s">]+)?|(\s+)/g;
        var am;
        while ((am = ar.exec(attrs))) {
          if (am[4] !== undefined) out.push(['t', am[4]]);
          else {
            out.push(['a', am[1]]);
            if (am[2] !== undefined) out.push(['p', am[2]]);
            if (am[3] !== undefined) out.push(['s', am[3]]);
          }
        }
        out.push(['p', m[6]]); // > or />
      }
      last = re.lastIndex;
    }
    if (last < src.length) out.push(['t', src.slice(last)]);
    return out;
  }

  /**
   * Turn tokens into one block element per source line. Tokens are split on
   * newlines so a multi-line string or comment never leaves a span open across a
   * line boundary — that's what lets the line-number gutter be pure CSS.
   */
  function codeHtml(src, lang) {
    var text = lang === 'json' ? prettyJson(src) : formatHtmlSource(src);
    var toks = lang === 'json' ? jsonTokens(text) : htmlTokens(text);
    var lines = [''];
    toks.forEach(function (t) {
      var cls = t[0];
      var segs = String(t[1] === undefined ? '' : t[1]).split('\n');
      segs.forEach(function (seg, i) {
        if (i > 0) lines.push('');
        if (seg === '') return;
        var esc = escapeHtml(seg);
        lines[lines.length - 1] +=
          cls === 't' ? esc : '<span class="tok-' + cls + '">' + esc + '</span>';
      });
    });
    var html = '<pre class="rp-code-view">';
    lines.forEach(function (l, i) {
      html += '<span class="rp-line" data-n="' + (i + 1) + '">' + (l || ' ') + '</span>';
    });
    return html + '</pre>';
  }

  function buildReflowToc(article, format) {
    if (format !== 'md' && format !== 'html' && format !== 'docx') return [];
    var hs = article.querySelectorAll('h1, h2, h3');
    var toc = [];
    for (var i = 0; i < hs.length; i++) {
      hs[i].id = 'rp-h-' + i;
      toc.push({ label: (hs[i].textContent || '').trim(), href: '#rp-h-' + i });
    }
    return toc;
  }

  function reflowLineHeight(s) {
    return (1.2 + (Number(s) / 100) * 0.8).toFixed(2);
  }

  // Syntax colours for the code view, per surface brightness. Deliberately muted
  // — this is a reading app, not an IDE.
  var TOKENS_LIGHT = {
    k: '#0b7285', // json key
    s: '#087f5b', // string / attribute value
    n: '#a61e4d', // number
    b: '#5f3dc4', // true / false / null
    p: '#868e96', // punctuation
    g: '#1971c2', // html tag
    a: '#0b7285', // html attribute
    c: '#909296', // comment
    d: '#9c6644', // doctype
  };
  var TOKENS_DARK = {
    k: '#66d9e8',
    s: '#8ce99a',
    n: '#ffa8a8',
    b: '#b197fc',
    p: '#909296',
    g: '#74c0fc',
    a: '#66d9e8',
    c: '#868e96',
    d: '#e8b48b',
  };

  function tokenCss(theme) {
    var dark = theme.key === 'dark' || theme.key === 'twilight' || isDarkBg(theme.background);
    var pal = dark ? TOKENS_DARK : TOKENS_LIGHT;
    // The reader-mode override below explicitly skips [class*="tok-"], so these
    // don't have to win a specificity fight with it — they just have to be the
    // only rule that matches. (It can't be won anyway: `:not(#rp-hl)` gives the
    // override two ids' worth of weight.)
    return Object.keys(pal)
      .map(function (k) {
        return '#rp-article .tok-' + k + '{color:' + pal[k] + '!important}';
      })
      .join('');
  }

  function applyReflowTheme(theme) {
    if (!reflowEl || !theme) return;
    reflowEl.style.background = theme.background;
    reflowEl.style.color = theme.text;
    var st = document.getElementById('rp-theme-style') || document.createElement('style');
    st.id = 'rp-theme-style';
    // Same reader-mode override as EPUB (see RP.applyTheme): strip the author's
    // background boxes and text colours instead of layering the theme under
    // them, which is what made text vanish on a theme switch. Our own highlight
    // overlay is excluded — it must keep the colour it was given.
    st.textContent = [
      // Everything except our highlight overlay and the syntax-highlighted
      // tokens, which own their colours (see tokenCss).
      '#rp-article,#rp-article *:not(#rp-hl):not(.rp-hl-rect):not([class*="tok-"]){',
      'background-color:transparent!important;color:' + theme.text + '!important}',
      '#rp-article a[href]{color:' + theme.link + '!important}',
      '#rp-article ::selection{background:rgba(66,133,244,0.28)}',
      '#rp-article .rp-line::before{color:' + theme.textSecondary + '!important}',
      tokenCss(theme),
    ].join('');
    document.head.appendChild(st);
    reflowRedrawHighlights();
  }

  function applyReflowTypography(t) {
    var a = document.getElementById('rp-article');
    if (!a || !t) return;
    a.style.fontSize = t.fontSizePct + '%';
    a.style.fontFamily = t.fontStack && t.fontStack !== 'inherit' ? t.fontStack : '';
    a.style.fontWeight = String(t.fontWeight);
    a.style.textAlign = t.textAlign;
    a.style.lineHeight = reflowLineHeight(t.lineSpacing);
    a.style.hyphens = t.hyphenation ? 'auto' : 'manual';
    a.style.webkitHyphens = t.hyphenation ? 'auto' : 'manual';
    a.style.padding = t.pageMargins ? '16px' : '4px';
    // Typography reflows the text, so the highlight rects (and any painted
    // selection) no longer line up with it.
    reflowRedrawHighlights();
    selRepaint();
  }

  var reflowScrollTimer = null;
  function onReflowScroll() {
    if (reflowScrollTimer) return;
    reflowScrollTimer = setTimeout(function () {
      reflowScrollTimer = null;
      if (!reflowEl) return;
      var max = Math.max(1, reflowEl.scrollHeight - reflowEl.clientHeight);
      var p = Math.min(1, reflowEl.scrollTop / max);
      post({ type: 'location', cfi: 'scroll:' + p.toFixed(4), progress: p, chapter: '' });
    }, 250);
  }

  /** The markup for a reflowable document, honouring the current view mode. */
  function reflowHtmlFor(text, format) {
    if (format === 'json') return codeHtml(text, 'json');
    if (format === 'html') {
      return reflowView === 'source' ? codeHtml(text, 'html') : sanitizeHtml(text);
    }
    return formatToHtml(text, format);
  }

  /**
   * DOCX is a zip of OOXML. mammoth maps it to semantic HTML, which then joins
   * the same sanitize → reflow path as Markdown and HTML — so selection,
   * highlighting, typography and theming all work on it for free.
   */
  function loadDocx(buffer, location) {
    if (!window.mammoth) {
      err('The DOCX converter failed to load.');
      return;
    }
    window.mammoth
      .convertToHtml({ arrayBuffer: buffer })
      .then(function (res) {
        loadReflow(sanitizeHtml((res && res.value) || ''), 'docx', location);
      })
      .catch(function (e) {
        err('Could not read this DOCX file: ' + e);
      });
  }

  /** `html` is already built (and sanitized, where the source was untrusted). */
  function loadReflow(html, format, location) {
    var viewer = document.getElementById('viewer');
    viewer.innerHTML = '';
    viewer.className = 'reflow';
    // @font-face must live in this (main) document for #rp-article fonts.
    if (!document.getElementById('rp-fonts')) {
      var fs = document.createElement('style');
      fs.id = 'rp-fonts';
      fs.textContent = window.__READER_FONTS_CSS__ || '';
      document.head.appendChild(fs);
    }
    var article = document.createElement('article');
    article.id = 'rp-article';
    article.innerHTML = html;
    viewer.appendChild(article);
    reflowEl = viewer;

    viewer.addEventListener('click', function (ev) {
      var a = closestAnchor(ev.target);
      if (a) {
        var href = a.getAttribute('href') || '';
        if (href.charAt(0) === '#') {
          // In-document anchor (e.g. a built TOC heading link): scroll to it.
          ev.preventDefault();
          var el = document.getElementById(href.slice(1));
          if (el && el.scrollIntoView) el.scrollIntoView();
        } else if (isExternalHref(href)) {
          ev.preventDefault();
          suppressTapUntil = Date.now() + 400;
          post({ type: 'link', href: href });
        }
        return; // a link tap never toggles the reader chrome
      }
      if (Date.now() < suppressTapUntil) return;
      post({ type: 'tap', zone: 'center' });
    });
    selInstall(document, 'reflow', null, null);
    wireHighlightTaps(viewer);
    viewer.addEventListener('scroll', onReflowScroll);
    viewer.addEventListener('scroll', selRepaint, { passive: true });

    if (lastTheme) applyReflowTheme(lastTheme);
    if (lastTypography) applyReflowTypography(lastTypography);

    post({ type: 'loaded', toc: buildReflowToc(article, format), chapterCount: 1 });

    if (location && location.indexOf('scroll:') === 0) {
      var f = parseFloat(location.split(':')[1]) || 0;
      setTimeout(function () {
        viewer.scrollTop = f * Math.max(1, viewer.scrollHeight - viewer.clientHeight);
      }, 60);
    }
  }

  window.RP = {
    loadBook: function (b64, format, location) {
      try {
        var buffer = base64ToArrayBuffer(b64);
        if (REFLOW_FORMATS.indexOf(format) !== -1) {
          mode = 'reflow';
          var raw = base64ToText(b64);
          reflowRaw = { text: raw, format: format };
          // JSON has no "rendered" form — it's always the highlighted source.
          reflowView = format === 'json' ? 'source' : 'rendered';
          loadReflow(reflowHtmlFor(raw, format), format, location);
          return;
        }
        if (format === 'pdf') {
          mode = 'pdf';
          loadPdf(buffer, location);
          return;
        }
        if (format === 'docx') {
          mode = 'reflow';
          reflowRaw = { text: '', format: 'docx' };
          reflowView = 'rendered';
          loadDocx(buffer, location);
          return;
        }
        if (format === 'doc') {
          // Legacy .doc is a binary OLE compound file, not a zip of XML — mammoth
          // can't read it and there's no dependable JS parser. Say so plainly
          // rather than rendering garbage.
          err(
            'Legacy .doc files aren’t supported. Open it in Word or Google Docs, ' +
              'save it as .docx, and import that instead.',
          );
          return;
        }
        if (format !== 'epub') {
          err('Format "' + format + '" is not supported by the reader engine yet.');
          return;
        }
        mode = 'epub';
        allowPinchZoom(); // pinch-to-zoom in the reading area (font size also zooms)
        book = ePub(buffer);
        var epubFlow = lastTypography ? lastTypography.flow : 'paginated';
        // The "continuous" manager pre-renders and stitches adjacent spine
        // sections together. The default manager only mounts one section at a
        // time and is the classic cause of EPUBs being stuck on the cover /
        // first page inside a WebView (next()/prev() across section boundaries
        // silently stalls). `snap` gives swipe page-turns in paginated flow.
        rendition = book.renderTo('viewer', {
          manager: 'continuous',
          width: '100%',
          height: '100%',
          flow: epubFlow,
          spread: 'none',
          snap: epubFlow === 'paginated',
          // EPUB chapters are attacker-supplied (X)HTML; never let their inline
          // scripts run in the chapter iframe.
          allowScriptedContent: false,
        });

        // Re-layout on orientation / viewport changes so pagination stays sane.
        window.addEventListener('resize', function () {
          try {
            if (rendition && rendition.resize) rendition.resize();
          } catch (e) {}
          setTimeout(redrawAnnotations, 50);
        });

        rendition.on('relocated', function (loc) {
          var cfi = loc && loc.start ? loc.start.cfi : '';
          var progress =
            locationsReady && cfi ? book.locations.percentageFromCfi(cfi) || 0 : 0;
          post({
            type: 'location',
            cfi: cfi,
            progress: progress,
            chapter: (loc && loc.start && loc.start.href) || '',
          });
        });

        // A page turn invalidates the painted rects, so drop the selection.
        rendition.on('relocated', function () {
          if (selCur) selClear(false);
        });

        rendition.on('rendered', function (section, view) {
          if (view && view.contents) wireContents(view.contents);
          // Re-place highlight overlays whenever a section (re)renders.
          redrawAnnotations();
        });

        rendition.hooks.content.register(function (contents) {
          // Inject bundled @font-face into the chapter iframe so font-family applies.
          try {
            contents.addStylesheetCss(window.__READER_FONTS_CSS__ || '', 'rp-fonts');
          } catch (e) {
            try {
              var st = contents.document.createElement('style');
              st.textContent = window.__READER_FONTS_CSS__ || '';
              contents.document.head.appendChild(st);
            } catch (e2) {}
          }
          wireContents(contents);
          // Each chapter is its own document, so the selection engine installs
          // per iframe. frameElement gives us the offset needed to translate the
          // chapter's client coords into WebView coords for RN.
          try {
            selInstall(
              contents.document,
              'epub',
              contents.window && contents.window.frameElement,
              contents,
            );
          } catch (eSel) {}
          // Web fonts load async; when they swap in, the text reflows and any
          // highlight drawn beforehand ends up misaligned. Redraw once fonts settle.
          try {
            if (contents.document.fonts && contents.document.fonts.ready) {
              contents.document.fonts.ready.then(redrawAnnotations);
            }
          } catch (e3) {}
        });

        var startAt = location || undefined;
        rendition.display(startAt).then(function () {
          var toc = (book.navigation && book.navigation.toc ? book.navigation.toc : []).map(
            function (i) {
              return { label: i.label ? i.label.trim() : '', href: i.href };
            },
          );
          post({ type: 'loaded', toc: toc, chapterCount: book.spine ? book.spine.length : 0 });
          if (lastTheme) window.RP.applyTheme(lastTheme);
          if (lastTypography) applyTypographyInternal(lastTypography);
        });

        book.ready
          .then(function () {
            return book.locations.generate(1600);
          })
          .then(function () {
            locationsReady = true;
          })
          .catch(function () {});
      } catch (e) {
        err(e);
      }
    },

    applyTheme: function (theme) {
      lastTheme = theme;
      pdf.theme = theme;
      if (mode === 'pdf') {
        applyPdfTheme(theme);
        return;
      }
      if (mode === 'reflow') {
        applyReflowTheme(theme);
        return;
      }
      if (!rendition) return; // stashed in lastTheme; re-applied after epub display
      try {
        rendition.themes.override('color', theme.text, true);
        rendition.themes.override('background', theme.background, true);
        // Reader-mode override.
        //
        // Documents carry their own colours: a callout with a black background,
        // a heading with white text, a code block with a grey box. Painting a
        // theme *underneath* that left two ways to lose the text — the author's
        // own colour could vanish against the new background, or our forced
        // theme colour could vanish against an author background box we never
        // touched. Either way the reader saw blank space where words should be.
        //
        // So the theme doesn't negotiate: author background colours and text
        // colours are stripped from the content and everything is repainted in
        // the theme's palette. `background-color` (not the `background`
        // shorthand) so background *images* — cover art, figures — survive.
        var rules = {
          '*': {
            'background-color': 'transparent !important',
            color: theme.text + ' !important',
          },
          'html, body': {
            background: theme.background + ' !important',
            color: theme.text + ' !important',
          },
          // Type selectors outrank `*`, so links keep the accent colour. Scoped
          // to a[href] because EPUBs routinely wrap headings in a bare <a> as a
          // bookmark target — those aren't links and shouldn't be tinted.
          'a[href]': { color: theme.link + ' !important' },
          '::selection': { background: 'rgba(66,133,244,0.28)' },
        };
        rendition.themes.register('rp', rules);
        rendition.themes.select('rp');
        document.body.style.background = theme.background;
        // Selecting a theme reflows the page, so highlight overlays must be redrawn.
        redrawAnnotations();
        selRepaint();
      } catch (e) {
        err(e);
      }
    },

    applyTypography: function (t) {
      lastTypography = t;
      if (mode === 'pdf') {
        applyPdfZoom(t);
        return;
      }
      if (mode === 'reflow') {
        applyReflowTypography(t);
        return;
      }
      applyTypographyInternal(t);
    },

    next: function () {
      if (mode === 'pdf' || mode === 'reflow') {
        var v1 = document.getElementById('viewer');
        if (v1) v1.scrollBy({ top: v1.clientHeight * 0.92, behavior: 'smooth' });
        return;
      }
      if (rendition) rendition.next();
    },
    prev: function () {
      if (mode === 'pdf' || mode === 'reflow') {
        var v2 = document.getElementById('viewer');
        if (v2) v2.scrollBy({ top: -v2.clientHeight * 0.92, behavior: 'smooth' });
        return;
      }
      if (rendition) rendition.prev();
    },
    gotoCfi: function (cfi) {
      if (mode === 'pdf') {
        if (cfi && cfi.indexOf('page:') === 0) scrollToPdfPage(parseInt(cfi.split(':')[1], 10) || 1);
        return;
      }
      if (rendition && cfi) rendition.display(cfi);
    },
    gotoHref: function (href) {
      if (mode === 'reflow') {
        if (href && href.charAt(0) === '#') {
          var el = document.getElementById(href.slice(1));
          if (el && el.scrollIntoView) el.scrollIntoView();
        }
        return;
      }
      if (rendition && href) rendition.display(href);
    },

    addHighlight: function (id, anchor, color) {
      // PDF / reflow keep their own overlay registries; only EPUB goes through
      // epub.js annotations.
      var a = parseAnchor(anchor);
      if (a && a.t === 'pdf') {
        // Keep the original anchor string: tapping the highlight has to hand RN
        // back something it can re-add with a different colour.
        pdfHls[id] = { p: a.p, r: a.r || [], color: color, anchor: anchor };
        pdfRedrawHighlights();
        return;
      }
      if (a && a.t === 'txt') {
        // `v` is absent on highlights saved before the File/Browser tabs existed;
        // treat those as belonging to the rendered view.
        reflowHls[id] = { v: a.v || 'rendered', s: a.s, e: a.e, color: color, anchor: anchor };
        reflowRedrawHighlights();
        return;
      }
      var cfiRange = anchor;
      if (!rendition) return;
      // Idempotent: if this id is already drawn (e.g. a re-sync after load),
      // remove the old mark first so we never stack duplicate overlays.
      if (hlCfi[id]) {
        try {
          rendition.annotations.remove(hlCfi[id], 'highlight');
        } catch (e0) {}
      }
      hlCfi[id] = cfiRange;
      try {
        // multiply darkens nicely over a light page but turns invisible on a
        // dark one; screen lightens so the marker shows on dark/twilight.
        var dark =
          lastTheme && (lastTheme.key === 'dark' || lastTheme.key === 'twilight');
        rendition.annotations.highlight(
          cfiRange,
          { id: id },
          function () {
            // Tapping a highlight opens the sheet to recolor/delete it.
            suppressTapUntil = Date.now() + 400;
            post({ type: 'highlightTapped', id: id, cfiRange: cfiRange });
          },
          'hl-' + id,
          {
            fill: color,
            'fill-opacity': dark ? '0.45' : '0.35',
            'mix-blend-mode': dark ? 'screen' : 'multiply',
          },
        );
        redrawAnnotations();
      } catch (e) {
        err(e);
      }
    },
    removeHighlight: function (id) {
      if (pdfHls[id]) {
        delete pdfHls[id];
        pdfRedrawHighlights();
        return;
      }
      if (reflowHls[id]) {
        delete reflowHls[id];
        reflowRedrawHighlights();
        return;
      }
      if (!rendition) return;
      try {
        // epub.js keys annotations by CFI, not our id — look it up.
        var cfi = hlCfi[id];
        if (cfi) rendition.annotations.remove(cfi, 'highlight');
        delete hlCfi[id];
      } catch (e) {}
    },
    renderHighlights: function (items) {
      if (!items) return;
      items.forEach(function (h) {
        window.RP.addHighlight(h.id, h.cfiRange, h.color);
      });
    },
    clearAllHighlights: function () {
      pdfHls = {};
      pdfRedrawHighlights();
      reflowHls = {};
      reflowRedrawHighlights();
      try {
        Object.keys(hlCfi).forEach(function (id) {
          try {
            rendition.annotations.remove(hlCfi[id], 'highlight');
          } catch (e) {}
        });
      } catch (e) {}
      hlCfi = {};
      redrawAnnotations();
    },
    /** Convert a PDF to an EPUB entirely on-device (P2 onboarding). */
    convertPdfToEpub: function (b64, title) {
      try {
        convertPdfToEpub(b64, String(title || 'Converted document'));
      } catch (e) {
        err(e);
      }
    },

    /** 'rendered' | 'source' — the File/Browser tabs on an HTML document. */
    setViewMode: function (m) {
      var next = m === 'source' ? 'source' : 'rendered';
      if (mode !== 'reflow' || next === reflowView || !reflowRaw.format) return;
      reflowView = next;
      var article = document.getElementById('rp-article');
      if (!article) return;
      // The two views are different DOM, so any painted selection and the text
      // offsets behind it are meaningless now.
      selClear(true);
      article.innerHTML = reflowHtmlFor(reflowRaw.text, reflowRaw.format);
      if (lastTypography) applyReflowTypography(lastTypography);
      // Highlights are anchored per view (see selAnchor), so this redraws only
      // the ones belonging to the view we just switched to.
      reflowRedrawHighlights();
      post({
        type: 'loaded',
        toc: buildReflowToc(article, reflowRaw.format),
        chapterCount: 1,
      });
    },

    /**
     * Select the whole of what's currently on screen — the chapter, the reflow
     * article, or the current PDF page's text layer. This is the "Select all"
     * the OS menu would have given us, which our own selection engine
     * necessarily suppresses.
     */
    selectAll: function () {
      var host = (selCur && selCur.host) || selLastHost || selHosts[selHosts.length - 1];
      if (!host) return;
      var root = null;
      if (host.kind === 'reflow') {
        root = document.getElementById('rp-article');
      } else if (host.kind === 'pdf') {
        var page =
          pdf.pagesEl &&
          pdf.pagesEl.querySelector('.pdf-page[data-page="' + pdf.current + '"] .textLayer');
        root = page;
      } else {
        root = host.doc.body || host.doc.documentElement;
      }
      if (!root) return;
      try {
        var flat = selFlatten(root);
        if (!flat.text.trim()) return;
        var r = selSnap(flat, host.doc, 0, flat.text.length);
        if (!r) return;
        // Carry the flattened text, so the handles can still be dragged to
        // narrow a select-all down.
        selCur = { host: host, range: r, flat: flat };
        selDrag = null;
        selPaint();
        selPost();
      } catch (e) {}
    },

    search: function (query) {
      if (!book || !query) return;
      var q = query.trim();
      if (!q) return;
      Promise.all(
        book.spine.spineItems.map(function (item) {
          return item
            .load(book.load.bind(book))
            .then(function () {
              var res = item.find(q);
              item.unload();
              return res;
            })
            .catch(function () {
              return [];
            });
        }),
      ).then(function (results) {
        var flat = [].concat.apply([], results);
        post({ type: 'searchResults', query: q, count: flat.length });
      });
    },

    clearSelection: function () {
      selClear(true); // our own overlay
      // Native ranges only exist when the user opted into the OS menu.
      try {
        window.getSelection().removeAllRanges();
      } catch (e) {}
      try {
        var c = rendition && rendition.getContents ? rendition.getContents() : [];
        (c || []).forEach(function (ct) {
          if (ct.window) ct.window.getSelection().removeAllRanges();
        });
      } catch (e) {}
      post({ type: 'selectionCleared' });
    },
  };

  // ---------- PDF → EPUB conversion ----------
  //
  // Runs in this WebView because everything it needs is already here: pdf.js to
  // pull the text out, JSZip to write the container. A PDF is fixed-layout, so
  // its text can't reflow to the screen; an EPUB can. We extract the text run by
  // run, rebuild paragraphs from the layout, and emit a minimal EPUB 2 the
  // existing epub.js path can open.

  function xmlEscape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Rebuild paragraphs from a page's positioned text runs.
   *
   * pdf.js hands back items with a transform matrix, not sentences. We group
   * runs into lines by baseline, then start a new paragraph when a line's
   * vertical gap is bigger than the prevailing leading, or when it's indented —
   * the same cues a human eye uses.
   */
  function pdfPageParagraphs(items) {
    var lines = [];
    items.forEach(function (it) {
      var s = it.str;
      if (!s || !s.trim()) return;
      var y = Math.round(it.transform[5]);
      var x = it.transform[4];
      var line = null;
      for (var i = 0; i < lines.length; i++) {
        // Same line if the baselines are within a couple of px.
        if (Math.abs(lines[i].y - y) <= 2) {
          line = lines[i];
          break;
        }
      }
      if (!line) {
        line = { y: y, minX: x, runs: [] };
        lines.push(line);
      }
      line.minX = Math.min(line.minX, x);
      line.runs.push({ x: x, s: s });
    });

    // Top of page downwards (PDF y grows upwards).
    lines.sort(function (a, b) {
      return b.y - a.y;
    });
    lines.forEach(function (l) {
      l.runs.sort(function (a, b) {
        return a.x - b.x;
      });
      l.text = l.runs
        .map(function (r) {
          return r.s;
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    });
    lines = lines.filter(function (l) {
      return l.text;
    });
    if (!lines.length) return [];

    // Typical line-to-line gap on this page — the yardstick for "blank line".
    var gaps = [];
    for (var i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
    gaps.sort(function (a, b) {
      return a - b;
    });
    var median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    var pageLeft = Math.min.apply(
      null,
      lines.map(function (l) {
        return l.minX;
      }),
    );

    var paras = [];
    var cur = '';
    for (var j = 0; j < lines.length; j++) {
      var l = lines[j];
      var brk = false;
      if (j > 0) {
        var gap = lines[j - 1].y - l.y;
        if (median && gap > median * 1.6) brk = true; // blank line
        if (l.minX > pageLeft + 8) brk = true; // indented → new para
      }
      if (brk && cur) {
        paras.push(cur);
        cur = '';
      }
      cur = cur ? cur + ' ' + l.text : l.text;
      // A short line that isn't the last one usually ends a paragraph.
      var next = lines[j + 1];
      if (next && l.text.length < 45 && /[.!?:”"']$/.test(l.text)) {
        paras.push(cur);
        cur = '';
      }
    }
    if (cur) paras.push(cur);
    return paras;
  }

  function chapterXhtml(title, paras) {
    var body = paras
      .map(function (p) {
        return '    <p>' + xmlEscape(p) + '</p>';
      })
      .join('\n');
    return (
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml">\n' +
      '  <head><title>' +
      xmlEscape(title) +
      '</title>\n' +
      '  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/></head>\n' +
      '  <body>\n' +
      body +
      '\n  </body>\n</html>\n'
    );
  }

  function buildEpub(title, chapters) {
    var zip = new JSZip();
    // Per OCF, `mimetype` must be first and stored uncompressed.
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.folder('META-INF').file(
      'container.xml',
      '<?xml version="1.0"?>\n' +
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
        '  <rootfiles><rootfile full-path="OEBPS/content.opf" ' +
        'media-type="application/oebps-package+xml"/></rootfiles>\n' +
        '</container>\n',
    );

    var oebps = zip.folder('OEBPS');
    var manifest = '';
    var spine = '';
    var nav = '';
    chapters.forEach(function (c, i) {
      var id = 'ch' + (i + 1);
      var file = id + '.xhtml';
      oebps.file(file, chapterXhtml(c.title, c.paras));
      manifest +=
        '    <item id="' + id + '" href="' + file + '" media-type="application/xhtml+xml"/>\n';
      spine += '    <itemref idref="' + id + '"/>\n';
      nav +=
        '  <navPoint id="np' +
        (i + 1) +
        '" playOrder="' +
        (i + 1) +
        '">\n' +
        '    <navLabel><text>' +
        xmlEscape(c.title) +
        '</text></navLabel>\n' +
        '    <content src="' +
        file +
        '"/>\n  </navPoint>\n';
    });

    var uid = 'urn:uuid:revpdf-' + Date.now().toString(36);
    oebps.file(
      'content.opf',
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">\n' +
        '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
        '    <dc:title>' +
        xmlEscape(title) +
        '</dc:title>\n' +
        '    <dc:language>en</dc:language>\n' +
        '    <dc:identifier id="bookid">' +
        uid +
        '</dc:identifier>\n' +
        '    <dc:creator>Converted by RevPdf</dc:creator>\n' +
        '  </metadata>\n' +
        '  <manifest>\n' +
        '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n' +
        manifest +
        '  </manifest>\n' +
        '  <spine toc="ncx">\n' +
        spine +
        '  </spine>\n</package>\n',
    );
    oebps.file(
      'toc.ncx',
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n' +
        '  <head><meta name="dtb:uid" content="' +
        uid +
        '"/></head>\n' +
        '  <docTitle><text>' +
        xmlEscape(title) +
        '</text></docTitle>\n  <navMap>\n' +
        nav +
        '  </navMap>\n</ncx>\n',
    );

    return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  }

  /**
   * Convert a base64 PDF to a base64 EPUB, reporting progress as it goes.
   * Pages are grouped into chapters so a long PDF doesn't become one huge
   * XHTML file that epub.js has to parse in one go.
   */
  function convertPdfToEpub(b64, title) {
    var PAGES_PER_CHAPTER = 10;
    ensurePdfWorker();
    post({ type: 'convertProgress', progress: 0, stage: 'Reading the PDF' });

    pdfjsLib
      .getDocument({ data: new Uint8Array(base64ToArrayBuffer(b64)), isEvalSupported: false })
      .promise.then(function (doc) {
        var total = doc.numPages;
        var chapters = [];
        var pending = [];

        function flush(upTo) {
          if (!pending.length) return;
          var first = upTo - pending.length + 1;
          chapters.push({
            title: 'Pages ' + first + '–' + upTo,
            paras: pending.slice(),
          });
          pending = [];
        }

        function step(n) {
          if (n > total) {
            flush(total);
            post({ type: 'convertProgress', progress: 0.95, stage: 'Building the EPUB' });
            if (!chapters.length) {
              err(
                'This PDF has no extractable text — it’s probably a scan, ' +
                  'so there’s nothing to convert.',
              );
              return;
            }
            buildEpub(title, chapters).then(function (out) {
              post({ type: 'converted', base64: out });
            });
            return;
          }
          doc
            .getPage(n)
            .then(function (page) {
              return page.getTextContent();
            })
            .then(function (tc) {
              pdfPageParagraphs(tc.items).forEach(function (p) {
                pending.push(p);
              });
              if (n % PAGES_PER_CHAPTER === 0) flush(n);
              post({
                type: 'convertProgress',
                progress: (n / total) * 0.9,
                stage: 'Extracting text — page ' + n + ' of ' + total,
              });
              // Yield to the event loop so the WebView stays responsive.
              setTimeout(function () {
                step(n + 1);
              }, 0);
            })
            .catch(function () {
              setTimeout(function () {
                step(n + 1);
              }, 0);
            });
        }
        step(1);
      })
      .catch(function (e) {
        err('Could not read the PDF: ' + e);
      });
  }

  // ---------- in-document find (EPUB / PDF / reflow) ----------
  var find = { q: '', list: [], idx: -1 };

  function postFind() {
    post({ type: 'findResults', query: find.q, count: find.list.length, index: find.idx });
  }

  function findGoto() {
    if (find.idx < 0 || !find.list.length) return;
    var t = find.list[find.idx];
    if (mode === 'epub' && rendition) rendition.display(t);
    else if (mode === 'pdf') scrollToPdfPage(t);
  }

  function epubFind(q) {
    if (!book) {
      find = { q: q, list: [], idx: -1 };
      postFind();
      return;
    }
    Promise.all(
      book.spine.spineItems.map(function (item) {
        return item
          .load(book.load.bind(book))
          .then(function () {
            var res = item.find(q) || [];
            item.unload();
            return res;
          })
          .catch(function () {
            return [];
          });
      }),
    ).then(function (results) {
      var flat = [].concat.apply([], results);
      find.q = q;
      find.list = flat.map(function (r) {
        return r.cfi;
      });
      find.idx = flat.length ? 0 : -1;
      postFind();
      findGoto();
    });
  }

  function pdfFind(q) {
    if (!pdf.doc) {
      find = { q: q, list: [], idx: -1 };
      postFind();
      return;
    }
    var ql = q.toLowerCase();
    var pages = [];
    var i = 1;
    function step() {
      if (i > pdf.total) {
        find.q = q;
        find.list = pages;
        find.idx = pages.length ? 0 : -1;
        postFind();
        findGoto();
        return;
      }
      var pageNo = i;
      pdf.doc
        .getPage(pageNo)
        .then(function (p) {
          return p.getTextContent();
        })
        .then(function (tc) {
          var s = tc.items
            .map(function (it) {
              return it.str;
            })
            .join(' ')
            .toLowerCase();
          if (s.indexOf(ql) !== -1) pages.push(pageNo);
          i = pageNo + 1;
          step();
        })
        .catch(function () {
          i = pageNo + 1;
          step();
        });
    }
    step();
  }

  function reflowFind(q) {
    find = { q: q, list: [], idx: -1 };
    var ok = false;
    try {
      window.getSelection().removeAllRanges();
      ok = window.find(q, false, false, true);
    } catch (e) {}
    post({ type: 'findResults', query: q, count: ok ? 1 : 0, index: ok ? 0 : -1 });
  }

  window.RP.findInDoc = function (q) {
    q = (q || '').trim();
    if (!q) {
      find = { q: '', list: [], idx: -1 };
      postFind();
      return;
    }
    if (mode === 'epub') return epubFind(q);
    if (mode === 'pdf') return pdfFind(q);
    if (mode === 'reflow') return reflowFind(q);
  };
  window.RP.findNext = function () {
    if (mode === 'reflow') {
      try {
        window.find(find.q, false, false, true);
      } catch (e) {}
      return;
    }
    if (!find.list.length) return;
    find.idx = (find.idx + 1) % find.list.length;
    findGoto();
    postFind();
  };
  window.RP.findPrev = function () {
    if (mode === 'reflow') {
      try {
        window.find(find.q, false, true, true);
      } catch (e) {}
      return;
    }
    if (!find.list.length) return;
    find.idx = (find.idx - 1 + find.list.length) % find.list.length;
    findGoto();
    postFind();
  };
  window.RP.clearFind = function () {
    find = { q: '', list: [], idx: -1 };
    try {
      window.getSelection().removeAllRanges();
    } catch (e) {}
  };

  post({ type: 'ready' });
})();
