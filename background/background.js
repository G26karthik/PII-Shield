/**
 * background.js
 * PII Shield — Background Service Worker
 *
 * ============================================================================
 * SYSTEM DESIGN NOTE (01-system-design.mdc)
 * 1. Load: Negligible. Listens to extension lifecycle and storage changes.
 * 2. Volume: Operates on a single counter value (stats). Fits in memory.
 * 3. Concurrency: chrome.storage.local operations are serialized by Chrome.
 * 4. Latency budget: Under 10ms for badge updates.
 * 5. Backpressure: Non-blocking async event handlers.
 * 6. Failure blast radius: If background crashes, badge updates fail but
 *    content script-level masking continues with cached configs.
 * 7. Next bottleneck: Extension startup overhead in Chrome cold-boot.
 * 8. Render and delivery: Badge text updated via chrome.action API.
 * ============================================================================
 */

// Default per-PII-type detection toggles (kept in sync with
// PIIDetectors.DEFAULT_PII_TYPES in content/pii-detectors.js; the service
// worker inlines this rather than importing the shared module).
const DEFAULT_PII_TYPES = {
  phone: true,
  email: true,
  aadhaar: true,
  creditCard: true,
  pan: true,
  passport: true,
  bankAccount: true
};

// Initialize storage defaults on extension installation
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get([
    'enabled', 'domMasking', 'networkMasking', 'maskType', 'blockedCount', 'piiTypes', 'customRules'
  ]);

  chrome.storage.local.set({
    enabled: existing.enabled !== undefined ? existing.enabled : true,
    domMasking: existing.domMasking !== undefined ? existing.domMasking : true,
    networkMasking: existing.networkMasking !== undefined ? existing.networkMasking : true,
    maskType: existing.maskType !== undefined ? existing.maskType : 'redacted',
    blockedCount: existing.blockedCount !== undefined ? existing.blockedCount : 0,
    piiTypes: { ...DEFAULT_PII_TYPES, ...(existing.piiTypes || {}) },
    customRules: existing.customRules || []
  });

  // Set default badge background color (matching purple theme accent)
  chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
});

// Update the badge when statistics change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.blockedCount) {
    const count = changes.blockedCount.newValue || 0;
    chrome.action.setBadgeText({
      text: count > 0 ? String(count) : ''
    });
  }
});

// Listener for runtime messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'pii_masked') {
    const increment = message.count || 1;
    
    // Atomically increment blocked count in storage
    chrome.storage.local.get({ blockedCount: 0 }, (data) => {
      const newCount = data.blockedCount + increment;
      chrome.storage.local.set({ blockedCount: newCount });
    });
  }

  // Custom rules management
  if (message.type === 'save_custom_rule') {
    chrome.storage.local.get({ customRules: [] }, (data) => {
      const rules = data.customRules;
      // Remove existing rule with same id if present
      const filtered = rules.filter(r => r.id !== message.rule.id);
      filtered.push(message.rule);
      chrome.storage.local.set({ customRules: filtered }, () => {
        sendResponse({ success: true, rules: filtered });
      });
    });
    return true; // Async response
  }

  if (message.type === 'delete_custom_rule') {
    chrome.storage.local.get({ customRules: [] }, (data) => {
      const filtered = data.customRules.filter(r => r.id !== message.ruleId);
      chrome.storage.local.set({ customRules: filtered }, () => {
        sendResponse({ success: true, rules: filtered });
      });
    });
    return true; // Async response
  }

  if (message.type === 'get_custom_rules') {
    chrome.storage.local.get({ customRules: [] }, (data) => {
      sendResponse({ rules: data.customRules });
    });
    return true; // Async response
  }

  if (message.type === 'generate_rule') {
    callPollinationsAI(message.prompt)
      .then(rule => sendResponse({ rule }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // Async response
  }

  // Return false for sync messages
  return false;
});

// ---- Pollinations.ai — Free AI, no API key required ----
// Uses OpenAI-compatible endpoint backed by open-source models.
const SYSTEM_PROMPT = `You are a regex generator for a browser privacy extension called PII Shield.
The user describes a text pattern to detect and mask. Respond with ONLY a JSON object, nothing else:
{"regex": "<JavaScript regex source string>", "flags": "gi", "label": "<2-4 word name>"}

IMPORTANT rules:
- regex must be valid JavaScript regex syntax
- Use word boundaries (\\b) to avoid partial matches where appropriate
- No catastrophic backtracking (avoid nested quantifiers like (a+)+)
- flags: usually "gi" (global + case-insensitive)
- label: short human-readable name (2-4 words, lowercase)

Examples:
User: "block strings with 3 numbers followed by 2 letters"
{"regex": "\\b\\d{3}[A-Za-z]{2}\\b", "flags": "gi", "label": "3-digit 2-letter code"}

User: "mask Indian vehicle registration numbers"
{"regex": "\\b[A-Z]{2}\\s?\\d{1,2}\\s?[A-Z]{1,3}\\s?\\d{4}\\b", "flags": "gi", "label": "vehicle registration"}

User: "hide IP addresses"
{"regex": "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b", "flags": "g", "label": "IP address"}`;

async function callPollinationsAI(userPrompt) {
  const ENDPOINT = 'https://text.pollinations.ai/openai';

  const body = {
    model: 'openai',          // Uses GPT-4o-mini via Pollinations
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: 200,
    seed: 42
  };

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`AI service error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty response from AI service.');

  // Robust JSON extraction — handles multiple response formats from AI:
  //  1. Raw JSON object
  //  2. Markdown code fences: ```json { ... } ```
  //  3. JSON embedded in prose text
  // NOTE: non-greedy /\{[\s\S]*?\}/ BREAKS on regex patterns containing `}`
  //       (e.g., \d{3}), so we use greedy last-brace extraction instead.
  let parsed;
  try {
    // Strategy 1: content IS the JSON directly
    parsed = JSON.parse(content);
  } catch (_) {
    try {
      // Strategy 2: strip markdown code fences then parse
      const stripped = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      parsed = JSON.parse(stripped);
    } catch (_) {
      // Strategy 3: greedy extraction — find first `{` and LAST `}` in the string
      const firstBrace = content.indexOf('{');
      const lastBrace  = content.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        console.error('[PII Shield] Raw AI response:', content);
        throw new Error('AI returned unexpected format. Please rephrase and try again.');
      }
      try {
        parsed = JSON.parse(content.slice(firstBrace, lastBrace + 1));
      } catch (e) {
        console.error('[PII Shield] Raw AI response:', content);
        throw new Error('Could not parse AI response. Please try a clearer description.');
      }
    }
  }

  if (!parsed.regex || !parsed.label) {
    throw new Error('AI response incomplete. Please try a more specific description.');
  }

  // Validate the regex compiles safely
  try {
    new RegExp(parsed.regex, parsed.flags || 'gi');
  } catch (e) {
    throw new Error(`AI generated an invalid pattern: ${e.message}`);
  }

  return {
    id: 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    label: parsed.label,
    regexSource: parsed.regex,
    regexFlags: parsed.flags || 'gi'
  };
}
