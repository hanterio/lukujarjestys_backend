const express = require('express')
const router = express.Router()
const controller = require('../controllers/optimointi')
const middleware = require('../utils/middleware')

router.post('/', middleware.requireKouluEiPoistettu, controller.optimoi)
router.get('/metadata', middleware.requireKouluEiPoistettu, controller.metadata)

module.exports = router