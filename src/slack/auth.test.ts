/**
 * Unit tests for auth.ts
 * Uses Node's built-in assert module
 * Run with: npx ts-node src/slack/auth.test.ts
 */

import * as assert from 'assert';
import { isAuthorizedUser } from './auth';

console.log('Running auth.ts tests...\n');

// Test 1: Matching user IDs should return true
(() => {
    const result = isAuthorizedUser('U12345ABC', 'U12345ABC');
    assert.strictEqual(result, true, 'Matching user IDs should return true');
    console.log('PASS: Matching user IDs returns true');
})();

// Test 2: Non-matching user IDs should return false
(() => {
    const result = isAuthorizedUser('U12345ABC', 'U99999XYZ');
    assert.strictEqual(result, false, 'Non-matching user IDs should return false');
    console.log('PASS: Non-matching user IDs returns false');
})();

// Test 3: Empty userId should return false
(() => {
    const result = isAuthorizedUser('', 'U12345ABC');
    assert.strictEqual(result, false, 'Empty userId should return false');
    console.log('PASS: Empty userId returns false');
})();

// Test 4: Empty allowedUserId should return false
(() => {
    const result = isAuthorizedUser('U12345ABC', '');
    assert.strictEqual(result, false, 'Empty allowedUserId should return false');
    console.log('PASS: Empty allowedUserId returns false');
})();

// Test 5: Both empty should return false
(() => {
    const result = isAuthorizedUser('', '');
    assert.strictEqual(result, false, 'Both empty should return false');
    console.log('PASS: Both empty returns false');
})();

// Test 6: Whitespace handling - should trim before comparison
(() => {
    const result = isAuthorizedUser('  U12345ABC  ', 'U12345ABC');
    assert.strictEqual(result, true, 'Should handle leading/trailing whitespace');
    console.log('PASS: Handles whitespace correctly');
})();

// Test 7: Case sensitivity - Slack user IDs are case-sensitive
(() => {
    const result = isAuthorizedUser('u12345abc', 'U12345ABC');
    assert.strictEqual(result, false, 'User IDs should be case-sensitive');
    console.log('PASS: User IDs are case-sensitive');
})();

// Test 8: Null-ish handling - undefined coerced to empty string behavior
(() => {
    // @ts-expect-error - Testing runtime behavior with undefined
    const result = isAuthorizedUser(undefined, 'U12345ABC');
    assert.strictEqual(result, false, 'Undefined userId should return false');
    console.log('PASS: Undefined userId returns false');
})();

// Test 9: Null-ish handling - null
(() => {
    // @ts-expect-error - Testing runtime behavior with null
    const result = isAuthorizedUser(null, 'U12345ABC');
    assert.strictEqual(result, false, 'Null userId should return false');
    console.log('PASS: Null userId returns false');
})();

console.log('\n All auth.ts tests passed!');
