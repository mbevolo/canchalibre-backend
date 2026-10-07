const controller = require('../controllers/clubManagement');
const authClub = require('../middlewares/authClub');

const validation = require('../validations/accounts');
const { accountLimiter } = require('../middlewares/rateLimits');
const router = require('express').Router();

router.put('/club/:id/access-token', authClub, controller.putClubIdAccessToken);

router.post('/registro-club', accountLimiter, validation.registerClub, controller.postRegistroClub);

router.put('/club/perfil/publico', authClub, async (req, res) => {
  const { direccion, descripcion, servicios, fotos } = req.body || {};
  const allowed = ['Estacionamiento', 'Vestuarios', 'Duchas', 'Iluminación', 'Buffet', 'Alquiler de equipos', 'Cancha cubierta', 'Acceso accesible'];
  if (typeof direccion !== 'string' || direccion.length > 250 || typeof descripcion !== 'string' || descripcion.length > 1500 ||
      !Array.isArray(servicios) || servicios.length > allowed.length || servicios.some(x => !allowed.includes(x)) ||
      !Array.isArray(fotos) || fotos.length > 6 || fotos.some(x => {
        if (typeof x !== 'string' || x.length > 120000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(x)) return true;
        const bytes = Buffer.from(x.split(',')[1], 'base64');
        return bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217;
      })) return res.status(400).json({ error: 'Perfil inválido. Máximo 6 fotos JPEG optimizadas.' });
  try {
    const club = await require('../models/Club').findByIdAndUpdate(req.clubId, { $set: { direccion: direccion.trim(), descripcion: descripcion.trim(), servicios: [...new Set(servicios)], fotos } }, { new: true });
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'No se pudo guardar el perfil' }); }
});

router.put('/club/:id', authClub, controller.putClubId);

router.post('/login-club', controller.postLoginClub);

router.post(
  '/club/reenviar-verificacion',
  accountLimiter, validation.emailBody,
  controller.postClubReenviarVerificacion,
);

router.get('/verificar-club', accountLimiter, validation.verifyClubQuery, controller.getVerificarClub);

router.get(
  '/club/:email',
  (req, res, next) =>
    req.headers.authorization ? authClub(req, res, next) : next(),
  controller.getClubEmail,
);

router.put(
  '/editar-ubicacion-club',
  authClub,
  controller.putEditarUbicacionClub,
);

module.exports = router;
