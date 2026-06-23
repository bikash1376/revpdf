# Security Vulnerability Report — revpdf

> Audit date: 2026-06-23
> Scope: application source (`src/`, `assets/reader/`, `scripts/`) and shipped dependencies.
> Core theme: revpdf opens **untrusted documents** inside a **highly-privileged WebView**, and several rendering paths do not sanitize that content.

## Severity summary

| # | Severity | Issue | Location |
|---|----------|-------|----------|
| 1 | Critical | Stored XSS via Markdown / HTML documents | `src/reader-web/controller.js` |
| 2 | Critical | pdf.js 3.11.174 — arbitrary JS execution from a malicious PDF (CVE-2024-4367) | `package.json`, `controller.js` |
| 3 | High | EPUB scripted content enabled | `controller.js` |
| 4 | High | Over-permissive WebView (amplifier for #1–#3) | `src/components/ReaderWebView.tsx` |
| 5 | High | Vulnerable transitive dependency `@xmldom/xmldom` (via epubjs) | dependency tree |
| 6 | Medium | Unbounded full-file load → memory DoS | `ReaderWebView.tsx`, `controller.js` |
| 7 | Medium | Native bridge trusts WebView messages | `src/reader/bridge.ts`, `reader/[id].tsx` |
| — | Low/Info | Dev-only CVEs, search exfiltration by design | see below |

---

## Critical

### 1. Stored XSS via Markdown / HTML documents
**Files:** `src/reader-web/controller.js:433-456` (`formatToHtml`) → `:521` (`article.innerHTML = ...`)

- **HTML format** is "sanitized" by stripping only `<script>` tags with a regex:
  ```js
  if (format === 'html') return String(text).replace(/<script[\s\S]*?<\/script>/gi, '');
  ```
  Trivially bypassed: `<img src=x onerror=...>`, `<svg onload=...>`, `<iframe src=javascript:...>`, `<body onload>`, etc. None are `<script>` tags.
- **Markdown format** runs `marked.parse(text)` and injects the result via `innerHTML`. `marked` (v12) does **not** sanitize and passes embedded raw HTML through by design.

A malicious `.md`/`.html` file therefore executes arbitrary JS inside the reader WebView. That context can read the loaded document's contents, spoof messages to the native bridge via `window.ReactNativeWebView.postMessage`, and exfiltrate data to any URL (no CSP — see #4). CSV/JSON/TXT are correctly HTML-escaped; only MD and HTML are vulnerable.

**Fix:** Sanitize all rendered document HTML with a real sanitizer (e.g. DOMPurify) for the `md` and `html` reflow paths; drop the regex strip.

### 2. pdf.js 3.11.174 — arbitrary JS execution from a malicious PDF
**Files:** `package.json:28`, bundled in `assets/reader/reader.html`, loaded at `controller.js:227`

This is **CVE-2024-4367 / GHSA-wgrm-67xf-hhpq** (confirmed by `npm audit`: pdfjs-dist `<=4.1.392`, high). A crafted PDF font can run arbitrary JS when the document is opened. `getDocument({ data: ... })` is called **without** `isEvalSupported: false`, so the mitigation is off. Any opened PDF is a potential attacker. Fixed in pdf.js ≥ 4.2.67.

**Fix:** Pass `getDocument({ data, isEvalSupported: false })` and bump `pdfjs-dist` to ≥ 4.2.67 (requires rerunning `npm run build:reader`).

---

## High

### 3. EPUB scripted content enabled
**File:** `controller.js:594` — `allowScriptedContent: true` in the epub.js rendition.

EPUB chapters are arbitrary attacker-supplied (X)HTML. With scripting allowed, scripts inside an EPUB run in the chapter iframe. Combined with the WebView flags below, an EPUB becomes a script-execution vector, not just a rendering one.

**Fix:** Disable `allowScriptedContent`, or accept it only behind sanitization + CSP.

### 4. Over-permissive WebView (the amplifier for #1–#3)
**File:** `src/components/ReaderWebView.tsx:162-170`

```js
originWhitelist={['*']}
allowFileAccess
allowUniversalAccessFromFileURLs
javaScriptEnabled
domStorageEnabled
```

`allowUniversalAccessFromFileURLs` + `allowFileAccess` let document-origin script reach cross-origin and local resources; `originWhitelist:['*']` removes navigation restrictions; and there is **no `Content-Security-Policy`** meta tag in `reader.html` (`build-reader.mjs` emits none). Each XSS above thus gains network egress for exfiltration and a much wider blast radius. None of these flags are required to render self-contained inlined HTML.

**Fix:** Remove `allowUniversalAccessFromFileURLs` and `allowFileAccess`, narrow `originWhitelist`, and add a restrictive CSP `<meta>` in `scripts/build-reader.mjs`.

### 5. Vulnerable transitive dependency: `@xmldom/xmldom` (via epubjs)
`npm audit` — high. Multiple XML-injection and recursion-DoS advisories, reachable when parsing EPUB XML (OPF/NCX). Fix requires an epubjs upgrade.

**Fix:** Upgrade `epubjs` to a release that depends on a patched `@xmldom/xmldom`.

---

## Medium

### 6. Unbounded full-file load → memory DoS
**Files:** `ReaderWebView.tsx:123` reads the entire file as base64; `controller.js:60-66` `atob`s it into a `Uint8Array`. No size cap anywhere in import (`src/store/library.ts:71`) or the load path. A large or maliciously crafted file can OOM-crash the WebView/app.

**Fix:** Cap import file size and surface a friendly error.

### 7. Native bridge trusts WebView messages
**Files:** `src/reader/bridge.ts:56-64`, `src/app/reader/[id].tsx:101,134`

`parseOutbound` only checks `typeof msg.type === 'string'`; fields aren't validated. A compromised WebView (via #1/#2/#3) can post forged `link`, `selection`, etc. messages. `link` flows to `Linking.openURL(msg.href)` — `isExternalHref` filtering happens *inside the WebView*, so a hijacked WebView can pass any scheme to the OS handler.

**Fix:** Validate bridge messages against the typed schema and re-check link schemes natively.

---

## Low / Informational

- **Dev-only CVEs** (not shipped to users): `js-yaml`, `postcss`, `babel-*` flagged by `npm audit`. Safe to ignore for release; they inflate audit output.
- **Search exfiltration by design:** `src/components/SelectionSheet.tsx:66` sends selected text to the configured search engine. `text` is `encodeURIComponent`-escaped (no injection) and this is expected behavior — just note that selections leave the device.
- **Result-link WebView** (`SelectionSheet.tsx:210`) uses `setSupportMultipleWindows` and routes off-host links through `openLink` — reasonable.

---

## Recommended remediation order

1. **Sanitize all rendered document HTML** (DOMPurify) for the `md` and `html` reflow paths; drop the regex strip. *(#1)*
2. **Disable pdf.js eval** (`isEvalSupported: false`) and bump `pdfjs-dist` ≥ 4.2.67; rerun `npm run build:reader`. *(#2)*
3. **Tighten the WebView:** remove `allowUniversalAccessFromFileURLs` / `allowFileAccess`, narrow `originWhitelist`, add a restrictive CSP in `build-reader.mjs`. *(#4)*
4. **Reconsider `allowScriptedContent`** for EPUB, or gate it behind sanitization + CSP. *(#3)*
5. **Cap import file size** and surface a friendly error. *(#6)*
6. **Validate bridge messages** against the typed schema and re-check link schemes natively. *(#7)*
7. **Upgrade `epubjs`** to clear `@xmldom/xmldom`. *(#5)*

> Note: editing the reader requires changing `src/reader-web/controller.js` then running `npm run build:reader` to regenerate `assets/reader/reader.html`.
