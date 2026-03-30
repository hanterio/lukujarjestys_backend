const express = require('express')
const router = express.Router()
const controller = require('../controllers/optimointi')

router.post('/', controller.optimoi)

module.exports = router