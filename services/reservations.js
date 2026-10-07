const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const Reserva = require('../models/Reserva');
const Turno = require('../models/Turno');
function failure(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
async function transaction(operation) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } catch (error) {
    if (error.code === 11000) throw failure(409, 'El turno ya está reservado');
    if (error.code === 20)
      throw failure(
        503,
        'La base debe admitir transacciones para esta operación',
      );
    throw error;
  } finally {
    await session.endSession();
  }
}
async function confirmReservation(reserva, code, fields) {
  return transaction(async (session) => {
    const claimed = await Reserva.findOneAndUpdate(
      {
        _id: reserva._id,
        estado: 'PENDING',
        codigoOTP: code,
        expiresAt: { $gt: new Date() },
      },
      { $set: { estado: 'CONFIRMED' } },
      { new: true, session },
    );
    if (!claimed) throw failure(409, 'Esta reserva ya fue procesada');
    return Turno.findOneAndUpdate(
      {
        canchaId: String(reserva.canchaId),
        fecha: reserva.fecha,
        hora: reserva.hora,
        $or: [{ usuarioReservado: null }, { usuarioReservado: '' }],
      },
      {
        $set: {
          ...fields,
          bookingId: randomUUID(),
          pagoId: null,
          pagoMetodo: null,
          fechaPago: null,
          telefonoReservado: null,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        session,
      },
    );
  });
}
async function cancelTurno(id, scope) {
  return transaction(async (session) => {
    const turno = await Turno.findOne({ _id: id, ...scope }).session(session);
    if (!turno) throw failure(404, 'Reserva no encontrada');
    if (turno.pagado)
      throw failure(
        409,
        'La reserva está pagada; gestioná primero el reintegro con el club',
      );
    if (!turno.usuarioReservado)
      throw failure(409, 'La reserva ya está cancelada');
    await Turno.updateOne(
      { _id: turno._id },
      {
        $set: {
          usuarioReservado: null,
          emailReservado: null,
          telefonoReservado: null,
          usuarioId: null,
          pagado: false,
        },
      },
      { session },
    );
    await Reserva.updateMany(
      {
        canchaId: turno.canchaId,
        fecha: turno.fecha,
        hora: turno.hora,
        estado: 'CONFIRMED',
      },
      { $set: { estado: 'CANCELLED' } },
      { session },
    );
    return turno;
  });
}
module.exports = { confirmReservation, cancelTurno, transaction, failure };
