# PII Shield (Privacy Proxy)

PII Shield is a Manifest V3 browser extension that automatically detects and redacts personal information (phone numbers, emails, credit cards, Aadhaar, PAN, passports, bank accounts/IFSC) on **any website** before it leaves your browser. It also includes an AI-powered custom rule builder widget to add regex masking rules using natural language.

---

## Features

- **Simplified Popup Control**: A clean, premium glassmorphic settings panel containing only a master on/off toggle and live redaction statistics.
- **Universal Site Support**: Works dynamically on any website, including AI chat interfaces like ChatGPT, Gemini, and Claude.
- **AI-Powered Rule Builder**: A floating shield icon widget in the bottom-right of every web page lets you describe custom patterns to block (e.g. *"block strings with 3 numbers followed by two letters"*) in plain English.
- **Pollinations AI Integration**: Translates natural language prompts to precise JavaScript regular expressions instantly. Entirely free, requires no configuration, no sign-up, and no API key.
- **Rule Naming & Management**: Preview AI-generated regexes and name them customly before adding them to your active masking engine. Delete rules at any time.
- **DOM-Level Masking**: Scans your inputs as you type or paste. Intercepts paste events to redact PII immediately, and highlights typed sensitive data with a hover badge for one-click redaction.
- **Network Interception**: Overrides `window.fetch` and `XMLHttpRequest` in the page context to silently redact PII from outgoing HTTP request payloads before they leave your browser.

---

## Directory Structure

```text
PII-Shield/
├── manifest.json            # Extension configuration (Manifest V3)
├── test-regex.js            # Node.js self-test validation script
├── background/
│   └── background.js        # Background service worker (AI requester & badge manager)
├── popup/
│   ├── popup.html           # Settings menu HTML
│   ├── popup.css            # Premium glassmorphic styling
│   └── popup.js             # Storage state and UI bindings
└── content/
    ├── pii-detectors.js     # Shared PII detection/masking engine
    ├── content.js           # Isolated-world DOM scanner, paste handler, and rule loader
    ├── inject.js            # Main-world fetch/XHR network interceptor
    ├── widget.js            # Isolated-world floating AI rule builder panel
    └── widget.css           # Rule builder widget stylesheet
```

---

## Installation Instructions

1. Open **Google Chrome** (or any Chromium-based browser like Edge, Brave, or Opera).
2. Navigate to `chrome://extensions/`.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click the **Load unpacked** button in the top-left.
5. Select the `PII-Shield` workspace directory from your computer.
6. Open any webpage — you should see a floating purple shield icon in the bottom-right corner!
7. Click the Extension Puzzle piece icon in your browser toolbar, pin **PII Shield**, and open the popup settings to control active guarding.

---

## How It Works Under the Hood

### Custom Rule Builder Widget
`content/widget.js` runs in the isolated world and injects the rule builder interface. When a user requests a new rule, it sends a message to `background.js`, which calls a system-prompted model via `https://text.pollinations.ai/openai`. The response is cleaned, parsed, validated, and returned as a `{ regex, flags, label }` configuration. Custom rules are saved into `chrome.storage.local` where they persist across browser restarts.

### DOM-Level Masking
`content.js` monitors text entries inside input boxes, textareas, and contenteditable elements. When PII (built-in or custom) is detected in typed inputs, it renders a warning badge. Intercepting paste events, it redacts PII before it reaches the page DOM.

### Network Interception
`content.js` synchronizes all active configurations and custom rules into `data-phone-masker-config` on the document root. `inject.js` (running in the MAIN world to intercept `window.fetch` and `XMLHttpRequest`) reads this configuration synchronously and applies all regular expressions to outgoing request bodies.

---

## Running the Verification Tests

To verify that the regex matching and masking logic functions properly across various formats without loading the extension in Chrome:

Ensure you have [Node.js](https://nodejs.org/) installed, and run:

```bash
node test-regex.js
```

This will run **29 assertions**:
- US and international phone formats.
- Email addresses.
- Aadhaar card formats.
- Credit cards (Luhn-checked).
- PAN card, passport, and bank accounts (keyword-context matched).
- Overlaps and disabled/enabled type logic.
- Custom detector API registration, masking, deletion, and robust JSON regex extraction.
