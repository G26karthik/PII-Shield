/**
 * content.js
 * AI Prompt Phone Masker - Isolated World Content Script
 *
 * ============================================================================
 * SYSTEM DESIGN NOTE (01-system-design.mdc)
 * 1. Load: Low. Monitors user interactions (paste, typing input events).
 * 2. Volume: Small string inputs (few KB). Processes in-memory using regex.
 * 3. Concurrency: Individual script instance per tab/frame.
 * 4. Latency budget: Text replacements must complete within 2-3ms to ensure
 *    flicker-free visual response.
 * 5. Backpressure: Debounces the DOM scanning on input keypress (300ms) to
 *    prevent CPU spikes during fast typing.
 * 6. Failure blast radius: Isolated. If content script fails, it does not
 *    interfere with the host site's native JavaScript execution.
 * 7. Next bottleneck: Selecting cursor ranges in complex contenteditable divs.
 * 8. Render and delivery: Renders a lightweight, position-anchored warning badge
 *    directly inside the DOM.
 * ============================================================================
 */

(async () => {
  // Config state
  let config = {
    enabled: true,
    domMasking: true,
    networkMasking: true,
    maskType: 'asterisks'
  };

  // Regular expression patterns for phone numbers
  const PHONE_REGEXES = [
    /(?:\b\d{1,3}[-.\s]+|\+\d{1,3}[-.\s]*)(?:\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{5}[-.\s]?\d{5}\b)|\b(?:\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{5}[-.\s]?\d{5}\b)/g
  ];

  // Helper to get replacement string
  function getMaskReplacement(maskType) {
    switch (maskType) {
      case 'placeholder': return '[phone number]';
      case 'redacted': return '[REDACTED]';
      case 'asterisks':
      default:
        return '***';
    }
  }

  // Helper to synchronize configuration into DOM for inject.js (MAIN world)
  function updateDOMConfig() {
    document.documentElement.setAttribute('data-phone-masker-config', JSON.stringify({
      enabled: config.enabled,
      networkMasking: config.networkMasking,
      maskType: config.maskType
    }));
  }

  // Load and listen to settings from storage
  async function loadConfig() {
    const data = await chrome.storage.local.get({
      enabled: true,
      domMasking: true,
      networkMasking: true,
      maskType: 'asterisks'
    });
    config = data;
    updateDOMConfig();
    if (!config.enabled) {
      removeBadge();
    }
  }

  await loadConfig();

  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      config[key] = change.newValue;
    }
    updateDOMConfig();
    if (!config.enabled) {
      removeBadge();
    }
  });

  // Inject CSS for the warning badge
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .phone-masker-alert {
      position: absolute;
      background: linear-gradient(135deg, hsl(263, 90%, 63%) 0%, hsl(290, 85%, 60%) 100%);
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 20px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 99999;
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transform: translateY(5px);
      transition: opacity 0.2s ease, transform 0.2s ease;
      pointer-events: auto;
    }
    .phone-masker-alert.visible {
      opacity: 1;
      transform: translateY(0);
    }
    .phone-masker-btn {
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.4);
      color: white;
      border-radius: 12px;
      padding: 2px 8px;
      cursor: pointer;
      font-weight: 700;
      font-size: 10px;
      transition: background 0.15s ease;
    }
    .phone-masker-btn:hover {
      background: rgba(255, 255, 255, 0.35);
    }
  `;
  document.head.appendChild(styleEl);

  let activeAlert = null;
  let activeInputEl = null;

  // Check if text contains phone numbers
  function testPhoneNumbers(text) {
    return PHONE_REGEXES.some(regex => {
      regex.lastIndex = 0;
      return regex.test(text);
    });
  }

  // Count phone numbers in text
  function countPhoneNumbers(text) {
    let count = 0;
    PHONE_REGEXES.forEach(regex => {
      regex.lastIndex = 0;
      const matches = text.match(regex);
      if (matches) count += matches.length;
    });
    return count;
  }

  // Mask all phone numbers in text
  function maskText(text) {
    let modified = text;
    let totalCount = 0;
    PHONE_REGEXES.forEach(regex => {
      regex.lastIndex = 0;
      const matches = text.match(regex);
      if (matches) {
        totalCount += matches.length;
        modified = modified.replace(regex, getMaskReplacement(config.maskType));
      }
    });
    return { modified, totalCount };
  }

  // Position and show warning badge near the active input field
  function showBadge(inputEl) {
    if (!config.enabled || !config.domMasking) return;
    
    // Remove old alert if it exists
    removeBadge();

    activeInputEl = inputEl;

    const alertEl = document.createElement('div');
    alertEl.className = 'phone-masker-alert';
    alertEl.innerHTML = `
      <span>⚠️ Phone Number Detected</span>
      <button class="phone-masker-btn" id="phone-masker-action-btn">Redact</button>
    `;

    document.body.appendChild(alertEl);
    activeAlert = alertEl;

    // Position calculation
    const rect = inputEl.getBoundingClientRect();
    const alertRect = alertEl.getBoundingClientRect();
    
    // Position floating badge slightly above the bottom-right corner of the input field
    const top = window.scrollY + rect.bottom - 36;
    const left = window.scrollX + rect.right - alertEl.offsetWidth - 16;

    alertEl.style.top = `${top}px`;
    alertEl.style.left = `${left}px`;

    // Force layout reflow then show
    alertEl.offsetHeight; 
    alertEl.classList.add('visible');

    // Handle redact action click
    const actionBtn = alertEl.querySelector('#phone-masker-action-btn');
    actionBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      redactActiveInput();
    });
  }

  function removeBadge() {
    if (activeAlert) {
      activeAlert.classList.remove('visible');
      const alertToRemove = activeAlert;
      setTimeout(() => {
        if (alertToRemove && alertToRemove.parentNode) {
          alertToRemove.parentNode.removeChild(alertToRemove);
        }
      }, 200);
      activeAlert = null;
    }
    activeInputEl = null;
  }

  // Redacts the phone numbers inside the active input field safely
  function redactActiveInput() {
    if (!activeInputEl) return;

    let text = '';
    const isContentEditable = activeInputEl.tagName !== 'INPUT' && activeInputEl.tagName !== 'TEXTAREA';

    if (isContentEditable) {
      text = activeInputEl.innerText;
    } else {
      text = activeInputEl.value;
    }

    const { modified, totalCount } = maskText(text);

    if (totalCount > 0) {
      activeInputEl.focus();

      // Safely replace text using standard document commands to retain React bindings
      if (isContentEditable) {
        // Select all text inside contenteditable
        const range = document.createRange();
        range.selectNodeContents(activeInputEl);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Execute text replacement
        document.execCommand('insertText', false, modified);
      } else {
        // Select all text in standard input/textarea
        activeInputEl.select();
        document.execCommand('insertText', false, modified);
      }

      // Notify background service worker of masking event
      chrome.runtime.sendMessage({ type: 'phone_masked', count: totalCount });
    }

    removeBadge();
  }

  // Global listener for Paste events
  document.addEventListener('paste', (e) => {
    if (!config.enabled || !config.domMasking) return;

    const target = e.target;
    let inputEl = target;
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
      inputEl = target.closest('[contenteditable="true"]');
    }
    if (!inputEl) return;

    const pastedText = e.clipboardData.getData('text');
    if (testPhoneNumbers(pastedText)) {
      // Intercept the default paste and insert the masked text
      e.preventDefault();
      const { modified, totalCount } = maskText(pastedText);
      document.execCommand('insertText', false, modified);

      // Notify background
      chrome.runtime.sendMessage({ type: 'phone_masked', count: totalCount });
    }
  }, true);

  // Debounced input scanner to prevent main thread blocking while typing
  let scanTimeout = null;
  document.addEventListener('input', (e) => {
    if (!config.enabled || !config.domMasking) return;

    const target = e.target;
    let inputEl = target;
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
      inputEl = target.closest('[contenteditable="true"]');
    }
    if (!inputEl) return;

    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      const isContentEditable = inputEl.tagName !== 'INPUT' && inputEl.tagName !== 'TEXTAREA';
      const text = isContentEditable ? inputEl.innerText : inputEl.value;
      if (testPhoneNumbers(text)) {
        showBadge(inputEl);
      } else {
        removeBadge();
      }
    }, 400);
  }, true);

  // Remove warning badge on blur, unless clicking the badge itself
  document.addEventListener('mousedown', (e) => {
    if (activeAlert && !activeAlert.contains(e.target) && e.target !== activeInputEl) {
      removeBadge();
    }
  });

  // Listen for CustomEvents dispatched by inject.js (Network Proxy)
  document.addEventListener('phone-masker-stat', (e) => {
    const count = e.detail && e.detail.count;
    if (count && count > 0) {
      chrome.runtime.sendMessage({ type: 'phone_masked', count });
    }
  });

})();
