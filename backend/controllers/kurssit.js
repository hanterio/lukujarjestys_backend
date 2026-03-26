const kurssitRouter = require('express').Router()
const Kurssi = require('../models/kurssi')
const Lukuvuosi = require('../models/lukuvuosi')

let cachedLukuvuosi = null
let lukuvuosiCacheTime = 0

let kurssiCache = null
let kurssiCacheTime = 0

kurssitRouter.get('/', async (request, response, next) => {
  try {
    const now = Date.now()

    // 🔹 kurssi-cache (10s)
    if (kurssiCache && now - kurssiCacheTime < 10000) {
      return response.json(kurssiCache)
    }

    // 🔹 lukuvuosi-cache (60s)
    let aktiivinenVuosi = cachedLukuvuosi

    if (!aktiivinenVuosi || now - lukuvuosiCacheTime > 60000) {
      aktiivinenVuosi = await Lukuvuosi.findOne({ status: 'ACTIVE' })
      cachedLukuvuosi = aktiivinenVuosi
      lukuvuosiCacheTime = now
    }
    if (!aktiivinenVuosi) {
      return response.status(500).json({ error: 'Ei aktiivista lukuvuotta' })
    }

    const kurssit = await Kurssi.find({
      lukuvuosiId: aktiivinenVuosi._id
    }).populate('aineId')

    kurssiCache = kurssit
    kurssiCacheTime = now

    response.json(kurssit)

  } catch (error) {
    next(error)
  }
})

kurssitRouter.get('/:id', async (request, response, next) => {
  const kurssi = await Kurssi
    .findById(request.params.id)
    .populate('aineId')
    .lean()
  if (kurssi) {
    response.json(kurssi)
  } else {
    response.status(404).end()
  }
})

kurssitRouter.delete('/:id', async (request, response, next) => {
  await Kurssi.findByIdAndDelete(request.params.id)
  kurssiCache = null

  request.app.get('io').emit('kurssitPaivitetty')

  response.status(204).end()
})

kurssitRouter.post('/', async (request, response, next) => {
  const body = request.body

  if (!body.nimi) {
    return next(new Error('kurssin nimi puuttuu'))
  }
  const aktiivinenVuosi = await Lukuvuosi.findOne({ status: 'ACTIVE' })
  if (!aktiivinenVuosi) {
    return response.status(500).json({ error: 'Ei aktiivista lukuvuotta' })
  }
  const kurssi = new Kurssi({
    'nimi': body.nimi,
    'aste': body.aste,
    'luokka': body.luokka,
    'vvt': body.vvt,
    'opiskelijat': body.opiskelijat,
    'opettaja': body.opettaja,
    'opetus': body.opetus,
    'lukuvuosiId': aktiivinenVuosi._id
  })
  const savedKurssi = await kurssi.save()
  kurssiCache = null

  request.app.get('io').emit('kurssitPaivitetty')

  response.status(201).json(savedKurssi)
})


kurssitRouter.put('/:id', async (request, response, next) => {
  try {
    const body = request.body

    const kurssi = await Kurssi.findById(request.params.id)

    if (!kurssi) {
      return response.status(404).end()
    }
    if (body.__v !== kurssi.__v) {
      return response.status(409).json({
        error: 'Kurssia on muokattu toisaalla. Päivitä sivu.'
      })
    }

    kurssi.nimi = body.nimi
    kurssi.aste = body.aste
    kurssi.luokka = body.luokka
    kurssi.vvt = body.vvt
    kurssi.opiskelijat = body.opiskelijat
    kurssi.opettaja = body.opettaja
    kurssi.opetus = body.opetus

    const savedKurssi = await kurssi.save()
    kurssiCache = null

    // 🔥 LISÄÄ TÄMÄ
    request.app.get('io').emit('kurssitPaivitetty')
    response.json(savedKurssi)

  } catch (error) {
    next(error)
  }
})

module.exports = kurssitRouter

