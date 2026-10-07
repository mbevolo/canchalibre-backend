const Joi = require('joi');
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const schema = Joi.object({
  nombre: Joi.string().trim().max(100).required(),
  deporte: Joi.string().trim().max(50).required(),
  precio: Joi.number().positive().required(),
  horaDesde: Joi.string().pattern(time).required(),
  horaHasta: Joi.string()
    .pattern(/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/)
    .required(),
  diasDisponibles: Joi.array()
    .items(
      Joi.string().valid(
        'lunes',
        'martes',
        'miércoles',
        'miercoles',
        'jueves',
        'viernes',
        'sábado',
        'sabado',
        'domingo',
      ),
    )
    .unique()
    .default([]),
  clubEmail: Joi.string()
    .email({ tlds: { allow: false } })
    .required(),
  duracionTurno: Joi.number().integer().min(1).max(1440).default(60),
  nocturnoDesde: Joi.number()
    .integer()
    .min(0)
    .max(23)
    .empty('')
    .allow(null)
    .default(null),
  precioNocturno: Joi.number().positive().empty('').allow(null).default(null),
});
function courtInput(body) {
  const result = schema.validate(body, { stripUnknown: true });
  if (result.error)
    return {
      error: 'Datos de cancha inválidos: ' + result.error.details[0].message,
    };
  const minutes = (value) => {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  };
  if (minutes(result.value.horaHasta) <= minutes(result.value.horaDesde))
    return { error: 'El horario Hasta debe ser mayor que Desde' };
  if (
    result.value.duracionTurno >
    minutes(result.value.horaHasta) - minutes(result.value.horaDesde)
  )
    return { error: 'La duración supera el horario disponible' };
  return result;
}
module.exports = { courtInput };
