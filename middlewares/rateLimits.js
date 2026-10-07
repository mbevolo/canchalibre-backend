const rateLimit = require('express-rate-limit');
const sensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const accountLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
module.exports = { sensitiveLimiter, accountLimiter };
