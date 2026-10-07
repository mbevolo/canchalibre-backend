const controller = require('../controllers/courts');
const authClub = require('../middlewares/authClub');

const router = require('express').Router();

router.get('/canchas/:clubEmail', controller.getCanchasClubEmail);

router.post('/canchas', authClub, controller.postCanchas);

router.put('/canchas/:id', authClub, controller.putCanchasId);

router.delete('/canchas/:id', authClub, controller.deleteCanchasId);

module.exports = router;
