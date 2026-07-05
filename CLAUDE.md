# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome/Edge/Brave extension ("AI Prompt Phone Masker" / PII Shield) that redacts PII — phone numbers, email addresses, Aadhaar numbers, credit card numbers, PAN card numbers, passport numbers, and bank account/IFSC codes — before it reaches AI chat sites (ChatGPT, Claude.ai, Gemini). It has no build step, no bundler, and no package.json — it is loaded directly as unpacked source.

## Commands

- Run the regex/masking self-test: `node test-regex.js`
- Load the extension for manual testing: open `chrome://extensions/`, enable Developer mode, "Load unpacked", select the repo root.
- There is no lint, build, or package.json — don't invent npm scripts. `test-regex.js` is a standalone Node script with a hand-rolled assertion suite (no test framework); add new cases directly to the `testCases` array in that file.

## Architecture

The extension works via two cooperating content-script contexts injected on `*://*.chatgpt.com/*`, `*://*.claude.ai/*`, and `*://*.gemini.google.com/*` (declared in `manifest.json`):

- **`content/content.js`** — runs in the Isolated World (has DOM + `chrome.storage` access). Handles DOM-level masking: intercepts `paste` events (redacts before insert), debounces `input` events (300-400ms) to show a floating "Redact" badge near the active field, and safely rewrites text via `document.execCommand('insertText', ...)` so framework-controlled inputs (React, etc.) don't desync.
- **`content/inject.js`** — runs in the MAIN world (`world: "MAIN"`, `run_at: "document_start"` in manifest.json), so it executes in the page's own JS context. It monkey-patches `window.fetch` and `XMLHttpRequest.prototype.send` to scrub phone numbers from outgoing string request bodies before they leave the browser — this is the "network proxy" mode and is independent of what the DOM shows the user.
- **Config bridging between worlds**: `content.js` cannot directly share JS state with `inject.js` (different worlds), so it serializes settings into a DOM attribute — `document.documentElement.setAttribute('data-phone-masker-config', JSON.stringify(...))` — which `inject.js` reads on each intercepted call via `getConfig()`. Any new setting that `inject.js` needs must be added to this attribute payload in `content.js`'s `updateDOMConfig()`.
- **Stats flow back the other way**: `inject.js` can't call `chrome.runtime` APIs directly (MAIN world), so it dispatches a `CustomEvent('phone-masker-stat', { detail: { count } })` on `document`, which `content.js` listens for and forwards via `chrome.runtime.sendMessage({ type: 'pii_masked', count })` to the background worker.
- **`background/background.js`** — service worker. Owns `chrome.storage.local` defaults (`enabled`, `domMasking`, `networkMasking`, `maskType`, `blockedCount`, `piiTypes`), increments `blockedCount` on `pii_masked` messages, and mirrors it onto the toolbar badge via `chrome.storage.onChanged`.
- **`popup/popup.js` + `popup.html` + `popup.css`** — settings UI. Reads/writes the same `chrome.storage.local` keys directly; all three scripts (`content.js`, `background.js`, `popup.js`) stay in sync purely through `chrome.storage.onChanged` listeners, there is no message-passing config protocol.
- **`content/pii-detectors.js`** is the single source of truth for detection/masking logic: a UMD-style plain script exporting `DETECTORS`, `DEFAULT_PII_TYPES`, `luhnCheck`, `detectAll`, `getMaskReplacement`, and `maskText`. It's listed first in the `js` array of *both* `content_scripts` entries in `manifest.json` (isolated world for `content.js`, MAIN world for `inject.js`) so each world gets its own instance of the exact same code, and `test-regex.js` `require()`s it directly in Node — so there is only one place to change detection behavior. `background.js` is the one exception: it inlines a copy of just the `DEFAULT_PII_TYPES` object (not the detection logic) since a service worker can't easily consume the browser-global UMD export; keep it in sync if you add/remove a PII type.
- **PII types** (each independently toggleable via `piiTypes.<id>` in storage, all default `true`): `phone` (legacy regex, unchanged behavior/labels), `email`, `aadhaar` (12-digit, UIDAI numbers never start with 0/1), `creditCard` (13-19 digit grouped candidates, kept only if they pass `luhnCheck`), `pan`, `passport` (Indian format: 1 letter + 7 digits), `bankAccount` (two detectors sharing this id — a standalone IFSC pattern, and a context-gated account-number pattern that only fires after a keyword like "account"/"a/c" since bare digit runs are otherwise indistinguishable from phone/Aadhaar/card numbers).
- **Overlap resolution**: `detectAll` runs every enabled detector over the full text, then sorts all candidate matches by `(start asc, length desc)` and greedily keeps non-overlapping ones — so at a given position the longer/more specific match wins, and independent PII in the same string (e.g. an email and a phone number) are both kept. `maskText` does one left-to-right rebuild pass over those resolved matches.
- Mask replacement has three modes keyed by `maskType`: `asterisks` (`***` for every type, default), `placeholder` (`"[<type label>]"`, e.g. `[email]`), `redacted` (`"[REDACTED <TYPE LABEL>]"`, e.g. `[REDACTED AADHAAR NUMBER]`) — except `phone`, which keeps its original exact strings (`[phone number]` / `[REDACTED]`) for backward compatibility.

## Design constraints worth preserving

- Network interception must fail safe: if masking throws inside the patched `fetch`/`XHR.send`, the original unmasked request must still go through rather than breaking the host page (see the try/catch wrapping in `inject.js`).
- DOM text replacement must go through `document.execCommand('insertText', ...)`, not direct `.value`/`.innerText` assignment, to avoid breaking React-controlled inputs on these chat sites.
