/**
 * DeliverIQ — Automated Test Suite
 * Validates all 5 Gates & Verification Services
 */

const assert = require('assert');
const { validateSyntax, isDisposable } = require('../src/services/syntaxValidator');
const { verifyEmail } = require('../src/services/verificationEngine');

async function runTestSuite() {
  console.log('======================================================');
  console.log('🧪 Running DeliverIQ Automated Test Suite');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    }
  }

  async function asyncTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    }
  }

  // --- UNIT TESTS: SYNTAX & BOUNDARIES (GATE 1) ---
  console.log('1. Syntax & RFC Boundary Tests (Gate 1):');

  test('Accepts standard valid email', () => {
    const res = validateSyntax('test.user@example.com');
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.domain, 'example.com');
  });

  test('Rejects consecutive dots in address', () => {
    const res = validateSyntax('test..user@example.com');
    assert.strictEqual(res.isValid, false);
    assert.match(res.errorReason, /RFC 5322/);
  });

  test('Rejects local-part exceeding 64 characters (RFC 5321 limit)', () => {
    const longLocal = 'a'.repeat(65) + '@example.com';
    const res = validateSyntax(longLocal);
    assert.strictEqual(res.isValid, false);
    assert.match(res.errorReason, /64-character limit/);
  });

  test('Flags role-based accounts (admin, support, info)', () => {
    const res = validateSyntax('admin@company.com');
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.isRoleAccount, true);
  });

  // --- UNIT TESTS: DISPOSABLE SCREENING (GATE 2) ---
  console.log('\n2. Disposable / Burner Screening Tests (Gate 2):');

  test('Detects known burner domains in blacklist', () => {
    assert.strictEqual(isDisposable('mailinator.com'), true);
    assert.strictEqual(isDisposable('tempmail.com'), true);
    assert.strictEqual(isDisposable('yopmail.com'), true);
  });

  test('Detects dynamic temporary domain prefixes', () => {
    assert.strictEqual(isDisposable('temp-inbox-123.com'), true);
    assert.strictEqual(isDisposable('burner-box.org'), true);
    assert.strictEqual(isDisposable('throwaway-mail.net'), true);
  });

  test('Allows legitimate domains', () => {
    assert.strictEqual(isDisposable('gmail.com'), false);
    assert.strictEqual(isDisposable('microsoft.com'), false);
    assert.strictEqual(isDisposable('github.com'), false);
  });

  // --- INTEGRATION TESTS: COMPLETE 5-GATE PIPELINE ---
  console.log('\n3. End-to-End Verification Pipeline Tests (Gates 1 - 5):');

  await asyncTest('Pipeline catches invalid syntax with score 0%', async () => {
    const res = await verifyEmail('broken..syntax@@domain');
    assert.strictEqual(res.status, 'Likely to bounce');
    assert.strictEqual(res.score, 0);
    assert.strictEqual(res.syntax, false);
  });

  await asyncTest('Pipeline catches disposable email with score 10%', async () => {
    const res = await verifyEmail('test@mailinator.com');
    assert.strictEqual(res.status, 'Likely to bounce');
    assert.strictEqual(res.score, 10);
    assert.strictEqual(res.disposable, true);
  });

  await asyncTest('Pipeline catches non-existent domain (Gate 3)', async () => {
    const res = await verifyEmail('user@domainthatwillneverexist9988776655.com');
    assert.strictEqual(res.status, 'Likely to bounce');
    assert.strictEqual(res.score, 5);
    assert.strictEqual(res.mxRecords.length, 0);
  });

  await asyncTest('Pipeline verifies mailbox existence on live mail server (Gate 4)', async () => {
    const res = await verifyEmail('totally_fake_nonexistent_person_9988776655@gmail.com');
    // Remote Google server rejects non-existent recipient with 550 or network restricts port 25
    assert.ok(res.status === 'Likely to bounce' || res.status === 'Unknown');
    assert.ok(res.transcript.length >= 5);
  });

  console.log('\n======================================================');
  console.log(`📊 Test Summary: ${passed}/${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log('======================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
