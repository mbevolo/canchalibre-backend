const controller = require('../controllers/clubManagement');
const authClub = require('../middlewares/authClub');

const validation = require('../validations/accounts');
const { accountLimiter } = require('../middlewares/rateLimits');
const router = require('express').Router();

router.put('/club/:id/access-token', authClub, controller.putClubIdAccessToken);

router.post('/registro-club', accountLimiter, validation.registerClub, controller.postRegistroClub);

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
