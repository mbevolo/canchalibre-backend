// models/config.js
const mongoose = require('mongoose');
const ConfigSchema = new mongoose.Schema({
    precioDestacado: { type: Number, default: 4999 },
    diasDestacado: { type: Number, default: 30 },
    mpTokenEncrypted: { type: String, select: false },
    mpWebhookEncrypted: { type: String, select: false },
    mpAccount: { id: String, email: String, name: String, test: Boolean },
    mpVerifiedAt: Date
});
module.exports = mongoose.model('config', ConfigSchema);
