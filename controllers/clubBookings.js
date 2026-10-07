const Usuario = require('../models/Usuario');
const Cancha = require('../models/Cancha');
const { validBookingSlot } = require('../utils/bookingSlot');
const { calcularPrecioTurno } = require('../services/booking');
const Turno = require('../models/Turno');
const { randomUUID } = require('node:crypto');
const Club = require('../models/Club');
const { paymentReference } = require('../services/payments');
const mercadopago = require('../utils/mercadopago');
const mongoose = require('mongoose');
const { cancelTurno } = require('../services/reservations');

const postReservarTurno = async (req, res) => {
  const {
    deporte,
    fecha,
    club,
    hora,
    precio,
    usuarioReservado,
    emailReservado,
    metodoPago,
    canchaId,
    telefonoReservado,
  } = req.body;

  try {
    // ✅ Buscar el teléfono del usuario automáticamente
    const usuario = await Usuario.findOne({ email: emailReservado });

    // 🔹 Recalcular precio según la cancha y la hora solicitada
    const cancha = await Cancha.findById(canchaId);
    if (!cancha) return res.status(404).json({ error: 'Cancha no encontrada' });
    if (cancha.clubEmail !== req.clubEmail || club !== req.clubEmail)
      return res
        .status(403)
        .json({ error: 'La cancha no pertenece al club autenticado' });
    if (!validBookingSlot(cancha, fecha, hora))
      return res
        .status(400)
        .json({ error: 'El turno no pertenece a los horarios disponibles' });

    const [Y, M, D] = fecha.split('-').map(Number);
    const [h, mm] = hora.split(':').map(Number);
    const inicioReserva = new Date(Y, M - 1, D, h, mm, 0, 0);
    const precioCalculado = calcularPrecioTurno(cancha, inicioReserva);

    // El índice único del slot impide que dos reservas simultáneas se pisen.
    const turno = await Turno.findOneAndUpdate(
      {
        canchaId,
        fecha,
        hora,
        $or: [{ usuarioReservado: null }, { usuarioReservado: '' }],
      },
      {
        $set: {
          deporte: cancha.deporte,
          club: cancha.clubEmail,
          fecha,
          hora,
          canchaId,
          usuarioReservado,
          emailReservado,
          telefonoReservado,
          usuarioId: usuario?._id || null,
          precio: precioCalculado,
          pagado: false,
          metodoPago,
          bookingId: randomUUID(),
          pagoId: null,
          pagoMetodo: null,
          fechaPago: null,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    if (metodoPago === 'online') {
      const clubData = await Club.findOne({ email: club });
      if (!clubData || !clubData.mercadoPagoAccessToken) {
        return res
          .status(400)
          .json({ error: 'El club no tiene configurado su Access Token' });
      }

      const preference = {
        items: [
          {
            title: `Reserva de cancha - ${deporte}`,
            quantity: 1,
            currency_id: 'ARS',
            unit_price: precioCalculado,
          },
        ],
        notification_url:
          'https://api.canchalibre.ar/api/mercadopago/webhook?club=' +
          encodeURIComponent(clubData.email) +
          '&turno=' +
          turno._id,
        external_reference: paymentReference(turno),
      };

      const response = await mercadopago.preferences.create(preference, {
        access_token: clubData.mercadoPagoAccessToken,
      });
      return res.json({
        mensaje: 'Turno reservado. Link de pago generado.',
        pagoUrl: response.body.init_point,
      });
    }

    if (metodoPago === 'efectivo') {
      return res.json({
        mensaje: 'Turno reservado. Pago pendiente en efectivo.',
      });
    }
  } catch (error) {
    if (error.code === 11000)
      return res.status(409).json({ error: 'El turno ya está reservado' });
    console.error('❌ Error en /reservar-turno:', error);
    res.status(500).json({ error: 'Error al reservar turno' });
  }
};

const getTurnos = async (req, res) => {
  try {
    const turnos = await Turno.find({ club: req.clubEmail });
    res.json(turnos);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener turnos' });
  }
};

const getTurnosId = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ error: 'Identificador de turno inválido' });
  try {
    const turno = await Turno.findOne({
      _id: req.params.id,
      club: req.clubEmail,
    }).populate('usuarioId', 'nombre apellido email telefono');
    if (!turno) return res.status(404).json({ error: 'Reserva no encontrada' });
    return res.json(turno);
  } catch (error) {
    return res.status(500).json({ error: 'Error al consultar reserva' });
  }
};

const putTurnosId = async (req, res) => {
  try {
    const turno = await Turno.findOne({
      _id: req.params.id,
      club: req.clubEmail,
    });
    if (!turno)
      return res
        .status(404)
        .json({ error: 'Turno no encontrado o no pertenece al club' });

    const camposPermitidos = [
      'deporte',
      'fecha',
      'hora',
      'precio',
      'usuarioReservado',
      'emailReservado',
      'pagado',
      'metodoPago',
    ];
    const update = {};
    for (const campo of camposPermitidos) {
      if (req.body[campo] !== undefined) update[campo] = req.body[campo];
    }

    await Turno.updateOne({ _id: turno._id }, update);
    res.json({ mensaje: 'Turno actualizado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar turno' });
  }
};

const postTurnosIdPaymentLink = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ error: 'Identificador de turno inválido' });
  try {
    const turno = await Turno.findOne({
      _id: req.params.id,
      club: req.clubEmail,
    });
    if (!turno || !turno.usuarioReservado)
      return res.status(404).json({ error: 'Reserva no encontrada' });
    if (turno.pagado)
      return res.status(409).json({ error: 'La reserva ya está pagada' });
    const club = await Club.findById(req.clubId);
    if (!club?.mercadoPagoAccessToken)
      return res
        .status(400)
        .json({ error: 'El club no tiene configurado su Access Token' });
    const response = await mercadopago.preferences.create(
      {
        items: [
          {
            title: 'Reserva de cancha - ' + turno.deporte,
            quantity: 1,
            currency_id: 'ARS',
            unit_price: turno.precio,
          },
        ],
        external_reference: paymentReference(turno),
        notification_url:
          'https://api.canchalibre.ar/api/mercadopago/webhook?club=' +
          encodeURIComponent(club.email) +
          '&turno=' +
          turno._id,
      },
      { access_token: club.mercadoPagoAccessToken },
    );
    return res.json({ pagoUrl: response.body.init_point });
  } catch (error) {
    return res.status(500).json({ error: 'Error generando link de pago' });
  }
};

const patchTurnosIdCancelar = async (req, res) => {
  try {
    await cancelTurno(req.params.id, { club: req.clubEmail });
    return res.json({ mensaje: 'Reserva cancelada' });
  } catch (error) {
    return res
      .status(error.status || 500)
      .json({
        error: error.status ? error.message : 'Error al cancelar reserva',
      });
  }
};

const getReservasClubEmail = async (req, res) => {
  if (
    String(req.params.clubEmail).toLowerCase() !==
    String(req.clubEmail).toLowerCase()
  ) {
    return res
      .status(403)
      .json({ error: 'No autorizado para consultar este club' });
  }
  try {
    const clubEmail = req.params.clubEmail;
    const club = await Club.findOne({ email: clubEmail });
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    // ===== Buscar y ORDENAR reservas por fecha+hora reales (robusto DD/MM/YYYY y YYYY-MM-DD) =====
    const pipeline = [
      {
        $match: {
          $or: [{ club: clubEmail }, { club: club.nombre }],
          usuarioReservado: { $ne: null },
        },
      },
      // Normalizar fecha/hora y construir un Date real
      {
        $addFields: {
          _fechaStr: { $ifNull: ['$fecha', ''] },
          _horaStr: {
            $let: {
              vars: { h: { $ifNull: ['$hora', '00:00'] } },
              in: {
                // si viene algo raro como "08:00:" lo recortamos a HH:mm
                $cond: [
                  { $regexMatch: { input: '$$h', regex: /^[0-2]\d:[0-5]\d$/ } },
                  '$$h',
                  {
                    $let: {
                      vars: { p: { $split: ['$$h', ':'] } },
                      in: {
                        $concat: [
                          { $ifNull: [{ $arrayElemAt: ['$$p', 0] }, '00'] },
                          ':',
                          { $ifNull: [{ $arrayElemAt: ['$$p', 1] }, '00'] },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          _isISO: {
            $regexMatch: { input: '$_fechaStr', regex: /^\d{4}-\d{2}-\d{2}$/ },
          },
          _fechaParts: {
            $cond: [
              {
                $regexMatch: {
                  input: '$_fechaStr',
                  regex: /^\d{4}-\d{2}-\d{2}$/,
                },
              },
              { $split: ['$_fechaStr', '-'] }, // YYYY-MM-DD
              { $split: ['$_fechaStr', '/'] }, // DD/MM/YYYY
            ],
          },
          _horaParts: { $split: ['$_horaStr', ':'] },
        },
      },
      {
        $addFields: {
          _year: {
            $cond: [
              '$_isISO',
              { $toInt: { $arrayElemAt: ['$_fechaParts', 0] } }, // YYYY
              { $toInt: { $arrayElemAt: ['$_fechaParts', 2] } }, // YYYY
            ],
          },
          _month: { $toInt: { $arrayElemAt: ['$_fechaParts', 1] } }, // MM
          _day: {
            $cond: [
              '$_isISO',
              { $toInt: { $arrayElemAt: ['$_fechaParts', 2] } }, // DD (en ISO es el 3er elem)
              { $toInt: { $arrayElemAt: ['$_fechaParts', 0] } }, // DD
            ],
          },
          _hour: {
            $toInt: { $ifNull: [{ $arrayElemAt: ['$_horaParts', 0] }, 0] },
          },
          _minute: {
            $toInt: { $ifNull: [{ $arrayElemAt: ['$_horaParts', 1] }, 0] },
          },
        },
      },
      {
        $addFields: {
          fechaHoraOrden: {
            $dateFromParts: {
              year: '$_year',
              month: '$_month',
              day: '$_day',
              hour: '$_hour',
              minute: '$_minute',
              timezone: 'America/Argentina/Buenos_Aires',
            },
          },
        },
      },
      { $sort: { fechaHoraOrden: 1 } }, // ascendente (más próximo primero)

      // === Traer datos de usuario (equivalente a populate)
      {
        $lookup: {
          from: 'usuarios',
          localField: 'usuarioId',
          foreignField: '_id',
          as: 'usuarioDoc',
        },
      },
      { $unwind: { path: '$usuarioDoc', preserveNullAndEmptyArrays: true } },
    ];

    const reservasOrdenadas = await Turno.aggregate(pipeline);

    // Traer canchas para obtener el nombre
    const canchas = await Cancha.find({ clubEmail: clubEmail });

    // Agregar nombre de cancha y aplanar usuario
    const reservasConNombre = reservasOrdenadas.map((r) => {
      const canchaMatch = canchas.find(
        (c) =>
          c._id.equals(r.canchaId) || c._id.toString() === String(r.canchaId),
      );

      return {
        ...r,
        nombreCancha: canchaMatch ? canchaMatch.nombre : 'Sin nombre',
        usuarioId: r.usuarioId, // compatibilidad
        usuario: r.usuarioDoc
          ? {
              nombre: r.usuarioDoc.nombre,
              apellido: r.usuarioDoc.apellido,
              email: r.usuarioDoc.email,
              telefono: r.usuarioDoc.telefono,
              _id: r.usuarioDoc._id,
            }
          : null,
        // === Campos planos para que tanto InfoClub como Reservas funcionen ===
        usuarioNombre: r.usuarioDoc ? r.usuarioDoc.nombre : '',
        usuarioApellido: r.usuarioDoc ? r.usuarioDoc.apellido : '',
        usuarioEmail: r.usuarioDoc ? r.usuarioDoc.email : '',
        usuarioTelefono: r.telefonoReservado || r.usuarioDoc?.telefono || '',
      };
    });

    res.json(reservasConNombre);
  } catch (error) {
    console.error('Error al obtener reservas:', error);
    res.status(500).json({ error: 'Error al obtener reservas' });
  }
};

const patchTurnosIdMarcarPagado = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ error: 'Identificador inválido' });
  try {
    const turno = await Turno.findOneAndUpdate(
      {
        _id: req.params.id,
        club: req.clubEmail,
        pagado: false,
        usuarioReservado: { $nin: [null, ''] },
      },
      { $set: { pagado: true, pagoMetodo: 'manual', fechaPago: new Date() } },
      { new: true },
    );
    if (!turno) {
      const existing = await Turno.findOne({
        _id: req.params.id,
        club: req.clubEmail,
      });
      if (!existing)
        return res.status(404).json({ error: 'Reserva no encontrada' });
      if (!existing.usuarioReservado)
        return res.status(409).json({ error: 'La reserva está cancelada' });
    }
    res.json({ mensaje: 'Turno marcado como pagado' });
  } catch (error) {
    res.status(500).json({ error: 'Error al marcar como pagado' });
  }
};

module.exports = {
  postReservarTurno,
  getTurnos,
  getTurnosId,
  putTurnosId,
  postTurnosIdPaymentLink,
  patchTurnosIdCancelar,
  getReservasClubEmail,
  patchTurnosIdMarcarPagado,
};
