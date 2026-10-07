const Club = require('../models/Club');
const Reserva = require('../models/Reserva');
async function expireFeatured(now = new Date()) {
  return Club.updateMany(
    { destacado: true, destacadoHasta: { $lt: now } },
    { $set: { destacado: false, destacadoHasta: null } },
  );
}
async function expirePending(now = new Date()) {
  return Reserva.updateMany(
    { estado: 'PENDING', expiresAt: { $lt: now } },
    { $set: { estado: 'EXPIRED' } },
  );
}
module.exports = { expireFeatured, expirePending };
