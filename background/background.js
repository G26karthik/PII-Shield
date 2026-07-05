/**
 * background.js
 * AI Prompt Phone Masker - Background Service Worker
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

// Initialize storage defaults on extension installation
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get([
    'enabled', 'domMasking', 'networkMasking', 'maskType', 'blockedCount'
  ]);
  
  chrome.storage.local.set({
    enabled: existing.enabled !== undefined ? existing.enabled : true,
    domMasking: existing.domMasking !== undefined ? existing.domMasking : true,
    networkMasking: existing.networkMasking !== undefined ? existing.networkMasking : true,
    maskType: existing.maskType !== undefined ? existing.maskType : 'asterisks',
    blockedCount: existing.blockedCount !== undefined ? existing.blockedCount : 0
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
  if (message.type === 'phone_masked') {
    const increment = message.count || 1;
    
    // Atomically increment blocked count in storage
    chrome.storage.local.get({ blockedCount: 0 }, (data) => {
      const newCount = data.blockedCount + increment;
      chrome.storage.local.set({ blockedCount: newCount });
    });
  }
  // Return true if async response is needed
  return false;
});
