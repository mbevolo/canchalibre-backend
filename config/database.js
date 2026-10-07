const mongoose = require('mongoose');
async function connectDatabase() {
  if (!process.env.MONGO_URI) throw new Error('Falta MONGO_URI');
  await mongoose.connect(process.env.MONGO_URI);
}
module.exports = { connectDatabase };
