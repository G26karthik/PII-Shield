/**
 * popup.js
 * Controls settings page interactive logic, loading/saving variables to chrome.storage.local
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const masterSwitch = document.getElementById('master-switch');
  const domSwitch = document.getElementById('dom-masking-switch');
  const networkSwitch = document.getElementById('network-masking-switch');
  const maskSelect = document.getElementById('mask-type');
  const blockedCountEl = document.getElementById('blocked-count');
  const resetBtn = document.getElementById('reset-stats-btn');

  // Load saved state
  const state = await chrome.storage.local.get({
    enabled: true,
    domMasking: true,
    networkMasking: true,
    maskType: 'asterisks',
    blockedCount: 0
  });

  // Initialize UI values
  masterSwitch.checked = state.enabled;
  domSwitch.checked = state.domMasking;
  networkSwitch.checked = state.networkMasking;
  maskSelect.value = state.maskType;
  blockedCountEl.textContent = state.blockedCount;

  // If master switch is disabled, gray out sub-options
  updateOptionsState(state.enabled);

  // Event Listeners for controls
  masterSwitch.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    chrome.storage.local.set({ enabled });
    updateOptionsState(enabled);
  });

  domSwitch.addEventListener('change', (e) => {
    chrome.storage.local.set({ domMasking: e.target.checked });
  });

  networkSwitch.addEventListener('change', (e) => {
    chrome.storage.local.set({ networkMasking: e.target.checked });
  });

  maskSelect.addEventListener('change', (e) => {
    chrome.storage.local.set({ maskType: e.target.value });
  });

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

  // Helper to toggle sub-controls disabled visual state
  function updateOptionsState(enabled) {
    const options = [domSwitch, networkSwitch, maskSelect];
    options.forEach(opt => {
      opt.disabled = !enabled;
      // Fade wrapper styles
      const parentRow = opt.closest('.option-row') || opt.closest('.select-wrapper');
      if (parentRow) {
        if (enabled) {
          parentRow.style.opacity = '1';
          parentRow.style.pointerEvents = 'auto';
        } else {
          parentRow.style.opacity = '0.5';
          parentRow.style.pointerEvents = 'none';
        }
      }
    });
  }
});
