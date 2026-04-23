const router = require('express').Router()
const Koulu = require('../models/koulu')
const Lukuvuosi = require('../models/lukuvuosi')
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

// Poista koulu (pehmeä poisto)
router.delete('/koulut/:id', vaatiSuperadmin, async (req, res) => {
  await Koulu.findByIdAndUpdate(req.params.id, { tila: 'poistettu' })
  res.json({ message: 'Koulu poistettu' })
})

// Palauta poistettu koulu kokeiluun (käyttäjät näkevät taas kokeilunäkymän)
router.put('/koulut/:id/palauta', vaatiSuperadmin, async (req, res) => {
  const k = await Koulu.findById(req.params.id)
  if (!k) {
    return res.status(404).json({ error: 'Koulua ei löydy' })
  }
  if (k.tila !== 'poistettu') {
    return res.status(400).json({ error: 'Vain poistettu koulu voidaan palauttaa kokeiluun' })
  }
  k.tila = 'kokeilu'
  await k.save()
  res.json(k)
})

// Hae oletuslukuvuosi, joka näkyy uusille kokeilukäyttäjille
router.get('/kokeilu-lukuvuosi', vaatiSuperadmin, async (req, res) => {
  const lv = await Lukuvuosi.findOne({ status: 'ACTIVE' }).sort({ createdAt: -1 })
  if (!lv) {
    return res.status(404).json({ error: 'Aktiivista lukuvuotta ei löytynyt' })
  }
  res.json(lv)
})

// Päivitä oletuslukuvuoden nimi uusille kokeilukäyttäjille
router.put('/kokeilu-lukuvuosi', vaatiSuperadmin, async (req, res) => {
  const name = (req.body?.name || '').trim()
  if (!name) {
    return res.status(400).json({ error: 'Lukuvuoden nimi puuttuu' })
  }

  const lv = await Lukuvuosi.findOne({ status: 'ACTIVE' }).sort({ createdAt: -1 })
  if (!lv) {
    return res.status(404).json({ error: 'Aktiivista lukuvuotta ei löytynyt' })
  }

  // Pidetään ACTIVE-rivit keskenään samassa nimessä, jotta legacy-polut näyttävät saman otsikon.
  await Lukuvuosi.updateMany({ status: 'ACTIVE' }, { $set: { name } })
  // Varmistetaan että myös olemassa olevat kokeilukoulut osoittavat tähän aktiiviseen lukuvuoteen.
  await Koulu.updateMany({ tila: 'kokeilu' }, { $set: { aktiivinenLukuvuosiId: lv._id } })
  const paivitetty = await Lukuvuosi.findById(lv._id)
  res.json(paivitetty)
})

module.exports = router