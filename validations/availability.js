const Joi = require('joi');
const { weekBounds } = require('../services/availability');
const schema = Joi.object({
  fecha: Joi.string().allow('').max(10),
  provincia: Joi.string().allow('').max(100),
  localidad: Joi.string().allow('').max(100),
  club: Joi.string().allow('').max(100),
});
function availabilityQuery(query) {
  const input = schema.validate(query, { stripUnknown: true });
  if (input.error) return { error: 'Filtros de búsqueda inválidos' };
  try {
    return { value: input.value, week: weekBounds(input.value.fecha) };
  } catch {
    return {
      error: 'Fecha inválida; usá una fecha real en formato YYYY-MM-DD',
    };
  }
}
module.exports = { availabilityQuery };
