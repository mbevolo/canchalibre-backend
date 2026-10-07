const controller = require('../controllers/payments');
const signature = require('../middlewares/mercadoPagoSignature');

const router = require('express').Router();

router.post('/api/mercadopago/webhook', signature(), controller.postApiMercadopagoWebhook);

router.post(
  '/api/mercadopago/destacado-webhook',
  signature(true),
  controller.postApiMercadopagoDestacadoWebhook,
);

module.exports = router;
