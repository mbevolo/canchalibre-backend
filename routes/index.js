function registerRoutes(app) {
  app.use('/api/club', require('./club'));
  app.use('/api/stats', require('./stats'));
  app.use('/ubicaciones', require('./ubicaciones'));
  app.use('/superadmin', require('./superadmin'));
  const { sensitiveLimiter } = require('../middlewares/rateLimits');
  app.post('/login', sensitiveLimiter);
  app.use('/login-club', sensitiveLimiter);
  app.use('/api/mercadopago', sensitiveLimiter);
  app.use('/auth', sensitiveLimiter, require('./auth'));
  app.use('/api/me', require('./user'));
  app.use(require('./reservations'));
  app.use(require('./retired'));
  app.use(require('./clubManagement'));
  app.use(require('./clubBookings'));
  app.use(require('./payments'));
  app.use(require('./courts'));
  app.use(require('./availability'));
  app.use(require('./accounts'));
  app.use(require('./featured'));
  app.use(require('./directory'));
}
module.exports = { registerRoutes };
