const postReservasReenviarConfirmacion = (req, res) => {
  return res.status(410).json({
    error: 'Ruta antigua. Usá POST /api/me/reservas/:id/resend-confirmation.',
  });
};

const postReservasIdReenviar = (req, res) => {
  return res
    .status(410)
    .json({
      error: 'Ruta antigua. Usá POST /api/me/reservas/:id/resend-confirmation.',
    });
};

const getReservasUsuarioEmail = (req, res) => {
  return res
    .status(410)
    .json({ error: 'Ruta antigua. Usá GET /api/me/reservas.' });
};

const postLogin = (req, res) => {
  return res
    .status(410)
    .json({ error: 'Ruta de login antigua. Usá /auth/login.' });
};

const getUsuarioEmail = (req, res) => {
  return res.status(410).json({ error: 'Ruta antigua. Usá GET /auth/me.' });
};

const postGenerarLinkPagoReservaId = (req, res) => {
  return res
    .status(410)
    .json({ error: 'Ruta antigua. Usá POST /api/me/turnos/:id/payment-link.' });
};

module.exports = {
  postReservasReenviarConfirmacion,
  postReservasIdReenviar,
  getReservasUsuarioEmail,
  postLogin,
  getUsuarioEmail,
  postGenerarLinkPagoReservaId,
};
