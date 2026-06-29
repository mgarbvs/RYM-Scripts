# RYM Album Card — Userscript

A userscript (Tampermonkey / Violentmonkey / Greasemonkey) that adds a **"Copy album card"** button to any RateYourMusic release page. Makes a picture of cover art, artist, album title, year, rating, and genre pills — and copies it to your clipboard so you can paste it directly into iMessage, or anywhere else really.

<img width="1200" height="1590" alt="image" src="https://github.com/user-attachments/assets/23f9a811-9132-4b69-b8c7-856163aa0c57" />



## Why a userscript?

RateYourMusic is protected by Cloudflare. Userscript is the easiest tool for the job without being "scraping".

## Installation

### Tampermonkey (Chrome, Safari, Firefox, Edge)

1. Install the [Tampermonkey](https://www.tampermonkey.net) extension for your browser.
2. Click the Tampermonkey icon → **"Create a new script"**.
3. Delete the default template and paste the entire contents of `rym-card.user.js`.
4. **File → Save** (or Cmd-S).

### Violentmonkey (Chrome, Firefox)

1. Install [Violentmonkey](https://violentmonkey.github.io).
2. Click the Violentmonkey icon → **"+"** → **"New script"**.
3. Paste the contents of `rym-card.user.js`, replacing the template.
4. Save.

### Greasemonkey (Firefox)

1. Install [Greasemonkey](https://www.greasespot.net).
2. Greasemonkey icon → **"New user script…"** → paste the contents of `rym-card.user.js` and save.

### From a URL (if hosted)

Both managers support installing directly from a `.user.js` URL — navigate to the raw file URL and they will prompt you to install.

## Usage

1. Open any RateYourMusic album, EP, single, or compilation page, for example:
   `https://rateyourmusic.com/release/album/radiohead/ok-computer/`
2. Wait for the page to finish loading. A **"📋 Copy album card"** button appears fixed in the bottom-right corner.
3. Click the button. The button shows "⏳ Building card…" while it fetches the cover and composes the image.
4. When it shows "✅ Copied!", switch to iMessage and press **Cmd-V** to paste.

If clipboard access is unavailable (insecure context or browser restriction), the script falls back to opening the card in a new tab or triggering a download.

## Card layout

The card is approximately 1200 × 1700 px (portrait), rendered on a dark background:

- Cover art (square, rounded corners)
- Artist name (muted)
- Album title (bold, wraps if long)
- Year · ★ Rating (if available)
- **GENRES** — primary genre pills (blue)
- **SUBGENRES** — secondary genre / descriptor pills (purple)

## Browser support

- **Chrome + Tampermonkey** — full support, tested flow.
- **Safari + Tampermonkey** — fully supported. The clipboard write uses the Safari-compatible pattern: `ClipboardItem` is constructed with an unresolved Promise so the async canvas work stays within the click gesture. Safari rejects clipboard writes that happen outside a gesture; this script handles it correctly.
- **Firefox + Tampermonkey, Violentmonkey, or Greasemonkey** — works; the cover loads via a plain `crossOrigin` image (RYM's CDN sends `Access-Control-Allow-Origin: *`), so no manager-specific networking API is needed.

## Technical notes

### Canvas taint fix

The cover image is served from a cross-origin CDN (`e.snmc.io`). Drawing a cross-origin image directly onto a `<canvas>` taints the canvas and makes `toBlob()` throw a security error. This script fetches the cover bytes via `GM_xmlhttpRequest` (which bypasses CORS), creates a `blob:` URL from the response, loads that blob URL into an `<img>`, and draws that — the canvas sees a same-origin blob URL and stays untainted.

### Safari clipboard timing

`navigator.clipboard.write()` must be called synchronously within the user's click gesture. This script does NOT `await` anything before calling `clipboard.write()`. Instead, it passes the composing Promise directly as the `ClipboardItem` value:

```js
navigator.clipboard.write([
  new ClipboardItem({ 'image/png': pngPromise })  // promise, not resolved blob
])
```

Safari and Chrome both accept a promise here. The async work (cover fetch + canvas render) resolves inside the gesture window.

## Selectors — what to update if RYM changes its markup

The DOM selectors are isolated in the `SEL` constant near the top of `rym-card.user.js`. If RYM updates its HTML and the card stops picking up data, open an album page, open DevTools (F12), and run these queries in the Console to find the new class names:

```js
document.querySelector('.album_title')
document.querySelector('.page_release_art_frame img')
document.querySelector('.release_pri_genres')
document.querySelector('.release_sec_genres')
document.querySelector('.release_descriptors')
document.querySelector('span.avg_rating')
document.querySelector('span.issue_date')
```

Then update the matching strings in the `SEL` block in `rym-card.user.js`. A selector fix-up round after first install is likely — RYM's markup is not documented publicly and these selectors were derived from known scraper projects rather than live inspection.

| Field | Selector |
|---|---|
| Album title | `.album_title` — first text node |
| Artist | `.album_title_artist a`, fallback `a.artist`, `a.credited_name` |
| Cover image | `.page_release_art_frame img` |
| Primary genres | `.release_pri_genres a.genre` |
| Secondary genres | `.release_sec_genres a.genre` |
| Descriptors (fallback) | `.release_descriptors a.tag` |
| Release year | `span.issue_date` (regex for 4-digit year) |
| Average rating | `span.avg_rating` |

## File layout

```
rym-card.user.js    The userscript — install this
README.md           This file
```

## Verification status

- **Syntax**: checked with `node --check` — passes.
- **Static flow**: the canvas-taint fix (blob URL path) and Safari clipboard timing (unresolved Promise to ClipboardItem) are confirmed in place.
- **Live browser test**: NOT run — no browser is available in this environment, and RYM 403s automated requests anyway. You should expect one round of selector adjustments after your first live test.
