const { test } = require('node:test');
const assert = require('node:assert/strict');
const mp = require('../utils/mercadopago');
test('SDK actual conserva token por club y formato de respuesta', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ id: '123', init_point: 'https://checkout.test/123', status: 'approved' }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
  try {
    const [a, b] = await Promise.all([
      mp.preferences.create({ items: [{ id: 'a', title: 'Cancha', quantity: 1, unit_price: 1000, currency_id: 'ARS' }] }, { access_token: 'TEST-club-a' }),
      mp.payment.findById('123', { access_token: 'TEST-club-b' })
    ]);
    assert.equal(a.body.init_point, 'https://checkout.test/123');
    assert.equal(b.body.status, 'approved');
    const pref = calls.find(c => c.url.includes('/checkout/preferences'));
    const payment = calls.find(c => c.url.includes('/v1/payments/123'));
    assert.ok(pref); assert.ok(payment);
    assert.equal(pref.options.headers.Authorization, 'Bearer TEST-club-a');
    assert.equal(payment.options.headers.Authorization, 'Bearer TEST-club-b');
  } finally { global.fetch = originalFetch; }
});
