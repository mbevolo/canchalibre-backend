const Club = require('../models/Club');
const mongoose = require('mongoose');

const getClubes = async (req, res) => {
  try {
    const { provincia, localidad, q } = req.query;

    for (const value of [provincia, localidad, q]) {
      if (value !== undefined && (typeof value !== 'string' || value.length > 100))
        return res.status(400).json({ error: 'Filtro inválido' });
    }

    const filter = { activo: { $ne: false } };
    if (provincia) filter.provincia = provincia; // match exacto (igual a lo que carga el select)
    if (localidad) filter.localidad = localidad; // match exacto
    if (q) {
      if (typeof q !== 'string' || q.length > 100)
        return res.status(400).json({ error: 'Búsqueda inválida' });
      filter.nombre = {
        $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      };
    } // búsqueda por nombre (opcional)

    const projection = {
      fotos: { $slice: 1 },
      direccion: 1,
      servicios: 1,
      email: 1,
      nombre: 1,
      provincia: 1,
      localidad: 1,
      destacado: 1,
      destacadoHasta: 1,
      latitud: 1,
      longitud: 1,
      _id: 0,
    };

    const clubes = await Club.find(filter, projection).lean().sort({
      destacado: -1,
      nombre: 1,
    });
    res.json(clubes);
  } catch (error) {
    console.error("❌ Error en GET /clubes:");
    res.status(500).json({ error: 'Error al obtener clubes' });
  }
};

const getClubIdId = async (req, res) => {
  try {
    const id = (req.params.id || '').trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    // Traemos el club por _id
    const club = await Club.findOne({ _id: id, activo: { $ne: false } }, {
      fotos: { $slice: 1 },
      direccion: 1,
      servicios: 1,
      email: 1,
      nombre: 1,
      provincia: 1,
      localidad: 1,
      latitud: 1,
      longitud: 1,
      destacado: 1,
      destacadoHasta: 1,
    }).lean();

    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    res.json(club);
  } catch (error) {
    console.error("❌ Error en GET /club-id/:id:");
    res.status(500).json({ error: 'Error al obtener club por id' });
  }
};

module.exports = { getClubes, getClubIdId };
