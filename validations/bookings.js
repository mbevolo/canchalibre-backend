const { celebrate, Joi, Segments } = require('celebrate');
const hold = celebrate({
  [Segments.BODY]: Joi.object({
    canchaId: Joi.string().hex().length(24).required(),
    fecha: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required(),
    hora: Joi.string()
      .pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .required(),
    email: Joi.string()
      .email({ tlds: { allow: false } })
      .optional(),
    usuarioId: Joi.any().optional(),
    metodoPago: Joi.string().valid('online', 'efectivo').default('efectivo'),
  }),
});
const clubBooking = celebrate({
  [Segments.BODY]: Joi.object({
    deporte: Joi.string().max(40).required(),
    fecha: Joi.string()
      .pattern(/^\d{4}-\d{2}-\d{2}$/)
      .required(),
    club: Joi.string().max(100).required(),
    hora: Joi.string()
      .pattern(/^\d{2}:\d{2}$/)
      .required(),
    precio: Joi.number().min(0).required(),
    usuarioReservado: Joi.string().max(100).required(),
    emailReservado: Joi.string().email().required(),
    telefonoReservado: Joi.string().trim().max(30).allow('').default(''),
    metodoPago: Joi.string().valid('online', 'efectivo').required(),
    canchaId: Joi.string().required(),
  }),
});
module.exports = { hold, clubBooking };
