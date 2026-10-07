const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'app-test-only';
process.env.JWT_ACCESS_SECRET = 'app-test-only';
process.env.ALLOWED_ORIGINS = 'http://localhost:8080';

test('creating the app does not connect, listen or start jobs; retired routes stay retired', async () => {
  const mongoose = require('mongoose'), express = require('express'), cron = require('node-cron');
  const connect = mongoose.connect, listen = express.application.listen, schedule = cron.schedule;
  let server;
  try {
    mongoose.connect = () => { throw new Error('Unexpected database connection'); };
    express.application.listen = () => { throw new Error('Unexpected HTTP listener'); };
    cron.schedule = () => { throw new Error('Unexpected scheduled job'); };
    const app = require('../app').createApp();
    server = listen.call(app, 0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(base + '/login', { method: 'POST' })).status, 410);
    assert.equal((await fetch(base + '/generar-link-pago/old', { method: 'POST' })).status, 410);
    assert.equal((await fetch(base + '/superadmin/register', { method: 'POST' })).status, 404);
    assert.equal((await fetch(base + '/turnos')).status, 401);
    const missing = await fetch(base + '/missing-route');
    assert.equal(missing.status, 404); assert.equal((await missing.json()).error, 'Ruta no encontrada');
    const blocked = await fetch(base + '/login', { method: 'POST', headers: { Origin: 'https://blocked.example.com' } });
    assert.equal(blocked.status, 403); assert.deepEqual(await blocked.json(), { error: 'Origen no permitido' });
    const malformed = await fetch(base + '/reservas/hold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: 'JSON inválido' });
    assert.equal((await fetch(base + '/reservas/hold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  } finally {
    mongoose.connect = connect; express.application.listen = listen; cron.schedule = schedule;
    if (server) await new Promise(resolve => server.close(resolve));
  }
});

test('failed database startup never opens HTTP or schedules jobs', async () => {
  const mongoose = require('mongoose'), express = require('express'), cron = require('node-cron');
  const connect = mongoose.connect, listen = express.application.listen, schedule = cron.schedule;
  const oldUri = process.env.MONGO_URI;
  let listeners = 0, jobs = 0;
  try {
    process.env.MONGO_URI = 'mongodb://127.0.0.1:1/canchalibre_test';
    mongoose.connect = async () => { throw new Error('Test connection failed'); };
    express.application.listen = () => { listeners++; };
    cron.schedule = () => { jobs++; };
    await assert.rejects(require('../server').startServer(), /Test connection failed/);
    assert.equal(listeners, 0); assert.equal(jobs, 0);
  } finally {
    mongoose.connect = connect; express.application.listen = listen; cron.schedule = schedule;
    if (oldUri === undefined) delete process.env.MONGO_URI; else process.env.MONGO_URI = oldUri;
  }
});
