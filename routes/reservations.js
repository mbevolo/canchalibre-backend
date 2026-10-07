const controller = require('../controllers/reservations');
const { sensitiveLimiter } = require('../middlewares/rateLimits');
const optionalAuthUser = require('../middlewares/optionalAuthUser');
const { hold } = require('../validations/bookings');

const router = require('express').Router();

router.post(
  '/reservas/hold',
  sensitiveLimiter,
  optionalAuthUser,
  hold,
  controller.postReservasHold,
);

router.get(
  '/reservas/confirmar/:id/:code',
  controller.getReservasConfirmarIdCode,
);

module.exports = router;
