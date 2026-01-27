import * as assert from 'assert';
import { isAuthorizedUser } from '../../slack/auth';

suite('Auth Test Suite', () => {
    test('Matching user IDs should return true', () => {
        const result = isAuthorizedUser('U12345ABC', 'U12345ABC');
        assert.strictEqual(result, true);
    });

    test('Non-matching user IDs should return false', () => {
        const result = isAuthorizedUser('U12345ABC', 'U99999XYZ');
        assert.strictEqual(result, false);
    });

    test('Empty userId should return false', () => {
        const result = isAuthorizedUser('', 'U12345ABC');
        assert.strictEqual(result, false);
    });

    test('Empty allowedUserId should return false', () => {
        const result = isAuthorizedUser('U12345ABC', '');
        assert.strictEqual(result, false);
    });

    test('Both empty should return false', () => {
        const result = isAuthorizedUser('', '');
        assert.strictEqual(result, false);
    });

    test('Should handle leading/trailing whitespace', () => {
        const result = isAuthorizedUser('  U12345ABC  ', 'U12345ABC');
        assert.strictEqual(result, true);
    });

    test('User IDs should be case-sensitive', () => {
        const result = isAuthorizedUser('u12345abc', 'U12345ABC');
        assert.strictEqual(result, false);
    });

    test('Undefined userId should return false', () => {
        // @ts-expect-error - Testing runtime behavior with undefined
        const result = isAuthorizedUser(undefined, 'U12345ABC');
        assert.strictEqual(result, false);
    });

    test('Null userId should return false', () => {
        // @ts-expect-error - Testing runtime behavior with null
        const result = isAuthorizedUser(null, 'U12345ABC');
        assert.strictEqual(result, false);
    });
});
