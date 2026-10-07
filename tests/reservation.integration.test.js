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
    require('../server');
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
      return fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    }
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
    assert.equal((await Reserva.findById(reservaId)).estado, 'CONFIRMED');
    const turno = await Turno.findOne({ canchaId: String(cancha._id) });
    assert.equal(String(turno.usuarioId), String(user._id));
    const availability = await request('/turnos-generados?fecha=2030-01-10');
    const slots = await availability.json();
    assert.ok(slots.length > 0);
    assert.ok(slots.every(slot => slot.emailReservado === null));
    assert.ok(!JSON.stringify(slots).includes(user.email));
    assert.equal((await request('/turnos/' + turno._id + '/payment-link', { method: 'POST' })).status, 401);
    const originalCourtPreference = mercadopago.preferences.create;
    try {
      mercadopago.preferences.create = async (body, options) => {
        assert.equal(options.access_token, 'TEST-private-club-token');
        assert.equal(body.external_reference, require('../utils/paymentWrites').paymentReference(turno));
        return { body: { init_point: 'https://sandbox.example.test/court' } };
      };
      assert.equal((await request('/turnos/' + turno._id + '/payment-link', { method: 'POST', token: clubToken })).status, 200);
    } finally { mercadopago.preferences.create = originalCourtPreference; }
    const webhook = '/api/mercadopago/webhook?club=club%40canchalibre.local&turno=' + turno._id;
    paymentResponse = { status: 'pending', external_reference: require('../utils/paymentWrites').paymentReference(turno), transaction_amount: turno.precio, currency_id: 'ARS' };
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
    paymentResponse = { status: 'approved', external_reference: require('../utils/paymentWrites').paymentReference(rollbackTurno), transaction_amount: rollbackTurno.precio, currency_id: 'ARS' };
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
    assert.equal((await request('/turnos', { token: clubToken })).status, 403);
    await request('/superadmin/clubes/' + clubFixture._id + '/suspender', { method: 'PATCH', token: adminToken });
    assert.equal((await request('/turnos', { token: clubToken })).status, 200);
    assert.equal((await request('/auth/logout', { method: 'POST', cookie: newCookie })).status, 200);
    assert.equal((await request('/auth/refresh', { method: 'POST', cookie: newCookie })).status, 401);
  } finally {
    express.application.listen = originalListen;
    cron.schedule = originalSchedule;
    mercadopago.payment.findById = originalPaymentLookup;
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
});
