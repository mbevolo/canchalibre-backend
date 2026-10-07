const PaymentEvent = require('../models/PaymentEvent');
const Turno = require('../models/Turno');
const Club = require('../models/Club');
const Cancha = require('../models/Cancha');
const mercadopago = require('../utils/mercadopago');
const { applyPayment } = require('../services/payments');
const { transaction, failure } = require('../services/reservations');
const mongoose = require('mongoose');
const DestacadoOrder = require('../models/DestacadoOrder');

const postApiMercadopagoWebhook = async (req, res) => {
  try {
    const paymentId = req.mercadoPagoPaymentId;
    if (!paymentId) return res.sendStatus(200);

    const turnoIdFromQuery = req.query.turno
      ? String(req.query.turno).trim()
      : null;
    const clubEmailFromQuery = req.query.club
      ? String(req.query.club).trim()
      : null;

    // ✅ Idempotencia persistente en DB
    const yaExiste = await PaymentEvent.findOne({ paymentId });
    if (yaExiste) return res.sendStatus(200);

    // Registrar solamente después de verificar y aplicar un pago aprobado.

    // 1) Resolver TURNO (primero por query, luego por external_reference, luego por pagoId)
    let turno = null;

    if (turnoIdFromQuery) {
      try {
        turno = await Turno.findById(turnoIdFromQuery);
      } catch (_) {}
    }

    // 2) Si no lo tenemos aún, vamos a buscar el pago en MP, pero para eso necesitamos token correcto.
    //    Intentamos obtener el club por:
    //    A) clubEmailFromQuery
    //    B) turno.club (si ya encontramos turno)
    //    C) cancha.clubEmail (si encontramos turno y tiene canchaId)

    let clubData = null;

    if (clubEmailFromQuery) {
      clubData = await Club.findOne({ email: clubEmailFromQuery });
    }

    if (!clubData && turno?.club) {
      // turno.club guarda el email del club (en tu sistema)
      clubData = await Club.findOne({ email: turno.club });
    }

    if (!clubData && turno?.canchaId) {
      const cancha = await Cancha.findById(turno.canchaId);
      if (cancha?.clubEmail) {
        clubData = await Club.findOne({ email: cancha.clubEmail });
      }
    }

    // Si todavía no tenemos clubData, no podemos consultar el pago (porque ahora es token del club)
    if (!clubData || !clubData.mercadoPagoAccessToken) {
      return res.sendStatus(200);
    }

    // ✅ Configurar MP con token del club dueño
    // Traer el pago desde MP (con el token del club correcto)
    const resp = await mercadopago.payment.findById(paymentId, {
      access_token: clubData.mercadoPagoAccessToken,
    });
    const payment = resp?.body || {};
    const status = payment.status;
    const externalRef = payment.external_reference;

    // Si todavía no encontramos turno, intentamos con external_reference
    if (!turno && externalRef) {
      try {
        turno = await Turno.findById(String(externalRef).split(':')[0]);
      } catch (_) {}
    }

    // Fallback: buscar por pagoId
    if (!turno) {
      turno = await Turno.findOne({ pagoId: paymentId }).catch(() => null);
    }

    if (!turno) {
      return res.sendStatus(200);
    }

    // ✅ Marcar pagado si approved
    if (status === 'approved') {
      await applyPayment(turno._id, clubData.email, String(paymentId), payment);
    } else if (status === 'rejected' || status === 'cancelled') {
      // acá podés decidir si liberás turno o lo dejás pendiente
    } else {

    }

    return res.sendStatus(200);
  } catch (error) {
    if (error.code === 11000) return res.sendStatus(200);
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    console.error("❌ Error procesando webhook MP:");
    return res.sendStatus(500);
  }
};

const postApiMercadopagoDestacadoWebhook = async (req, res) => {
  try {
    const paymentId = req.mercadoPagoPaymentId;
    if (!paymentId) return res.sendStatus(200);

    // ✅ Idempotencia persistente en DB
    const yaExiste = await PaymentEvent.findOne({ paymentId });
    if (yaExiste) return res.sendStatus(200);

    // Traer el pago desde MP
    const resp = await mercadopago.payment.findById(paymentId, {
      access_token: process.env.MP_ACCESS_TOKEN,
    });
    const pago = resp?.body || {};
    const status = pago.status;
    const clubEmail = pago.external_reference;

    if (!clubEmail) return res.sendStatus(200);

    if (status === 'approved') {
      await transaction(async (session) => {
        if (await PaymentEvent.findOne({ paymentId }).session(session)) return;
        const orderId = String(clubEmail).startsWith('destacado:')
          ? String(clubEmail).slice(10)
          : null;
        if (!mongoose.isValidObjectId(orderId))
          throw failure(400, 'Referencia de destaque inválida');
        const order = await DestacadoOrder.findById(orderId).session(session);
        if (
          !order ||
          pago.currency_id !== 'ARS' ||
          Number(pago.transaction_amount) !== order.precio
        )
          throw failure(400, 'El pago no corresponde al destaque');
        if (order.paymentId && order.paymentId !== String(paymentId))
          throw failure(409, 'El destaque ya tiene otro pago');
        const club = await Club.findById(order.clubId).session(session);
        if (!club) throw failure(404, 'Club no encontrado');
        const from = Math.max(Date.now(), club.destacadoHasta?.getTime() || 0);
        club.destacado = true;
        club.destacadoHasta = new Date(from + order.dias * 86400000);
        club.idUltimaTransaccion = String(paymentId);
        await club.save({ session });
        order.paymentId = String(paymentId);
        await order.save({ session });
        await PaymentEvent.create([{ paymentId: String(paymentId) }], {
          session,
        });
      });
    }

    return res.sendStatus(200);
  } catch (error) {
    if (error.status)
      return res.status(error.status).json({ error: error.message });
    console.error("❌ Error en webhook de destacado:");
    return res.sendStatus(500);
  }
};

module.exports = {
  postApiMercadopagoWebhook,
  postApiMercadopagoDestacadoWebhook,
};
