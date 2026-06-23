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
  var allowNativeMenu = false; // show the OS copy/paste/share menu on selection
  var pdf = { doc: null, total: 0, scale: 1, current: 1, theme: null, observer: null };

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

  function applyPdfZoom(t) {
    if (!pdf.doc || !t) return;
    var zoom = (t.fontSizePct || 100) / 100;
    if (zoom === pdf.zoom) return;
    pdf.zoom = zoom;
    pdf.scale = pdf.baseScale * zoom;
    pdf.estW = Math.round(pdf.baseUnscaledW * pdf.scale);
    pdf.estH = Math.round(pdf.baseUnscaledH * pdf.scale);
    var viewer = document.getElementById('viewer');
    var pages = viewer.querySelectorAll('.pdf-page');
    pages.forEach(function (div) {
      div.innerHTML = '';
      div.removeAttribute('data-rendered');
      div.style.width = pdf.estW + 'px';
      div.style.height = pdf.estH + 'px';
    });
    // Re-render the pages currently in view at the new scale.
    pages.forEach(function (div) {
      var r = div.getBoundingClientRect();
      if (r.bottom > -300 && r.top < viewer.clientHeight + 300) {
        renderPdfPage(parseInt(div.getAttribute('data-page'), 10), div);
      }
    });
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
    allowPinchZoom();
    var viewer = document.getElementById('viewer');
    viewer.innerHTML = '';
    viewer.className = 'pdf';
    viewer.addEventListener('click', function () {
      if (Date.now() < suppressTapUntil) return;
      post({ type: 'tap', zone: 'center' });
    });
    document.addEventListener('selectionchange', onPdfSelectionChange);

    pdfjsLib
      .getDocument({ data: new Uint8Array(buffer) })
      .promise.then(function (doc) {
        pdf.doc = doc;
        pdf.total = doc.numPages;
        return doc.getPage(1).then(function (p1) {
          var unscaled = p1.getViewport({ scale: 1 });
          var avail = viewer.clientWidth || unscaled.width;
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
      viewer.appendChild(div);
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

  function renderPdfPage(n, div) {
    if (!div || div.getAttribute('data-rendered')) return;
    div.setAttribute('data-rendered', '1');
    pdf.doc.getPage(n).then(function (page) {
      var viewport = page.getViewport({ scale: pdf.scale });
      var dpr = window.devicePixelRatio || 1;
      div.style.width = Math.floor(viewport.width) + 'px';
      div.style.height = Math.floor(viewport.height) + 'px';

      var canvas = document.createElement('canvas');
      canvas.className = 'pdf-canvas';
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';
      var ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      div.appendChild(canvas);
      page.render({ canvasContext: ctx, viewport: viewport });

      var textDiv = document.createElement('div');
      textDiv.className = 'textLayer';
      textDiv.style.width = Math.floor(viewport.width) + 'px';
      textDiv.style.height = Math.floor(viewport.height) + 'px';
      // pdf.js v3 sizes/positions the selectable text spans from this CSS var.
      // Without it the text layer is mis-scaled, so selection grabs the wrong
      // words (or nothing) — the root cause of the broken PDF selection.
      textDiv.style.setProperty('--scale-factor', String(viewport.scale));
      div.appendChild(textDiv);
      page.getTextContent().then(function (tc) {
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
    var viewer = document.getElementById('viewer');
    var el = viewer.querySelector('[data-page="' + n + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView();
  }

  var pdfSelTimer = null;
  function onPdfSelectionChange() {
    if (pdfSelTimer) clearTimeout(pdfSelTimer);
    pdfSelTimer = setTimeout(function () {
      var text = '';
      try {
        text = window.getSelection().toString();
      } catch (e) {}
      if (text && text.trim().length) {
        suppressTapUntil = Date.now() + 400;
        post({ type: 'selection', text: text.trim(), cfiRange: '' });
        // Collapse selection so the OS selection menu doesn't sit over the sheet,
        // unless the user enabled the native menu.
        if (!allowNativeMenu) {
          setTimeout(function () {
            try {
              window.getSelection().removeAllRanges();
            } catch (e) {}
          }, 0);
        }
      }
    }, 250);
  }

  // ---------- Reflow (txt / md / json / csv / html) ----------
  var REFLOW_FORMATS = ['txt', 'md', 'json', 'csv', 'html'];
  var reflowEl = null;

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
        return window.marked ? window.marked.parse(text) : '<pre>' + escapeHtml(text) + '</pre>';
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
    if (format === 'html') return String(text).replace(/<script[\s\S]*?<\/script>/gi, '');
    return text
      .split(/\n{2,}/)
      .map(function (p) {
        return '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>';
      })
      .join('');
  }

  function buildReflowToc(article, format) {
    if (format !== 'md' && format !== 'html') return [];
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

  function applyReflowTheme(theme) {
    if (!reflowEl || !theme) return;
    reflowEl.style.background = theme.background;
    reflowEl.style.color = theme.text;
    var st = document.getElementById('rp-link-style') || document.createElement('style');
    st.id = 'rp-link-style';
    st.textContent = '#rp-article a{color:' + theme.link + '}';
    document.head.appendChild(st);
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

  function loadReflow(text, format, location) {
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
    article.innerHTML = formatToHtml(text, format);
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
    document.addEventListener('selectionchange', onPdfSelectionChange);
    viewer.addEventListener('scroll', onReflowScroll);

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
          loadReflow(base64ToText(b64), format, location);
          return;
        }
        if (format === 'pdf') {
          mode = 'pdf';
          loadPdf(buffer, location);
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
          allowScriptedContent: true,
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

        rendition.on('selected', function (cfiRange, contents) {
          var text = '';
          try {
            text = contents.window.getSelection().toString();
          } catch (e) {}
          if (text && text.trim().length) {
            suppressTapUntil = Date.now() + 400;
            post({ type: 'selection', text: text.trim(), cfiRange: cfiRange });
            // We've captured text + CFI; unless the user opted into the OS
            // copy/paste/share menu, collapse the DOM selection so it doesn't
            // pop over our sheet.
            if (!allowNativeMenu) {
              setTimeout(function () {
                try {
                  contents.window.getSelection().removeAllRanges();
                } catch (e) {}
              }, 0);
            }
          }
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
        var dark = theme.key === 'dark' || theme.key === 'twilight' || isDarkBg(theme.background);
        rendition.themes.override('color', theme.text, true);
        rendition.themes.override('background', theme.background, true);
        var rules = {
          body: { background: theme.background + ' !important', color: theme.text + ' !important' },
          a: { color: theme.link + ' !important' },
          '::selection': { background: 'rgba(120,120,160,0.35)' },
        };
        if (dark) {
          // Many EPUBs hard-code black text in their own stylesheet, which a
          // body-level color can't beat. On dark/twilight force the text color
          // on the actual text elements so the page stays readable.
          rules[
            'p, div, span, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, ' +
              'em, strong, b, i, u, small, sup, sub, figcaption, section, ' +
              'article, header, footer, pre, code, dt, dd, caption, label'
          ] = { color: theme.text + ' !important' };
        }
        rendition.themes.register('rp', rules);
        rendition.themes.select('rp');
        document.body.style.background = theme.background;
        // Selecting a theme reflows the page, so highlight overlays must be redrawn.
        redrawAnnotations();
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

    addHighlight: function (id, cfiRange, color) {
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
      if (!rendition) return;
      try {
        // epub.js keys annotations by CFI, not our id — look it up.
        var cfi = hlCfi[id];
        if (cfi) rendition.annotations.remove(cfi, 'highlight');
        delete hlCfi[id];
      } catch (e) {}
    },
    renderHighlights: function (items) {
      if (!rendition || !items) return;
      items.forEach(function (h) {
        window.RP.addHighlight(h.id, h.cfiRange, h.color);
      });
    },
    clearAllHighlights: function () {
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
    setNativeMenu: function (enabled) {
      allowNativeMenu = !!enabled;
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
