const router = require('express').Router()
const Koulu = require('../models/koulu')
const Kayttaja = require('../models/kayttaja')
const jwt = require('jsonwebtoken')
const config = require('../utils/config')

// Middleware joka tarkistaa että käyttäjä on superadmin
const vaatiSuperadmin = (req, res, next) => {
  const authorization = req.get('authorization')
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'token puuttuu' })
  }

  const token = authorization.replace('Bearer ', '')
  const decoded = jwt.verify(token, config.SECRET)

  if (decoded.rooli !== 'superadmin') {
    return res.status(403).json({ error: 'ei oikeuksia' })
  }

  req.kayttaja = decoded
  next()
}

// Hae kaikki koulut
router.get('/koulut', vaatiSuperadmin, async (req, res) => {
  const koulut = await Koulu.find({}).sort({ kokeiluAlkoi: -1 })
  res.json(koulut)
})

// Aktivoi koulu
router.put('/koulut/:id/aktivoi', vaatiSuperadmin, async (req, res) => {
  const { domain } = req.body
  const koulu = await Koulu.findByIdAndUpdate(
    req.params.id,
    { tila: 'aktiivinen', domain },
    { new: true }
  )
  res.json(koulu)
})

// Poista koulu
router.delete('/koulut/:id', vaatiSuperadmin, async (req, res) => {
  await Koulu.findByIdAndUpdate(req.params.id, { tila: 'poistettu' })
  res.json({ message: 'Koulu poistettu' })
})

module.exports = router