# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Chrome extension for immersive webpage translation, powered by the local `claude` CLI (DeepSeek v4 backend).

### Architecture

- **`extension/`** — Chrome extension (Manifest V3)
  - `content.js` — Injected into every page. Extracts text blocks from the DOM, sends them for translation via the background service worker, then applies translations in-place. Handles restore to original text.
  - `background.js` — Service worker. Bridges content script to the native messaging host. Connects to `com.immersive.translate` native host and forwards translation requests.
  - `popup.html` / `popup.js` — Extension popup UI. Language selector, translate/restore buttons, progress display.
- **`native-host/`** — Native messaging host (Python)
  - `translate.py` — Reads Chrome native-messaging protocol messages from stdin, calls `claude -p --output-format json` with a structured translation prompt, writes responses to stdout. Logs errors to `~/.claude/immersive-translate.log`.
  - `install.sh` — Registers the native host with Chrome on macOS. Usage: `./install.sh <extension-id>`

### Data flow

1. User clicks "翻译页面" in popup → message sent to content script
2. Content script walks DOM via TreeWalker, groups text nodes by block element, assigns IDs
3. Text blocks sent in batches (40 per batch) to background service worker
4. Background connects to `com.immersive.translate` native host via Chrome native messaging
5. Native host (Python) calls `claude -p` with: system prompt + JSON text blocks → receives JSON array of `{id, text}` translations
6. Translations flow back and are applied to DOM elements in-place

### Config

Claude Code uses DeepSeek API backend. Credentials and model config in `~/.claude/settings.json`. The native host reads these env vars before spawning `claude -p`.
