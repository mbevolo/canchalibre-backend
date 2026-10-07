const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const Club = require('../models/Club');
const Cancha = require('../models/Cancha');

function isTestDeployment(env, databaseName) {
  return env.APP_BASE_URL === 'https://canchalibre-backend-v2-test.onrender.com'
    && env.FRONT_URL === 'https://canchalibre-frontend-v2-test.vercel.app'
    && databaseName === 'canchalibre_v2_test';
}
const clubs = [
  { email: 'villa-maria@fixtures.canchalibre.invalid', nombre: 'Prueba V2 · Villa María Deportes', localidad: 'Villa María', latitud: -32.4101, longitud: -63.2438 },
  { email: 'villa-nueva@fixtures.canchalibre.invalid', nombre: 'Prueba V2 · Villa Nueva Club', localidad: 'Villa Nueva', latitud: -32.4325, longitud: -63.2475 },
  { email: 'padel-tenis@fixtures.canchalibre.invalid', nombre: 'Prueba V2 · Pádel y Tenis', localidad: 'Villa María', latitud: -32.3980, longitud: -63.2580 },
];
clubs.push({ email: 'panel-club@fixtures.canchalibre.invalid', nombre: 'Prueba V2 · Club Panel', localidad: 'Villa María', latitud: -32.413, longitud: -63.25, passwordHash: '$2b$10$nJGqkM6lyp3W.rNq9fFBK..M5yW1oM2ASSpNjRMcgYVGChK.CxD5a', emailVerificado: true });
const courts = [
  ['Fútbol 5', 'futbol', 18000, 60],
  ['Pádel', 'padel', 12000, 90],
  ['Tenis', 'tenis', 8000, 60],
];
async function seedV2Test({ env = process.env, connection = require('mongoose').connection } = {}) {
  if (!isTestDeployment(env, connection.name)) return false;
  // Contraseña aleatoria descartada: los clubes ficticios no tienen credenciales públicas.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  for (const club of clubs) {
    await Club.updateOne({ email: club.email }, { $setOnInsert: {
      provincia: 'Córdoba', telefono: '0000000000', passwordHash,
      emailVerificado: false, activo: true, ...club,
    } }, { upsert: true, runValidators: true });
    for (const [nombre, deporte, precio, duracionTurno] of courts) {
      await Cancha.updateOne({ clubEmail: club.email, nombre }, { $setOnInsert: {
        clubEmail: club.email, nombre, deporte, precio, duracionTurno,
        horaDesde: '08:00', horaHasta: '23:00',
        diasDisponibles: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],
      } }, { upsert: true, runValidators: true });
    }
  }
  // Cargar la galería una sola vez; conservar posteriores cambios desde el panel.
  const profile = require('./club-panel-profile.json');
  await Club.updateOne({
    email: 'panel-club@fixtures.canchalibre.invalid',
    testProfileSeeded: { $ne: true },
  }, { $set: { ...profile, testProfileSeeded: true } }, { runValidators: true });
  return true;
}
module.exports = { seedV2Test, isTestDeployment };
