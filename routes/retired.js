const controller = require('../controllers/retired');

const router = require('express').Router();

router.post(
  '/reservas/reenviar-confirmacion',
  controller.postReservasReenviarConfirmacion,
);

router.post('/reservas/:id/reenviar', controller.postReservasIdReenviar);

router.get('/reservas-usuario/:email', controller.getReservasUsuarioEmail);

router.post('/login', controller.postLogin);

router.get('/usuario/:email', controller.getUsuarioEmail);

router.post(
  '/generar-link-pago/:reservaId',
  controller.postGenerarLinkPagoReservaId,
);

module.exports = router;
