const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');
const Club = require('../models/Club');
const UserSession = require('../models/UserSession');
const { transaction, failure } = require('./reservations');

async function resetPassword(token, password, club = false) {
  const hash = await bcrypt.hash(password, 10);
  const filter = { resetToken: token, resetTokenExp: { $gt: new Date() } };
  const update = {
    $set: { passwordHash: hash },
    $unset: { password: 1, resetToken: 1, resetTokenExp: 1 },
    $inc: { authVersion: 1 },
  };
  if (club) {
    const changed = await Club.findOneAndUpdate(filter, update, { new: true });
    if (!changed) throw failure(400, 'Token inválido o expirado.');
    return;
  }
  await transaction(async session => {
    const changed = await Usuario.findOneAndUpdate(filter, update, { new: true, session });
    if (!changed) throw failure(400, 'Token inválido o expirado.');
    await UserSession.updateMany({ usuarioId: changed._id, revokedAt: null },
      { $set: { revokedAt: new Date() } }, { session });
  });
}
module.exports = { resetPassword };
