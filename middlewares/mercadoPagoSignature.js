const { createHmac, timingSafeEqual } = require('node:crypto');

// The ID authenticated by MP must also be the ID fetched from its API.
function mercadoPagoSignature(featured = false) {
  return (req, res, next) => {
    let secret = featured
      ? process.env.MP_FEATURED_WEBHOOK_SECRET || process.env.MP_WEBHOOK_SECRET
      : process.env.MP_WEBHOOK_SECRET;
    if (!featured && process.env.MP_CLUB_WEBHOOK_SECRETS) {
      try {
        const secrets = JSON.parse(process.env.MP_CLUB_WEBHOOK_SECRETS);
        secret = Object.hasOwn(secrets, req.query.club) ? secrets[req.query.club] : secret;
      } catch (_) {
        return res.status(503).json({ error: 'Webhook sin configuración válida' });
      }
    }
    if (typeof secret !== 'string' || !secret.trim())
      return res.status(503).json({ error: 'Webhook sin configuración válida' });
    const id = req.query['data.id'];
    const requestId = req.get('x-request-id');
    const signature = req.get('x-signature');
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(id) ||
        !requestId || !/^[a-zA-Z0-9_-]{1,200}$/.test(requestId) || !signature)
      return res.sendStatus(401);
    const parts = signature.split(',').map(part => part.trim().split('='));
    const timestamps = parts.filter(p => p[0] === 'ts');
    const hashes = parts.filter(p => p[0] === 'v1');
    if (timestamps.length !== 1 || hashes.length !== 1 ||
        timestamps[0].length !== 2 || hashes[0].length !== 2 ||
        !/^\d{1,20}$/.test(timestamps[0][1]) || !/^[a-fA-F0-9]{64}$/.test(hashes[0][1]))
      return res.sendStatus(401);
    // Do not impose a timestamp window: delayed provider retries remain valid.
    const digest = createHmac('sha256', secret)
      .update(`id:${id.toLowerCase()};request-id:${requestId};ts:${timestamps[0][1]};`)
      .digest();
    if (!timingSafeEqual(digest, Buffer.from(hashes[0][1], 'hex')))
      return res.sendStatus(401);
    if ((req.body?.data?.id !== undefined && String(req.body.data.id) !== id) ||
        (req.query.id !== undefined && req.query.id !== id))
      return res.status(400).json({ error: 'Identificador de pago inconsistente' });
    req.mercadoPagoPaymentId = id;
    next();
  };
}

module.exports = mercadoPagoSignature;
