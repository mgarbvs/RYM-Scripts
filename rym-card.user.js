// ==UserScript==
// @name         RYM Album Card
// @version      2.4.0
// @description  One-click: compose a shareable album card PNG from an RYM release page and copy it to the clipboard.
// @author       michael.garbus@gmail.com
// @match        https://rateyourmusic.com/release/*
// The cover-art CDN (cdn.sonemic.net / e.snmc.io) sends Access-Control-Allow-
// Origin: *, so we load the cover with a plain crossOrigin image — no GM APIs
// needed. Works on Greasemonkey, Tampermonkey, and Violentmonkey alike.
// @updateURL    https://raw.githubusercontent.com/mgarbvs/RYM-Scripts/main/rym-card.user.js
// @downloadURL  https://raw.githubusercontent.com/mgarbvs/RYM-Scripts/main/rym-card.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* ============================================================
   SELECTORS — update these if RYM changes its markup.
   All selectors are isolated here so a non-expert can fix
   them without reading the rest of the code.

   To verify in DevTools (F12 → Console on an album page):
     document.querySelector('.album_title')
     document.querySelector('.page_release_art_frame img')
     document.querySelector('.release_pri_genres')
     document.querySelector('.release_sec_genres')
     document.querySelector('.release_descriptors')
     document.querySelector('span.avg_rating')
     document.querySelector('span.issue_year')
   ============================================================ */
const SEL = {
  // The release title lives in a div; the first text node is the album name,
  // a child <span class="album_title_artist"> wraps the artist name after it.
  albumTitle:      '.album_title',
  // Artist name link, inside the album_title_artist span or standalone.
  artist:          '.album_title_artist a, a.artist, a.credited_name',
  // Cover art: the <img> inside the release art frame.
  coverImg:        '.page_release_art_frame img',
  // Genre spans contain <a class="genre"> links.
  primaryGenres:   '.release_pri_genres a.genre',
  secondaryGenres: '.release_sec_genres a.genre',
  // Descriptor tags are the fallback when no secondary genres exist.
  descriptors:     '.release_descriptors a.tag',
  // Year: the first issue year span (primary release); we pull a 4-digit year from its text.
  issueDate:       'span.issue_year',
  // Average rating.
  avgRating:       'span.avg_rating',
  // Number-of-ratings span; text looks like "from 444 ratings".
  numRatings:      'span.num_ratings',
};

/* ============================================================
   PALETTE — tweak colours here.
   ============================================================ */
const PALETTE = {
  bg:           '#121212',
  textPrimary:  '#f0f0f0',
  textSecondary:'#aaaaaa',
  pillGenreBg:  '#3c5078',
  pillGenreText:'#c8dcff',
  pillSubBg:    '#463c64',
  pillSubText:  '#d3c3ff',
  pillRadius:   10,
};

/* ============================================================
   MAIN — inject button once the page is ready.
   ============================================================ */
(function main() {
  'use strict';

  // Give RYM a tick to finish rendering dynamic content.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }
})();

function injectButton() {
  if (document.getElementById('rym-card-btn')) return; // already injected

  const btn = document.createElement('button');
  btn.id = 'rym-card-btn';
  btn.textContent = '📋 Copy album card';
  Object.assign(btn.style, {
    position:   'fixed',
    bottom:     '20px',
    right:      '20px',
    zIndex:     '999999',
    padding:    '10px 18px',
    background: '#3c5078',
    color:      '#fff',
    border:     'none',
    borderRadius:'8px',
    fontSize:   '15px',
    fontFamily: '-apple-system, Helvetica, Arial, sans-serif',
    cursor:     'pointer',
    boxShadow:  '0 2px 8px rgba(0,0,0,0.5)',
    transition: 'background 0.2s',
  });

  // ── SAFARI CLIPBOARD TIMING FIX ──────────────────────────────────────────
  // navigator.clipboard.write() MUST be called synchronously within the click
  // gesture. The ClipboardItem is constructed with an *unresolved* Promise so
  // the async canvas work happens inside the gesture window.
  // NEVER make this handler async and NEVER await before clipboard.write().
  btn.addEventListener('click', () => {
    setButtonState(btn, 'working');

    // Start composing asynchronously; pass the promise directly to ClipboardItem.
    const pngPromise = buildCardBlob();

    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      navigator.clipboard.write([
        new ClipboardItem({
          'image/png':  pngPromise,
          'text/plain': new Blob([window.location.href], { type: 'text/plain' }),
        }),
      ])
        .then(() => setButtonState(btn, 'done'))
        .catch(err => {
          console.error('[RYM Card] clipboard.write failed:', err);
          // Fall back: open the image in a new tab for manual save.
          pngPromise.then(blob => openBlobInNewTab(blob, btn)).catch(() => setButtonState(btn, 'error'));
        });
    } else {
      // Clipboard API unavailable (e.g. insecure context) — trigger download.
      pngPromise
        .then(blob => downloadBlob(blob))
        .then(() => setButtonState(btn, 'done'))
        .catch(err => {
          console.error('[RYM Card] fallback failed:', err);
          setButtonState(btn, 'error');
        });
    }
  });

  document.body.appendChild(btn);
}

function setButtonState(btn, state) {
  const labels = {
    idle:    '📋 Copy album card',
    working: '⏳ Building card…',
    done:    '✅ Copied!',
    error:   '❌ Error — check console',
  };
  btn.textContent = labels[state] || labels.idle;
  btn.disabled = (state === 'working');
  if (state === 'done' || state === 'error') {
    setTimeout(() => {
      btn.textContent = labels.idle;
      btn.disabled = false;
    }, 3000);
  }
}

/* ============================================================
   METADATA — read from the live DOM.
   Every accessor is defensive: returns '' or [] on miss.
   ============================================================ */
function readMetadata() {
  const titleEl = document.querySelector(SEL.albumTitle);
  let title = '';
  if (titleEl) {
    // The album title is the first text node; skip the artist child span.
    for (const node of titleEl.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        title = node.textContent.trim();
        break;
      }
    }
    if (!title) title = titleEl.textContent.trim(); // fallback
  }

  const artistEl = document.querySelector(SEL.artist);
  const artist = artistEl ? artistEl.textContent.trim() : '';

  const coverImgEl = document.querySelector(SEL.coverImg);
  let coverUrl = coverImgEl ? (coverImgEl.currentSrc || coverImgEl.src || '') : '';
  // Handle protocol-relative URLs.
  if (coverUrl.startsWith('//')) coverUrl = 'https:' + coverUrl;

  const primaryGenres = Array.from(document.querySelectorAll(SEL.primaryGenres))
    .map(a => a.textContent.trim()).filter(Boolean);

  let secondaryGenres = Array.from(document.querySelectorAll(SEL.secondaryGenres))
    .map(a => a.textContent.trim()).filter(Boolean);

  // Fall back to descriptor tags when no secondary genres are found.
  if (!secondaryGenres.length) {
    secondaryGenres = Array.from(document.querySelectorAll(SEL.descriptors))
      .map(a => a.textContent.trim()).filter(Boolean);
  }

  const dateEl = document.querySelector(SEL.issueDate);
  let year = '';
  if (dateEl) {
    const m = dateEl.textContent.match(/\b(19|20)\d{2}\b/);
    if (m) year = m[0];
  }

  const ratingEl = document.querySelector(SEL.avgRating);
  const rating = ratingEl ? ratingEl.textContent.trim() : '';

  const numRatingsEl = document.querySelector(SEL.numRatings);
  let ratingCount = '';
  if (numRatingsEl) {
    const m = numRatingsEl.textContent.match(/([\d,]+)/);
    if (m) ratingCount = m[1];
  }

  return { title, artist, coverUrl, primaryGenres, secondaryGenres, year, rating, ratingCount };
}

/* ============================================================
   CARD COMPOSER — draws on <canvas>, returns Promise<Blob>.
   ============================================================ */

/**
 * Returns Promise<Blob> (PNG).  Never hangs: cover fetch errors resolve to
 * a card without a cover image rather than rejecting.
 */
function buildCardBlob() {
  const meta = readMetadata();
  return loadCoverImage(meta.coverUrl)
    .then(coverImg => renderCard(meta, coverImg))
    .catch(err => {
      // Cover unavailable — render without it.
      console.warn('[RYM Card] cover unavailable, rendering without:', err);
      return renderCard(meta, null);
    });
}

/**
 * Load the cover into an HTMLImageElement with crossOrigin set, so it can be
 * drawn to the canvas without tainting it (toBlob would otherwise throw a
 * security error). RYM's cover CDN sends Access-Control-Allow-Origin: *, so
 * the CORS load succeeds and the canvas stays clean — no GM APIs required.
 *
 * A cache-buster is appended because the page already loaded this image
 * WITHOUT crossOrigin; reusing that cached entry would taint the canvas.
 *
 * Returns Promise<HTMLImageElement>. Rejects on load error or empty URL.
 */
function loadCoverImage(url) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error('no cover URL'));
      return;
    }
    const bust = url + (url.includes('?') ? '&' : '?') + 'rymcard=1';
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('cover load failed'));
    img.src = bust;
  });
}

/**
 * Draw the album card onto a <canvas> and resolve to a PNG Blob.
 * coverImg may be null (card renders without cover).
 */
function renderCard(meta, coverImg) {
  return new Promise((resolve, reject) => {
    try {
      const W        = 1200;
      const PAD      = 60;
      const FONT     = '-apple-system, Helvetica, Arial, sans-serif';

      // ── Off-screen sizing pass ──────────────────────────────────────────
      // We need to measure text to calculate total canvas height before drawing.
      const measureCanvas = document.createElement('canvas');
      measureCanvas.width  = W;
      measureCanvas.height = 1; // height doesn't matter for measurement
      const mc = measureCanvas.getContext('2d');

      const COVER_W      = W - 2 * PAD; // 1080px
      const COVER_H      = coverImg ? COVER_W : 0;

      const LINE_GAP     = 12;
      const SECTION_GAP  = 24;
      const PILL_PAD_X   = 12;
      const PILL_PAD_Y   = 6;
      const PILL_GAP     = 8;
      const PILL_R       = PALETTE.pillRadius;

      // Font sizes
      const SZ_ARTIST      = 44;
      const SZ_TITLE       = 54;
      const SZ_META        = 30;
      const SZ_LABEL       = 26;
      const SZ_PILL        = 28;
      const SZ_RATING      = 48;
      const SZ_RATINGCOUNT = 26;

      function setFont(ctx, size, weight) {
        ctx.font = `${weight || 'normal'} ${size}px ${FONT}`;
      }

      function textH(ctx, size, weight) {
        setFont(ctx, size, weight);
        const m = ctx.measureText('Ag');
        return Math.ceil((m.actualBoundingBoxAscent || size * 0.8) +
                         (m.actualBoundingBoxDescent || size * 0.2));
      }

      function pillRowHeight(ctx, tags, size) {
        if (!tags.length) return 0;
        setFont(ctx, size);
        const rowH = textH(ctx, size) + PILL_PAD_Y * 2;
        let x = PAD, rows = 1;
        for (const tag of tags) {
          const pw = Math.ceil(ctx.measureText(tag).width) + PILL_PAD_X * 2;
          if (x + pw > W - PAD && x > PAD) { rows++; x = PAD; }
          x += pw + PILL_GAP;
        }
        return rows * rowH + (rows - 1) * PILL_GAP;
      }

      // Measure each section
      const artistH = meta.artist ? textH(mc, SZ_ARTIST, 'normal') + LINE_GAP : 0;

      // Right-side rating block width — measured before the title so the title
      // can reserve a gutter and never overlap the right-aligned rating.
      const GUTTER_GAP = 24;
      let ratingBlockW = 0;
      if (meta.rating) {
        setFont(mc, SZ_RATING, '600');
        ratingBlockW = mc.measureText(`★ ${meta.rating}`).width;
        if (meta.ratingCount) {
          setFont(mc, SZ_RATINGCOUNT, 'normal');
          ratingBlockW = Math.max(ratingBlockW, mc.measureText(`${meta.ratingCount} ratings`).width);
        }
      }
      // Year suffix drawn inline after the last title line in a smaller, grey font.
      const SZ_YEAR     = 34;
      const YEAR_COLOR  = '#888888';
      const yearSuffix  = meta.year ? ` · ${meta.year}` : '';
      setFont(mc, SZ_YEAR, 'normal');
      const yearSuffixW = yearSuffix ? Math.ceil(mc.measureText(yearSuffix).width) + 4 : 0;

      const titleMaxW = (W - 2 * PAD) - (ratingBlockW ? Math.ceil(ratingBlockW) + GUTTER_GAP : 0) - yearSuffixW;

      // Title wraps — compute lines once here so the height measurement and
      // the draw pass use the same line count.  A single-line measure would
      // under-count H and clip genres off the bottom on long titles.
      let titleLines = [];
      let titleH = 0;
      if (meta.title) {
        setFont(mc, SZ_TITLE, '600');
        titleLines = wrapText(mc, meta.title, titleMaxW);
        const tlh = textH(mc, SZ_TITLE, '600');
        titleH = titleLines.length * (tlh + 4) + LINE_GAP;
      }

      const metaText  = '';
      const metaH     = metaText ? textH(mc, SZ_META) + LINE_GAP : 0;

      // Right-side rating block: rating line + optional count line, anchored to title baseline.
      // titleLineH is used as the first-line height so the rating baseline matches the title's.
      const titleLineH = textH(mc, SZ_TITLE, '600');
      let ratingBlockH = 0;
      if (meta.rating) {
        ratingBlockH = titleLineH;
        if (meta.ratingCount) {
          ratingBlockH += LINE_GAP + textH(mc, SZ_RATINGCOUNT);
        }
      }

      const genreLabelH  = meta.primaryGenres.length   ? textH(mc, SZ_LABEL) + LINE_GAP : 0;
      const genrePillH   = pillRowHeight(mc, meta.primaryGenres,   SZ_PILL);
      const subLabelH    = meta.secondaryGenres.length  ? textH(mc, SZ_LABEL) + LINE_GAP : 0;
      const subPillH     = pillRowHeight(mc, meta.secondaryGenres, SZ_PILL);

      const genreSection = meta.primaryGenres.length
        ? SECTION_GAP + genreLabelH + genrePillH
        : 0;
      const subSection   = meta.secondaryGenres.length
        ? SECTION_GAP + subLabelH + subPillH
        : 0;

      const H = PAD
        + COVER_H + (COVER_H ? PAD : 0)
        + artistH
        + Math.max(titleH, ratingBlockH)
        + metaH
        + genreSection
        + subSection
        + PAD;

      // ── Real canvas ─────────────────────────────────────────────────────
      const canvas = document.createElement('canvas');
      canvas.width  = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Background
      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, W, H);

      let y = PAD;

      // Cover art
      if (coverImg && COVER_H > 0) {
        // Draw cover scaled to square, preserving aspect ratio (fill, centre-crop).
        const src = coverImg;
        const sw  = src.naturalWidth;
        const sh  = src.naturalHeight;
        const scale = Math.max(COVER_W / sw, COVER_H / sh);
        const dw  = sw * scale;
        const dh  = sh * scale;
        const ox  = PAD + (COVER_W - dw) / 2;
        const oy  = y    + (COVER_H - dh) / 2;

        ctx.save();
        ctx.beginPath();
        roundRect(ctx, PAD, y, COVER_W, COVER_H, 12);
        ctx.clip();
        ctx.drawImage(src, ox, oy, dw, dh);
        ctx.restore();

        y += COVER_H + PAD;
      }

      // Artist
      if (meta.artist) {
        setFont(ctx, SZ_ARTIST, 'normal');
        ctx.fillStyle = PALETTE.textSecondary;
        ctx.fillText(meta.artist, PAD, y + textH(ctx, SZ_ARTIST));
        y += artistH;
      }

      // Title (may wrap — uses pre-computed titleLines from the measurement pass)
      const headerTop = y;
      if (titleLines.length) {
        setFont(ctx, SZ_TITLE, '600');
        ctx.fillStyle = PALETTE.textPrimary;
        const lineH = textH(ctx, SZ_TITLE, '600');
        for (let i = 0; i < titleLines.length; i++) {
          const baseline = y + lineH;
          ctx.fillText(titleLines[i], PAD, baseline);
          if (i === titleLines.length - 1 && yearSuffix) {
            const lineW = ctx.measureText(titleLines[i]).width;
            setFont(ctx, SZ_YEAR, 'normal');
            ctx.fillStyle = YEAR_COLOR;
            ctx.fillText(yearSuffix, PAD + lineW, baseline);
            setFont(ctx, SZ_TITLE, '600');
            ctx.fillStyle = PALETTE.textPrimary;
          }
          y += lineH + 4;
        }
        y += LINE_GAP;
      }

      // Right-side rating block — right-aligned, baseline matches title's first line.
      if (meta.rating) {
        const ratingBaseline = headerTop + titleLineH;
        ctx.textAlign = 'right';

        setFont(ctx, SZ_RATING, '600');
        ctx.fillStyle = PALETTE.textPrimary;
        ctx.fillText(`★ ${meta.rating}`, W - PAD, ratingBaseline);

        if (meta.ratingCount) {
          setFont(ctx, SZ_RATINGCOUNT, 'normal');
          ctx.fillStyle = PALETTE.textSecondary;
          ctx.fillText(`${meta.ratingCount} ratings`, W - PAD, ratingBaseline + LINE_GAP + textH(ctx, SZ_RATINGCOUNT));
        }

        ctx.textAlign = 'left';
      }

      // If the rating block is taller than the title block, advance y to cover the extra.
      if (ratingBlockH > titleH) {
        y += ratingBlockH - titleH;
      }

      // Year meta line
      if (metaText) {
        setFont(ctx, SZ_META, 'normal');
        ctx.fillStyle = PALETTE.textSecondary;
        ctx.fillText(metaText, PAD, y + textH(ctx, SZ_META));
        y += metaH;
      }

      // Primary genres
      if (meta.primaryGenres.length) {
        y += SECTION_GAP;
        setFont(ctx, SZ_LABEL, '600');
        ctx.fillStyle = PALETTE.textSecondary;
        ctx.fillText('GENRES', PAD, y + textH(ctx, SZ_LABEL, '600'));
        y += genreLabelH;
        y = drawPills(ctx, meta.primaryGenres, SZ_PILL, y,
          PALETTE.pillGenreBg, PALETTE.pillGenreText, W, PAD, PILL_PAD_X, PILL_PAD_Y, PILL_GAP, PILL_R);
      }

      // Secondary genres / subgenres
      if (meta.secondaryGenres.length) {
        y += SECTION_GAP;
        setFont(ctx, SZ_LABEL, '600');
        ctx.fillStyle = PALETTE.textSecondary;
        ctx.fillText('SUBGENRES', PAD, y + textH(ctx, SZ_LABEL, '600'));
        y += subLabelH;
        drawPills(ctx, meta.secondaryGenres, SZ_PILL, y,
          PALETTE.pillSubBg, PALETTE.pillSubText, W, PAD, PILL_PAD_X, PILL_PAD_Y, PILL_GAP, PILL_R);
      }

      // Export PNG blob
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('toBlob returned null'));
      }, 'image/png');

    } catch (err) {
      reject(err);
    }
  });
}

/* ============================================================
   CANVAS HELPERS
   ============================================================ */

/**
 * Draw rounded-rectangle pill labels, wrapping across rows.
 * Returns the new Y position after all pills.
 */
function drawPills(ctx, tags, fontSize, y, bgColor, textColor, W, PAD, padX, padY, gap, radius) {
  ctx.font = `normal ${fontSize}px ${'-apple-system, Helvetica, Arial, sans-serif'}`;
  const m = ctx.measureText('Ag');
  const textAscent = m.actualBoundingBoxAscent || fontSize * 0.8;
  const rowH = Math.ceil(textAscent + (m.actualBoundingBoxDescent || fontSize * 0.2)) + padY * 2;

  let x = PAD;
  let rowY = y;

  for (const tag of tags) {
    const tw = Math.ceil(ctx.measureText(tag).width);
    const pw = tw + padX * 2;

    if (x + pw > W - PAD && x > PAD) {
      rowY += rowH + gap;
      x = PAD;
    }

    // Pill background
    ctx.fillStyle = bgColor;
    drawRoundRect(ctx, x, rowY, pw, rowH, radius);
    ctx.fill();

    // Pill text
    ctx.fillStyle = textColor;
    ctx.fillText(tag, x + padX, rowY + padY + textAscent);

    x += pw + gap;
  }

  return rowY + rowH;
}

/**
 * Path helper: rounded rectangle.
 */
function drawRoundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

/**
 * Clip path helper: rounded rectangle (for cover art clip).
 */
function roundRect(ctx, x, y, w, h, r) {
  drawRoundRect(ctx, x, y, w, h, r);
}

/**
 * Simple greedy text wrap. Returns array of lines that fit within maxWidth.
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

/* ============================================================
   FALLBACK HELPERS
   ============================================================ */

function openBlobInNewTab(blob, btn) {
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank');
  if (!tab) {
    // Popup blocked — fall through to download.
    downloadBlob(blob);
    setButtonState(btn, 'done');
  } else {
    setButtonState(btn, 'done');
    // Revoke after the new tab has a chance to load.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function downloadBlob(blob) {
  return new Promise(resolve => {
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'album-card.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => { URL.revokeObjectURL(url); resolve(); }, 1000);
  });
}
