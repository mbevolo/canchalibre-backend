const { celebrate, Joi, Segments } = require('celebrate');
const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254).required();
const token = Joi.string().pattern(/^[a-f0-9]{64}$/i).required();
const password = Joi.string().min(6).max(72).pattern(/[A-Za-z]/).pattern(/\d/)
  .custom((value, helpers) => Buffer.byteLength(value, 'utf8') <= 72 ? value : helpers.error('string.max', { limit: 72 })).required();
const text = Joi.string().trim().max(100).required();
const body = fields => celebrate({ [Segments.BODY]: Joi.object(fields).unknown(true) });
module.exports = {
  emailBody: body({ email }),
  profileBody: celebrate({ [Segments.BODY]: Joi.object({ nombre: Joi.string().trim().max(100).allow(''), apellido: Joi.string().trim().max(100).allow(''), telefono: Joi.string().trim().max(30).allow('') }).min(1) }),
  resetBody: body({ token, nuevaPassword: password }),
  registerUser: body({ nombre: text, apellido: text, email, password, telefono: Joi.string().max(30).allow('') }),
  registerClub: body({ nombre: text, email, password, telefono: Joi.string().max(30).required(), provincia: text, localidad: text }),
  verifyQuery: celebrate({ [Segments.QUERY]: Joi.object({ token, tipo: Joi.string().valid('usuario', 'club').required() }) }),
  verifyClubQuery: celebrate({ [Segments.QUERY]: Joi.object({ token, email }) }),
};
