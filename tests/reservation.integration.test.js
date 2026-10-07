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
    await Club.create({ nombre: 'Test Club', email: 'club@canchalibre.local', telefono: '123', provincia: 'Cordoba', localidad: 'Test', passwordHash });
    const cancha = await Cancha.create({ nombre: 'Test Court', clubEmail: 'club@canchalibre.local', deporte: 'padel', precio: 1000 });
    async function request(path, { token, cookie, body, method = 'GET' } = {}) {
      const headers = {};
      if (token) headers.Authorization = 'Bearer ' + token;
      if (cookie) headers.Cookie = cookie;
      if (body) headers['Content-Type'] = 'application/json';
      return fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    }
    const login = await request('/auth/login', { method: 'POST', body: { email: user.email, password } });
    assert.equal(login.status, 200);
    const { accessToken } = await login.json();
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    assert.match(login.headers.get('set-cookie'), /Path=\/auth/);
    assert.equal((await request('/auth/me', { token: accessToken })).status, 200);
    const refreshed = await request('/auth/refresh', { method: 'POST', cookie });
    assert.equal(refreshed.status, 200);
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
    const otherLogin = await request('/auth/login', { method: 'POST', body: { email: 'other@canchalibre.local', password } });
    const otherToken = (await otherLogin.json()).accessToken;
    assert.equal((await request('/api/me/reservas/' + reservaId + '/cancel', { method: 'PATCH', token: otherToken })).status, 404);
    const list = await request('/api/me/reservas', { token: renewed.accessToken });
    assert.equal((await list.json()).length, 1);
    const confirm = await request('/reservas/confirmar/' + reservaId + '/' + reserva.codigoOTP);
    assert.equal(confirm.status, 302);
    assert.equal((await Reserva.findById(reservaId)).estado, 'CONFIRMED');
    const turno = await Turno.findOne({ canchaId: String(cancha._id) });
    assert.equal(String(turno.usuarioId), String(user._id));
    assert.equal((await request('/api/me/turnos/' + turno._id + '/cancel', { method: 'PATCH', token: otherToken })).status, 404);
    assert.equal((await request('/api/me/turnos/' + turno._id + '/cancel', { method: 'PATCH', token: renewed.accessToken })).status, 200);
    assert.equal((await Turno.findById(turno._id)).usuarioId, null);
    assert.equal((await request('/auth/logout', { method: 'POST', cookie: newCookie })).status, 200);
    assert.equal((await request('/auth/refresh', { method: 'POST', cookie: newCookie })).status, 401);
  } finally {
    express.application.listen = originalListen;
    cron.schedule = originalSchedule;
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
  }
});
