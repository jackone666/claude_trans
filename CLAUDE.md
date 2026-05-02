# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Chrome extension (Manifest V3) for immersive webpage translation. Calls DeepSeek Flash API directly from the browser — no local CLI, no native host, no Python dependency.

### Architecture

- `extension/content.js` — Injected into every page at `document_idle`. Walks DOM with TreeWalker, extracts translatable text nodes, sends to background for translation, replaces text in-place preserving all element structure (links, buttons, code). Handles auto-detection of English pages, SPA navigation via history hooks + MutationObserver.
- `extension/background.js` — Service worker. Receives text blocks, splits into batches of 10, fires 10 parallel `fetch()` calls to DeepSeek Flash API (thinking disabled), merges and returns results. Reads API key from `chrome.storage.local`.
- `extension/popup.html` / `popup.js` — Popup UI with language selector, API key input, translate/restore buttons, progress display.

### Data flow

1. Page load → `detectIsEnglish()` checks `lang` attr + `body.innerText` sampling
2. `extractTextBlocks()` — TreeWalker collects visible text nodes, skipping CODE/PRE/KBD/SAMP/VAR/A/INPUT descendants
3. Blocks sent via `chrome.runtime.sendMessage` to background service worker
4. Background splits into 10-block batches, `Promise.all` fires parallel DeepSeek API calls
5. Each API call: `POST /anthropic/v1/messages` with `thinking: disabled`, returns JSON array
6. Translations merged, sorted by ID, sent back to content script
7. Content script sets each text node's `textContent` to translated value

### Config

API key stored in `chrome.storage.local` (set via popup). No file-based config needed. Model: `deepseek-v4-flash`, thinking disabled, 10 parallel workers.
