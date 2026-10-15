const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'test-secret-for-notification-encryption';
const { normalizePhone } = require('../utils/phone');
const service = require('../services/reservationNotifications');
test('normaliza celulares argentinos sin duplicar prefijos y rechaza números incompletos', () => {
  for (const value of ['3534818982', '+54 9 353 4818982', '543534818982']) assert.equal(normalizePhone(value), '5493534818982');
  for (const value of ['', '549', '03534818982', '353154818982', 'abcdefghij', null]) assert.equal(normalizePhone(value), null);
});
test('envía confirmación a GREEN-API sin preview y no confirma por enviar', async () => {
  const original = global.fetch;
  const config = { reservationChannel: 'whatsapp', greenInstanceId: '1234567890', greenTokenEncrypted: service.encrypt('secret-token-instance') };
  let request;
  global.fetch = async (url, options) => { request = { url, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({ idMessage: 'message-1' }) }; };
  try {
    const reserva = { _id: 'reservation-1', codigoOTP: '123456', fecha: '2026-12-01', hora: '20:00', estado: 'PENDING' };
    assert.equal(await service.sendPending(reserva, { telefono: '3534818982' }, { nombre: 'Cancha 1' }, { nombre: 'Club' }, config), 'whatsapp');
    assert.equal(request.body.chatId, '5493534818982@c.us');
    assert.equal(request.body.linkPreview, false);
    assert.match(request.body.message, /id=reservation-1&code=123456/);
    assert.equal(reserva.estado, 'PENDING');
    assert.equal(JSON.stringify(service.publicSettings(config)).includes('secret-token'), false);
    global.fetch = async () => ({ ok: false });
    await assert.rejects(service.sendPending(reserva, { telefono: '3534818982' }, {}, {}, config));
  } finally { global.fetch = original; }
});
