// updateCanchas.js
require('dotenv').config();
const mongoose = require('mongoose');

// ===============================
// 🔗 Conexión a MongoDB Atlas
// ===============================
const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb+srv://turnolibre_user:TurnoLibre123@nube.g7usckv.mongodb.net/turnolibre?retryWrites=true&w=majority&appName=Nube';

mongoose
  .connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('🟢 Conectado a MongoDB Atlas'))
  .catch((err) => {
    console.error('🔴 Error de conexión a MongoDB', err);
    process.exit(1);
  });

// ===============================
// 🏟 Modelo Cancha (mínimo necesario)
// ===============================
const canchaSchema = new mongoose.Schema({
  nombre: String,
  deporte: String,
  precio: Number,
  horaDesde: String,
  horaHasta: String,
  diasDisponibles: [String],
  clubEmail: String,
  duracionTurno: { type: Number, default: 60 }, // 👉 nuevo campo
});

const Cancha = mongoose.model('Cancha', canchaSchema);

// ===============================
// 🛠 Script de actualización
// ===============================
async function actualizarCanchas() {
  try {
    const dias = [
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
      'Domingo',
    ];

    const canchas = await Cancha.find();

    for (const cancha of canchas) {
      let actualizado = false;

      if (!cancha.diasDisponibles || cancha.diasDisponibles.length === 0) {
        cancha.diasDisponibles = dias;
        actualizado = true;
      }

      if (!cancha.duracionTurno) {
        cancha.duracionTurno = 60; // 👉 valor por defecto si no tiene
        actualizado = true;
      }

      if (actualizado) {
        await cancha.save();
        console.log(`✅ Cancha actualizada: ${cancha.nombre}`);
      } else {
        console.log(`ℹ️ Cancha ya estaba completa: ${cancha.nombre}`);
      }
    }

    console.log('🚀 Actualización finalizada');
  } catch (error) {
    console.error('❌ Error al actualizar canchas:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

actualizarCanchas();
