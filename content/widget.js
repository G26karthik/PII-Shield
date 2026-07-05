/**
 * widget.js
 * PII Shield — Floating AI Rule Builder Widget
 * Runs in the ISOLATED world of the content script.
 *
 * Runs inside the extension sandbox (immune to website CSP like gemini.google.com)
 * and can directly access chrome.storage.local and chrome.runtime.sendMessage.
 */

(async () => {
  // Avoid double-injection on SPA navigation
  if (document.getElementById('pii-shield-widget-host')) return;

  // ---- State ----
  let isPanelOpen = false;
  let currentPreview = null;
  let customRules = [];

  // ---- Storage & Rule Management ----
  async function getRules() {
    try {
      const data = await chrome.storage.local.get({ customRules: [] });
      customRules = data.customRules || [];
      if (typeof PIIDetectors !== 'undefined') {
        PIIDetectors.loadCustomDetectors(customRules);
      }
    } catch (e) {
      console.warn('[PII Shield] Failed to load rules:', e);
      customRules = [];
    }
    return customRules;
  }

  async function saveRule(rule) {
    try {
      const data = await chrome.storage.local.get({ customRules: [] });
      const rules = (data.customRules || []).filter(r => r.id !== rule.id);
      rules.push(rule);
      await chrome.storage.local.set({ customRules: rules });
      customRules = rules;
      if (typeof PIIDetectors !== 'undefined') {
        PIIDetectors.loadCustomDetectors(customRules);
      }
      renderRulesList();
    } catch (e) {
      console.warn('[PII Shield] Failed to save rule:', e);
      showError('Failed to save rule.');
    }
    return customRules;
  }

  async function deleteRule(ruleId) {
    try {
      const data = await chrome.storage.local.get({ customRules: [] });
      const rules = (data.customRules || []).filter(r => r.id !== ruleId);
      await chrome.storage.local.set({ customRules: rules });
      customRules = rules;
      if (typeof PIIDetectors !== 'undefined') {
        PIIDetectors.loadCustomDetectors(customRules);
      }
      renderRulesList();
    } catch (e) {
      console.warn('[PII Shield] Failed to delete rule:', e);
      showError('Failed to delete rule.');
    }
    return customRules;
  }

  async function generateRule(userPrompt) {
    const response = await chrome.runtime.sendMessage({ type: 'generate_rule', prompt: userPrompt });
    if (response.error) {
      throw new Error(response.error);
    }
    return response.rule;
  }

  // ---- DOM Construction ----
  function buildWidget() {
    const host = document.createElement('div');
    host.id = 'pii-shield-widget-host';
    document.body.appendChild(host);

    // Floating Action Button
    const fab = document.createElement('button');
    fab.className = 'pii-shield-fab';
    fab.id = 'pii-shield-fab';
    fab.setAttribute('aria-label', 'PII Shield — Add custom masking rule');
    fab.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>`;
    host.appendChild(fab);

    // Panel
    const panel = document.createElement('div');
    panel.className = 'pii-shield-panel';
    panel.id = 'pii-shield-panel';
    panel.innerHTML = `
      <div class="pii-shield-panel__header">
        <div class="pii-shield-panel__title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
               style="flex-shrink:0;margin-right:6px;color:hsl(263,90%,73%)">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          PII Shield — AI Rule Builder
        </div>
        <div class="pii-shield-panel__subtitle">
          Describe a pattern in plain English — AI will create the masking rule
        </div>
        <div class="pii-shield-ai-badge">
          <span class="pii-shield-ai-dot pii-shield-ai-dot--ready"></span>
          <span>Powered by Pollinations AI · Free · No API key needed</span>
        </div>
      </div>

      <div class="pii-shield-panel__input-area">
        <div class="pii-shield-input-wrapper">
          <input type="text" class="pii-shield-input" id="pii-shield-prompt-input"
                 placeholder="e.g. block strings with 3 numbers + 2 letters"
                 autocomplete="off" spellcheck="false" />
          <button class="pii-shield-submit-btn" id="pii-shield-submit-btn"
                  aria-label="Generate masking rule">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>

        <div class="pii-shield-error" id="pii-shield-error"></div>

        <div class="pii-shield-preview" id="pii-shield-preview">
          <div class="pii-shield-preview__label">Rule Name (Editable)</div>
          <input type="text" class="pii-shield-input" id="pii-shield-preview-label-input"
                 style="margin-bottom: 8px; font-weight: 600; width: 100%;" placeholder="Rule Name" />
          <div class="pii-shield-preview__label" style="margin-top: 8px;">Generated Regex Pattern</div>
          <div class="pii-shield-preview__regex" id="pii-shield-preview-regex"></div>
          <div class="pii-shield-preview__actions">
            <button class="pii-shield-preview__btn pii-shield-preview__btn--confirm"
                    id="pii-shield-confirm-btn">✓ Add Rule</button>
            <button class="pii-shield-preview__btn pii-shield-preview__btn--cancel"
                    id="pii-shield-cancel-btn">✕ Cancel</button>
          </div>
        </div>
      </div>

      <div class="pii-shield-panel__rules">
        <div class="pii-shield-rules-title">Active Custom Rules</div>
        <div id="pii-shield-rules-list">
          <div class="pii-shield-rules-empty" id="pii-shield-rules-empty">
            No custom rules yet
          </div>
        </div>
      </div>
    `;
    host.appendChild(panel);

    return { host, fab, panel };
  }

  // ---- UI Helpers ----
  function renderRulesList() {
    const listEl = document.getElementById('pii-shield-rules-list');
    const emptyEl = document.getElementById('pii-shield-rules-empty');
    if (!listEl) return;

    listEl.querySelectorAll('.pii-shield-rule-item').forEach(el => el.remove());

    if (customRules.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    customRules.forEach(rule => {
      const item = document.createElement('div');
      item.className = 'pii-shield-rule-item';
      item.innerHTML = `
        <div class="pii-shield-rule-item__info">
          <div class="pii-shield-rule-item__label">${esc(rule.label)}</div>
          <div class="pii-shield-rule-item__regex">/${esc(rule.regexSource)}/${esc(rule.regexFlags)}</div>
        </div>
        <button class="pii-shield-rule-item__delete" title="Delete rule">🗑</button>
      `;
      item.querySelector('.pii-shield-rule-item__delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        setItemDeleting(item, true);
        await deleteRule(rule.id);
      });
      listEl.appendChild(item);
    });
  }

  function setItemDeleting(el, state) {
    el.style.opacity = state ? '0.4' : '1';
    el.style.pointerEvents = state ? 'none' : '';
  }

  function showPreview(rule) {
    currentPreview = rule;
    const previewEl = document.getElementById('pii-shield-preview');
    const labelInput = document.getElementById('pii-shield-preview-label-input');
    if (labelInput) labelInput.value = rule.label;
    document.getElementById('pii-shield-preview-regex').textContent = `/${rule.regexSource}/${rule.regexFlags}`;
    previewEl.classList.add('pii-shield-preview--visible');
    if (labelInput) {
      setTimeout(() => labelInput.focus(), 150);
    }
  }

  function hidePreview() {
    currentPreview = null;
    const previewEl = document.getElementById('pii-shield-preview');
    if (previewEl) previewEl.classList.remove('pii-shield-preview--visible');
  }

  function showError(msg) {
    const el = document.getElementById('pii-shield-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('pii-shield-error--visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('pii-shield-error--visible'), 7000);
  }

  function setLoading(state) {
    const btn = document.getElementById('pii-shield-submit-btn');
    const input = document.getElementById('pii-shield-prompt-input');
    if (btn) {
      btn.disabled = state;
      btn.innerHTML = state
        ? '<div class="pii-shield-spinner"></div>'
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
             <line x1="22" y1="2" x2="11" y2="13"></line>
             <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
           </svg>`;
    }
    if (input) input.disabled = state;
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
  }

  // ---- Event Handlers ----
  async function handleSubmit() {
    const input = document.getElementById('pii-shield-prompt-input');
    const prompt = (input ? input.value : '').trim();
    if (!prompt) return;

    hidePreview();
    setLoading(true);
    try {
      const rule = await generateRule(prompt);
      showPreview(rule);
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!currentPreview) return;
    const labelInput = document.getElementById('pii-shield-preview-label-input');
    if (labelInput) {
      currentPreview.label = labelInput.value.trim() || currentPreview.label;
    }
    await saveRule(currentPreview);
    hidePreview();
    const input = document.getElementById('pii-shield-prompt-input');
    if (input) input.value = '';
  }

  function togglePanel(fab, panel) {
    isPanelOpen = !isPanelOpen;
    panel.classList.toggle('pii-shield-panel--open', isPanelOpen);
    fab.classList.toggle('pii-shield-fab--open', isPanelOpen);
    if (isPanelOpen) {
      setTimeout(() => document.getElementById('pii-shield-prompt-input')?.focus(), 250);
    }
  }

  // ---- Init ----
  customRules = await getRules();
  const { fab, panel } = buildWidget();
  renderRulesList();

  fab.addEventListener('click', e => { e.stopPropagation(); togglePanel(fab, panel); });

  document.addEventListener('click', e => {
    if (isPanelOpen && !panel.contains(e.target) && !fab.contains(e.target)) {
      togglePanel(fab, panel);
    }
  });

  document.getElementById('pii-shield-submit-btn').addEventListener('click', handleSubmit);
  document.getElementById('pii-shield-prompt-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  });
  document.getElementById('pii-shield-confirm-btn').addEventListener('click', handleConfirm);
  document.getElementById('pii-shield-cancel-btn').addEventListener('click', hidePreview);

})();
