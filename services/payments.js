const Turno = require('../models/Turno');
const PaymentEvent = require('../models/PaymentEvent');
const { transaction, failure } = require('./reservations');
function paymentReference(turno) {
  return String(turno._id) + (turno.bookingId ? ':' + turno.bookingId : '');
}
async function applyPayment(turnoId, clubEmail, paymentId, payment) {
  return transaction(async (session) => {
    if (await PaymentEvent.findOne({ paymentId }).session(session)) return;
    const turno = await Turno.findById(turnoId).session(session);
    if (
      !turno ||
      !turno.usuarioReservado ||
      paymentReference(turno) !== String(payment.external_reference) ||
      turno.club !== clubEmail ||
      payment.currency_id !== 'ARS' ||
      Number(payment.transaction_amount) !== Number(turno.precio)
    ) {
      throw failure(400, 'El pago no corresponde a esta reserva');
    }
    if (turno.pagado && turno.pagoId !== paymentId)
      throw failure(409, 'La reserva ya tiene otro pago aprobado');
    await Turno.updateOne(
      { _id: turno._id },
      {
        $set: {
          pagado: true,
          fechaPago: new Date(),
          pagoId: paymentId,
          pagoMetodo:
            payment.payment_method?.type ||
            payment.payment_type_id ||
            payment.payment_method_id ||
            'mercadopago',
        },
      },
      { session },
    );
    await PaymentEvent.create([{ paymentId }], { session });
  });
}
module.exports = { paymentReference, applyPayment };
