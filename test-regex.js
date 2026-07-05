/**
 * test-regex.js
 * Run-check script to validate the phone number detection and masking logic in isolation.
 * Conforms to ponytail-enterprise-scale.mdc requirements for one runnable check.
 * Run with: node test-regex.js
 */

const assert = require('assert');

const PHONE_REGEXES = [
  /(?:\b\d{1,3}[-.\s]+|\+\d{1,3}[-.\s]*)(?:\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{5}[-.\s]?\d{5}\b)|\b(?:\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\d{5}[-.\s]?\d{5}\b)/g
];

function getMaskReplacement(maskType) {
  switch (maskType) {
    case 'placeholder': return '[phone number]';
    case 'redacted': return '[REDACTED]';
    case 'asterisks':
    default:
      return '***';
  }
}

function maskText(text, maskType = 'asterisks') {
  let modified = text;
  let totalCount = 0;
  
  PHONE_REGEXES.forEach(regex => {
    regex.lastIndex = 0;
    const matches = text.match(regex);
    if (matches) {
      totalCount += matches.length;
      modified = modified.replace(regex, getMaskReplacement(maskType));
    }
  });
  
  return { modified, totalCount };
}

// Test Suite
console.log('Running Phone Masker Regex Tests...\n');

const testCases = [
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
  }
];

let failed = 0;

testCases.forEach((tc) => {
  try {
    const result = maskText(tc.input, tc.maskType);
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
