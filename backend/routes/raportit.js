const router = require('express').Router()
const {
  opettajaOpetusmaaraExcel,
  opettajienKokonaistyomaaraExcel
} = require('../controllers/raportit')

router.get('/opettajaopetusmaara/excel', opettajaOpetusmaaraExcel)
router.get(
  '/opettajien-kokonaistyomaara/excel',
  opettajienKokonaistyomaaraExcel
)

module.exports = router