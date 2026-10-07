const controller = require('../controllers/accounts');

const validation = require('../validations/accounts');
const { accountLimiter } = require('../middlewares/rateLimits');
const router = require('express').Router();

router.post('/registrar', accountLimiter, validation.registerUser, controller.postRegistrar);

router.post('/reenviar-verificacion', accountLimiter, validation.emailBody, controller.postReenviarVerificacion);

router.post('/recuperar', accountLimiter, validation.emailBody, controller.postRecuperar);

router.post('/reset', accountLimiter, validation.resetBody, controller.postReset);

router.post('/recuperar-club', accountLimiter, validation.emailBody, controller.postRecuperarClub);

router.post('/reset-club', accountLimiter, validation.resetBody, controller.postResetClub);

router.get('/verificar-email', accountLimiter, validation.verifyQuery, controller.getVerificarEmail);

module.exports = router;
