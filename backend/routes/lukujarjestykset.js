const express = require('express')
const router = express.Router()

const controller = require('../controllers/lukujarjestykset')


router.get('/konfliktit', controller.tarkistaKonflikti)

// 🔍 hae lukujärjestys
router.get('/', controller.getOne)


// 💾 tallenna
router.post('/', controller.save)


module.exports = router