const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  clubId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Club' },
  precio: { type: Number, required: true },
  dias: { type: Number, required: true },
  paymentId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.models.DestacadoOrder || mongoose.model('DestacadoOrder', schema);
