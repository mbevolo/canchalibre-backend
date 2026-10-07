const controller = require('../controllers/availability');
const authClub = require('../middlewares/authClub');

const router = require('express').Router();

router.get(
  '/turnos-generados',
  (req, res, next) =>
    req.headers.authorization ? authClub(req, res, next) : next(),
  controller.getTurnosGenerados,
);

module.exports = router;
