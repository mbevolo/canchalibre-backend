const controller = require('../controllers/accounts');

const router = require('express').Router();

router.post('/registrar', controller.postRegistrar);

router.post('/reenviar-verificacion', controller.postReenviarVerificacion);

router.post('/recuperar', controller.postRecuperar);

router.post('/reset', controller.postReset);

router.post('/recuperar-club', controller.postRecuperarClub);

router.post('/reset-club', controller.postResetClub);

router.get('/verificar-email', controller.getVerificarEmail);

module.exports = router;
