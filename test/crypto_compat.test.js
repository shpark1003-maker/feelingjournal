const assert = require('assert');
const { encrypt, decrypt } = require('../api/_routes/shared');

console.log('=== STARTING CRYPTO COMPATIBILITY PRE-TESTS ===');

try {
    const originalText = "이것은 극비 정보로 E2E 암호화되어야 하는 일기 본문입니다. Hello, E2E Encryption!";
    const testKey = "super_secure_user_master_password_123!";
    const wrongKey = "wrong_password_xyz!";

    // 1. Basic Encryption & Decryption Roundtrip
    console.log('[TEST 1] Testing encryption/decryption roundtrip...');
    const encrypted = encrypt(originalText, testKey);
    
    assert.ok(encrypted.startsWith('e2e:'), 'Encrypted output should start with prefix "e2e:"');
    console.log(`=> Encrypted format: ${encrypted.substring(0, 30)}...`);

    const decrypted = decrypt(encrypted, testKey);
    assert.strictEqual(decrypted, originalText, 'Decrypted text must match the original text');
    console.log('=> Roundtrip PASSED!');

    // 2. Decryption with Invalid Password Fallback
    console.log('\n[TEST 2] Testing decryption with invalid password...');
    const failedDecryption = decrypt(encrypted, wrongKey);
    assert.strictEqual(failedDecryption, '[Decryption Failed - Invalid Password]', 'Invalid password should return failure string');
    console.log('=> Invalid password check PASSED!');

    // 3. Decryption without Password Prompt
    console.log('\n[TEST 3] Testing decryption without password...');
    const promptDecryption = decrypt(encrypted, null);
    assert.strictEqual(promptDecryption, '[Encrypted Document - Please Enter Password]', 'Missing password should return prompt string');
    console.log('=> Missing password check PASSED!');

    // 4. Edge cases
    console.log('\n[TEST 4] Testing edge cases (empty inputs, unencrypted pass-through)...');
    assert.strictEqual(encrypt("", testKey), "", 'Empty text encryption should return empty');
    assert.strictEqual(decrypt("", testKey), "", 'Empty text decryption should return empty');
    assert.strictEqual(decrypt("plain text", testKey), "plain text", 'Plain text without prefix should be passed through');
    console.log('=> Edge cases PASSED!');

    console.log('\n=== ALL CRYPTO COMPATIBILITY PRE-TESTS COMPLETED SUCCESSFULLY! ===');
} catch (error) {
    console.error('❌ Crypto compatibility test failed:', error);
    process.exit(1);
}
