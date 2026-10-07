const Joi = require('joi');
const Cancha = require('../models/Cancha');
const { transaction, failure } = require('../services/reservations');
// @ts-nocheck

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Superadmin = require('../models/Superadmin');
const Club = require('../models/Club');
const Usuario = require('../models/Usuario'); // <--- IMPORTANTE, arriba
const superadminAuth = require('../middlewares/superadminAuth');
const Turno = require('../models/Turno');
const router = express.Router();
const Config = require('../models/config');
const platformMP = require('../services/platformMercadoPago');
const DestacadoOrder = require('../models/DestacadoOrder');
const { cancelTurno } = require('../services/reservations');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('Falta JWT_SECRET en .env');

// La creación de superadmins no se expone por HTTP.
// Los superadmins existentes continúan usando /login.
// Para alta administrativa futura se utilizará un procedimiento fuera de la API pública.
router.post('/register', (req, res) => {
  return res.status(404).json({ ok: false, msg: 'Ruta no disponible' });
});

// Login superadmin
router.post('/login', require('../middlewares/rateLimits').sensitiveLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (typeof req.body.email !== 'string' || typeof password !== 'string' || !password) return res.status(400).json({ ok: false, msg: 'Credenciales inválidas' });
    const email = req.body.email.trim().toLowerCase();
    const superadmin = await Superadmin.findOne({ email });
    if (!superadmin) return res.status(400).json({ ok: false, msg: 'Usuario o contraseña incorrectos' });

    const valid = await bcrypt.compare(password, superadmin.passwordHash);
    if (!valid) return res.status(400).json({ ok: false, msg: 'Usuario o contraseña incorrectos' });

    // Genera token (puede ser JWT simple)
    const token = jwt.sign({ id: superadmin._id, rol: 'superadmin' }, JWT_SECRET, { expiresIn: '1d' });

    res.json({ ok: true, token, nombre: superadmin.nombre });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Resumen administrativo: cobros propios separados de las reservas de clubes.
router.get('/resumen', superadminAuth, async (req, res) => {
  try {
    const [clubes, usuarios, reservas, destacados, revenue] = await Promise.all([
      Club.countDocuments(), Usuario.countDocuments(), Turno.countDocuments(),
      Club.countDocuments({ destacado: true, destacadoHasta: { $gt: new Date() } }),
      DestacadoOrder.aggregate([{ $match: { paymentId: { $ne: null } } }, { $group: { _id: null, total: { $sum: '$precio' }, cantidad: { $sum: 1 } } }]),
    ]);
    res.json({ ok: true, resumen: { clubes, usuarios, reservas, destacados, ingresosDestacados: revenue[0]?.total || 0, destacadosPagados: revenue[0]?.cantidad || 0 } });
  } catch (_) { res.status(500).json({ ok: false, msg: 'No se pudo cargar el resumen' }); }
});
router.get('/mercadopago', superadminAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const config = await Config.findOne().select('+mpTokenEncrypted +mpWebhookEncrypted');
    res.json({ ok: true, mercadopago: platformMP.status(config) });
  } catch (_) { res.status(500).json({ ok: false, msg: 'No se pudo cargar la configuración de MercadoPago' }); }
});
router.put('/mercadopago', superadminAuth, require('../middlewares/rateLimits').sensitiveLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const input = Joi.object({
    accessToken: Joi.string().trim().min(20).max(500).pattern(/^(APP_USR-|TEST-)[A-Za-z0-9_-]+$/),
    webhookSecret: Joi.string().trim().min(16).max(256).pattern(/^[A-Za-z0-9_-]+$/),
  }).min(1).unknown(false).validate(req.body);
  if (input.error) return res.status(400).json({ ok: false, msg: 'Ingresá un Access Token o una clave de notificaciones válida.' });
  try {
    const updates = {};
    if (input.value.accessToken) {
      updates.mpAccount = await platformMP.verifyAccount(input.value.accessToken);
      updates.mpTokenEncrypted = platformMP.encrypt(input.value.accessToken);
      updates.mpVerifiedAt = new Date();
    }
    if (input.value.webhookSecret) updates.mpWebhookEncrypted = platformMP.encrypt(input.value.webhookSecret);
    const config = await Config.findOneAndUpdate({}, { $set: updates }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }).select('+mpTokenEncrypted +mpWebhookEncrypted');
    res.json({ ok: true, mercadopago: platformMP.status(config) });
  } catch (error) { res.status(error.status || 502).json({ ok: false, msg: error.status ? error.message : 'No se pudo verificar o guardar MercadoPago. Intentá nuevamente.' }); }
});

// Listado de clubes solo para superadmin (PROTEGIDO)
router.get('/clubes', superadminAuth, async (req, res) => {
  try {
    const clubes = await Club.find().select('-passwordHash -mercadoPagoAccessToken -fotos');
    res.json({ ok: true, clubes });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Listado de usuarios solo para superadmin (PROTEGIDO)
router.get('/usuarios', superadminAuth, async (req, res) => {
  try {
    const usuarios = await Usuario.find().select('-passwordHash -password');
    res.json({ ok: true, usuarios });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Listado de reservas solo para superadmin (PROTEGIDO)
router.get('/reservas', superadminAuth, async (req, res) => {
  try {
    const reservas = await Turno.find();
    res.json({ ok: true, reservas });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Listado de pagos (reservas pagadas) solo para superadmin
router.get('/pagos', superadminAuth, async (req, res) => {
  try {
    const pagos = await Turno.find({ pagado: true });
    const cobrosDestacados = await DestacadoOrder.find({ paymentId: { $ne: null } }).populate('clubId', 'nombre email').sort({ createdAt: -1 }).lean();
    res.json({ ok: true, pagos, cobrosDestacados });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Listado de clubes destacados (solo para superadmin)
router.get('/destacados', superadminAuth, async (req, res) => {
  try {
    // Trae todos los clubes que tienen destacado en true
    const destacados = await Club.find({ destacado: true }).select('-passwordHash -mercadoPagoAccessToken -fotos');
    res.json({ ok: true, destacados });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Quitar destacado a un club (solo para superadmin)
router.post('/quitar-destacado', superadminAuth, async (req, res) => {
  try {
    const { email } = req.body;
    const club = await Club.findOne({ email });
    if (!club) return res.status(404).json({ ok: false, msg: 'Club no encontrado' });

    club.destacado = false;
    club.destacadoHasta = null;
    await club.save();

    res.json({ ok: true, msg: 'Destacado quitado correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Obtener configuraciones globales
router.get('/configuraciones', superadminAuth, async (req, res) => {
  try {
    let config = await Config.findOne();
    if (!config) {
      config = await Config.create({}); // Usa los valores por defecto la primera vez
    }
    res.json({ ok: true, config });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Actualizar configuraciones globales
router.put('/configuraciones', superadminAuth, async (req, res) => {
  try {
    let config = await Config.findOne();
    if (!config) config = await Config.create({});
    const { precioDestacado, diasDestacado } = req.body;
    if ((precioDestacado !== undefined && (typeof precioDestacado !== 'number' || !Number.isFinite(precioDestacado) || precioDestacado <= 0)) ||
        (diasDestacado !== undefined && (!Number.isInteger(diasDestacado) || diasDestacado < 1 || diasDestacado > 365))) {
      return res.status(400).json({ ok: false, msg: 'Precio y duración de destaque inválidos' });
    }
    if (precioDestacado !== undefined) config.precioDestacado = precioDestacado;
    if (diasDestacado !== undefined) config.diasDestacado = diasDestacado;
    await config.save();
    res.json({ ok: true, config });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Editar club (solo superadmin)
router.put('/clubes/:id', superadminAuth, async (req, res) => {
  try {
    const input = Joi.object({
      nombre: Joi.string().trim().max(100), email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }),
      telefono: Joi.string().max(30).allow(''), activo: Joi.boolean().strict()
    }).min(1).validate(req.body);
    if (input.error) return res.status(400).json({ ok: false, msg: 'Datos de club inválidos' });
    const club = await transaction(async session => {
      const current = await Club.findById(req.params.id).session(session);
      if (!current) throw failure(404, 'Club no encontrado');
      const oldEmail = current.email;
      Object.assign(current, input.value);
      await current.save({ session });
      if (current.email !== oldEmail) {
        await Cancha.updateMany({ clubEmail: oldEmail }, { $set: { clubEmail: current.email } }, { session });
        await Turno.updateMany({ club: oldEmail }, { $set: { club: current.email } }, { session });
      }
      return current;
    });
    res.json({ ok: true, club });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, msg: err.status ? err.message : 'No se pudo editar el club' });
  }
});

// Suspender (activar/desactivar) club
router.patch('/clubes/:id/suspender', superadminAuth, async (req, res) => {
  try {
    const club = await Club.findById(req.params.id);
    if (!club) return res.status(404).json({ ok: false, msg: 'Club no encontrado' });
    club.activo = !club.activo;
    await club.save();
    res.json({ ok: true, club });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Eliminar club
router.delete('/clubes/:id', superadminAuth, async (req, res) => {
  try {
    await Club.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Editar usuario (solo superadmin)
router.put('/usuarios/:id', superadminAuth, async (req, res) => {
  try {
    const { nombre, apellido, email, telefono } = req.body;
    const usuario = await Usuario.findByIdAndUpdate(
      req.params.id,
      { nombre, apellido, email, telefono },
      { new: true }
    );
    if (!usuario) return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
    res.json({ ok: true, usuario });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Suspender (activar/desactivar) usuario
router.patch('/usuarios/:id/suspender', superadminAuth, async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.params.id);
    if (!usuario) return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
    usuario.activo = usuario.activo === false ? true : false; // alterna entre true y false
    await usuario.save();
    res.json({ ok: true, usuario });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Eliminar usuario
router.delete('/usuarios/:id', superadminAuth, async (req, res) => {
  try {
    await Usuario.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});
// Editar reserva
router.put('/reservas/:id', superadminAuth, async (req, res) => {
  try {
    const { deporte, fecha, club, hora, precio, usuarioReservado, emailReservado, pagado } = req.body;
    const turno = await Turno.findByIdAndUpdate(
      req.params.id,
      { deporte, fecha, club, hora, precio, usuarioReservado, emailReservado, pagado },
      { new: true }
    );
    if (!turno) return res.status(404).json({ ok: false, msg: 'Reserva no encontrada' });
    res.json({ ok: true, turno });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// Cancelar reserva (libera turno)
router.patch('/reservas/:id/cancelar', superadminAuth, async (req, res) => {
  try {
    await cancelTurno(req.params.id, {});
    return res.json({ ok: true });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, msg: error.status ? error.message : 'Error al cancelar reserva' });
  }
});

// Marcar reserva como pagada
router.patch('/reservas/:id/pagado', superadminAuth, async (req, res) => {
  try {
    const turno = await Turno.findByIdAndUpdate(req.params.id, { pagado: true }, { new: true });
    if (!turno) return res.status(404).json({ ok: false, msg: 'Reserva no encontrada' });
    res.json({ ok: true, turno });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});


module.exports = router;
