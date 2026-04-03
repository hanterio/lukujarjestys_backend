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

    // Invalidoi cache jos eri koulu
    const kouluId = request.kouluId?.toString()
    if (kurssiCache && now - kurssiCacheTime < 10000 && kurssiCache._kouluId === kouluId) {
      return response.json(kurssiCache._data)
    }

    let aktiivinenVuosi = cachedLukuvuosi
    if (!aktiivinenVuosi || now - lukuvuosiCacheTime > 60000) {
      aktiivinenVuosi = await Lukuvuosi.findOne({ status: 'ACTIVE' })
      cachedLukuvuosi = aktiivinenVuosi
      lukuvuosiCacheTime = now
    }
    if (!aktiivinenVuosi) {
      return response.status(500).json({ error: 'Ei aktiivista lukuvuotta' })
    }

    const query = { lukuvuosiId: aktiivinenVuosi._id }

    // Suodatetaan koulun mukaan jos kouluId löytyy
    if (request.kouluId) {
      query.kouluId = request.kouluId
    }

    const kurssit = await Kurssi.find(query).populate('aineId')

    kurssiCache = { _kouluId: kouluId, _data: kurssit }
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
  if (!request.kouluId) {
    return response.status(400).json({
      error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).'
    })
  }
  const aktiivinenVuosi = await Lukuvuosi.findOne({ status: 'ACTIVE' })
  if (!aktiivinenVuosi) {
    return response.status(500).json({ error: 'Ei aktiivista lukuvuotta' })
  }
  const kurssi = new Kurssi({
    nimi: body.nimi,
    aste: body.aste,
    luokka: body.luokka,
    vvt: body.vvt,
    opiskelijat: body.opiskelijat,
    opettaja: body.opettaja,
    opetus: body.opetus,
    lukuvuosiId: aktiivinenVuosi._id,
    kouluId: request.kouluId  // ← lisätään
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

