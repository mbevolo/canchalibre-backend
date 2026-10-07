const Club = require('../models/Club');
const Config = require('../models/config');
const DestacadoOrder = require('../models/DestacadoOrder');
const mercadopago = require('../utils/mercadopago');

const postClubEmailDestacarPago = async (req, res) => {
  try {
    const clubEmail = req.params.email;
    if (clubEmail !== req.clubEmail)
      return res.status(403).json({ error: 'No autorizado' });
    const club = await Club.findOne({ email: clubEmail });
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    // Traer la config dinámica
    let config = await Config.findOne();
    if (!config) config = await Config.create({}); // Defaults si no existe

    const precioDestacado = config.precioDestacado;
    const diasDestacado = config.diasDestacado;

    const order = await DestacadoOrder.create({
      clubId: club._id,
      precio: precioDestacado,
      dias: diasDestacado,
    });

    const preference = {
      items: [
        {
          title: `Destacar club "${club.nombre}" por ${diasDestacado} días`,
          quantity: 1,
          currency_id: 'ARS',
          unit_price: precioDestacado,
        },
      ],
      notification_url:
        'https://api.canchalibre.ar/api/mercadopago/destacado-webhook',
      external_reference: 'destacado:' + order._id,
      back_urls: {
        success: 'https://api.canchalibre.ar/panel-club.html',
        failure: 'https://api.canchalibre.ar/panel-club.html',
      },
      auto_return: 'approved',
    };

    const response = await mercadopago.preferences.create(preference, {
      access_token: process.env.MP_ACCESS_TOKEN,
    });

    res.json({ pagoUrl: response.body.init_point });
  } catch (error) {
    console.error("❌ Error generando link de pago de destaque:");
    res.status(500).json({ error: 'No se pudo generar el link de pago' });
  }
};

const getConfiguracionDestacado = async (req, res) => {
  let config = await Config.findOne();
  if (!config) {
    config = await Config.create({}); // Usa los valores por defecto la primera vez
  }
  res.json({
    precioDestacado: config.precioDestacado,
    diasDestacado: config.diasDestacado,
  });
};

module.exports = { postClubEmailDestacarPago, getConfiguracionDestacado };
