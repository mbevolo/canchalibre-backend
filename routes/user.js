const express = require('express');
const crypto = require('crypto');
const mercadopago = require('../utils/mercadopago');
const Turno = require('../models/Turno');
const Reserva = require('../models/Reserva');
const Usuario = require('../models/Usuario');
const Club = require('../models/Club');
const Cancha = require('../models/Cancha');
const authUser = require('../middlewares/authUser');
const { sendMail } = require('../utils/email');

const router = express.Router();
router.param('id', (req, res, next, id) => {
  if (!require('mongoose').isObjectIdOrHexString(id)) return res.status(400).json({ error: 'ID inválido' });
  next();
});

async function getCurrentUser(req) {
  return Usuario.findById(req.userId).select('_id email nombre apellido telefono').lean();
}

router.get('/reservas', authUser, async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const [confirmadas, pendientes] = await Promise.all([
      Turno.find({
        $or: [
          { usuarioId: req.userId },
          { usuarioId: null, emailReservado: user.email }
        ]
      }).lean(),
      Reserva.find({
        $or: [
          { usuarioId: req.userId },
          { usuarioId: null, emailContacto: user.email }
        ],
        estado: 'PENDING'
      }).lean()
    ]);

    const all = [
      ...confirmadas.map(r => ({ ...r, tipo: 'CONFIRMED' })),
      ...pendientes.map(r => ({ ...r, tipo: 'PENDING' }))
    ];

    const canchaIds = [...new Set(all.map(r => r.canchaId).filter(Boolean).map(String))];
    const canchas = canchaIds.length
      ? await Cancha.find({ _id: { $in: canchaIds } }).select('_id nombre clubEmail deporte').lean()
      : [];
    const canchaMap = new Map(canchas.map(c => [String(c._id), c]));

    const clubEmails = [...new Set([
      ...all.map(r => r.club).filter(Boolean),
      ...canchas.map(c => c.clubEmail).filter(Boolean)
    ])];
    const clubes = clubEmails.length
      ? await Club.find({ email: { $in: clubEmails } }).select('email nombre').lean()
      : [];
    const clubMap = new Map(clubes.map(c => [String(c.email).toLowerCase(), c.nombre]));

    return res.json(all.map(r => {
      const cancha = canchaMap.get(String(r.canchaId));
      const clubEmail = r.club || cancha?.clubEmail;
      const { codigoOTP, ...publicReserva } = r;
      return {
        ...publicReserva,
        nombreClub: clubMap.get(String(clubEmail || '').toLowerCase()) || 'Club desconocido',
        nombreCancha: cancha?.nombre || null,
        deporte: r.deporte || cancha?.deporte || null
      };
    }));
  } catch (error) {
    console.error('❌ Error en GET /api/me/reservas:', error);
    return res.status(500).json({ error: 'Error al obtener tus reservas' });
  }
});

router.post('/reservas/:id/resend-confirmation', authUser, async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const reserva = await Reserva.findOne({
      _id: req.params.id,
      $or: [
        { usuarioId: req.userId },
        { usuarioId: null, emailContacto: user.email }
      ],
      estado: 'PENDING'
    });
    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (reserva.expiresAt && new Date() > new Date(reserva.expiresAt)) {
      return res.status(400).json({ error: 'La reserva pendiente expiró.' });
    }

    reserva.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    reserva.codigoOTP = crypto.randomInt(100000, 1000000).toString();
    await reserva.save();

    const cancha = await Cancha.findById(reserva.canchaId);
    const club = cancha?.clubEmail
      ? await Club.findOne({ email: cancha.clubEmail }).select('nombre').lean()
      : null;
    const link = process.env.FRONT_URL + '/confirmar-reserva.html?id=' + reserva._id + '&code=' + reserva.codigoOTP;
    const html = '<h2>Confirmación de tu reserva</h2>' +
      '<p>Club: ' + (club?.nombre || 'A confirmar') + '</p>' +
      '<p>Cancha: ' + (cancha?.nombre || 'Sin nombre') + '</p>' +
      '<p>Fecha: ' + reserva.fecha + '</p>' +
      '<p>Hora: ' + reserva.hora + '</p>' +
      '<p><a href="' + link + '">Confirmar reserva</a></p>';

    await sendMail(user.email, 'Confirmá tu reserva en CanchaLibre', html);
    return res.json({ mensaje: 'Correo reenviado correctamente.' });
  } catch (error) {
    console.error('❌ Error en resend-confirmation:', error);
    return res.status(500).json({ error: 'Error al reenviar el correo.' });
  }
});

router.patch('/reservas/:id/cancel', authUser, async (req, res) => {
  try {
    const reserva = await Reserva.findOne({
      _id: req.params.id,
      usuarioId: req.userId,
      estado: 'PENDING'
    });
    if (!reserva) return res.status(404).json({ error: 'Reserva pendiente no encontrada' });
    reserva.estado = 'CANCELLED';
    await reserva.save();
    return res.json({ mensaje: 'Reserva pendiente cancelada correctamente.' });
  } catch (error) {
    console.error('❌ Error cancelando reserva:', error);
    return res.status(500).json({ error: 'Error al cancelar la reserva.' });
  }
});

router.patch('/turnos/:id/cancel', authUser, async (req, res) => {
  try {
    const turno = await Turno.findOne({ _id: req.params.id, usuarioId: req.userId });
    if (!turno) return res.status(404).json({ error: 'Turno no encontrado' });
    if (turno.pagado) return res.status(409).json({ error: 'Contactá al club para cancelar una reserva pagada y gestionar el reintegro' });

    const cancelled = await Turno.updateOne(
      { _id: turno._id, usuarioId: req.userId, pagado: false },
      { $set: { usuarioReservado: null, emailReservado: null, usuarioId: null, pagado: false } }
    );
    if (!cancelled.modifiedCount) return res.status(409).json({ error: 'La reserva cambió; volvé a consultarla' });
    await Reserva.updateMany({ canchaId: turno.canchaId, fecha: turno.fecha, hora: turno.hora, usuarioId: req.userId, estado: 'CONFIRMED' }, { $set: { estado: 'CANCELLED' } });
    return res.json({ mensaje: 'Turno cancelado correctamente.' });
  } catch (error) {
    console.error('❌ Error cancelando turno:', error);
    return res.status(500).json({ error: 'Error al cancelar el turno.' });
  }
});

router.post('/turnos/:id/payment-link', authUser, async (req, res) => {
  try {
    const turno = await Turno.findOne({ _id: req.params.id, usuarioId: req.userId });
    if (!turno) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (turno.pagado) return res.status(400).json({ error: 'El turno ya está pagado' });

    const club = await Club.findOne({ email: turno.club });
    if (!club?.mercadoPagoAccessToken) {
      return res.status(400).json({ error: 'El club no tiene configurado su Access Token' });
    }

    const preference = {
      items: [{
        title: 'Reserva de cancha - ' + (turno.deporte || 'CanchaLibre'),
        quantity: 1,
        currency_id: 'ARS',
        unit_price: Number(turno.precio || 0)
      }],
      notification_url: 'https://api.canchalibre.ar/api/mercadopago/webhook?club=' + encodeURIComponent(club.email) + '&turno=' + turno._id,
      external_reference: String(turno._id)
    };

    const response = await mercadopago.preferences.create(preference, { access_token: club.mercadoPagoAccessToken });
    return res.json({ pagoUrl: response?.body?.init_point || null });
  } catch (error) {
    console.error('❌ Error generando link de pago:', error);
    return res.status(500).json({ error: 'Error generando link de pago' });
  }
});

module.exports = router;
