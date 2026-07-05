# PII-Shield — CLAUDE.md (Agent Context & Loop Instructions)

## Goal
Extend the existing **PII-Shield** Chrome extension (Manifest V3) to detect and redact four types of Personally Identifiable Information (PII) from AI chat prompts on ChatGPT, Claude, and Gemini — before the data ever leaves the browser.

The four PII types to support:
1. **Phone Numbers** (already implemented — keep and improve)
2. **PAN Numbers** (Indian Permanent Account Number)
3. **Aadhaar Numbers** (Indian 12-digit UID)
4. **Email Addresses**

---

## Repository Layout (Current State)
```
PII-Shield/
+-- CLAUDE.md                  <- this file (agent context)
+-- manifest.json              <- Manifest V3 config
+-- README.md
+-- test-regex.js              <- Node.js run-check script (NO frameworks)
+-- background/
¦   +-- background.js          <- Badge coordinator, storage init
+-- content/
¦   +-- content.js             <- Isolated world: DOM events, paste, badge UI
¦   +-- inject.js              <- Main world: fetch/XHR network proxy
+-- popup/
    +-- popup.html
    +-- popup.css
    +-- popup.js
```

---

## Agentic Loop Instructions

### LOOP ENTRY — READ THIS FIRST
Before writing a single line of code, execute this sequence every iteration:

1. Read `test-regex.js` — understand the current test suite and all passing cases.
2. Read `content/content.js` — understand the PII_DETECTORS structure and event handlers.
3. Read `content/inject.js` — understand the network proxy interceptor.
4. Read `popup/popup.html` and `popup/popup.js` — understand the settings UI.
5. Run `node test-regex.js` — confirm baseline still passes before any change.

Only after all five steps, begin planning your changes.

---

### LOOP BODY — IMPLEMENTATION PLAN (execute in order)

#### STEP 1 — Create `content/pii-patterns.js`
Create a new file: `content/pii-patterns.js`

This file exports a single `PII_DETECTORS` array. Each detector is an object:

  {
    id: 'pan',
    label: 'PAN Number',
    severity: 'block',        // 'redact' | 'block'
    regex: /PATTERN/g,
    replacement: '[PAN REDACTED]'   // only used if severity === 'redact'
  }

Severity rules:
- 'redact'  -> automatically replace the PII with the replacement string. Show a brief non-blocking toast.
- 'block'   -> do NOT send the message. Show a prominent blocking modal. User must confirm.

The four detectors:

  id       | label          | severity | regex
  ---------|----------------|----------|-------------------------------------------------
  phone    | Phone Number   | redact   | (existing verified pattern from test-regex.js)
  email    | Email Address  | redact   | /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
  pan      | PAN Number     | block    | /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g
  aadhaar  | Aadhaar Number | block    | /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/g

Agent Research Note: PAN format is 5 alpha + 4 numeric + 1 alpha (10 chars total) per Income Tax Dept spec.
Aadhaar is a 12-digit number where the first digit is 2-9, often displayed in groups of 4 with spaces.

---

#### STEP 2 — Refactor `content/content.js`
- Inline PII_DETECTORS at the top (comment: // SOURCE: pii-patterns.js — keep in sync).
- Replace PHONE_REGEXES with a loop over PII_DETECTORS:

    for (const detector of PII_DETECTORS) {
      detector.regex.lastIndex = 0;
      if (detector.regex.test(text)) {
        if (detector.severity === 'block') {
          showBlockModal(detector);
          return;
        } else {
          text = text.replace(detector.regex, detector.replacement);
          maskedCount++;
        }
      }
    }

- Implement showBlockModal(detector): full-screen overlay, title "Sensitive Data Detected",
  explains what was found, two buttons: "Edit Message" and "Send Anyway".
- Update showBadge() to show the detector label (e.g. "Email Detected").

---

#### STEP 3 — Refactor `content/inject.js`
- Inline the same PII_DETECTORS array (same sync comment).
- Loop over detectors in the fetch/XHR interceptor, only redact severity='redact' types.
- 'block' severity is handled in the DOM layer only.

---

#### STEP 4 — Update `popup/popup.html` and `popup/popup.js`
- Add a "PII Types" section: one toggle row per detector showing label + severity badge.
- Save per-detector state to chrome.storage.local: { phone: true, email: true, pan: true, aadhaar: true }
- content.js and inject.js skip any detector where enabled === false.

---

#### STEP 5 — Update `background/background.js`
- Expand stats: { phone: 0, email: 0, pan: 0, aadhaar: 0, blocked: 0 }
- Handle new message type 'pii_blocked' in addition to 'phone_masked'.
- Badge shows total of all blocked + redacted counts.

---

#### STEP 6 — Update `test-regex.js`
Add test cases for ALL four detectors. Each needs:
- At least 2 positive matches (real valid formats)
- At least 1 negative (something that must NOT match)

Run: node test-regex.js
ALL tests must pass before proceeding. If any fail: fix, then re-run. Never skip.

---

#### STEP 7 — Update `README.md`
- Document all 4 PII types with redact vs block behavior.
- Show the pii-patterns.js detector structure so developers can add new types.
- Add a "Running Tests" section.

---

### LOOP EXIT CRITERIA — Definition of Done
The loop is complete only when ALL of the following are true:

[ ] node test-regex.js exits with code 0 and prints all tests passed
[ ] All 4 PII types detected in paste handler
[ ] redact types (phone, email) auto-replaced inline
[ ] block types (PAN, Aadhaar) show blocking modal before send
[ ] Per-detector toggles work in popup
[ ] Network proxy (inject.js) redacts phone + email in outgoing API payloads
[ ] No .env, .mdc files committed
[ ] Final commit: "feat: extend PII detection to PAN, Aadhaar, email, phone" and git push

---

## Constraints

- No new npm dependencies. Vanilla JS only.
- No TypeScript. Plain .js files only.
- Self-healing loop: if a step errors, fix root cause and retry. Never skip failing tests.
- Fail safe: if PII detection throws, log it and pass through original text.
- Keep the existing purple/dark theme for all new UI.
- Never commit .mdc files or .env files.
- Run test-regex.js after every regex change, not just at the end.
