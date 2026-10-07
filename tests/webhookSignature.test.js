const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const express = require('express');
const signature = require('../middlewares/mercadoPagoSignature');

test('webhooks authenticate the fetched ID and reject tampering before processing', async () => {
  const old = { ...process.env };
  process.env.MP_WEBHOOK_SECRET = 'test-shared-secret';
  process.env.MP_FEATURED_WEBHOOK_SECRET = 'test-featured-secret';
  delete process.env.MP_CLUB_WEBHOOK_SECRETS;
  let processed = 0;
  const app = express();
  app.use(express.json());
  for (const [route, featured] of [['/booking', false], ['/featured', true]])
    app.post(route, signature(featured), (req, res) => { processed++; res.json({ id: req.mercadoPagoPaymentId }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = (secret, id = 'ABC123', request = 'request-1', ts = '1704908010') => ({
    'Content-Type': 'application/json', 'x-request-id': request,
    'x-signature': `ts=${ts},v1=${createHmac('sha256', secret).update(`id:${id.toLowerCase()};request-id:${request};ts:${ts};`).digest('hex')}`
  });
  const send = (route, h, body = { data: { id: 'ABC123' } }) => fetch(base + route, { method: 'POST', headers: h, body: JSON.stringify(body) });
  try {
    for (const [route, secret] of [['/booking', 'test-shared-secret'], ['/featured', 'test-featured-secret']]) {
      const valid = headers(secret);
      assert.equal((await send(route + '?data.id=ABC123', valid)).status, 200);
      assert.equal((await send(route + '?data.id=ABC123', {})).status, 401);
      assert.equal((await send(route + '?data.id=CHANGED', valid)).status, 401);
      assert.equal((await send(route + '?data.id=ABC123', { ...valid, 'x-request-id': 'changed' })).status, 401);
      assert.equal((await send(route + '?data.id=ABC123', { ...valid, 'x-signature': 'ts=1,v1=bad' })).status, 401);
      assert.equal((await send(route + '?data.id=ABC123', { ...valid, 'x-signature': valid['x-signature'] + ',ts=2' })).status, 401);
      assert.equal((await send(route + '?data.id=ABC123', valid, { data: { id: 'other' } })).status, 400);
      assert.equal((await send(route + '?data.id=ABC123&id=other', valid)).status, 400);
      assert.equal((await send(route + '?data.id=ABC123&data.id=ABC123', valid)).status, 401);
      assert.equal((await send(route, valid)).status, 401);
    }
    assert.equal(processed, 2);
    process.env.MP_CLUB_WEBHOOK_SECRETS = JSON.stringify({ 'club@example.test': 'club-secret' });
    assert.equal((await send('/booking?data.id=ABC123&club=club@example.test', headers('club-secret'))).status, 200);
    assert.equal((await send('/booking?data.id=ABC123&club=club@example.test', headers('test-shared-secret'))).status, 401);
    process.env.MP_CLUB_WEBHOOK_SECRETS = '{invalid';
    assert.equal((await send('/booking?data.id=ABC123', headers('test-shared-secret'))).status, 503);
    delete process.env.MP_CLUB_WEBHOOK_SECRETS;
    delete process.env.MP_WEBHOOK_SECRET;
    assert.equal((await send('/booking?data.id=ABC123', headers('test-shared-secret'))).status, 503);
    assert.equal(processed, 3);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const key of ['MP_WEBHOOK_SECRET', 'MP_FEATURED_WEBHOOK_SECRET', 'MP_CLUB_WEBHOOK_SECRETS'])
      if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
  }
});
