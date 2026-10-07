const controller = require('../controllers/featured');
const authClub = require('../middlewares/authClub');

const router = require('express').Router();

router.post(
  '/club/:email/destacar-pago',
  authClub,
  controller.postClubEmailDestacarPago,
);

router.get('/configuracion-destacado', controller.getConfiguracionDestacado);

module.exports = router;
