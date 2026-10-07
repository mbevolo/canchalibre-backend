const authUser = require('./authUser');

// Sin credenciales se permite el flujo de invitado. Si hay credenciales,
// deben ser válidas: un JWT vencido debe responder 401 para renovar la sesión.
module.exports = function optionalAuthUser(req, res, next) {
  if (!req.headers.authorization) return next();
  return authUser(req, res, next);
};
