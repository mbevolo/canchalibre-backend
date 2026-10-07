const express = require('express');
const cors = require('cors');
function configureHttp(app) {
  app.set('trust proxy', 1);
  app.use(require('helmet')());
  app.use(require('compression')());
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin))
          return callback(null, true);
        const error = new Error('CORS no permitido');
        error.status = 403;
        return callback(error);
      },
      methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
}
module.exports = { configureHttp };
