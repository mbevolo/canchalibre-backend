const controller = require('../controllers/clubBookings');
const authClub = require('../middlewares/authClub');
const { clubBooking } = require('../validations/bookings');

const router = require('express').Router();

router.post(
  '/reservar-turno',
  authClub,
  clubBooking,
  controller.postReservarTurno,
);

router.get('/turnos', authClub, controller.getTurnos);

router.get('/turnos/:id', authClub, controller.getTurnosId);

router.put('/turnos/:id', authClub, controller.putTurnosId);

router.post(
  '/turnos/:id/payment-link',
  authClub,
  controller.postTurnosIdPaymentLink,
);

router.patch(
  '/turnos/:id/cancelar',
  authClub,
  controller.patchTurnosIdCancelar,
);

router.get('/reservas/:clubEmail', authClub, controller.getReservasClubEmail);

router.patch(
  '/turnos/:id/marcar-pagado',
  authClub,
  controller.patchTurnosIdMarcarPagado,
);

module.exports = router;
