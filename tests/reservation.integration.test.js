const { test } = require('node:test');
const assert = require('node:assert/strict');

test('login, refresh, reservation ownership, confirmation and logout', {
  skip: !process.env.MONGO_TEST_URI,
  timeout: 30000
}, async () => {
  const uri = process.env.MONGO_TEST_URI;
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:\d+\/canchalibre_test(?:\?|$)/, 'Only an isolated local test database is allowed');
  process.env.MONGO_URI = uri;
  process.env.JWT_ACCESS_SECRET = 'integration-only-secret';
  process.env.JWT_SECRET = 'integration-only-secret';
  process.env.NODE_ENV = 'test';
  process.env.FRONT_URL = 'http://localhost:8080';
  process.env.MP_ACCESS_TOKEN = 'TEST-isolated';
  process.env.MP_WEBHOOK_SECRET = 'isolated-webhook-secret';
  const mongoose = require('mongoose');
  const express = require('express');
  const cron = require('node-cron');
  const sent = [];
  const emailPath = require.resolve('../utils/email');
  require.cache[emailPath] = { id: emailPath, filename: emailPath, loaded: true, exports: { sendMail: async (...args) => { sent.push(args); } } };
  const mercadopago = require('../utils/mercadopago');
  const originalPaymentLookup = mercadopago.payment.findById;
  let paymentResponse;
  mercadopago.payment.findById = async (id, options) => {
    assert.equal(options.access_token, id.startsWith('featured') ? 'TEST-isolated' : 'TEST-private-club-token');
    return { body: paymentResponse };
  };
  const originalSchedule = cron.schedule;
  cron.schedule = () => ({ stop() {} });
  const originalListen = express.application.listen;
  let server;
  express.application.listen = function () { server = originalListen.call(this, 0, '127.0.0.1'); return server; };
  try {
    await require('../server').startServer();
    await mongoose.connection.asPromise();
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const Usuario = require('../models/Usuario');
    const Club = require('../models/Club');
    const Cancha = require('../models/Cancha');
    const Reserva = require('../models/Reserva');
    const Turno = require('../models/Turno');
    await Promise.all([Usuario.init(), Club.init(), Reserva.init(), Turno.init()]);
    const password = 'Integration-test-123!';
    const passwordHash = await require('bcryptjs').hash(password, 4);
    const user = await Usuario.create({ email: 'owner@canchalibre.local', passwordHash, emailVerificado: true });
    await Usuario.create({ email: 'other@canchalibre.local', passwordHash, emailVerificado: true });
    await Club.create({ nombre: 'Test Club', email: 'club@canchalibre.local', telefono: '123', provincia: 'Cordoba', localidad: 'Test', passwordHash, mercadoPagoAccessToken: 'TEST-private-club-token' });
    const clubFixture = await Club.findOne({ email: 'club@canchalibre.local' });
    const clubToken = require('jsonwebtoken').sign({ clubId: String(clubFixture._id) }, process.env.JWT_SECRET);
    const cancha = await Cancha.create({ nombre: 'Test Court', clubEmail: 'club@canchalibre.local', deporte: 'padel', precio: 1000, horaDesde: '08:00', horaHasta: '22:00', diasDisponibles: ['jueves'], duracionTurno: 60 });
    async function request(path, { token, cookie, body, method = 'GET' } = {}) {
      const headers = {};
      if (token) headers.Authorization = 'Bearer ' + token;
      if (cookie) headers.Cookie = cookie;
      if (body) headers['Content-Type'] = 'application/json';
      if (path.includes('webhook')) {
        const url = new URL(path, base);
        const id = String(body.data.id);
        url.searchParams.set('data.id', id);
        headers['x-request-id'] = 'integration-request';
        const ts = '1704908010';
        const hash = require('node:crypto').createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(`id:${id.toLowerCase()};request-id:integration-request;ts:${ts};`).digest('hex');
        headers['x-signature'] = `ts=${ts},v1=${hash}`;
        path = url.pathname + url.search;
      }
      return fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    }
    for (const path of ['/auth/login', '/login-club']) {
      for (const body of [{ email: { $ne: null }, password }, { email: 'owner@canchalibre.local', password: {} }, { email: ['owner@canchalibre.local'], password }])
        assert.equal((await request(path, { method: 'POST', body })).status, 400);
    }
    for (const query of ['provincia=a&provincia=b', 'localidad=a&localidad=b', 'q=a&q=b', 'q=' + 'a'.repeat(101)])
      assert.equal((await request('/clubes?' + query)).status, 400);
    const publicClub = await request('/club/club@canchalibre.local');
    const publicData = await publicClub.json();
    assert.equal(publicData.passwordHash, undefined);
    assert.equal(publicData.mercadoPagoAccessToken, undefined);
    assert.equal(publicData.pagoOnlineDisponible, true);
    assert.equal((await request('/turnos')).status, 401);
    assert.equal((await request('/editar-ubicacion-club', { method: 'PUT', body: { email: 'club@canchalibre.local', latitud: 0, longitud: 0 } })).status, 401);
    const privateClub = await request('/api/club/me', { token: clubToken });
    const privateData = await privateClub.json();
    assert.equal(privateData.passwordHash, undefined);
    assert.equal(privateData.mercadoPagoAccessToken, 'TEST-private-club-token');
    assert.equal((await request('/club/' + clubFixture._id, { method: 'PUT', body: { direccion: 'Sin permiso' } })).status, 401);
    const profileSaved = await request('/club/' + clubFixture._id, { method: 'PUT', token: clubToken, body: { direccion: 'San Martín 123', latitud: -32.41, longitud: -63.25 } });
    assert.equal(profileSaved.status, 200);
    assert.equal((await profileSaved.json()).club.direccion, 'San Martín 123');
    assert.equal((await Club.findById(clubFixture._id)).longitud, -63.25);
    assert.equal((await request('/club/' + clubFixture._id, { method: 'PUT', token: clubToken, body: { latitud: 100 } })).status, 400);
    assert.equal((await request('/club/perfil/publico', { method: 'PUT', token: clubToken, body: { direccion: 'Dirección desactualizada', descripcion: 'Descripción', servicios: [], fotos: [] } })).status, 200);
    assert.equal((await Club.findById(clubFixture._id)).direccion, 'San Martín 123');
    const clubBooking = { canchaId: String(cancha._id), deporte: 'padel', club: clubFixture.email, fecha: '2030-01-10', hora: '12:00', precio: 1000, usuarioReservado: 'Test', emailReservado: 'test@example.com', metodoPago: 'efectivo' };
    const concurrentBookings = await Promise.all([request('/reservar-turno', { method: 'POST', token: clubToken, body: clubBooking }), request('/reservar-turno', { method: 'POST', token: clubToken, body: clubBooking })]);
    assert.deepEqual(concurrentBookings.map(r => r.status).sort(), [200, 409]);
    const Superadmin = require('../models/Superadmin');
    await Superadmin.create({ email: 'admin@example.com', nombre: 'Admin Test', passwordHash });
    const adminLogin = await request('/superadmin/login', { method: 'POST', body: { email: 'admin@example.com', password } });
    assert.equal(adminLogin.status, 200);
    const adminToken = (await adminLogin.json()).token;
    for (const resource of ['clubes', 'usuarios', 'reservas', 'pagos', 'destacados', 'configuraciones']) {
      assert.equal((await request('/superadmin/' + resource)).status, 401);
      const result = await request('/superadmin/' + resource, { token: adminToken });
      assert.equal(result.status, 200);
      const data = await result.json();
      assert.ok(!JSON.stringify(data).includes(passwordHash));
      assert.ok(!JSON.stringify(data).includes('TEST-private-club-token'));
    }
    assert.equal((await request('/canchas', { method: 'POST', token: clubToken, body: { clubEmail: 'another@example.com' } })).status, 403);
    assert.equal((await request('/superadmin/login', { method: 'POST', body: { email: { $ne: null }, password } })).status, 400);
    assert.equal((await request('/superadmin/configuraciones', { method: 'PUT', token: adminToken, body: { precioDestacado: -1 } })).status, 400);
    assert.equal((await request('/superadmin/configuraciones', { method: 'PUT', token: adminToken, body: { precioDestacado: 2500, diasDestacado: 7 } })).status, 200);
    // Credenciales de plataforma: autorización, verificación, cifrado y uso efectivo.
    assert.equal((await request('/superadmin/mercadopago')).status, 401);
    assert.equal((await request('/superadmin/mercadopago', { method: 'PUT', token: adminToken, body: { accessToken: 'bad' } })).status, 400);
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => String(url) === 'https://api.mercadolibre.com/users/me'
      ? { ok: true, json: async () => ({ id: 123, site_id: 'MLA', email: 'admin-mp@example.test', first_name: 'Admin', tags: ['test_user'] }) }
      : originalFetch(url, options);
    try {
      const saved = await request('/superadmin/mercadopago', { method: 'PUT', token: adminToken, body: { accessToken: 'TEST-platform-secret-for-testing', webhookSecret: 'platform-webhook-secret' } });
      assert.equal(saved.status, 200);
      const savedText = await saved.text();
      assert.ok(!savedText.includes('TEST-platform-secret-for-testing'));
      assert.ok(!savedText.includes('platform-webhook-secret'));
      assert.equal(JSON.parse(savedText).mercadopago.account.id, '123');
      const ConfigModel = require('../models/config');
      const dbConfig = await ConfigModel.findOne().select('+mpTokenEncrypted +mpWebhookEncrypted');
      assert.ok(!dbConfig.mpTokenEncrypted.includes('TEST-platform-secret-for-testing'));
      const creds = await require('../services/platformMercadoPago').credentials();
      assert.equal(creds.accessToken, 'TEST-platform-secret-for-testing');
      assert.equal(creds.webhookSecret, 'platform-webhook-secret');
      const cfgText = await (await request('/superadmin/configuraciones', { token: adminToken })).text();
      assert.ok(!cfgText.includes('mpTokenEncrypted') && !cfgText.includes('mpWebhookEncrypted'));
      const publicText = await (await request('/configuracion-destacado')).text();
      assert.ok(!publicText.includes('mpTokenEncrypted'));
      const preferenceOriginal = mercadopago.preferences.create;
      try {
        mercadopago.preferences.create = async (body, options) => {
          assert.equal(options.access_token, 'TEST-platform-secret-for-testing');
          assert.equal(body.back_urls.success, 'http://localhost:8080/panel-club.html');
          return { body: { init_point: 'https://checkout.test/featured' } };
        };
        assert.equal((await request('/club/' + clubFixture.email + '/destacar-pago', { method: 'POST', token: clubToken })).status, 200);
      } finally { mercadopago.preferences.create = preferenceOriginal; }
      const originalLookup = mercadopago.payment.findById;
      const previousSignatureSecret = process.env.MP_WEBHOOK_SECRET;
      try {
        process.env.MP_WEBHOOK_SECRET = 'platform-webhook-secret';
        mercadopago.payment.findById = async (id, options) => {
          assert.equal(options.access_token, 'TEST-platform-secret-for-testing');
          return { body: { status: 'pending', external_reference: 'destacado:pending-test' } };
        };
        assert.equal((await request('/api/mercadopago/destacado-webhook', { method: 'POST', body: { data: { id: 'configured-platform-payment' } } })).status, 200);
      } finally { mercadopago.payment.findById = originalLookup; process.env.MP_WEBHOOK_SECRET = previousSignatureSecret; }
      assert.equal((await request('/superadmin/resumen', { token: adminToken })).status, 200);
      await ConfigModel.updateOne({}, { $unset: { mpTokenEncrypted: 1, mpWebhookEncrypted: 1, mpAccount: 1, mpVerifiedAt: 1 } });
    } finally { global.fetch = originalFetch; }
    assert.equal((await request('/club/' + clubFixture.email + '/destacar-pago', { method: 'POST' })).status, 401);
    const originalPreference = mercadopago.preferences.create;
    let featuredReference;
    try {
      mercadopago.preferences.create = async (body, options) => {
        assert.equal(options.access_token, 'TEST-isolated');
        assert.equal(body.items[0].unit_price, 2500);
        featuredReference = body.external_reference;
        return { body: { init_point: 'https://sandbox.example.test/payment' } };
      };
      assert.equal((await request('/club/' + clubFixture.email + '/destacar-pago', { method: 'POST', token: clubToken })).status, 200);
    } finally { mercadopago.preferences.create = originalPreference; }
    // Price and duration are fixed at checkout even if configuration changes later.
    await request('/superadmin/configuraciones', { method: 'PUT', token: adminToken, body: { precioDestacado: 5000, diasDestacado: 30 } });
    const featuredWebhook = '/api/mercadopago/destacado-webhook';
    paymentResponse = { status: 'pending', external_reference: featuredReference, transaction_amount: 2500, currency_id: 'ARS' };
    assert.equal((await request(featuredWebhook, { method: 'POST', body: { data: { id: 'featured-payment' } } })).status, 200);
    assert.equal(await require('../models/PaymentEvent').countDocuments({ paymentId: 'featured-payment' }), 0);
    paymentResponse.status = 'approved';
    paymentResponse.transaction_amount = 1;
    assert.equal((await request(featuredWebhook, { method: 'POST', body: { data: { id: 'featured-payment' } } })).status, 400);
    paymentResponse.transaction_amount = 2500;
    assert.equal((await request(featuredWebhook, { method: 'POST', body: { data: { id: 'featured-payment' } } })).status, 200);
    const featuredClub = await Club.findById(clubFixture._id);
    assert.equal(featuredClub.destacado, true);
    assert.ok(Math.abs(featuredClub.destacadoHasta.getTime() - Date.now() - 7 * 86400000) < 5000);
    assert.equal((await request(featuredWebhook, { method: 'POST', body: { data: { id: 'featured-payment' } } })).status, 200);
    assert.equal((await Club.findById(clubFixture._id)).destacadoHasta.getTime(), featuredClub.destacadoHasta.getTime());
    const overview = await request('/api/stats/overview?anio=2030&mes=1', { token: clubToken });
    assert.equal(overview.status, 200);
    const stats = await overview.json();
    assert.equal(stats.totalReservas, 1);
    assert.equal(stats.reservasPorDia.length, 31);
    assert.equal(stats.reservasPorDia[9].dia, '2030-01-10');
    assert.equal(stats.reservasPorDia[9].cantidad, 1);
    assert.equal(stats.ocupacionPromedio, 1 / 70 * 100);
    assert.equal((await request('/api/stats/overview?anio=2030&mes=13', { token: clubToken })).status, 400);
    const courtBody = { nombre: 'Court ABM', deporte: 'padel', precio: 1200, horaDesde: '08:30', horaHasta: '09:30', diasDisponibles: ['jueves'], clubEmail: clubFixture.email, duracionTurno: 60 };
    assert.equal((await request('/canchas', { method: 'POST', token: clubToken, body: { ...courtBody, horaDesde: 8 } })).status, 400);
    assert.equal((await request('/canchas', { method: 'POST', token: clubToken, body: { ...courtBody, horaHasta: '08:00' } })).status, 400);
    assert.equal((await request('/canchas', { method: 'POST', token: clubToken, body: courtBody })).status, 200);
    const abmCourt = await Cancha.findOne({ nombre: courtBody.nombre });
    assert.ok(abmCourt);
    const foreignCourt = await Cancha.create({ ...courtBody, nombre: 'Foreign', clubEmail: 'foreign@example.com' });
    assert.equal((await request('/canchas/' + foreignCourt._id, { method: 'PUT', token: clubToken, body: courtBody })).status, 403);
    assert.equal((await request('/canchas/' + foreignCourt._id, { method: 'DELETE', token: clubToken })).status, 403);
    assert.equal((await request('/canchas/' + abmCourt._id, { method: 'PUT', token: clubToken, body: { ...courtBody, precio: 1500 } })).status, 200);
    assert.equal((await Cancha.findById(abmCourt._id)).precio, 1500);
    assert.equal((await request('/canchas/' + abmCourt._id, { method: 'DELETE', token: clubToken })).status, 200);
    assert.equal(await Cancha.findById(abmCourt._id), null);
    await Cancha.deleteOne({ _id: foreignCourt._id });
    const login = await request('/auth/login', { method: 'POST', body: { email: user.email, password } });
    assert.equal(login.status, 200);
    const { accessToken } = await login.json();
    const cookie = login.headers.get('set-cookie').split(';')[0];
    await request('/superadmin/usuarios/' + user._id + '/suspender', { method: 'PATCH', token: adminToken });
    assert.equal((await request('/auth/me', { token: accessToken })).status, 401);
    await request('/superadmin/usuarios/' + user._id + '/suspender', { method: 'PATCH', token: adminToken });
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    assert.match(login.headers.get('set-cookie'), /Path=\/auth/);
    assert.equal((await request('/auth/me', { token: accessToken })).status, 200);
    const refreshResults = await Promise.all([request('/auth/refresh', { method: 'POST', cookie }), request('/auth/refresh', { method: 'POST', cookie })]);
    assert.deepEqual(refreshResults.map(r => r.status).sort(), [200, 401]);
    const refreshed = refreshResults.find(r => r.status === 200);
    const renewed = await refreshed.json();
    const newCookie = refreshed.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/auth/refresh', { method: 'POST', cookie })).status, 401);
    const hold = await request('/reservas/hold', { method: 'POST', token: renewed.accessToken, body: {
      canchaId: String(cancha._id), fecha: '2030-01-10', hora: '10:00', metodoPago: 'efectivo', email: 'spoof@canchalibre.local'
    } });
    assert.equal(hold.status, 200);
    const { reservaId } = await hold.json();
    const reserva = await Reserva.findById(reservaId);
    assert.equal(String(reserva.usuarioId), String(user._id));
    assert.equal(reserva.emailContacto, user.email);
    assert.equal(sent[0][0], user.email);
    const guestHold = await request('/reservas/hold', { method: 'POST', body: { canchaId: String(cancha._id), fecha: '2030-01-10', hora: '16:00', email: 'guest@example.com', usuarioId: String(user._id), metodoPago: 'efectivo' } });
    assert.equal(guestHold.status, 200);
    const guestReservation = await Reserva.findById((await guestHold.json()).reservaId);
    assert.equal(guestReservation.usuarioId, null);
    const otherLogin = await request('/auth/login', { method: 'POST', body: { email: 'other@canchalibre.local', password } });
    const otherToken = (await otherLogin.json()).accessToken;
    assert.equal((await request('/api/me/reservas/' + reservaId + '/cancel', { method: 'PATCH', token: otherToken })).status, 404);
    const list = await request('/api/me/reservas', { token: renewed.accessToken });
    const listed = await list.json();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].codigoOTP, undefined);
    assert.equal((await request('/reservar-turno', { method: 'POST', body: {} })).status, 401);
    assert.equal((await request('/auth/refresh', { method: 'POST', cookie: 'canchalibre_refresh=%zz' })).status, 401);
    const confirm = await request('/reservas/confirmar/' + reservaId + '/' + reserva.codigoOTP);
    assert.equal(confirm.status, 302);
    const receipts = () => sent.filter(mail => mail[1] === 'Reserva confirmada · CanchaLibre');
    assert.equal(receipts().length, 1);
    assert.equal(receipts()[0][0], user.email);
    assert.match(receipts()[0][2], /Test Club/);
    assert.match(receipts()[0][2], /Test Court/);
    assert.match(receipts()[0][2], /10\/01\/2030/);
    await request('/reservas/confirmar/' + reservaId + '/' + reserva.codigoOTP);
    assert.equal(receipts().length, 1);
    assert.equal((await Reserva.findById(reservaId)).estado, 'CONFIRMED');
    const turno = await Turno.findOne({ canchaId: String(cancha._id) });
    assert.equal(String(turno.usuarioId), String(user._id));
    const availability = await request('/turnos-generados?fecha=2030-01-10');
    const slots = await availability.json();
    assert.equal((await request('/turnos-generados?fecha=2030-02-30')).status, 400);
    assert.equal((await request('/turnos-generados?club=a&club=b')).status, 400);
    assert.deepEqual(await (await request('/turnos-generados?fecha=2030-01-10&club=unknown@example.com')).json(), []);
    const filteredSlots = await (await request('/turnos-generados?fecha=2030-01-10&club=club%40canchalibre.local')).json();
    assert.ok(filteredSlots.length > 0);
    assert.ok(filteredSlots.every(s => s.club === clubFixture.email));
    assert.ok(slots.length > 0);
    assert.ok(slots.every(slot => slot.emailReservado === null));
    assert.ok(!JSON.stringify(slots).includes(user.email));
    assert.equal((await request('/turnos/' + turno._id)).status, 401);
    assert.equal((await request('/turnos/' + turno._id, { token: adminToken })).status, 401);
    const ownedTurno = await request('/turnos/' + turno._id, { token: clubToken });
    assert.equal(ownedTurno.status, 200);
    assert.equal((await ownedTurno.json()).usuarioId.passwordHash, undefined);
    const foreignClub = await Club.create({ nombre: 'Foreign Club', email: 'foreign@example.com', telefono: '123', provincia: 'Cordoba', localidad: 'Test', passwordHash });
    const foreignClubToken = require('jsonwebtoken').sign({ clubId: String(foreignClub._id) }, process.env.JWT_SECRET);
    assert.equal((await request('/turnos/' + turno._id, { token: foreignClubToken })).status, 404);
    assert.equal((await request('/turnos/' + turno._id + '/payment-link', { method: 'POST', token: foreignClubToken })).status, 404);
    assert.equal((await request('/turnos/' + turno._id + '/payment-link', { method: 'POST' })).status, 401);
    const originalCourtPreference = mercadopago.preferences.create;
    try {
      mercadopago.preferences.create = async (body, options) => {
        assert.equal(options.access_token, 'TEST-private-club-token');
        assert.equal(body.external_reference, require('../services/payments').paymentReference(turno));
        return { body: { init_point: 'https://sandbox.example.test/court' } };
      };
      assert.equal((await request('/turnos/' + turno._id + '/payment-link', { method: 'POST', token: clubToken })).status, 200);
    } finally { mercadopago.preferences.create = originalCourtPreference; }
    const webhook = '/api/mercadopago/webhook?club=club%40canchalibre.local&turno=' + turno._id;
    paymentResponse = { status: 'pending', external_reference: require('../services/payments').paymentReference(turno), transaction_amount: turno.precio, currency_id: 'ARS' };
    assert.equal((await request(webhook, { method: 'POST', body: { data: { id: 'test-payment' } } })).status, 200);
    assert.equal((await Turno.findById(turno._id)).pagado, false);
    paymentResponse = { ...paymentResponse, status: 'approved', transaction_amount: 1 };
    assert.equal((await request(webhook, { method: 'POST', body: { data: { id: 'test-payment' } } })).status, 400);
    assert.equal((await Turno.findById(turno._id)).pagado, false);
    paymentResponse.transaction_amount = turno.precio;
    const PaymentEvent = require('../models/PaymentEvent');
    const originalPaymentWrite = PaymentEvent.create;
    try {
      PaymentEvent.create = () => { throw new Error('Injected payment event failure'); };
      assert.equal((await request(webhook, { method: 'POST', body: { data: { id: 'test-payment' } } })).status, 500);
    } finally { PaymentEvent.create = originalPaymentWrite; }
    assert.equal((await Turno.findById(turno._id)).pagado, false);
    assert.equal(await PaymentEvent.countDocuments({ paymentId: 'test-payment' }), 0);
    assert.equal((await request(webhook, { method: 'POST', body: { data: { id: 'test-payment' } } })).status, 200);
    assert.equal((await Turno.findById(turno._id)).pagado, true);
    assert.equal((await request(webhook, { method: 'POST', body: { data: { id: 'test-payment' } } })).status, 200);
    assert.equal(await require('../models/PaymentEvent').countDocuments({ paymentId: 'test-payment' }), 1);
    assert.equal((await request('/api/me/turnos/' + turno._id + '/cancel', { method: 'PATCH', token: otherToken })).status, 404);
    assert.equal((await request('/api/me/turnos/' + turno._id + '/cancel', { method: 'PATCH', token: renewed.accessToken })).status, 409);
    await Turno.updateOne({ _id: turno._id }, { $set: { pagado: false } });
    assert.equal((await request('/api/me/turnos/' + turno._id + '/cancel', { method: 'PATCH', token: renewed.accessToken })).status, 200);
    assert.equal((await Turno.findById(turno._id)).usuarioId, null);
    assert.equal((await Reserva.findById(reservaId)).estado, 'CANCELLED');
    const rollback = await Reserva.create({ canchaId: cancha._id, usuarioId: user._id, emailContacto: user.email, fecha: '2030-01-10', hora: '15:00', codigoOTP: '654321', expiresAt: new Date(Date.now() + 600000) });
    const originalWrite = Turno.findOneAndUpdate;
    try {
      Turno.findOneAndUpdate = () => { throw new Error('Injected storage failure'); };
      assert.equal((await request('/reservas/confirmar/' + rollback._id + '/' + rollback.codigoOTP)).status, 500);
    } finally { Turno.findOneAndUpdate = originalWrite; }
    assert.equal((await Reserva.findById(rollback._id)).estado, 'PENDING');
    assert.equal(await Turno.countDocuments({ canchaId: String(cancha._id), fecha: rollback.fecha, hora: rollback.hora }), 0);
    assert.equal((await request('/reservas/confirmar/' + rollback._id + '/' + rollback.codigoOTP)).status, 302);
    const rollbackTurno = await Turno.findOne({ canchaId: String(cancha._id), fecha: rollback.fecha, hora: rollback.hora });
    const originalCancelWrite = Reserva.updateMany;
    try {
      Reserva.updateMany = () => { throw new Error('Injected cancellation failure'); };
      assert.equal((await request('/api/me/turnos/' + rollbackTurno._id + '/cancel', { method: 'PATCH', token: renewed.accessToken })).status, 500);
    } finally { Reserva.updateMany = originalCancelWrite; }
    assert.equal(String((await Turno.findById(rollbackTurno._id)).usuarioId), String(user._id));
    assert.equal((await Reserva.findById(rollback._id)).estado, 'CONFIRMED');
    assert.equal((await request('/api/me/turnos/' + rollbackTurno._id + '/cancel', { method: 'PATCH', token: renewed.accessToken })).status, 200);
    paymentResponse = { status: 'approved', external_reference: require('../services/payments').paymentReference(rollbackTurno), transaction_amount: rollbackTurno.precio, currency_id: 'ARS' };
    const rebooking = await Reserva.create({ canchaId: cancha._id, usuarioId: user._id, emailContacto: user.email, fecha: rollback.fecha, hora: rollback.hora, codigoOTP: '456789', expiresAt: new Date(Date.now() + 600000) });
    assert.equal((await request('/reservas/confirmar/' + rebooking._id + '/' + rebooking.codigoOTP)).status, 302);
    const lateWebhook = '/api/mercadopago/webhook?club=club%40canchalibre.local&turno=' + rollbackTurno._id;
    assert.equal((await request(lateWebhook, { method: 'POST', body: { data: { id: 'late-payment' } } })).status, 400);
    assert.equal((await Turno.findById(rollbackTurno._id)).pagado, false);
    const conflicts = await Reserva.create([1, 2].map(n => ({ canchaId: cancha._id, usuarioId: user._id, emailContacto: user.email, fecha: '2030-01-10', hora: '14:00', codigoOTP: String(100000 + n), expiresAt: new Date(Date.now() + 600000) })));
    const confirmed = await Promise.all(conflicts.map(r => request('/reservas/confirmar/' + r._id + '/' + r.codigoOTP)));
    assert.deepEqual(confirmed.map(r => r.status).sort(), [302, 409]);
    assert.equal(await Turno.countDocuments({ canchaId: String(cancha._id), fecha: '2030-01-10', hora: '14:00' }), 1);
    assert.equal((await request('/superadmin/clubes/' + clubFixture._id, { method: 'PUT', token: adminToken, body: { email: 'renamed@example.com' } })).status, 200);
    assert.equal((await Cancha.findById(cancha._id)).clubEmail, 'renamed@example.com');
    assert.ok((await Turno.find({ canchaId: String(cancha._id) })).every(t => t.club === 'renamed@example.com'));
    assert.equal((await request('/turnos', { token: clubToken })).status, 200);
    await request('/superadmin/clubes/' + clubFixture._id + '/suspender', { method: 'PATCH', token: adminToken });
    assert.equal((await request('/club-id/' + clubFixture._id)).status, (await Club.findById(clubFixture._id)).activo ? 200 : 404);
    assert.equal((await request('/turnos', { token: clubToken })).status, 403);
    assert.deepEqual(await (await request('/turnos-generados?fecha=2030-01-10&club=renamed@example.com')).json(), []);
    await request('/superadmin/clubes/' + clubFixture._id + '/suspender', { method: 'PATCH', token: adminToken });
    assert.equal((await request('/turnos', { token: clubToken })).status, 200);
    const { expireFeatured, expirePending } = require('../services/maintenance');
    const maintenanceNow = new Date();
    const expiredClub = await Club.create({ nombre: 'Expired Club', email: 'expired@example.com', telefono: '123', provincia: 'Cordoba', localidad: 'Test', passwordHash, destacado: true, destacadoHasta: new Date(maintenanceNow.getTime() - 1000) });
    await expireFeatured(maintenanceNow);
    assert.equal((await Club.findById(expiredClub._id)).destacado, false);
    assert.equal((await Club.findById(clubFixture._id)).destacado, true, 'A current renewal is preserved');
    const expiredHold = await Reserva.create({ canchaId: cancha._id, fecha: '2030-01-10', hora: '20:00', codigoOTP: '234567', expiresAt: new Date(maintenanceNow.getTime() - 1000) });
    await expirePending(maintenanceNow);
    assert.equal((await Reserva.findById(expiredHold._id)).estado, 'EXPIRED');
    assert.equal((await Reserva.findById(guestReservation._id)).estado, 'PENDING');
    await Club.deleteOne({ _id: expiredClub._id });
    await Reserva.deleteOne({ _id: expiredHold._id });
    const { dataAudit } = require('../utils/dataAudit');
    const healthy = await dataAudit(mongoose.connection.db);
    assert.equal(healthy.uniqueSlotIndex, true);
    assert.equal(healthy.counts.duplicateSlotGroups, 0);
    assert.equal(healthy.counts.duplicateConfirmedGroups, 0);
    assert.equal(healthy.counts.paidWithoutBooking, 0);
    const orphan = await Turno.create({ canchaId: 'missing-court', club: 'missing@example.com', fecha: '2030-02-01', hora: '08:00', pagado: true });
    const inconsistent = await dataAudit(mongoose.connection.db);
    assert.ok(inconsistent.counts.slotsWithoutCourt > healthy.counts.slotsWithoutCourt);
    assert.equal(inconsistent.counts.paidWithoutBooking, 1);
    assert.equal(await Turno.countDocuments({ _id: orphan._id }), 1, 'Audit does not repair or delete records');
    assert.ok(!JSON.stringify(inconsistent).includes(user.email));
    await Turno.deleteOne({ _id: orphan._id });
    assert.equal((await request('/auth/logout', { method: 'POST', cookie: newCookie })).status, 200);
    assert.equal((await request('/auth/refresh', { method: 'POST', cookie: newCookie })).status, 401);
    // Recovery rejects selector objects and consumes a token exactly once.
    for (const path of ['/reset', '/reset-club']) {
      assert.equal((await request(path, { method: 'POST', body: { token: { $ne: null }, nuevaPassword: 'New-pass-123!' } })).status, 400);
    }
    for (const path of ['/recuperar', '/recuperar-club', '/reenviar-verificacion', '/club/reenviar-verificacion'])
      assert.equal((await request(path, { method: 'POST', body: { email: { $ne: null } } })).status, 400);
    const recovered = await Usuario.create({ email: 'recover@example.test', nombre: 'Recover', passwordHash, password: 'legacy-hash', emailVerificado: true });
    const beforeReset = await request('/auth/login', { method: 'POST', body: { email: recovered.email, password } });
    const beforeToken = (await beforeReset.json()).accessToken;
    const beforeCookie = beforeReset.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/recuperar', { method: 'POST', body: { email: recovered.email } })).status, 200);
    const resetUser = await Usuario.findById(recovered._id);
    const recoveryBody = { token: resetUser.resetToken, nuevaPassword: 'Changed-pass-123!' };
    assert.ok(sent.at(-1)[2].includes(process.env.FRONT_URL + '/reset.html'));
    const UserSession = require('../models/UserSession');
    const originalRevoke = UserSession.updateMany;
    UserSession.updateMany = async () => { throw new Error('Injected session failure'); };
    try { assert.equal((await request('/reset', { method: 'POST', body: recoveryBody })).status, 500); }
    finally { UserSession.updateMany = originalRevoke; }
    assert.equal((await Usuario.findById(recovered._id)).resetToken, recoveryBody.token, 'Reset rolls back if session revocation fails');
    const simultaneous = await Promise.all([request('/reset', { method: 'POST', body: recoveryBody }), request('/reset', { method: 'POST', body: recoveryBody })]);
    assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 400]);
    assert.equal((await request('/auth/me', { token: beforeToken })).status, 401);
    assert.equal((await request('/auth/refresh', { method: 'POST', cookie: beforeCookie })).status, 401);
    assert.equal((await request('/auth/login', { method: 'POST', body: { email: recovered.email, password } })).status, 401);
    const afterReset = await request('/auth/login', { method: 'POST', body: { email: recovered.email, password: recoveryBody.nuevaPassword } });
    assert.equal(afterReset.status, 200);
    assert.equal((await request('/auth/me', { token: (await afterReset.json()).accessToken })).status, 200);
    const changedUser = await Usuario.findById(recovered._id);
    assert.equal(changedUser.password, undefined); assert.equal(changedUser.authVersion, 1);
    assert.equal((await request('/reset', { method: 'POST', body: recoveryBody })).status, 400);
    const logoutAllToken = (await (await request('/auth/login', { method: 'POST', body: { email: recovered.email, password: recoveryBody.nuevaPassword } })).json()).accessToken;
    assert.equal((await request('/auth/logout-all', { token: logoutAllToken, method: 'POST' })).status, 200);
    assert.equal((await request('/auth/me', { token: logoutAllToken })).status, 401);
    assert.equal((await request('/auth/me', { token: logoutAllToken, method: 'PATCH', body: { nombre: {} } })).status, 401);
    for (const endpoint of ['/recuperar', '/recuperar-club']) {
      const missing = await request(endpoint, { method: 'POST', body: { email: 'missing@example.test' } });
      assert.equal(missing.status, 200); assert.match((await missing.json()).mensaje, /Si la cuenta existe/);
    }


    await Club.updateOne({ _id: clubFixture._id }, { $set: { emailVerificado: true } });
    assert.equal((await request('/recuperar-club', { method: 'POST', body: { email: (await Club.findById(clubFixture._id)).email } })).status, 200);
    const resetClub = await Club.findById(clubFixture._id);
    const clubResetBody = { token: resetClub.resetToken, nuevaPassword: 'New-club-pass-123!' };
    const clubResets = await Promise.all([request('/reset-club', { method: 'POST', body: clubResetBody }), request('/reset-club', { method: 'POST', body: clubResetBody })]);
    assert.deepEqual(clubResets.map(r => r.status).sort(), [200, 400]);
    assert.equal((await request('/api/club/me', { token: clubToken })).status, 401);
    const newClubLogin = await request('/login-club', { method: 'POST', body: { email: resetClub.email, password: clubResetBody.nuevaPassword } });
    assert.equal(newClubLogin.status, 200);
    assert.equal((await request('/api/club/me', { token: (await newClubLogin.json()).token })).status, 200);

    assert.equal((await request('/registrar', { method: 'POST', body: { nombre: 'New', apellido: 'User', email: ' NEW@example.test ', password, telefono: '1234567890' } })).status, 200);
    const registered = await Usuario.findOne({ email: 'new@example.test' });
    assert.ok(registered); assert.equal(registered.emailVerificado, false);
    assert.ok(sent.at(-1)[2].includes(process.env.FRONT_URL + '/verificar-email.html'));
    assert.equal((await request('/auth/login', { method: 'POST', body: { email: registered.email, password } })).status, 403);
    const verifyPath = '/verificar-email?tipo=usuario&token=' + registered.tokenVerificacion;
    assert.equal((await request(verifyPath)).status, 302);
    assert.equal((await request(verifyPath)).status, 400);
    assert.equal((await request('/auth/login', { method: 'POST', body: { email: registered.email, password } })).status, 200);
  } finally {
    express.application.listen = originalListen;
    cron.schedule = originalSchedule;
    mercadopago.payment.findById = originalPaymentLookup;
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
});
