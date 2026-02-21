const router = require('express').Router()
const { opettajaOpetusmaaraExcel } = require('../controllers/raportit')

router.get('/opettajaopetusmaara/excel', opettajaOpetusmaaraExcel)

module.exports = router