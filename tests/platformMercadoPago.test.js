const { test } = require('node:test');
const assert = require('node:assert/strict');
const platform = require('../services/platformMercadoPago');
test('platform secrets are encrypted with integrity and never included in status', () => {
  const old = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-platform-secret';
  try {
    const value = 'TEST-private-credential'; const encrypted = platform.encrypt(value);
    assert.equal(platform.decrypt(encrypted), value);
    assert.ok(!encrypted.includes(value));
    const parts = encrypted.split('.'); parts[3] = Buffer.from('tampered').toString('base64');
    assert.throws(() => platform.decrypt(parts.join('.')));
    const status = JSON.stringify(platform.status({ mpTokenEncrypted: encrypted, mpWebhookEncrypted: encrypted }));
    assert.ok(!status.includes(encrypted) && !status.includes(value));
  } finally { if (old === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = old; }
});
