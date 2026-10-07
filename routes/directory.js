const controller = require('../controllers/directory');

const router = require('express').Router();

router.get('/clubes', controller.getClubes);

router.get('/club-id/:id', controller.getClubIdId);

module.exports = router;
