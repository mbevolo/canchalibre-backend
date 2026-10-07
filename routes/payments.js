const controller = require('../controllers/payments');

const router = require('express').Router();

router.post('/api/mercadopago/webhook', controller.postApiMercadopagoWebhook);

router.post(
  '/api/mercadopago/destacado-webhook',
  controller.postApiMercadopagoDestacadoWebhook,
);

module.exports = router;
