const router = require('express').Router()
const middleware = require('../utils/middleware')
const {
  opettajaOpetusmaaraExcel,
  opettajienKokonaistyomaaraExcel
} = require('../controllers/raportit')

router.get(
  '/opettajaopetusmaara/excel',
  middleware.flexUserExtractor,
  opettajaOpetusmaaraExcel
)
router.get(
  '/opettajien-kokonaistyomaara/excel',
  middleware.flexUserExtractor,
  opettajienKokonaistyomaaraExcel
)

module.exports = router