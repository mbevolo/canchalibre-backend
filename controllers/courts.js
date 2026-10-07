const Cancha = require('../models/Cancha');
const { courtInput } = require('../validations/court');
const mongoose = require('mongoose');

const getCanchasClubEmail = async (req, res) => {
  try {
    const canchas = await Cancha.find({ clubEmail: req.params.clubEmail });
    res.json(canchas);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener canchas' });
  }
};

const postCanchas = async (req, res) => {
  if (req.body.clubEmail !== req.clubEmail)
    return res
      .status(403)
      .json({ error: 'La cancha debe pertenecer al club autenticado' });
  const input = courtInput(req.body);
  if (input.error) return res.status(400).json({ error: input.error });
  try {
    await Cancha.create(input.value);
    res.json({ mensaje: 'Cancha agregada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al agregar cancha' });
  }
};

const putCanchasId = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return res.status(400).json({ error: 'Identificador de cancha inválido' });
  try {
    const cancha = await Cancha.findById(req.params.id);
    if (!cancha) return res.status(404).json({ error: 'Cancha no encontrada' });
    if (cancha.clubEmail !== req.clubEmail)
      return res
        .status(403)
        .json({ error: 'No autorizado para modificar esta cancha' });
    const input = courtInput({ ...req.body, clubEmail: req.clubEmail });
    if (input.error) return res.status(400).json({ error: input.error });
    await Cancha.findByIdAndUpdate(req.params.id, input.value, {
      runValidators: true,
    });
    res.json({ mensaje: 'Cancha actualizada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar cancha' });
  }
};

const deleteCanchasId = async (req, res) => {
  try {
    const cancha = await Cancha.findById(req.params.id);
    if (!cancha) return res.status(404).json({ error: 'Cancha no encontrada' });
    if (
      String(cancha.clubEmail).toLowerCase() !==
      String(req.clubEmail).toLowerCase()
    ) {
      return res
        .status(403)
        .json({ error: 'No autorizado para eliminar esta cancha' });
    }

    await Cancha.findByIdAndDelete(req.params.id);
    res.json({ mensaje: 'Cancha eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar cancha' });
  }
};

module.exports = {
  getCanchasClubEmail,
  postCanchas,
  putCanchasId,
  deleteCanchasId,
};
