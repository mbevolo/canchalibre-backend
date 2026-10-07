const express = require('express');
const { configureHttp } = require('./config/http');
function createApp() {
  const app = express();
  configureHttp(app);
  require('./routes').registerRoutes(app);
  app.use(require('celebrate').errors());
  const { notFound, errorHandler } = require('./middlewares/errors');
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
