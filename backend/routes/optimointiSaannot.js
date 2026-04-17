const express = require('express')
const router = express.Router()
const controller = require('../controllers/optimointiSaannot')
const middleware = require('../utils/middleware')

router.get('/', middleware.requireKouluEiPoistettu, controller.list)
router.post('/', middleware.requireKouluEiPoistettu, controller.create)
router.put('/:id', middleware.requireKouluEiPoistettu, controller.update)
router.delete('/:id', middleware.requireKouluEiPoistettu, controller.remove)

module.exports = router
