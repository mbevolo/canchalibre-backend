// Adaptador del SDK actual. Cada operación usa un cliente propio para evitar
// mezclar las credenciales de distintos clubes en solicitudes simultáneas.
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
let defaultToken;
function client(options = {}) {
  const accessToken = options.access_token || defaultToken || process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('Falta la credencial de MercadoPago');
  return new MercadoPagoConfig({ accessToken, options: { timeout: 10000 } });
}
module.exports = {
  configure(options) { defaultToken = options.access_token; },
  preferences: {
    async create(body, options) {
      const data = await new Preference(client(options)).create({ body });
      return { body: data };
    }
  },
  payment: {
    async findById(id, options) {
      const data = await new Payment(client(options)).get({ id: String(id) });
      return { body: data };
    }
  }
};
