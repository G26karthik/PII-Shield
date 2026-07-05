/**
 * inject.js
 * AI Prompt Phone Masker - Main World Script
 * Intercepts network payloads (window.fetch and XMLHttpRequest) before they leave the page.
 *
 * ============================================================================
 * SYSTEM DESIGN NOTE (01-system-design.mdc)
 * 1. Load: Intercepts outgoing requests (approx 1 per message sent by user).
 * 2. Volume: Operates on HTTP request bodies (usually a few KB of prompt text).
 * 3. Concurrency: Synchronous string search on request dispatch; thread-safe.
 * 4. Latency budget: Must complete in < 2ms to prevent visible API call delays.
 * 5. Backpressure: Only scans text payloads. Large media files (e.g. image bytes)
 *    are bypassed.
 * 6. Failure blast radius: Fail safe (transparent). If interceptor errors, we
 *    must fallback to original payload and complete the request unmasked rather
 *    than breaking the AI chat app.
 * 7. Next bottleneck: Parsing deeply nested JSON prompt representations.
 * 8. Render and delivery: Communicates stats using CustomEvent back to content.js.
 * ============================================================================
 */

(function() {
  function maskText(text, maskType, piiTypes, customRules) {
    if (customRules && typeof PIIDetectors !== 'undefined') {
      PIIDetectors.loadCustomDetectors(customRules);
    }
    return PIIDetectors.maskText(text, maskType, piiTypes);
  }

  // Load config from document element attribute (synchronized by content.js)
  function getConfig() {
    const configAttr = document.documentElement.getAttribute('data-phone-masker-config');
    if (configAttr) {
      try {
        return JSON.parse(configAttr);
      } catch (e) {
        // Fallback to default config on parse error
      }
    }
    return { enabled: true, networkMasking: true, maskType: 'redacted', piiTypes: PIIDetectors.DEFAULT_PII_TYPES, customRules: [] };
  }

  // 1. Intercept fetch API calls
  const originalFetch = window.fetch;
  window.fetch = async function(resource, options) {
    const config = getConfig();

    // If extension is disabled or network proxy is disabled, pass straight through
    if (!config.enabled || !config.networkMasking) {
      return originalFetch.apply(this, arguments);
    }

    if (options && options.body) {
      try {
        if (typeof options.body === 'string') {
          const { modified, totalCount } = maskText(options.body, config.maskType, config.piiTypes, config.customRules);
          if (totalCount > 0) {
            options.body = modified;
            
            // Dispatch custom event to content.js to register stats count
            document.dispatchEvent(new CustomEvent('phone-masker-stat', { 
              detail: { count: totalCount } 
            }));
          }
        }
      } catch (err) {
        console.warn('[Phone Masker] Fetch interception error, failing safe:', err);
      }
    }

    return originalFetch.apply(this, arguments);
  };

  // 2. Intercept XMLHttpRequest calls
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body) {
    const config = getConfig();

    if (!config.enabled || !config.networkMasking || !body) {
      return originalSend.apply(this, arguments);
    }

    try {
      if (typeof body === 'string') {
        const { modified, totalCount } = maskText(body, config.maskType, config.piiTypes, config.customRules);
        if (totalCount > 0) {
          // Replace argument with masked version
          body = modified;

          document.dispatchEvent(new CustomEvent('phone-masker-stat', { 
            detail: { count: totalCount } 
            }));
        }
      }
    } catch (err) {
      console.warn('[Phone Masker] XHR interception error, failing safe:', err);
    }

    return originalSend.apply(this, arguments);
  };
})();
