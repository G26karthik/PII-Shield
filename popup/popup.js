/**
 * popup.js
 * PII Shield — Popup settings controller.
 * Manages the master on/off switch and privacy statistics display.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const masterSwitch = document.getElementById('master-switch');
  const blockedCountEl = document.getElementById('blocked-count');
  const resetBtn = document.getElementById('reset-stats-btn');

  // Load saved state
  const state = await chrome.storage.local.get({
    enabled: true,
    blockedCount: 0
  });

  // Initialize UI
  masterSwitch.checked = state.enabled;
  blockedCountEl.textContent = state.blockedCount;

  // Master switch toggle
  masterSwitch.addEventListener('change', (e) => {
    chrome.storage.local.set({ enabled: e.target.checked });
  });

  // Reset statistics
  resetBtn.addEventListener('click', () => {
    chrome.storage.local.set({ blockedCount: 0 });
    blockedCountEl.textContent = '0';
  });

  // Watch for background stats updates while popup is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.blockedCount) {
      blockedCountEl.textContent = changes.blockedCount.newValue;
    }
  });
});
