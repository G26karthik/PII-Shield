# AI Prompt Phone Masker (Privacy Proxy)

A Manifest V3 browser extension that helps mask sensitive personal data before it is transmitted to AI chat sites (ChatGPT, Claude, Gemini, etc.). It acts as a client-side proxy, giving you complete control over your privacy.

## Features

- **Multi-Type PII Detection**: Detects phone numbers, email addresses, Aadhaar numbers, credit card numbers (Luhn-validated), PAN card numbers, passport numbers, and bank account numbers/IFSC codes — each independently toggleable in the popup.
- **DOM-Level Masking**: Scans your text as you type or paste. Intercepts paste events to redact PII immediately, and highlights typed sensitive data with a non-intrusive hover badge letting you redact with one click.
- **Network Interception (Proxy Mode)**: Keeps the UI clean (you see what you type), but overrides `window.fetch` and `XMLHttpRequest` in the page's context to silently scrub PII from the request payloads before they leave your browser.
- **Premium Popup Interface**: Toggle the extension on/off, choose which PII types to detect, choose different redaction masks (`***`, `[<type>]`, or `[REDACTED <TYPE>]`), and track how many items have been successfully blocked.
- **Unified Detection Engine**: A single shared module (`content/pii-detectors.js`) powers detection in both the DOM and network layers, with overlap-aware matching so multiple PII types in the same message are all caught correctly.

---

## Directory Structure

```text
phone-masker-extension/
├── manifest.json            # Extension configuration (Manifest V3)
├── test-regex.js            # Node.js self-test validation script
├── background/
│   └── background.js        # Background service worker (badge manager)
├── popup/
│   ├── popup.html           # Settings menu HTML
│   ├── popup.css            # Premium glassmorphic styling
│   └── popup.js             # Storage state and UI bindings
└── content/
    ├── pii-detectors.js     # Shared PII detection/masking engine (single source of truth)
    ├── content.js           # Isolated-world DOM and event handler
    └── inject.js            # Main-world fetch/XHR network interceptor
```

---

## Installation Instructions

1. Open **Google Chrome** (or any Chromium-based browser like Edge or Brave).
2. Navigate to `chrome://extensions/`.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click the **Load unpacked** button in the top-left.
5. Select the `phone-masker-extension` directory from your computer.
6. Click the Extension Puzzle piece icon in your browser toolbar, pin the **AI Prompt Phone Masker**, and open the popup settings to configure.

---

## How It Works Under the Hood

### Detection Engine
`content/pii-detectors.js` is the single shared module that powers all detection and masking. It defines a detector per PII type (phone, email, Aadhaar, credit card, PAN, passport, bank account/IFSC), runs every enabled one over the text, validates candidates (e.g. a Luhn checksum for credit cards), resolves overlaps so multiple PII types in the same message are all caught, and formats the redaction text. It's loaded into both the isolated-world and MAIN-world content scripts (see `manifest.json`) so detection logic can never drift between the two, and is also `require()`-d directly by `test-regex.js`.

### DOM-Level Masking
The `content.js` script runs in Chrome's **Isolated World** (which has DOM access and Extension Storage access). It:
1. Listens to the `paste` event. If PII is detected in the pasted text, it stops the default paste event, redacts the text, and inserts it safely using `document.execCommand('insertText')` so React state tracking doesn't break.
2. Listens to the `input` event (debounced). If PII is typed, it displays a premium floating pill near the input area warning you. Clicking **Redact** modifies the input in-place.

### Network-Level Interception
The `inject.js` script is declared in `manifest.json` under `world: "MAIN"`. This allows it to execute directly in the website's execution context.
1. It overrides `window.fetch` and `XMLHttpRequest.prototype.send`.
2. It monitors outgoing HTTP payloads. If it detects PII in a JSON or Form string request, it redacts it.
3. It posts stats back to `content.js` using a `CustomEvent` which `content.js` forwards to the `background.js` service worker.

### Per-Type Toggles
Each PII type can be turned on/off independently from the popup (stored as `piiTypes.<id>` in `chrome.storage.local`, default all-on). Disabling a type stops it being detected in both DOM and network masking.

---

## Running the Verification Tests

To verify that the regex matching and masking logic functions properly across various formats without loading the extension in Chrome:

Ensure you have [Node.js](https://nodejs.org/) installed, and run:

```bash
node phone-masker-extension/test-regex.js
```

This will run assertions against phone numbers, email addresses, Aadhaar numbers, credit card numbers (including Luhn-invalid ones that must NOT be masked), PAN cards, passport numbers, and bank account/IFSC codes — as well as ensure that random numbers (like years, amounts, and short IDs) are not accidentally masked.
