const mongoose = require('mongoose');

const turnoSchema = new mongoose.Schema({
  bookingId: String,
  deporte: String,
  fecha: String,
  club: String,
  hora: String,
  precio: Number,
  usuarioReservado: String,
  emailReservado: String,
  canchaId: String,
  pagado: { type: Boolean, default: false },
  metodoPago: { type: String, enum: ['online', 'efectivo'], default: 'efectivo' },

  usuarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Usuario'
  },
  // 🔹 Campos de auditoría de pago
  pagoId: { type: String, default: null },
  pagoMetodo: { type: String, default: null },
  fechaPago: { type: Date, default: null }
});

// Evitar duplicados: misma cancha + misma fecha + misma hora
turnoSchema.index({ canchaId: 1, fecha: 1, hora: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.Turno || mongoose.model('Turno', turnoSchema);
