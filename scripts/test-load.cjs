const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose'), express = require('express'), cron = require('node-cron');
(async () => {
  const mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1, dbName: 'canchalibre_test' }, instanceOpts: [{ args: ['--nounixsocket'] }] });
  let api;
  const originalListen = express.application.listen, originalSchedule = cron.schedule;
  try {
    Object.assign(process.env, { MONGO_URI: mongo.getUri('canchalibre_test'), JWT_SECRET: 'load-only-secret', JWT_ACCESS_SECRET: 'load-only-secret', NODE_ENV: 'test', FRONT_URL: 'http://localhost:8080', MP_ACCESS_TOKEN: 'TEST-isolated' });
    express.application.listen = function () { api = originalListen.call(this, 0, '127.0.0.1'); return api; };
    cron.schedule = () => ({ stop() {} });
    const email = require.resolve('../utils/email'); require.cache[email] = { id: email, filename: email, loaded: true, exports: { sendMail: async () => {} } };
    await require('../server').startServer(); await mongoose.connection.asPromise();
    if (!api.listening) await new Promise(r => api.once('listening', r));
    const Club = require('../models/Club'), Cancha = require('../models/Cancha'), Turno = require('../models/Turno');
    await Promise.all([Club.init(), Cancha.init(), Turno.init()]);
    const clubs = await Club.insertMany(Array.from({ length: 10 }, (_, n) => ({ nombre: 'Club ' + n, email: `club${n}@example.com`, telefono: '123', provincia: 'Cordoba', localidad: 'Test', passwordHash: 'not-a-login-hash', activo: true })));
    const courts = await Cancha.insertMany(Array.from({ length: 100 }, (_, n) => ({ nombre: 'Court ' + n, clubEmail: clubs[n % 10].email, deporte: 'padel', precio: 1000, horaDesde: '08:00', horaHasta: '22:00', diasDisponibles: ['jueves'], duracionTurno: 60 })));
    await Turno.insertMany(courts.flatMap(c => Array.from({ length: 10 }, (_, n) => ({ canchaId: String(c._id), club: c.clubEmail, fecha: '2030-01-10', hora: String(n + 8).padStart(2, '0') + ':00', precio: 1000, usuarioReservado: 'Fixture', bookingId: String(c._id) + '-' + n }))));
    const base = 'http://127.0.0.1:' + api.address().port;
    async function measure(path) {
      await (await fetch(base + path)).arrayBuffer();
      const durations = []; let next = 0;
      const begin = performance.now();
      await Promise.all(Array.from({ length: 10 }, async () => { while (next++ < 100) {
        const start = performance.now(), response = await fetch(base + path); assert.equal(response.status, 200); await response.arrayBuffer(); durations.push(performance.now() - start);
      } }));
      durations.sort((a, b) => a - b);
      return { requests: durations.length, concurrency: 10, p50Ms: Math.round(durations[49]), p95Ms: Math.round(durations[94]), elapsedMs: Math.round(performance.now() - begin) };
    }
    const results = { fixture: { clubs: 10, courts: 100, slots: 1000 }, publicClubs: await measure('/clubes'), availability: await measure('/turnos-generados?fecha=2030-01-10'), selectedClub: await measure('/turnos-generados?fecha=2030-01-10&club=club0%40example.com') };
    const token = require('jsonwebtoken').sign({ clubId: String(clubs[0]._id) }, process.env.JWT_SECRET);
    const booking = { canchaId: String(courts[0]._id), deporte: 'padel', club: clubs[0].email, fecha: '2030-01-10', hora: '18:00', precio: 1000, usuarioReservado: 'Concurrent', emailReservado: 'test@example.com', metodoPago: 'efectivo' };
    const responses = await Promise.all(Array.from({ length: 20 }, () => fetch(base + '/reservar-turno', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(booking) })));
    assert.equal(responses.filter(r => r.status === 200).length, 1); assert.equal(responses.filter(r => r.status === 409).length, 19);
    assert.equal(await Turno.countDocuments({ canchaId: booking.canchaId, fecha: booking.fecha, hora: booking.hora }), 1);
    results.concurrentBooking = { attempts: 20, booked: 1, conflicts: 19 };
    console.log(JSON.stringify(results, null, 2));
    console.log('Local synthetic benchmark only; no production capacity claim. No real emails or payments.');
  } finally {
    express.application.listen = originalListen; cron.schedule = originalSchedule;
    if (api) await new Promise(r => api.close(r)); await mongoose.disconnect(); await mongo.stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
