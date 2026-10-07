const Usuario = require('../models/Usuario');
const Cancha = require('../models/Cancha');
const { validBookingSlot } = require('../utils/bookingSlot');
const Club = require('../models/Club');
const Turno = require('../models/Turno');
const crypto = require('crypto');
const Reserva = require('../models/Reserva');
const {
  formatearFechaDDMMYYYY,
  calcularPrecioTurno,
} = require('../services/booking');
const { sendMail } = require('../utils/email');
const { confirmReservation } = require('../services/reservations');
const { paymentReference } = require('../services/payments');
const mercadopago = require('../utils/mercadopago');

const postReservasHold = async (req, res) => {
  try {
    const { canchaId, fecha, hora, email: emailBody, metodoPago } = req.body;
    let usuarioId = null;
    let email = String(emailBody || '')
      .trim()
      .toLowerCase();

    if (req.userId) {
      const usuarioAutenticado = await Usuario.findById(req.userId)
        .select('_id email')
        .lean();
      if (!usuarioAutenticado)
        return res.status(401).json({ error: 'Usuario no encontrado' });
      usuarioId = usuarioAutenticado._id;
      email = usuarioAutenticado.email;
    }

    if (!canchaId || !fecha || !hora || !email) {
      return res.status(400).json({ error: 'Faltan datos obligatorios.' });
    }

    const canchaValida = await Cancha.findById(canchaId);
    if (!canchaValida)
      return res.status(404).json({ error: 'Cancha no encontrada' });
    if (!validBookingSlot(canchaValida, fecha, hora))
      return res
        .status(400)
        .json({ error: 'El turno no pertenece a los horarios disponibles' });
    const clubValido = await Club.findOne({
      email: canchaValida.clubEmail,
      activo: { $ne: false },
    }).select('_id');
    if (!clubValido)
      return res.status(404).json({ error: 'Club no disponible' });
    if (
      await Turno.exists({
        canchaId,
        fecha,
        hora,
        usuarioReservado: { $nin: [null, ''] },
      })
    )
      return res.status(409).json({ error: 'El turno ya está reservado' });

    const codigoOTP = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000);

    const reserva = new Reserva({
      canchaId,
      fecha,
      hora,
      usuarioId,
      emailContacto: email,
      metodoPago: metodoPago === 'online' ? 'online' : 'efectivo', // ✅ guarda online o efectivo
      estado: 'PENDING',
      codigoOTP,
      expiresAt,
    });
    await reserva.save();

    // 🟦 Traemos info de cancha y club para mostrar en el mail
    const cancha = await Cancha.findById(canchaId);
    let club = null;
    if (cancha && cancha.clubEmail) {
      club = await Club.findOne({ email: cancha.clubEmail });
    }

    // 🟦 Calculamos el precio usando tu helper de precio nocturno
    let precioCalculado = null;
    try {
      const [Y, M, D] = fecha.split('-').map(Number); // asume YYYY-MM-DD
      const [h, m] = hora.split(':').map(Number);
      const inicioReserva = new Date(Y, M - 1, D, h, m || 0, 0, 0);
      if (cancha) {
        precioCalculado = calcularPrecioTurno(cancha, inicioReserva);
      }
    } catch (e) {
      console.error("⚠️ No se pudo calcular precio para el mail de reserva:");
    }

    const link = `${process.env.FRONT_URL}/confirmar-reserva.html?id=${reserva._id}&code=${codigoOTP}`;

    const html = `
      <h2>Confirmación de tu reserva</h2>

      <p>Estos son los datos de tu reserva pendiente:</p>
      <ul>
        <li><strong>Club:</strong> ${club ? club.nombre : 'A confirmar'}</li>
        <li><strong>Cancha:</strong> ${cancha ? cancha.nombre : 'Sin nombre'}</li>
        <li><strong>Deporte:</strong> ${cancha ? cancha.deporte : ''}</li>
        <li><strong>Fecha:</strong> ${formatearFechaDDMMYYYY(reserva.fecha)}</li>
        <li><strong>Hora:</strong> ${hora}</li>
        ${precioCalculado !== null ? `<li><strong>Precio estimado:</strong> $${precioCalculado}</li>` : ''}
      </ul>

      <hr/>

      <p>Para confirmar la reserva, hacé clic en el siguiente enlace (vence en 10 minutos):</p>
      <p><a href="${link}">${link}</a></p>

      <p>Si no realizaste esta reserva, podés ignorar este mensaje.</p>
    `;

    await sendMail(email, 'Confirmá tu reserva en CanchaLibre', html);

    res.json({
      mensaje: 'Te enviamos un email para confirmar tu reserva.',
      reservaId: reserva._id,
    });
  } catch (error) {
    console.error("❌ Error en /reservas/hold:");
    res.status(500).json({ error: 'Error al crear reserva pendiente.' });
  }
};

const getReservasConfirmarIdCode = async (req, res) => {
  try {
    const { id, code } = req.params;

    // 1) Buscar reserva
    const reserva = await Reserva.findById(id);
    if (!reserva) return res.send('❌ Reserva no encontrada.');

    // 2) Validaciones
    if (String(reserva.codigoOTP) !== String(code)) {
      return res.send('❌ Código inválido.');
    }

    if (reserva.estado !== 'PENDING') {
      return res.send('⚠️ Esta reserva ya fue confirmada o expirada.');
    }

    if (reserva.expiresAt && new Date() > new Date(reserva.expiresAt)) {
      return res.send('⏳ El enlace expiró. Volvé a reservar.');
    }

    // Validar primero y confirmar de forma atómica antes de ocupar el slot.

    // ✅ IMPORTANTE: impactar la reserva en Turno (lo que ve el panel del club)
    // Si el Turno NO existe, lo creamos (porque /turnos-generados no guarda turnos en DB)

    const cancha = await Cancha.findById(reserva.canchaId);
    if (!cancha) {
      return res.send('❌ No se encontró la cancha para confirmar la reserva.');
    }

    const emailReservadoFinal = (reserva.emailContacto || '').trim();
    if (!emailReservadoFinal) {
      return res.send('❌ La reserva no tiene email de contacto.');
    }

    // Intentar buscar usuarioId por email (opcional)
    let usuario = null;
    try {
      usuario = reserva.usuarioId
        ? await Usuario.findById(reserva.usuarioId)
        : await Usuario.findOne({ email: emailReservadoFinal });
    } catch (e) {}

    // Calcular precio (igual que hacés en el mail)
    let precioCalculado = Number(reserva.precio || 0);
    try {
      const [Y, M, D] = String(reserva.fecha).split('-').map(Number);
      const [h, m] = String(reserva.hora).split(':').map(Number);
      const inicioReserva = new Date(Y, M - 1, D, h, m || 0, 0, 0);
      precioCalculado = calcularPrecioTurno(cancha, inicioReserva);
    } catch (e) {
      console.error("⚠️ No se pudo calcular precio al confirmar:");
    }

    const turno = await confirmReservation(reserva, code, {
      deporte: cancha.deporte,
      club: cancha.clubEmail,
      fecha: reserva.fecha,
      hora: reserva.hora,
      canchaId: String(reserva.canchaId),
      precio: precioCalculado,
      usuarioReservado: emailReservadoFinal,
      emailReservado: emailReservadoFinal,
      usuarioId: usuario?._id || null,
      pagado: false,
      metodoPago: reserva.metodoPago || 'efectivo',
    });

    let clubConfirmado = null;
    try { clubConfirmado = await Club.findOne({ email: cancha.clubEmail }); } catch (_) {}
    await require('../services/confirmationEmail').sendConfirmationEmail(
      turno, cancha, clubConfirmado, emailReservadoFinal,
    );

    // 4) Si eligió MercadoPago -> crear preferencia y redirigir

    const metodoFinal = turno.metodoPago || reserva.metodoPago || 'efectivo';

    if (metodoFinal === 'online') {
      // ✅ cobrar en la cuenta del CLUB dueño de la cancha
      const clubData = await Club.findOne({ email: cancha.clubEmail });
      if (!clubData || !clubData.mercadoPagoAccessToken) {
        return res
          .status(400)
          .send(
            '❌ El club no tiene configurado su Access Token de MercadoPago.',
          );
      }

      // ✅ pasar club + turno al webhook para que pueda usar el token del club
      const clubEmailEnc = encodeURIComponent(
        String(clubData.email || cancha.clubEmail || ''),
      );
      const turnoIdEnc = encodeURIComponent(String(turno._id));
      const notificationUrl = `https://api.canchalibre.ar/api/mercadopago/webhook?club=${clubEmailEnc}&turno=${turnoIdEnc}`;

      const preference = {
        items: [
          {
            title: `Reserva CanchaLibre`,
            quantity: 1,
            currency_id: 'ARS',
            unit_price: Number(turno.precio || 0),
          },
        ],

        // ✅ IMPORTANTE: que sea el TURNO (así el webhook lo encuentra y marca pagado)
        external_reference: paymentReference(turno),

        back_urls: {
          success: `${process.env.FRONT_URL}/mp-success.html?turno=${turno._id}`,
          pending: `${process.env.FRONT_URL}/mp-pending.html?turno=${turno._id}`,
          failure: `${process.env.FRONT_URL}/mp-failure.html?turno=${turno._id}`,
        },

        auto_return: 'approved',
        notification_url: notificationUrl,
      };

      let resp;
      try {
        resp = await mercadopago.preferences.create(preference, {
          access_token: clubData.mercadoPagoAccessToken,
        });
      } catch (e) {
        console.error("❌ Error creando preferencia MP:");
        return res
          .status(500)
          .send('❌ Error creando preferencia de MercadoPago.');
      }

      const body = resp?.body || {};

      const tokenClub = String(clubData?.mercadoPagoAccessToken || '');
      const esSandbox = tokenClub.startsWith('TEST-');

      const urlCheckout = esSandbox ? body.sandbox_init_point : body.init_point;

      if (!urlCheckout) {
        return res
          .status(500)
          .send('❌ MercadoPago no devolvió URL de checkout.');
      }

      return res.redirect(urlCheckout);
    }

    // 5) Si es efectivo -> volver al front
    return res.redirect(
      `${process.env.FRONT_URL}/reserva-confirmada.html?id=${reserva._id}`,
    );
  } catch (error) {
    if (error.status) return res.status(error.status).send(error.message);
    console.error("❌ Error en confirmación de reserva:");
    return res.status(500).send('Error confirmando la reserva');
  }
};

module.exports = { postReservasHold, getReservasConfirmarIdCode };
