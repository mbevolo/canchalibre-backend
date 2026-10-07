const rateLimit = require('express-rate-limit');
const sensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
module.exports = { sensitiveLimiter };
