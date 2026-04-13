const express = require('express')
const router = express.Router()

const controller = require('../controllers/lukujarjestykset')
const middleware = require('../utils/middleware')

router.get('/konfliktit', controller.tarkistaKonflikti)

// 🔍 hae lukujärjestys
router.get('/', controller.getOne)

// 💾 tallenna
router.post('/', middleware.requireKouluEiPoistettu, controller.save)

module.exports = router