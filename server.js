require('dotenv').config();
console.log("DEBUG FRONT_URL:", process.env.FRONT_URL);
console.log("DEBUG APP_BASE_URL:", process.env.APP_BASE_URL);
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const mercadopago = require('mercadopago');
const cron = require('node-cron');
const Config = require('./models/config');
const superadminRoutes = require('./routes/superadmin');
const Club = require('./models/Club');
const Turno = require('./models/Turno');
const Usuario = require('./models/Usuario');
const Cancha = require('./models/Cancha');
const ubicacionesRoute = require('./routes/ubicaciones');
const { celebrate, Joi, Segments, errors } = require('celebrate');
const PaymentEvent = require('./models/PaymentEvent');
const crypto = require('crypto');
const { sendMail } = require('./utils/email');
const clubRoutes = require("./routes/club");
const authClub = require('./middlewares/authClub');
const authUser = require('./middlewares/authUser');
const optionalAuthUser = require('./middlewares/optionalAuthUser');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user'); 
const statsRoutes = require("./routes/stats");
const Reserva = require('./models/Reserva');


const app = express();

app.set("trust proxy", 1);

function formatearFechaDDMMYYYY(fecha) {
  const s = String(fecha || '').trim();

  // YYYY-MM-DD → DD/MM/YYYY
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, y, mm, dd] = m;
    return `${dd}/${mm}/${y}`;
  }

  return s;
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : [];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // permite Postman o llamadas internas

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log("❌ CORS bloqueado para:", origin);
    return callback(new Error("CORS no permitido"));
  },
  methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
}));


// ============================================
// 📌 BODY PARSER (importante para POST/JSON)
// ============================================
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));


// ============================================
// 🔥 NO PONER MÁS CORS DESPUÉS DE ESTE PUNTO
// ============================================


// ============================================
// 📍 Rutas antes que nada
// ============================================
app.use("/api/club", clubRoutes);
app.use("/api/stats", statsRoutes);
app.use('/ubicaciones', ubicacionesRoute);
app.use('/superadmin', superadminRoutes);


// ============================================
// MercadoPago config
// ============================================
mercadopago.configure({ access_token: process.env.MP_ACCESS_TOKEN });


// ============================================
// Protección de rate limit
// ============================================
const sensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.post('/login', sensitiveLimiter);

app.use('/login-club', sensitiveLimiter);
app.use('/api/mercadopago', sensitiveLimiter);
app.use('/auth', sensitiveLimiter, authRoutes);
app.use('/api/me', userRoutes);


// ============================================
// Conexión MongoDB
// ============================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🟢 Conectado a MongoDB Atlas'))
  .catch(err => console.error('🔴 Error de conexión a MongoDB', err));


// Crear reserva pendiente y enviar email de confirmación
app.post('/reservas/hold', optionalAuthUser, async (req, res) => {
  try {
const { canchaId, fecha, hora, usuarioId: usuarioIdBody, email: emailBody, metodoPago } = req.body;
    let usuarioId = null;
    let email = String(emailBody || '').trim().toLowerCase();

    if (req.userId) {
      const usuarioAutenticado = await Usuario.findById(req.userId).select('_id email').lean();
      if (!usuarioAutenticado) return res.status(401).json({ error: 'Usuario no encontrado' });
      usuarioId = usuarioAutenticado._id;
      email = usuarioAutenticado.email;
    } else {
      usuarioId = usuarioIdBody || null;
    }

    if (!canchaId || !fecha || !hora || !email) {
      return res.status(400).json({ error: 'Faltan datos obligatorios.' });
    }

    const codigoOTP = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000);

    const reserva = new Reserva({
      canchaId,
      fecha,
      hora,
      usuarioId,
      emailContacto: email,
      metodoPago: (metodoPago === 'online' ? 'online' : 'efectivo'), // ✅ guarda online o efectivo
      estado: 'PENDING',
      codigoOTP,
      expiresAt
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
      console.error('⚠️ No se pudo calcular precio para el mail de reserva:', e);
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

    res.json({ mensaje: 'Te enviamos un email para confirmar tu reserva.', reservaId: reserva._id });
  } catch (error) {
    console.error('❌ Error en /reservas/hold:', error);
    res.status(500).json({ error: 'Error al crear reserva pendiente.' });
  }
});


// ===============================
// 🔁 REENVIAR CORREO DE CONFIRMACIÓN
// ===============================
app.post('/reservas/reenviar-confirmacion', (req, res) => {
  return res.status(410).json({
    error: 'Ruta antigua. Usá POST /api/me/reservas/:id/resend-confirmation.'
  });
});


// Confirmar reserva desde el enlace del correo
app.get('/reservas/confirmar/:id/:code', async (req, res) => {
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

    // 3) Confirmar reserva
    reserva.estado = 'CONFIRMED';
    await reserva.save();

    // ✅ IMPORTANTE: impactar la reserva en Turno (lo que ve el panel del club)
    // Si el Turno NO existe, lo creamos (porque /turnos-generados no guarda turnos en DB)

    const cancha = await Cancha.findById(reserva.canchaId);
    if (!cancha) {
      console.log('❌ No se encontró Cancha para crear Turno:', reserva.canchaId);
      return res.send('❌ No se encontró la cancha para confirmar la reserva.');
    }

    const emailReservadoFinal = (reserva.emailContacto || '').trim();
    if (!emailReservadoFinal) {
      console.log('❌ Reserva sin emailContacto:', reserva._id);
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
      console.error('⚠️ No se pudo calcular precio al confirmar:', e);
    }

    // Buscar turno existente por canchaId+fecha+hora
    let turno = await Turno.findOne({
      canchaId: reserva.canchaId,
      fecha: reserva.fecha,
      hora: reserva.hora
    });

    if (!turno) {
      // ✅ Crear turno nuevo (esto es lo que faltaba)
      turno = new Turno({
        deporte: cancha.deporte,
        fecha: reserva.fecha,
        club: cancha.clubEmail, // 👈 clave para que el panel del club lo encuentre
        hora: reserva.hora,
        precio: precioCalculado,
        usuarioReservado: emailReservadoFinal,
        emailReservado: emailReservadoFinal,
        usuarioId: usuario?._id || null,
        pagado: false,
        canchaId: reserva.canchaId
      });
    } else {
      // ✅ Si ya existía, lo marcamos reservado
      turno.usuarioReservado = emailReservadoFinal;
      turno.emailReservado = emailReservadoFinal;
      turno.usuarioId = usuario?._id || turno.usuarioId || null;
      turno.pagado = false;
      turno.precio = precioCalculado;
    }

    // Guardar método de pago si existe (por ahora, si no vino, queda efectivo)
    turno.metodoPago = reserva.metodoPago || turno.metodoPago || 'efectivo';

    await turno.save();
    console.log('✅ Turno guardado/actualizado como reservado:', turno._id);

    // 4) Si eligió MercadoPago -> crear preferencia y redirigir
    console.log('🧾 CONFIRM metodoPago reserva:', reserva.metodoPago);
    console.log('🧾 CONFIRM metodoPago turno:', turno.metodoPago);

    const metodoFinal = (turno.metodoPago || reserva.metodoPago || 'efectivo');
    console.log('🧾 CONFIRM metodoFinal:', metodoFinal);

    if (metodoFinal !== 'online') {
      console.log('🚫 NO entra a MercadoPago porque metodoFinal es:', metodoFinal);
    } else {
      console.log('✅ ENTRA a MercadoPago (metodoFinal=online)');
    }

    if (metodoFinal === 'online') {
      // ✅ cobrar en la cuenta del CLUB dueño de la cancha
      const clubData = await Club.findOne({ email: cancha.clubEmail });
      if (!clubData || !clubData.mercadoPagoAccessToken) {
        return res
          .status(400)
          .send('❌ El club no tiene configurado su Access Token de MercadoPago.');
      }

      mercadopago.configure({ access_token: clubData.mercadoPagoAccessToken });
      console.log('🏦 MP cobrador (club):', clubData.email);
      console.log('🏦 Token de MercadoPago del club cargado correctamente');

      // ✅ pasar club + turno al webhook para que pueda usar el token del club
      const clubEmailEnc = encodeURIComponent(String(clubData.email || cancha.clubEmail || ''));
      const turnoIdEnc = encodeURIComponent(String(turno._id));
      const notificationUrl = `https://api.canchalibre.ar/api/mercadopago/webhook?club=${clubEmailEnc}&turno=${turnoIdEnc}`;

      const preference = {
        items: [
          {
            title: `Reserva CanchaLibre`,
            quantity: 1,
            currency_id: 'ARS',
            unit_price: Number(turno.precio || 0),
          }
        ],

        // ✅ IMPORTANTE: que sea el TURNO (así el webhook lo encuentra y marca pagado)
        external_reference: String(turno._id),

        back_urls: {
          success: `${process.env.FRONT_URL}/mp-success.html?turno=${turno._id}`,
          pending: `${process.env.FRONT_URL}/mp-pending.html?turno=${turno._id}`,
          failure: `${process.env.FRONT_URL}/mp-failure.html?turno=${turno._id}`
        },

        auto_return: 'approved',
        notification_url: notificationUrl,
      };

      let resp;
      try {
        resp = await mercadopago.preferences.create(preference);
      } catch (e) {
        console.error('❌ Error creando preferencia MP:', e?.message || e);
        console.error('❌ Detalle MP:', e?.response?.data || e);
        return res.status(500).send('❌ Error creando preferencia de MercadoPago.');
      }

      const body = resp?.body || {};

      console.log('💰 MP collector_id:', body?.collector_id);
      console.log('🔗 MP init_point:', body?.init_point);
      console.log('🔗 MP sandbox_init_point:', body?.sandbox_init_point);

      const tokenClub = String(clubData?.mercadoPagoAccessToken || '');
      const esSandbox = tokenClub.startsWith('TEST-');

      const urlCheckout = esSandbox ? body.sandbox_init_point : body.init_point;

      console.log('🧪 MP modo:', esSandbox ? 'SANDBOX' : 'PRODUCCION');
      console.log('🔗 MP redirect:', urlCheckout);

      if (!urlCheckout) {
        return res.status(500).send('❌ MercadoPago no devolvió URL de checkout.');
      }

      return res.redirect(urlCheckout);
    }

    // 5) Si es efectivo -> volver al front
    return res.redirect(`${process.env.FRONT_URL}/reserva-confirmada.html?id=${reserva._id}`);

  } catch (error) {
    console.error('❌ Error en confirmación de reserva:', error);
    return res.status(500).send('Error confirmando la reserva');
  }
});



// 📨 Reenviar correo de confirmación de reserva
app.post('/reservas/:id/reenviar', (req, res) => {
  return res.status(410).json({ error: 'Ruta antigua. Usá POST /api/me/reservas/:id/resend-confirmation.' });
});

/* LEGACY RESEND
app.post('/reservas/:id/reenviar', async (req, res) => {
  try {
    const reserva = await Reserva.findById(req.params.id);
    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada.' });

    if (reserva.estado !== 'PENDING') {
      return res.status(400).json({ error: 'Solo se pueden reenviar reservas pendientes.' });
    }

    // Renovar vencimiento y OTP
    reserva.expiresAt = new Date(Date.now() + 10 * 60000);
    reserva.codigoOTP = Math.floor(100000 + Math.random() * 900000).toString();
    await reserva.save();

    // 🟦 Info de cancha y club
    const cancha = await Cancha.findById(reserva.canchaId);
    let club = null;
    if (cancha && cancha.clubEmail) {
      club = await Club.findOne({ email: cancha.clubEmail });
    }

    // 🟦 Calcular precio estimado
    let precioCalculado = null;
    try {
      const [Y, M, D] = String(reserva.fecha).split('-').map(Number);
      const [h, m] = String(reserva.hora).split(':').map(Number);
      const inicioReserva = new Date(Y, M - 1, D, h, m || 0, 0, 0);
      if (cancha) {
        precioCalculado = calcularPrecioTurno(cancha, inicioReserva);
      }
    } catch (e) {
      console.error('⚠️ No se pudo calcular precio en /reservas/:id/reenviar:', e);
    }

    const link = `${process.env.FRONT_URL}/confirmar-reserva.html?id=${reserva._id}&code=${reserva.codigoOTP}`;

    const html = `
      <h2>Confirmación de tu reserva</h2>
      <p>Estos son los datos de tu reserva pendiente:</p>
      <ul>
        <li><strong>Club:</strong> ${club ? club.nombre : 'A confirmar'}</li>
        <li><strong>Cancha:</strong> ${cancha ? cancha.nombre : 'Sin nombre'}</li>
        <li><strong>Deporte:</strong> ${cancha ? cancha.deporte : ''}</li>
        <li><strong>Fecha:</strong> ${reserva.fecha}</li>
        <li><strong>Hora:</strong> ${reserva.hora}</li>
        ${precioCalculado !== null ? `<li><strong>Precio estimado:</strong> $${precioCalculado}</li>` : ''}
      </ul>

      <hr/>

      <p>Hacé clic en este enlace para confirmar tu reserva (vence en 10 minutos):</p>
      <p><a href="${link}">${link}</a></p>
    `;

    await sendMail(reserva.emailContacto, 'Confirmá tu reserva en CanchaLibre', html);

    res.json({ mensaje: 'Correo reenviado correctamente.' });
  } catch (error) {
    console.error('❌ Error en /reservas/:id/reenviar:', error);
    res.status(500).json({ error: 'Error al reenviar correo de confirmación.' });
  }
});



// 🗑️ Cancelar una reserva pendiente
app.patch('/reservas/:id/cancelar', (req, res) => {
  return res.status(410).json({ error: 'Ruta antigua. Usá PATCH /api/me/reservas/:id/cancel.' });
});

/* LEGACY CANCEL PENDING
app.patch('/reservas/:id/cancelar', async (req, res) => {
  try {
    const reserva = await Reserva.findById(req.params.id);
    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada.' });

    if (reserva.estado !== 'PENDING') {
      return res.status(400).json({ error: 'Solo se pueden cancelar reservas pendientes.' });
    }

    reserva.estado = 'CANCELLED';
    await reserva.save();

    res.json({ mensaje: 'Reserva pendiente cancelada correctamente.' });
  } catch (error) {
    console.error('❌ Error al cancelar reserva pendiente:', error);
    res.status(500).json({ error: 'Error al cancelar la reserva pendiente.' });
  }
});
*/


// Tarea automática: cada 5 minutos revisa clubes con destaque vencido y lo desactiva
cron.schedule('*/5 * * * *', async () => {
    console.log("CRON corriendo...");
    try {
        const now = new Date();
        const clubesVencidos = await Club.find({
            destacado: true,
            destacadoHasta: { $lt: now }
        });
        for (let club of clubesVencidos) {
            club.destacado = false;
            club.destacadoHasta = null;
            await club.save();
            console.log(`⏰ Club ${club.nombre} perdió el destaque automáticamente`);
        }
    } catch (error) {
        console.error('❌ Error en tarea automática de destaque:', error);
    }
});

// 🕒 CRON: Expirar reservas pendientes (cada 2 minutos)
cron.schedule('*/2 * * * *', async () => {
  try {
    const ahora = new Date();
    const expiradas = await Reserva.updateMany(
      { estado: 'PENDING', expiresAt: { $lt: ahora } },
      { $set: { estado: 'EXPIRED' } }
    );

    if (expiradas.modifiedCount > 0) {
      console.log(`⏰ ${expiradas.modifiedCount} reservas pendientes expiraron automáticamente.`);
    }
  } catch (error) {
    console.error('❌ Error en CRON de expiración de reservas:', error);
  }
});



function quitarAcentos(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getDiaNombre(fecha) {
    const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return dias[new Date(fecha).getDay()];
}
// ===== Precio nocturno (usa campos del modelo Cancha) =====
function calcularPrecioTurno(cancha, inicioTurnoDate) {
  // nocturnoDesde: 0-23, precioNocturno: Number|null
  const hora = inicioTurnoDate.getHours();
  if (cancha.nocturnoDesde !== null && typeof cancha.nocturnoDesde === 'number') {
    if (hora >= cancha.nocturnoDesde) {
      if (typeof cancha.precioNocturno === 'number' && !Number.isNaN(cancha.precioNocturno)) {
        return cancha.precioNocturno;
      }
    }
  }
  return cancha.precio;
}
// ✅ RUTA PARA OBTENER LAS RESERVAS DE UN USUARIO POR EMAIL

// ✅ Mostrar reservas confirmadas y pendientes del usuario
app.get('/reservas-usuario/:email', (req, res) => {
  return res.status(410).json({ error: 'Ruta antigua. Usá GET /api/me/reservas.' });
});

/* LEGACY USER RESERVATIONS
app.get('/reservas-usuario/:email', async (req, res) => {
  try {
    const email = req.params.email.trim();

    // Confirmadas (en Turno)
    const reservasConfirmadas = await Turno.find({
      emailReservado: { $regex: new RegExp(`^${email}$`, 'i') }
    }).lean();

    // Pendientes (en Reserva)
    const reservasPendientes = await Reserva.find({
      emailContacto: { $regex: new RegExp(`^${email}$`, 'i') },
      estado: 'PENDING'
    }).lean();

    // ✅ Armar array final (primero)
    let reservasFinales = await Promise.all([
      ...reservasConfirmadas.map(async (r) => {
        const club = await Club.findOne({ email: r.club }).select('nombre').lean();
        return {
          ...r,
          nombreClub: club?.nombre || 'Club desconocido',
          tipo: 'CONFIRMED'
        };
      }),
      ...reservasPendientes.map(async (r) => {
        const cancha = r.canchaId ? await Cancha.findById(r.canchaId).select('clubEmail nombre').lean() : null;
        const club = cancha ? await Club.findOne({ email: cancha.clubEmail }).select('nombre').lean() : null;
        return {
          ...r,
          nombreClub: club?.nombre || 'Club desconocido',
          tipo: 'PENDING',
          // 👇 opcional: ya le ponemos nombreCancha acá para pendientes
          nombreCancha: cancha?.nombre || null
        };
      })
    ]);

    // ✅ Resolver nombre de cancha también para confirmadas (y por las dudas para todas)
    const canchaIds = [...new Set(
      reservasFinales.map(r => r.canchaId).filter(Boolean).map(id => String(id))
    )];

    if (canchaIds.length) {
      const canchas = await Cancha.find({ _id: { $in: canchaIds } })
        .select('_id nombre')
        .lean();

      const canchaMap = new Map(canchas.map(c => [String(c._id), c.nombre]));

      reservasFinales = reservasFinales.map(r => ({
        ...r,
        nombreCancha: r.nombreCancha || (r.canchaId ? (canchaMap.get(String(r.canchaId)) || null) : null)
      }));
    }

    return res.json(reservasFinales);
  } catch (error) {
    console.error('Error en /reservas-usuario:', error);
    return res.status(500).json({ error: 'Error al obtener reservas del usuario' });
  }
});
*/




// ✅ NUEVA RUTA: guardar access token del club usando el ID
app.put('/club/:id/access-token', authClub, async (req, res) => {
  try {
    const clubId = (req.params.id || '').trim();
    const { accessToken } = req.body;

    if (clubId !== String(req.clubId)) {
      return res.status(403).json({ error: 'No autorizado para modificar este club' });
    }

    if (typeof accessToken !== 'string' || accessToken.trim().length < 10) {
      return res.status(400).json({ error: 'Access Token inválido' });
    }

    console.log("📩 Solicitud de guardado Access Token para club:", clubId);

    const club = await Club.findByIdAndUpdate(
      clubId,
      { mercadoPagoAccessToken: accessToken },
      { new: true }
    );

    if (!club) {
      console.log("❌ No se encontró un club con ese ID.");
      return res.status(404).json({ error: 'No se encontró un club con ese ID' });
    }

    console.log("✅ Access Token guardado correctamente para club:", clubId);

    res.json({ mensaje: 'Access Token guardado correctamente' });

  } catch (error) {
    console.error("🔥 Error al guardar Access Token:", error);
    res.status(500).json({ error: 'Error al guardar Access Token' });
  }
});



// ✅ NUEVA RUTA: reservar turno
app.post(
  '/reservar-turno',
  celebrate({
    [Segments.BODY]: Joi.object({
      deporte: Joi.string().max(40).required(),
      fecha: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      club: Joi.string().max(100).required(),
      hora: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
      precio: Joi.number().min(0).required(),
      usuarioReservado: Joi.string().max(100).required(),
      emailReservado: Joi.string().email().required(),
      metodoPago: Joi.string().valid('online','efectivo').required(),
      canchaId: Joi.string().required()
    })
  }),
  async (req, res) => {
     console.log('📦 Body recibido en /reservar-turno:', req.body);
    const { deporte, fecha, club, hora, precio, usuarioReservado, emailReservado, metodoPago, canchaId } = req.body;

    try {
      console.log('📦 Datos validados en /reservar-turno:', req.body);

      // ✅ Buscar el teléfono del usuario automáticamente
      const usuario = await Usuario.findOne({ email: emailReservado });

      // 🔹 Recalcular precio según la cancha y la hora solicitada
      const cancha = await Cancha.findById(canchaId);
      if (!cancha) return res.status(404).json({ error: 'Cancha no encontrada' });

      const [Y, M, D] = fecha.split('-').map(Number);
      const [h, mm] = hora.split(':').map(Number);
      const inicioReserva = new Date(Y, (M - 1), D, h, mm, 0, 0);
      const precioCalculado = calcularPrecioTurno(cancha, inicioReserva);

      const turnoExistente = await Turno.findOne({ deporte, fecha, hora, club, canchaId });

      let turno;
      if (turnoExistente) {
        // ✅ ACTUALIZAR TURNO YA GENERADO
        turnoExistente.usuarioReservado = usuarioReservado;
        turnoExistente.emailReservado   = emailReservado;
        turnoExistente.pagado           = false;
        turnoExistente.canchaId         = canchaId;
        turnoExistente.precio           = precioCalculado;

        // 👈 NUEVO: guardar también el usuarioId
        if (usuario?._id) {
          turnoExistente.usuarioId = usuario._id;
        }

        await turnoExistente.save();
        turno = turnoExistente;
      } else {
        // ✅ CREAR TURNO NUEVO
        turno = new Turno({
          deporte,
          fecha,
          club,
          hora,
          precio: precioCalculado,
          usuarioReservado,
          emailReservado,
          usuarioId: usuario?._id,   // ya estaba bien
          pagado: false,
          canchaId
        });
        await turno.save();
      }


if (metodoPago === 'online') {
  const clubData = await Club.findOne({ email: club });
  if (!clubData || !clubData.mercadoPagoAccessToken) {
    return res.status(400).json({ error: 'El club no tiene configurado su Access Token' });
  }

  mercadopago.configure({ access_token: clubData.mercadoPagoAccessToken });

  const preference = {
    items: [{
      title: `Reserva de cancha - ${deporte}`,
      quantity: 1,
      currency_id: 'ARS',
      unit_price: precioCalculado
    }],
notification_url: 'https://api.canchalibre.ar/api/mercadopago/webhook',
    external_reference: turno._id.toString()
  };

  const response = await mercadopago.preferences.create(preference);
  return res.json({ mensaje: 'Turno reservado. Link de pago generado.', pagoUrl: response.body.init_point });
}

if (metodoPago === 'efectivo') {
  return res.json({ mensaje: 'Turno reservado. Pago pendiente en efectivo.' });
}

    } catch (error) {
      console.error('❌ Error en /reservar-turno:', error);
      res.status(500).json({ error: 'Error al reservar turno' });
    }
  }
);


// ✅ WEBHOOK MP (multi-club) con idempotencia y token por club
app.post('/api/mercadopago/webhook', async (req, res) => {
  try {
    const paymentId = req.query.id || req.body?.data?.id;
    if (!paymentId) return res.sendStatus(200);

    const turnoIdFromQuery = req.query.turno ? String(req.query.turno).trim() : null;
    const clubEmailFromQuery = req.query.club ? String(req.query.club).trim() : null;

    // ✅ Idempotencia persistente en DB
    const yaExiste = await PaymentEvent.findOne({ paymentId });
    if (yaExiste) return res.sendStatus(200);

    // Registrar como procesado ANTES de continuar
    await PaymentEvent.create({ paymentId });

    // 1) Resolver TURNO (primero por query, luego por external_reference, luego por pagoId)
    let turno = null;

    if (turnoIdFromQuery) {
      try { turno = await Turno.findById(turnoIdFromQuery); } catch (_) {}
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
      console.log('⚠️ Webhook sin club token. paymentId:', paymentId, 'club:', clubEmailFromQuery, 'turno:', turnoIdFromQuery);
      return res.sendStatus(200);
    }

    // ✅ Configurar MP con token del club dueño
    mercadopago.configure({ access_token: clubData.mercadoPagoAccessToken });

    // Traer el pago desde MP (con el token del club correcto)
    const resp = await mercadopago.payment.findById(paymentId);
    const payment = resp?.body || {};
    const status = payment.status;
    const externalRef = payment.external_reference;

    // Si todavía no encontramos turno, intentamos con external_reference
    if (!turno && externalRef) {
      try { turno = await Turno.findById(String(externalRef)); } catch (_) {}
    }

    // Fallback: buscar por pagoId
    if (!turno) {
      turno = await Turno.findOne({ pagoId: paymentId }).catch(() => null);
    }

    if (!turno) {
      console.log('⚠️ Webhook: no se encontró turno. paymentId:', paymentId, 'external_reference:', externalRef);
      return res.sendStatus(200);
    }

    // ✅ Marcar pagado si approved
    if (status === 'approved') {
      if (!turno.pagado) {
        turno.pagado = true;
        turno.fechaPago = new Date();
        turno.pagoId = paymentId;
        turno.pagoMetodo =
          payment.payment_method?.type ||
          payment.payment_type_id ||
          payment.payment_method_id ||
          'mercadopago';

        await turno.save();
        console.log('✅ Webhook: turno marcado como PAGADO:', String(turno._id), 'club:', clubData.email);
      } else {
        console.log('ℹ️ Webhook: turno ya estaba pagado:', String(turno._id));
      }
    } else if (status === 'rejected' || status === 'cancelled') {
      console.log('ℹ️ Webhook: pago no aprobado:', status, 'turno:', String(turno._id));
      // acá podés decidir si liberás turno o lo dejás pendiente
    } else {
      console.log('ℹ️ Webhook: status intermedio:', status, 'turno:', String(turno._id));
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error procesando webhook MP:', error);
    return res.sendStatus(500);
  }
});





// ✅ TUS RUTAS ORIGINALES:

app.post('/registro-club', async (req, res) => {
  const {
    email,
    password,
    nombre,
    telefono,
    direccion,
    latitud,
    longitud,
    provincia,
    localidad
  } = req.body;

  // ✅ Validar complejidad de la contraseña
  if (!password || password.length < 6 || !/\d/.test(password) || !/[A-Za-z]/.test(password)) {
    return res.status(400).json({
      error: 'La contraseña debe tener al menos 6 caracteres e incluir una letra y un número.'
    });
  }

  // ✅ Validación robusta (acepta coordenadas negativas)
  if (
    !email || !password || !nombre || !telefono ||
    !provincia || !localidad ||
    latitud === undefined || longitud === undefined ||
    latitud === null || longitud === null ||
    Number.isNaN(Number(latitud)) || Number.isNaN(Number(longitud))
  ) {
    return res
      .status(400)
      .json({ error: 'Faltan campos obligatorios para registrar el club' });
  }

  try {
    const existe = await Club.findOne({ email });
    if (existe)
      return res.status(400).json({ error: 'El club ya está registrado' });

    // ✅ Encriptar contraseña correctamente
    const hash = await bcrypt.hash(password, 10);

    // ✅ Asegurar que las coordenadas se guarden como números reales
    const latNum = parseFloat(latitud);
    const lonNum = parseFloat(longitud);

    // ✅ Generar token de verificación (24 hs de validez)
    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 horas

    // ✅ Crear y guardar nuevo club con campos de verificación
    const nuevoClub = new Club({
      email,
      passwordHash: hash,
      nombre,
      telefono,
      direccion,
      latitud: latNum,
      longitud: lonNum,
      provincia,
      localidad,
      emailVerificado: false,
      tokenVerificacion: token,
      tokenVerificacionExpira: expira
    });

    await nuevoClub.save();

    // ✅ Armar link de verificación (FRONT_URL ya lo usás en otros lados)
    const linkVerificacion = `${process.env.FRONT_URL}/verificar-club.html?token=${token}&email=${encodeURIComponent(email)}`;

    const html = `
      <h2>Verificá tu cuenta de club</h2>
      <p>Hola ${nombre} 👋</p>
      <p>Para activar tu acceso al panel de clubes de CanchaLibre, verificá tu email haciendo clic en el siguiente enlace:</p>
      <p><a href="${linkVerificacion}" style="color:#2c7be5;">Verificar cuenta</a></p>
      <p>Si no creaste esta cuenta, podés ignorar este mensaje.</p>
    `;

    // ✅ Usamos la misma función de envío de mail que ya tenés configurada (Brevo)
    await sendMail(email, 'Verificación de cuenta - CanchaLibre', html);

    // ✅ Mensaje al frontend
    res.json({
      mensaje: 'Club registrado. Revisá tu email para verificar la cuenta antes de iniciar sesión.'
    });
  } catch (error) {
    console.error('❌ Error en /registro-club:', error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        error:
          'Todos los campos obligatorios deben completarse correctamente.'
      });
    }

    res.status(500).json({ error: 'Error al registrar club' });
  }
});


app.put('/club/:id', authClub, async (req, res) => {
    const { nombre, telefono, provincia, localidad } = req.body;

    if (String(req.params.id) !== String(req.clubId)) {
        return res.status(403).json({ error: 'No autorizado para modificar este club' });
    }

    try {
        const club = await Club.findByIdAndUpdate(
            req.clubId,
            { nombre, telefono, provincia, localidad },
            { new: true }
        ).select('nombre email telefono provincia localidad latitud longitud destacado destacadoHasta activo');

        if (!club) return res.status(404).json({ error: 'Club no encontrado' });
        res.json({ ok: true, club });
    } catch (err) {
        console.error('❌ Error al actualizar club:', err.message);
        res.status(500).json({ error: 'Error al actualizar club' });
    }
});




const jwt = require('jsonwebtoken'); // ✅ Asegurate de tener esto arriba del archivo

app.post('/login-club', async (req, res) => {
  const { email, password } = req.body;

  try {
    console.log('📩 Intento de login de club:', email);

    const club = await Club.findOne({ email });
    if (!club) {
      return res.status(400).json({ error: 'Club no encontrado' });
    }

    // 🔐 Verificar que el email esté confirmado
    if (!club.emailVerificado) {
      return res.status(403).json({
        error: 'Debés verificar tu correo antes de iniciar sesión. Revisá tu email de verificación.'
      });
    }

    const match = await bcrypt.compare(password, club.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // ✅ Generar token JWT (ya lo tenés requerido arriba)
    const token = jwt.sign(
      { clubId: club._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      mensaje: 'Login exitoso',
      token,
      clubId: club._id,
      nombre: club.nombre,
      email: club.email
    });

  } catch (error) {
    console.error('❌ Error en /login-club:', error);
    res.status(500).json({ error: 'Error al iniciar sesión del club' });
  }
});

app.post('/club/reenviar-verificacion', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Falta el email.' });
    }

    const club = await Club.findOne({ email });
    if (!club) {
      return res.status(404).json({ error: 'No existe un club registrado con ese email.' });
    }

    // ✅ Si ya está verificado, no tiene sentido reenviar
    if (club.emailVerificado) {
      return res.status(400).json({ error: 'Este correo ya fue verificado. Ya podés iniciar sesión.' });
    }

    // ✅ Generar nuevo token y nueva expiración (24hs)
    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 horas

    club.tokenVerificacion = token;
    club.tokenVerificacionExpira = expira;
    await club.save();

    // ✅ Armar link de verificación (usamos FRONT_URL como en el registro)
    const linkVerificacion = `${process.env.FRONT_URL}/verificar-club.html?token=${token}&email=${encodeURIComponent(email)}`;

    const html = `
      <h2>Verificá tu cuenta de club</h2>
      <p>Hola ${club.nombre} 👋</p>
      <p>Te enviamos nuevamente el enlace para verificar tu email y activar el acceso al panel de clubes de CanchaLibre.</p>
      <p><a href="${linkVerificacion}" style="color:#2c7be5;">Verificar cuenta</a></p>
      <p>Si no creaste esta cuenta, podés ignorar este mensaje.</p>
    `;

    await sendMail(email, 'Reenvío de verificación - CanchaLibre', html);

    res.json({
      ok: true,
      mensaje: 'Te reenviamos el mail de verificación. Revisá tu bandeja de entrada o el correo no deseado.'
    });

  } catch (error) {
    console.error('❌ Error en /club/reenviar-verificacion:', error);
    res.status(500).json({ error: 'Error al reenviar el mail de verificación.' });
  }
});



app.get('/verificar-club', async (req, res) => {
  try {
    const { email, token } = req.query;

    if (!email || !token) {
      return res.status(400).json({ error: 'Faltan parámetros.' });
    }

    const club = await Club.findOne({ email });

    if (!club) {
      return res.status(404).json({ error: 'Club no encontrado.' });
    }

    // 🔍 Validar token
    if (
      !club.tokenVerificacion ||
      club.tokenVerificacion !== token ||
      !club.tokenVerificacionExpira ||
      club.tokenVerificacionExpira < new Date()
    ) {
      return res.status(400).json({ error: 'Token inválido o expirado.' });
    }

    // ✨ Marcar como verificado
    club.emailVerificado = true;
    club.tokenVerificacion = null;
    club.tokenVerificacionExpira = null;
    club.emailVerificadoEn = new Date();

    await club.save();

    res.json({ ok: true, mensaje: 'Cuenta verificada correctamente.' });

  } catch (error) {
    console.error('❌ Error en /verificar-club:', error);
    res.status(500).json({ error: 'Error al verificar cuenta.' });
  }
});




app.get('/club/:email', async (req, res) => {
    try {
        const club = await Club.findOne({ email: req.params.email });
        if (!club) return res.status(404).json({ error: 'Club no encontrado' });
        res.json(club);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener club' });
    }
});

app.put('/editar-ubicacion-club', async (req, res) => {
    const { email, latitud, longitud } = req.body;
    try {
        await Club.findOneAndUpdate({ email }, { latitud, longitud });
        res.json({ mensaje: 'Ubicación actualizada correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar ubicación' });
    }
});

app.get('/canchas/:clubEmail', async (req, res) => {
    try {
        const canchas = await Cancha.find({ clubEmail: req.params.clubEmail });
        res.json(canchas);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener canchas' });
    }
});

app.post('/canchas', authClub, async (req, res) => {
  const { 
    nombre, deporte, precio, horaDesde, horaHasta, 
    diasDisponibles, clubEmail, duracionTurno,
    nocturnoDesde, precioNocturno
  } = req.body;

  // ✅ Validaciones obligatorias
  if (!nombre || !deporte || !precio || !horaDesde || !horaHasta || !clubEmail) {
    return res.status(400).json({ error: 'Faltan campos obligatorios para crear la cancha.' });
  }

  if (isNaN(precio) || Number(precio) <= 0) {
    return res.status(400).json({ error: 'El precio debe ser un número mayor que 0.' });
  }

  const desde = parseInt(horaDesde.split(':')[0]);
  const hasta = parseInt(horaHasta.split(':')[0]);
  if (hasta <= desde) {
    return res.status(400).json({ error: 'El horario "Hasta" debe ser mayor que el horario "Desde".' });
  }

  try {
    const nuevaCancha = new Cancha({
      nombre,
      deporte,
      precio,
      horaDesde,
      horaHasta,
      diasDisponibles: Array.isArray(diasDisponibles) ? diasDisponibles : [],
      clubEmail,
      duracionTurno: Number(duracionTurno) || 60,
      nocturnoDesde: (nocturnoDesde === '' || nocturnoDesde === null || nocturnoDesde === undefined) ? null : Number(nocturnoDesde),
      precioNocturno: (precioNocturno === '' || precioNocturno === null || precioNocturno === undefined) ? null : Number(precioNocturno)
    });

    await nuevaCancha.save();
    res.json({ mensaje: 'Cancha agregada correctamente' });
  } catch (error) {
    console.error('❌ Error al agregar cancha:', error);
    res.status(500).json({ error: 'Error al agregar cancha' });
  }
});




app.put('/canchas/:id', authClub, async (req, res) => {
  try {
    const { 
      nombre, deporte, precio, horaDesde, horaHasta, 
      diasDisponibles, clubEmail, duracionTurno,
      nocturnoDesde, precioNocturno
    } = req.body;

    // ✅ Validaciones obligatorias
    if (!nombre || !deporte || !precio || !horaDesde || !horaHasta || !clubEmail) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para actualizar la cancha.' });
    }

    if (isNaN(precio) || Number(precio) <= 0) {
      return res.status(400).json({ error: 'El precio debe ser un número mayor que 0.' });
    }

    const desde = parseInt(horaDesde.split(':')[0]);
    const hasta = parseInt(horaHasta.split(':')[0]);
    if (hasta <= desde) {
      return res.status(400).json({ error: 'El horario "Hasta" debe ser mayor que el horario "Desde".' });
    }

    const cancha = await Cancha.findById(req.params.id);
    if (!cancha) return res.status(404).json({ error: 'Cancha no encontrada' });
    if (String(cancha.clubEmail).toLowerCase() !== String(req.clubEmail).toLowerCase()) {
      return res.status(403).json({ error: 'No autorizado para modificar esta cancha' });
    }

    const update = {
      nombre,
      deporte,
      precio,
      horaDesde,
      horaHasta,
      diasDisponibles: Array.isArray(diasDisponibles) ? diasDisponibles : [],
      clubEmail: req.clubEmail,
      duracionTurno: Number(duracionTurno) || 60,
      nocturnoDesde: (nocturnoDesde === '' || nocturnoDesde === null) ? null : Number(nocturnoDesde),
      precioNocturno: (precioNocturno === '' || precioNocturno === null) ? null : Number(precioNocturno)
    };

    await Cancha.findByIdAndUpdate(req.params.id, update);
    res.json({ mensaje: 'Cancha actualizada correctamente' });
  } catch (error) {
    console.error('❌ Error al actualizar cancha:', error);
    res.status(500).json({ error: 'Error al actualizar cancha' });
  }
});




app.delete('/canchas/:id', authClub, async (req, res) => {
    try {
        const cancha = await Cancha.findById(req.params.id);
        if (!cancha) return res.status(404).json({ error: 'Cancha no encontrada' });
        if (String(cancha.clubEmail).toLowerCase() !== String(req.clubEmail).toLowerCase()) {
            return res.status(403).json({ error: 'No autorizado para eliminar esta cancha' });
        }

        await Cancha.findByIdAndDelete(req.params.id);
        res.json({ mensaje: 'Cancha eliminada correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar cancha' });
    }
});

app.get('/turnos', async (req, res) => {
    try {
        const turnos = await Turno.find();
        res.json(turnos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener turnos' });
    }
});

app.put('/turnos/:id', authClub, async (req, res) => {
    try {
        const turno = await Turno.findOne({ _id: req.params.id, club: req.clubEmail });
        if (!turno) return res.status(404).json({ error: 'Turno no encontrado o no pertenece al club' });

        const camposPermitidos = ['deporte', 'fecha', 'hora', 'precio', 'usuarioReservado', 'emailReservado', 'pagado', 'metodoPago'];
        const update = {};
        for (const campo of camposPermitidos) {
            if (req.body[campo] !== undefined) update[campo] = req.body[campo];
        }

        await Turno.updateOne({ _id: turno._id }, update);
        res.json({ mensaje: 'Turno actualizado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar turno' });
    }
});

app.patch('/turnos/:id/cancelar', authClub, async (req, res) => {
    try {
        const turno = await Turno.findOne({ _id: req.params.id, club: req.clubEmail });
        if (!turno) return res.status(404).json({ error: 'Turno no encontrado o no pertenece al club' });

        await Turno.updateOne({ _id: turno._id }, {
            usuarioReservado: null,
            emailReservado: null,
            pagado: false
        });
        res.json({ mensaje: 'Reserva cancelada' });
    } catch (error) {
        res.status(500).json({ error: 'Error al cancelar reserva' });
    }
});


app.get('/turnos-generados', async (req, res) => {
  try {
    const { provincia, localidad } = req.query;

    // ====== Fecha base (YYYY-MM-DD) y semana Lunes->Domingo ======
    const fechaBase = req.query.fecha;

    let baseDate;
    if (fechaBase) {
      const [y, m, d] = fechaBase.split('-').map(Number);
      baseDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      baseDate = new Date();
      baseDate.setHours(0, 0, 0, 0);
    }

    let monday = new Date(baseDate);
    const dayNum = (monday.getDay() + 6) % 7; // 0=lun ... 6=dom
    monday.setDate(monday.getDate() - dayNum);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const mondayStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
    const sundayStr = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;

    // ====== Filtrar clubes por provincia/localidad (si aplica) ======
    const filtroClub = {};
    if (provincia) filtroClub.provincia = provincia;
    if (localidad) filtroClub.localidad = localidad;

    const clubes = (provincia || localidad)
      ? await Club.find(filtroClub).select('email nombre latitud longitud').lean()
      : await Club.find().select('email nombre latitud longitud').lean();

    const clubByEmail = new Map(clubes.map(c => [c.email, c]));
    const emailsClubes = clubes.map(c => c.email);

    // ====== Traer canchas YA filtradas (evita traer todo y filtrar en memoria) ======
    const canchasQuery = (provincia || localidad)
      ? { clubEmail: { $in: emailsClubes } }
      : {};

    const canchas = await Cancha.find(canchasQuery)
      .select('_id nombre deporte clubEmail diasDisponibles horaDesde horaHasta duracionTurno precio precioNocturno horaNocturna')
      .lean();

    const canchaIds = canchas.map(c => c._id);

    // ====== Traer SOLO turnos de esa semana y de esas canchas ======
    // Nota: fecha está guardada como string "YYYY-MM-DD", así que el rango funciona bien.
    const turnosReservados = await Turno.find({
      fecha: { $gte: mondayStr, $lte: sundayStr },
      canchaId: { $in: canchaIds }
    })
      .select('canchaId deporte club fecha hora usuarioReservado emailReservado pagado')
      .lean();

    // ====== Indexar reservas en Map (O(1)) en vez de .find() por cada slot ======
    const reservadosPorCanchaFechaHora = new Map();
    const reservadosLegacy = new Map(); // compatibilidad si alguna reserva vieja dependía de club/deporte

    for (const t of turnosReservados) {
      const key = `${String(t.canchaId)}|${t.fecha}|${t.hora}`;
      reservadosPorCanchaFechaHora.set(key, t);

      // fallback legacy (por si hay datos antiguos)
      const keyLegacy = `${t.deporte}|${t.club}|${t.fecha}|${t.hora}`;
      reservadosLegacy.set(keyLegacy, t);
    }

    // ====== Días de la semana ======
    const dias = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday.getTime());
      d.setDate(d.getDate() + i);
      return d;
    });

    const todosTurnos = [];

    for (const cancha of canchas) {
      const clubInfo = clubByEmail.get(cancha.clubEmail) || null;

      const diasDisponibles = (cancha.diasDisponibles || [])
        .map(x => quitarAcentos(String(x).toLowerCase().trim()));

      // Duración de turno en minutos (default 60)
      const duracion = Number(cancha.duracionTurno) || 60;

      const [dH, dM = 0] = String(cancha.horaDesde).split(':').map(n => parseInt(n, 10));
      const [hH, hM = 0] = String(cancha.horaHasta).split(':').map(n => parseInt(n, 10));

      const desdeMin = dH * 60 + dM;
      const hastaMin = hH * 60 + hM;

      for (const d of dias) {
        const fechaStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const diaNombre = quitarAcentos(getDiaNombre(d).toLowerCase().trim());

        if (!diasDisponibles.includes(diaNombre)) continue;

        for (let m = desdeMin; m + duracion <= hastaMin; m += duracion) {
          const h = Math.floor(m / 60);
          const min = m % 60;
          const hora = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

          const inicioDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, min, 0, 0);
          const precioCalculado = calcularPrecioTurno(cancha, inicioDate);

          // ✅ lookup O(1)
          const key = `${String(cancha._id)}|${fechaStr}|${hora}`;
          let reservado = reservadosPorCanchaFechaHora.get(key);

        

          todosTurnos.push({
            canchaId: cancha._id,
            nombreCancha: cancha.nombre,
            deporte: cancha.deporte,
            club: cancha.clubEmail,
            fecha: fechaStr,
            hora,
            precio: precioCalculado,
            usuarioReservado: reservado ? reservado.usuarioReservado : null,
            emailReservado: reservado ? reservado.emailReservado : null,
            pagado: reservado ? reservado.pagado : false,
            realId: reservado ? reservado._id : null,
            latitud: clubInfo ? clubInfo.latitud : null,
            longitud: clubInfo ? clubInfo.longitud : null,
            duracionTurno: cancha.duracionTurno || 60
          });
        }
      }
    }

    res.json(todosTurnos);
  } catch (error) {
    console.error('❌ Error en /turnos-generados:', error);
    res.status(500).json({ error: 'Error al generar turnos' });
  }
});




app.get('/reservas/:clubEmail', authClub, async (req, res) => {
    if (String(req.params.clubEmail).toLowerCase() !== String(req.clubEmail).toLowerCase()) {
        return res.status(403).json({ error: 'No autorizado para consultar este club' });
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
      _fechaStr: { $ifNull: ["$fecha", ""] },
      _horaStr: {
        $let: {
          vars: { h: { $ifNull: ["$hora", "00:00"] } },
          in: {
            // si viene algo raro como "08:00:" lo recortamos a HH:mm
            $cond: [
              { $regexMatch: { input: "$$h", regex: /^[0-2]\d:[0-5]\d$/ } },
              "$$h",
              {
                $let: {
                  vars: { p: { $split: ["$$h", ":"] } },
                  in: {
                    $concat: [
                      { $ifNull: [{ $arrayElemAt: ["$$p", 0] }, "00"] },
                      ":",
                      { $ifNull: [{ $arrayElemAt: ["$$p", 1] }, "00"] }
                    ]
                  }
                }
              }
            ]
          }
        }
      },
    },
  },
  {
    $addFields: {
      _isISO: { $regexMatch: { input: "$_fechaStr", regex: /^\d{4}-\d{2}-\d{2}$/ } },
      _fechaParts: {
        $cond: [
          { $regexMatch: { input: "$_fechaStr", regex: /^\d{4}-\d{2}-\d{2}$/ } },
          { $split: ["$_fechaStr", "-"] }, // YYYY-MM-DD
          { $split: ["$_fechaStr", "/"] }  // DD/MM/YYYY
        ]
      },
      _horaParts: { $split: ["$_horaStr", ":"] }
    },
  },
  {
    $addFields: {
      _year: {
        $cond: [
          "$_isISO",
          { $toInt: { $arrayElemAt: ["$_fechaParts", 0] } }, // YYYY
          { $toInt: { $arrayElemAt: ["$_fechaParts", 2] } }  // YYYY
        ]
      },
      _month: { $toInt: { $arrayElemAt: ["$_fechaParts", 1] } }, // MM
      _day: {
        $cond: [
          "$_isISO",
          { $toInt: { $arrayElemAt: ["$_fechaParts", 2] } }, // DD (en ISO es el 3er elem)
          { $toInt: { $arrayElemAt: ["$_fechaParts", 0] } }  // DD
        ]
      },
      _hour: { $toInt: { $ifNull: [{ $arrayElemAt: ["$_horaParts", 0] }, 0] } },
      _minute:{ $toInt: { $ifNull: [{ $arrayElemAt: ["$_horaParts", 1] }, 0] } },
    },
  },
  {
    $addFields: {
      fechaHoraOrden: {
        $dateFromParts: {
          year: "$_year",
          month: "$_month",
          day: "$_day",
          hour: "$_hour",
          minute: "$_minute",
          timezone: "America/Argentina/Buenos_Aires",
        }
      }
    }
  },
  { $sort: { fechaHoraOrden: 1 } }, // ascendente (más próximo primero)

  // === Traer datos de usuario (equivalente a populate)
  {
    $lookup: {
      from: "usuarios",
      localField: "usuarioId",
      foreignField: "_id",
      as: "usuarioDoc",
    },
  },
  { $unwind: { path: "$usuarioDoc", preserveNullAndEmptyArrays: true } },
];

const reservasOrdenadas = await Turno.aggregate(pipeline);

// Traer canchas para obtener el nombre
const canchas = await Cancha.find({ clubEmail: clubEmail });

// Agregar nombre de cancha y aplanar usuario
const reservasConNombre = reservasOrdenadas.map((r) => {
  const canchaMatch = canchas.find(
    (c) => c._id.equals(r.canchaId) || c._id.toString() === String(r.canchaId)
  );

  return {
    ...r,
    nombreCancha: canchaMatch ? canchaMatch.nombre : "Sin nombre",
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
    usuarioNombre: r.usuarioDoc ? r.usuarioDoc.nombre : "",
    usuarioApellido: r.usuarioDoc ? r.usuarioDoc.apellido : "",
    usuarioEmail: r.usuarioDoc ? r.usuarioDoc.email : "",
    usuarioTelefono: r.usuarioDoc && r.usuarioDoc.telefono
      ? r.usuarioDoc.telefono
      : (r.telefonoReservado || ""),  };
});


res.json(reservasConNombre);



    } catch (error) {
        console.error('Error al obtener reservas:', error);
        res.status(500).json({ error: 'Error al obtener reservas' });
    }
});






app.post('/registrar', async (req, res) => {
  const { nombre, apellido, telefono, email, password } = req.body;

  try {
    if (!email || !password || !nombre || !apellido) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    // Validar contraseña
    if (!password || password.length < 6 || !/\d/.test(password) || !/[A-Za-z]/.test(password)) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 6 caracteres e incluir una letra y un número.'
      });
    }

    const existe = await Usuario.findOne({ email });
    if (existe) return res.status(400).json({ error: 'El usuario ya existe' });

    // Normalizar teléfono
    const tel = String(telefono || '').replace(/\D/g, '');
    const telefonoNormalizado = tel.startsWith('549') ? tel : ('549' + tel);

    const hash = await bcrypt.hash(password, 10);

    // Token de verificación válido por 24h
    const token = crypto.randomBytes(32).toString('hex');
    const expira = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const nuevoUsuario = new Usuario({
      nombre,
      apellido,
      telefono: telefonoNormalizado,
      email,
      password: hash,
      emailVerificado: false,
      tokenVerificacion: token,
      tokenVerificacionExpira: expira
    });

    await nuevoUsuario.save();

    // Enviar email con Brevo
const link = `https://canchalibre.ar/verificar-email.html?token=${token}&tipo=usuario`;


    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif">
        <h2>¡Bienvenido/a a CanchaLibre!</h2>
        <p>Para activar tu cuenta, por favor verificá tu email haciendo clic en el botón:</p>
        <p>
          <a href="${link}" 
             style="background:#2c7be5;color:#fff;padding:10px 16px;border-radius:6px;
             text-decoration:none;display:inline-block">
            Verificar mi email
          </a>
        </p>
        <p>O copiá y pegá este enlace:<br>${link}</p>
        <hr/>
        <small>Este enlace vence en 24 horas.</small>
      </div>
    `;

    try {
      await sendMail(email, 'Verificá tu email en CanchaLibre', html);
    } catch (e) {
      console.error('❌ Error enviando email de verificación:', e);
    }

    return res.json({ mensaje: 'Usuario registrado. Revisa tu email para verificar la cuenta.' });

  } catch (error) {
    console.error('❌ Error en /registrar:', error);
    res.status(500).json({ error: 'Error al registrar usuario' });
  }
});



// Asegurate de tener arriba: const bcrypt = require('bcrypt');

app.post('/login', (req, res) => {
  return res.status(410).json({ error: 'Ruta de login antigua. Usá /auth/login.' });
});

/* LEGACY LOGIN DISABLED
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Faltan credenciales' });
    }

    const usuario = await Usuario.findOne({ email });
    if (!usuario) return res.status(400).json({ error: 'Usuario no encontrado' });

    // Compatibilidad: puede estar en passwordHash o en password
    const hash = usuario.passwordHash || usuario.password;
    if (!hash) {
      return res.status(500).json({ error: 'Usuario sin contraseña configurada' });
    }

    const match = await bcrypt.compare(password, hash);
    if (!match) return res.status(401).json({ error: 'Contraseña incorrecta' });

    // Check unificado de verificación (soporta emailVerified o emailVerificado)
    const verified = Boolean(usuario.emailVerified ?? usuario.emailVerificado ?? false);
    if (!verified) {
      return res.status(403).json({ error: 'Debes verificar tu email antes de iniciar sesión' });
    }

    return res.json({ mensaje: 'Login exitoso' });
  } catch (error) {
    console.error('❌ Error al iniciar sesión:', error);
    return res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});
*/

// Reenviar verificación (POST { email })
// === Reenviar verificación de email ===
app.post('/reenviar-verificacion', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Falta email' });

    const user = await Usuario.findOne({ email });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.emailVerificado) return res.json({ ok: true, mensaje: 'Ya estaba verificado' });

    // Nuevo token unificado
    const token = crypto.randomBytes(32).toString('hex');
    user.tokenVerificacion = token;
    user.tokenVerificacionExpira = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
    await user.save();

    // Link correcto
    const verifyLink = `https://canchalibre.ar/verificar-email.html?token=${token}&tipo=usuario`;

    console.log('[DEV] Link de verificación:', verifyLink);

    await sendMail(
      email,
      'Verificá tu email - CanchaLibre',
      `<p>Hola ${user.nombre || ''},</p>
       <p>Confirmá tu correo haciendo click aquí:</p>
       <p><a href="${verifyLink}">${verifyLink}</a></p>`
    );

    return res.json({ ok: true });

  } catch (e) {
    console.error('POST /reenviar-verificacion', e);
    return res.status(500).json({ error: 'Error interno' });
  }
});




app.get('/usuario/:email', (req, res) => {
  return res.status(410).json({ error: 'Ruta antigua. Usá GET /auth/me.' });
});

/* LEGACY USER PROFILE
app.get('/usuario/:email', async (req, res) => {
    try {
        const usuario = await Usuario.findOne({ email: req.params.email }, { password: 0 });
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
        res.json(usuario);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener usuario' });
    }
});
*/

app.post('/generar-link-pago/:reservaId', (req, res) => {
    return res.status(410).json({ error: 'Ruta antigua. Usá POST /api/me/turnos/:id/payment-link.' });
});

/* LEGACY PAYMENT LINK
app.post('/generar-link-pago/:reservaId', async (req, res) => {
    try {
        const reserva = await Turno.findById(req.params.reservaId);
        if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

        const club = await Club.findOne({ email: reserva.club });
        if (!club || !club.mercadoPagoAccessToken) {
            return res.status(400).json({ error: 'El club no tiene configurado su Access Token' });
        }

        // ✅ Configuración correcta para SDK v1
        mercadopago.configure({
            access_token: club.mercadoPagoAccessToken
        });

        const preference = {
            items: [{
                title: `Reserva de cancha - ${reserva.deporte}`,
                quantity: 1,
                currency_id: 'ARS',
                unit_price: reserva.precio
            }],
notification_url: 'https://api.canchalibre.ar/api/mercadopago/webhook',
            external_reference: reserva._id.toString()
        };

        const response = await mercadopago.preferences.create(preference);
        res.json({ pagoUrl: response.body.init_point });

    } catch (error) {
        console.error('Error generando link de pago:', error);
        res.status(500).json({ error: 'Error generando link de pago' });
    }
});

// ✅ NUEVA RUTA: obtener los datos de una reserva por ID (incluye teléfono)
app.get('/reserva/:id', authClub, async (req, res) => {
    try {
        const reserva = await Turno.findById(req.params.id).populate('usuarioId');

        // 👇 Este log te muestra qué número tiene realmente el perfil

        if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
        if (String(reserva.club).toLowerCase() !== String(req.clubEmail).toLowerCase()) {
            return res.status(403).json({ error: 'No autorizado para consultar esta reserva' });
        }
        res.json(reserva);
    } catch (error) {
        console.error('❌ Error en /reserva/:id:', error);
        res.status(500).json({ error: 'Error al obtener reserva' });
    }
});


app.put('/usuario/:email', (req, res) => {
    return res.status(410).json({ error: 'Ruta antigua. Usá PATCH /auth/me.' });
});

/* LEGACY USER UPDATE
app.put('/usuario/:email', async (req, res) => {
    try {
        const { nombre, apellido, telefono } = req.body;
        await Usuario.findOneAndUpdate(
            { email: req.params.email },
            { nombre, apellido, telefono },
            { new: true }
        );
        res.json({ mensaje: 'Datos actualizados correctamente' });
    } catch (error) {
        console.error('Error al actualizar usuario:', error);
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});
*/

// Endpoint para generar el link de pago para destacar club
app.post('/club/:email/destacar-pago', async (req, res) => {
    try {
        const clubEmail = req.params.email;
        const club = await Club.findOne({ email: clubEmail });
        if (!club) return res.status(404).json({ error: 'Club no encontrado' });

        // Traer la config dinámica
        let config = await Config.findOne();
        if (!config) config = await Config.create({}); // Defaults si no existe

        const precioDestacado = config.precioDestacado;
        const diasDestacado = config.diasDestacado;

        mercadopago.configure({
            access_token: process.env.MP_ACCESS_TOKEN // tu token de vendedor
        });

        const preference = {
            items: [{
                title: `Destacar club "${club.nombre}" por ${diasDestacado} días`,
                quantity: 1,
                currency_id: 'ARS',
                unit_price: precioDestacado
            }],
            notification_url: 'https://api.canchalibre.ar/api/mercadopago/destacado-webhook',
            external_reference: clubEmail,
            back_urls: {
                success: 'https://api.canchalibre.ar/panel-club.html',
                failure: 'https://api.canchalibre.ar/panel-club.html'
            },
            auto_return: 'approved'
        };

        const response = await mercadopago.preferences.create(preference);

        res.json({ pagoUrl: response.body.init_point });

    } catch (error) {
        console.error('❌ Error generando link de pago de destaque:', error);
        res.status(500).json({ error: 'No se pudo generar el link de pago' });
    }
});


// Webhook para pagos de destaque de club (la URL debe coincidir con tu 'notification_url')
// ✅ WEBHOOK MP de destaque con idempotencia
app.post('/api/mercadopago/destacado-webhook', async (req, res) => {
  try {
    const paymentId = req.query.id || req.body?.data?.id;
    if (!paymentId) return res.sendStatus(200);

    // ✅ Idempotencia persistente en DB
    const yaExiste = await PaymentEvent.findOne({ paymentId });
    if (yaExiste) return res.sendStatus(200);

    await PaymentEvent.create({ paymentId });

    // Traer el pago desde MP
    const resp = await mercadopago.payment.findById(paymentId);
    const pago = resp?.body || {};
    const status = pago.status;
    const clubEmail = pago.external_reference;

    if (!clubEmail) return res.sendStatus(200);

    if (status === 'approved') {
      // Calculamos fecha de vencimiento (30 días)
      const dias = 30;
      const fechaVencimiento = new Date();
      fechaVencimiento.setDate(fechaVencimiento.getDate() + dias);

      // Actualizamos el club
      await Club.findOneAndUpdate(
        { email: clubEmail },
        {
          destacado: true,
          destacadoHasta: fechaVencimiento,
          idUltimaTransaccion: paymentId
        }
      );

      console.log(`✅ Club ${clubEmail} destacado hasta el ${fechaVencimiento.toLocaleDateString('es-AR')}`);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error en webhook de destacado:', error);
    return res.sendStatus(500);
  }
});


app.get('/configuracion-destacado', async (req, res) => {
    let config = await Config.findOne();
    if (!config) {
        config = await Config.create({}); // Usa los valores por defecto la primera vez
    }
    res.json({
        precioDestacado: config.precioDestacado,
        diasDestacado: config.diasDestacado
    });
});

// Endpoint para obtener clubes (con filtros opcionales por provincia/localidad y búsqueda q)
app.get('/clubes', async (req, res) => {
  try {
    const { provincia, localidad, q } = req.query;

    const filter = {};
    if (provincia) filter.provincia = provincia;           // match exacto (igual a lo que carga el select)
    if (localidad) filter.localidad = localidad;           // match exacto
    if (q) filter.nombre = { $regex: q, $options: 'i' };   // búsqueda por nombre (opcional)

    const projection = {
      email: 1,
      nombre: 1,
      provincia: 1,
      localidad: 1,
      destacado: 1,
      destacadoHasta: 1,
      latitud: 1,
      longitud: 1,
      _id: 0
    };

    const clubes = await Club.find(filter, projection).sort({ destacado: -1, nombre: 1 });
    res.json(clubes);
  } catch (error) {
    console.error('❌ Error en GET /clubes:', error);
    res.status(500).json({ error: 'Error al obtener clubes' });
  }
});


app.patch('/turnos/:id/marcar-pagado', authClub, async (req, res) => {
    try {
        const turno = await Turno.findOne({ _id: req.params.id, club: req.clubEmail });
        if (!turno) return res.status(404).json({ error: 'Turno no encontrado o no pertenece al club' });
        await Turno.updateOne({ _id: turno._id }, { pagado: true });
        res.json({ mensaje: 'Turno marcado como pagado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al marcar como pagado' });
    }
});

// ====================================================
// 🔑 Recuperar contraseña - Usuarios y Clubes
// ====================================================

// 1️⃣ Usuario solicita recuperación
app.post('/recuperar', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Falta el email.' });

    const usuario = await Usuario.findOne({ email });
    if (!usuario) return res.status(404).json({ error: 'No existe un usuario con ese email.' });

    const token = crypto.randomBytes(32).toString('hex');
    usuario.resetToken = token;
    usuario.resetTokenExp = new Date(Date.now() + 3600000); // 1 hora
    await usuario.save();

    const link = `https://canchalibre.ar/reset.html?token=${token}&tipo=usuario`;

    await sendMail(
  usuario.email,
  'Recuperar contraseña - CanchaLibre',
  `
    <h2>Recuperación de contraseña</h2>
    <p>Hacé clic en el siguiente enlace para restablecer tu contraseña:</p>
    <p><a href="${link}" target="_blank">${link}</a></p>
    <p>Este enlace vence en 1 hora.</p>
  `
);


    res.json({ mensaje: 'Correo de recuperación enviado correctamente.' });
  } catch (error) {
    console.error('❌ Error en /recuperar:', error);
    res.status(500).json({ error: 'Error al procesar la recuperación.' });
  }
});

// 2️⃣ Usuario restablece contraseña
app.post('/reset', async (req, res) => {
  try {
    const { token, nuevaPassword } = req.body;
    if (!token || !nuevaPassword)
      return res.status(400).json({ error: 'Faltan datos.' });

    const usuario = await Usuario.findOne({
      resetToken: token,
      resetTokenExp: { $gt: Date.now() }
    });

    if (!usuario) return res.status(400).json({ error: 'Token inválido o expirado.' });

    // Validar nueva contraseña (mínimo 6, número y letra)
    if (nuevaPassword.length < 6 || !/\d/.test(nuevaPassword) || !/[A-Za-z]/.test(nuevaPassword)) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres e incluir una letra y un número.' });
    }

    const hash = await bcrypt.hash(nuevaPassword, 10);
    usuario.password = hash;
    usuario.resetToken = undefined;
    usuario.resetTokenExp = undefined;
    await usuario.save();

    res.json({ mensaje: 'Contraseña actualizada correctamente.' });
  } catch (error) {
    console.error('❌ Error en /reset:', error);
    res.status(500).json({ error: 'Error al restablecer contraseña.' });
  }
});

// 3️⃣ Club solicita recuperación
app.post('/recuperar-club', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Falta el email.' });

    const club = await Club.findOne({ email });
    if (!club) return res.status(404).json({ error: 'No existe un club con ese email.' });

    const token = crypto.randomBytes(32).toString('hex');
    club.resetToken = token;
    club.resetTokenExp = new Date(Date.now() + 3600000); // 1 hora
    await club.save();

    const link = `https://canchalibre.ar/reset.html?token=${token}&tipo=club`;

await sendMail(
  club.email,
  'Recuperar contraseña - CanchaLibre (Club)',
  `
    <h2>Recuperación de contraseña</h2>
    <p>Hacé clic en el siguiente enlace para restablecer tu contraseña del club:</p>
    <p><a href="${link}" target="_blank">${link}</a></p>
    <p>Este enlace vence en 1 hora.</p>
  `
);


    res.json({ mensaje: 'Correo de recuperación enviado correctamente al club.' });
  } catch (error) {
    console.error('❌ Error en /recuperar-club:', error);
    res.status(500).json({ error: 'Error al procesar la recuperación del club.' });
  }
});

// 4️⃣ Club restablece contraseña
app.post('/reset-club', async (req, res) => {
  try {
    const { token, nuevaPassword } = req.body;
    if (!token || !nuevaPassword)
      return res.status(400).json({ error: 'Faltan datos.' });

    const club = await Club.findOne({
      resetToken: token,
      resetTokenExp: { $gt: Date.now() }
    });

    if (!club) return res.status(400).json({ error: 'Token inválido o expirado.' });

    if (nuevaPassword.length < 6 || !/\d/.test(nuevaPassword) || !/[A-Za-z]/.test(nuevaPassword)) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres e incluir una letra y un número.' });
    }

    const hash = await bcrypt.hash(nuevaPassword, 10);
    club.passwordHash = hash;
    club.resetToken = undefined;
    club.resetTokenExp = undefined;
    await club.save();

    res.json({ mensaje: 'Contraseña del club actualizada correctamente.' });
  } catch (error) {
    console.error('❌ Error en /reset-club:', error);
    res.status(500).json({ error: 'Error al restablecer contraseña del club.' });
  }
});
// ✅ Verificación de email (usuarios y clubes)
app.get('/verificar-email', async (req, res) => {
  try {
    const { token, tipo } = req.query;

    if (!token) return res.status(400).send('Falta el token.');
    if (!tipo) return res.status(400).send('Falta el tipo (usuario o club).');

    const Modelo = tipo === 'club' ? Club : Usuario;

    const entidad = await Modelo.findOne({
      tokenVerificacion: token,
      tokenVerificacionExpira: { $gt: new Date() }
    });

    if (!entidad) {
      return res.status(400).send('Token inválido o vencido.');
    }

    entidad.emailVerificado = true;
    entidad.tokenVerificacion = undefined;
    entidad.tokenVerificacionExpira = undefined;
    await entidad.save();

  const redirectUrl =
  tipo === 'club'
    ? `https://canchalibre.ar/login-club.html?verified=1`
    : `https://canchalibre.ar/login.html?verified=1`;


    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('❌ Error en /verificar-email:', error);
    res.status(500).send('Error interno al verificar email.');
  }
});
app.get('/club-id/:id', async (req, res) => {
  try {
    const id = (req.params.id || '').trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Traemos el club por _id
    const club = await Club.findById(id, {
      email: 1,
      nombre: 1,
      provincia: 1,
      localidad: 1,
      latitud: 1,
      longitud: 1,
      destacado: 1,
      destacadoHasta: 1
    });

    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    res.json(club);
  } catch (error) {
    console.error('❌ Error en GET /club-id/:id:', error);
    res.status(500).json({ error: 'Error al obtener club por id' });
  }
});


const PORT = process.env.PORT || 3000;
// Manejo de errores de validación Celebrate
app.use(errors());

app.listen(PORT, () => console.log(`🚀 Servidor (con sockets) corriendo en http://localhost:${PORT}`));
