function notFound(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}
function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.status === 403)
    return res.status(403).json({ error: 'Origen no permitido' });
  if (error.status === 413)
    return res
      .status(413)
      .json({ error: 'La solicitud supera el tamaño permitido' });
  if (error.type === 'entity.parse.failed')
    return res.status(400).json({ error: 'JSON inválido' });
  console.error("Error inesperado en la API:");
  return res.status(500).json({ error: 'Error interno del servidor' });
}
module.exports = { notFound, errorHandler };
