/**
 * test-regex.js
 * Run-check script to validate the PII detection and masking logic in isolation.
 * Uses the shared content/pii-detectors.js module (also loaded into the
 * extension's content scripts), so this test exercises the exact same code.
 * Run with: node test-regex.js
 */

const assert = require('assert');
const PIIDetectors = require('./content/pii-detectors.js');

function maskText(text, maskType = 'asterisks', piiTypes = PIIDetectors.DEFAULT_PII_TYPES) {
  return PIIDetectors.maskText(text, maskType, piiTypes);
}

// Test Suite
console.log('Running PII Detector Tests...\n');

const testCases = [
  // --- Phone (legacy behavior, must be unchanged) ---
  {
    name: 'US Standard with Hyphens',
    input: 'My number is 555-555-5555, please call.',
    maskType: 'asterisks',
    expectedMasked: 'My number is ***, please call.',
    expectedCount: 1
  },
  {
    name: 'US International format with parentheses',
    input: 'Call me at +1 (555) 019-9283 today.',
    maskType: 'placeholder',
    expectedMasked: 'Call me at [phone number] today.',
    expectedCount: 1
  },
  {
    name: 'Raw 10-digit number',
    input: 'Text 9876543210 for details.',
    maskType: 'redacted',
    expectedMasked: 'Text [REDACTED] for details.',
    expectedCount: 1
  },
  {
    name: 'India mobile with space group',
    input: 'WhatsApp +91 98765 43210 right now.',
    maskType: 'asterisks',
    expectedMasked: 'WhatsApp *** right now.',
    expectedCount: 1
  },
  {
    name: 'No phone numbers, only years/amounts',
    input: 'In 2026, the company spent 100000 dollars on 15 machines.',
    maskType: 'asterisks',
    expectedMasked: 'In 2026, the company spent 100000 dollars on 15 machines.',
    expectedCount: 0
  },
  {
    name: 'Multiple numbers in one text',
    input: 'Numbers: 555-555-5555 and +91 98765 43210.',
    maskType: 'asterisks',
    expectedMasked: 'Numbers: *** and ***.',
    expectedCount: 2
  },
  {
    name: 'India mobile with no space to country code',
    input: 'Number is +919876543210.',
    maskType: 'asterisks',
    expectedMasked: 'Number is ***.',
    expectedCount: 1
  },
  {
    name: 'Long serial number (should not match)',
    input: 'Serial: 123456789012',
    maskType: 'asterisks',
    expectedMasked: 'Serial: 123456789012',
    expectedCount: 0
  },

  // --- Email ---
  {
    name: 'Email address',
    input: 'Reach me at jane.doe@example.com anytime.',
    maskType: 'placeholder',
    expectedMasked: 'Reach me at [email] anytime.',
    expectedCount: 1
  },
  {
    name: 'Email address, redacted style',
    input: 'jane.doe@example.com',
    maskType: 'redacted',
    expectedMasked: '[REDACTED EMAIL]',
    expectedCount: 1
  },

  // --- Aadhaar ---
  {
    name: 'Aadhaar with space groups',
    input: 'My Aadhaar is 2345 6789 0123.',
    maskType: 'placeholder',
    expectedMasked: 'My Aadhaar is [aadhaar number].',
    expectedCount: 1
  },
  {
    name: 'Aadhaar with no separators',
    input: 'Aadhaar: 234567890123',
    maskType: 'asterisks',
    expectedMasked: 'Aadhaar: ***',
    expectedCount: 1
  },
  {
    name: 'Aadhaar-shaped number starting with 0 (should not match as Aadhaar)',
    input: 'Code: 012345678901',
    maskType: 'asterisks',
    expectedMasked: 'Code: 012345678901',
    expectedCount: 0
  },

  // --- Credit card (Luhn-validated) ---
  {
    name: 'Valid Visa test number (Luhn-valid)',
    input: 'Card: 4111 1111 1111 1111',
    maskType: 'placeholder',
    expectedMasked: 'Card: [credit card number]',
    expectedCount: 1
  },
  {
    name: 'Luhn-invalid 16-digit number (should not match)',
    input: 'Number: 1234567890123456',
    maskType: 'asterisks',
    expectedMasked: 'Number: 1234567890123456',
    expectedCount: 0
  },

  // --- PAN ---
  {
    name: 'PAN card number',
    input: 'My PAN is ABCDE1234F.',
    maskType: 'redacted',
    expectedMasked: 'My PAN is [REDACTED PAN NUMBER].',
    expectedCount: 1
  },

  // --- Passport ---
  {
    name: 'Indian passport number',
    input: 'Passport no A1234567 was issued in Delhi.',
    maskType: 'placeholder',
    expectedMasked: 'Passport no [passport number] was issued in Delhi.',
    expectedCount: 1
  },

  // --- Bank account / IFSC ---
  {
    name: 'IFSC code',
    input: 'IFSC: HDFC0001234',
    maskType: 'placeholder',
    expectedMasked: 'IFSC: [IFSC code]',
    expectedCount: 1
  },
  {
    name: 'Bank account number with keyword context',
    input: 'My account number is 123456789012 for transfer.',
    maskType: 'placeholder',
    expectedMasked: 'My account number is [bank account number] for transfer.',
    expectedCount: 1
  },
  {
    name: 'Bare long digit string without context (should not match as bank account)',
    input: 'Reference: 123456789012345',
    maskType: 'asterisks',
    expectedMasked: 'Reference: 123456789012345',
    expectedCount: 0
  },

  // --- Overlap / mixed PII ---
  {
    name: 'Mixed PII types in one message',
    input: 'Email jane@example.com or call 555-555-5555.',
    maskType: 'placeholder',
    expectedMasked: 'Email [email] or call [phone number].',
    expectedCount: 2
  },

  // --- Per-type toggle filtering ---
  {
    name: 'Disabled type is not masked',
    input: 'Email jane@example.com or call 555-555-5555.',
    maskType: 'placeholder',
    piiTypes: { ...require('./content/pii-detectors.js').DEFAULT_PII_TYPES, email: false },
    expectedMasked: 'Email jane@example.com or call [phone number].',
    expectedCount: 1
  }
];

let failed = 0;

testCases.forEach((tc) => {
  try {
    const result = maskText(tc.input, tc.maskType, tc.piiTypes);
    assert.strictEqual(result.totalCount, tc.expectedCount, `Expected count ${tc.expectedCount}, got ${result.totalCount}`);
    assert.strictEqual(result.modified, tc.expectedMasked, `Expected "${tc.expectedMasked}", got "${result.modified}"`);
    console.log(`✅ Passed: ${tc.name}`);
  } catch (err) {
    console.error(`❌ Failed: ${tc.name}`);
    console.error(`   Error: ${err.message}`);
    failed++;
  }
});

console.log('\n----------------------------------------');
if (failed === 0) {
  console.log('🎉 All tests passed successfully!');
  process.exit(0);
} else {
  console.error(`💥 ${failed} tests failed!`);
  process.exit(1);
}
