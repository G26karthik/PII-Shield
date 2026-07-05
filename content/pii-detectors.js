/**
 * pii-detectors.js
 * Shared PII detection & masking engine.
 *
 * Loaded as a plain <script> global (`PIIDetectors`) in both the isolated-world
 * content script and the MAIN-world inject script (see manifest.json), and via
 * require() from test-regex.js in Node. Single source of truth for regex
 * patterns and mask formatting so the three contexts can never drift apart.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PIIDetectors = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // Luhn checksum, used to keep credit-card detection from flagging arbitrary
  // 13-19 digit runs (order IDs, phone numbers, etc).
  function luhnCheck(digits) {
    let sum = 0;
    let alternate = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits[i], 10);
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alternate = !alternate;
    }
    return sum % 10 === 0;
  }

  const DEFAULT_PII_TYPES = {
    phone: true,
    email: true,
    aadhaar: true,
    creditCard: true,
    pan: true,
    passport: true,
    bankAccount: true
  };

  // Each detector: { id, regex (global), group?, label, validate?(rawMatchValue) }
  // `group` selects a capture group as the actual matched span (used when a
  // keyword-context prefix must be matched but not masked). `validate` can
  // reject a structurally-matching candidate (e.g. failed Luhn checksum).
  const DETECTORS = [
    {
      id: 'phone',
      label: 'phone number',
      regex: /(?:\b\d{1,3}[-.\s]+|\+\d{1,3}[-.\s]*)(?:\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{5}[-.\s]?\d{5}\b)|\b(?:\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{5}[-.\s]?\d{5}\b)/g
    },
    {
      id: 'email',
      label: 'email',
      regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    },
    {
      id: 'aadhaar',
      label: 'aadhaar number',
      // UIDAI Aadhaar numbers are 12 digits and never start with 0 or 1.
      regex: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g
    },
    {
      id: 'creditCard',
      label: 'credit card number',
      regex: /\b(?:\d[ -]?){13,19}\b/g,
      validate: (value) => luhnCheck(value.replace(/[ -]/g, ''))
    },
    {
      id: 'pan',
      label: 'PAN number',
      regex: /\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g
    },
    {
      id: 'passport',
      label: 'passport number',
      // Indian passport: 1 letter (excluding Q/X/Z) + 7 digits, first digit non-zero.
      regex: /\b[A-PR-WYa-pr-wy][1-9]\d{6}\b/g
    },
    {
      id: 'bankAccount',
      label: 'IFSC code',
      regex: /\b[A-Za-z]{4}0[A-Za-z0-9]{6}\b/g
    },
    {
      id: 'bankAccount',
      label: 'bank account number',
      // Bare 9-18 digit runs are indistinguishable from phone/Aadhaar/card
      // numbers, so only mask when preceded by an account-referencing keyword.
      regex: /\b(?:a\/?c|account)\.?\s*(?:no\.?|number)?\s*(?:is|:|-)?\s*(\d{9,18})\b/gi,
      group: 1
    }
  ];

  // Runs every enabled detector over `text`, validates candidates, resolves
  // overlaps (earliest start wins; among equal starts, the longer/more
  // specific match wins), and returns a non-overlapping match list sorted by
  // position: [{ start, end, type, label, value }]
  function detectAll(text, enabledTypes) {
    const candidates = [];

    DETECTORS.forEach((detector) => {
      if (enabledTypes && enabledTypes[detector.id] === false) return;

      const regex = new RegExp(detector.regex.source, detector.regex.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        const value = detector.group ? match[detector.group] : match[0];
        if (value === undefined) {
          if (match[0].length === 0) regex.lastIndex++;
          continue;
        }

        const start = detector.group ? match.index + match[0].lastIndexOf(value) : match.index;
        const end = start + value.length;

        if (!detector.validate || detector.validate(value)) {
          candidates.push({ start, end, type: detector.id, label: detector.label, value });
        }

        if (match[0].length === 0) regex.lastIndex++;
      }
    });

    candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

    const resolved = [];
    let lastEnd = -1;
    for (const candidate of candidates) {
      if (candidate.start >= lastEnd) {
        resolved.push(candidate);
        lastEnd = candidate.end;
      }
    }
    return resolved;
  }

  // `phone` keeps its legacy exact replacement strings so existing behavior
  // and tests are unaffected; other types get a labeled placeholder/redacted
  // string so users can see which kind of PII was caught.
  function getMaskReplacement(maskType, typeId, label) {
    if (maskType === 'asterisks' || !maskType) return '***';
    if (typeId === 'phone') {
      return maskType === 'placeholder' ? '[phone number]' : '[REDACTED]';
    }
    if (maskType === 'placeholder') return `[${label}]`;
    return `[REDACTED ${label.toUpperCase()}]`;
  }

  function maskText(text, maskType, enabledTypes) {
    const matches = detectAll(text, enabledTypes);
    if (!matches.length) return { modified: text, totalCount: 0, counts: {} };

    let modified = '';
    let cursor = 0;
    const counts = {};

    matches.forEach((m) => {
      modified += text.slice(cursor, m.start);
      modified += getMaskReplacement(maskType, m.type, m.label);
      counts[m.type] = (counts[m.type] || 0) + 1;
      cursor = m.end;
    });
    modified += text.slice(cursor);

    return { modified, totalCount: matches.length, counts };
  }

  return { DETECTORS, DEFAULT_PII_TYPES, luhnCheck, detectAll, getMaskReplacement, maskText };
});
