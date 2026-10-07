module.exports = function publicJson(_doc, value) {
  for (const key of ['password', 'passwordHash', 'resetToken', 'resetTokenExp', 'tokenVerificacion', 'tokenVerificacionExpira', 'mercadoPagoAccessToken']) delete value[key];
  return value;
};
