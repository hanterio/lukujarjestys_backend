const router = require('express').Router()
const Lukuvuosi = require('../models/lukuvuosi')
const { requireKouluHallinta, requireKouluEiPoistettu } = require('../utils/middleware')
const { getEffectiveLukuvuosiForRequest } = require('../utils/effectiveLukuvuosi')
const { getAktiivinenLukuvuosiForKoulu } = require('../utils/resolveAktiivinenLukuvuosi')

/** Julkaistu lukuvuosi (Koulu.aktiivinenLukuvuosiId / resolver), ei esikatselua. */
router.get('/julkaistu', async (req, res) => {
  try {
    const lv = await getAktiivinenLukuvuosiForKoulu(req.kouluId)
    if (!lv) {
      return res.status(404).json({ error: 'Ei julkaistua lukuvuotta' })
    }
    res.json(lv)
  } catch (error) {
    console.error('Lukuvuosi julkaistu:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

/** GET: julkaistu lukuvuosi tai hallinnan esikatselu (X-Esikatselu-Lukuvuosi-Id). */
router.get('/active', async (req, res) => {
  try {
    const { effective } = await getEffectiveLukuvuosiForRequest(req)

    if (!effective) {
      return res.status(404).json({ error: 'Ei aktiivista lukuvuotta' })
    }

    res.json(effective)
  } catch (error) {
    console.error('Lukuvuosi virhe:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

/** Kaikki lukuvuodet (hallinnon valikkoon). */
router.get('/', requireKouluHallinta, async (req, res) => {
  try {
    const lista = await Lukuvuosi.find({}).sort({ name: 1 }).lean()
    res.json(lista)
  } catch (error) {
    console.error('Lukuvuodet lista:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

/** Luo uusi lukuvuosi (nimi esim. 2026–2027). */
router.post('/', requireKouluHallinta, requireKouluEiPoistettu, async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim()
    if (!name) {
      return res.status(400).json({ error: 'Lukuvuoden nimi puuttuu' })
    }
    const doc = await Lukuvuosi.create({
      name,
      status: 'ACTIVE',
    })
    res.status(201).json(doc)
  } catch (error) {
    next(error)
  }
})

module.exports = router
