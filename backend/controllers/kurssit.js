const kurssitRouter = require('express').Router()
const Kurssi = require('../models/kurssi')
const { requireKouluHallinta, requireKouluEiPoistettu } = require('../utils/middleware')
const { getKouluTila } = require('../utils/kouluRequest')
const { getEffectiveLukuvuosiForRequest } = require('../utils/effectiveLukuvuosi')
const mongoose = require('mongoose')

let kurssiCache = null
let kurssiCacheTime = 0

kurssitRouter.get('/', async (request, response, next) => {
  try {
    if (request.user?.rooli === 'teacher' && !request.kouluId) {
      return response.json([])
    }

    if (request.user?.rooli !== 'superadmin' && request.kouluId) {
      const tila = await getKouluTila(request)
      if (tila === 'poistettu') {
        return response.json([])
      }
    }

    const now = Date.now()
    const kouluId = request.kouluId?.toString()

    const { effective: aktiivinenVuosi, esikatselu } = await getEffectiveLukuvuosiForRequest(request)
    const lvKey = `${aktiivinenVuosi?._id?.toString() || 'none'}${esikatselu ? ':e' : ':p'}`

    if (
      kurssiCache &&
      now - kurssiCacheTime < 10000 &&
      kurssiCache._kouluId === kouluId &&
      kurssiCache._lukuvuosiId === lvKey
    ) {
      return response.json(kurssiCache._data)
    }

    if (!aktiivinenVuosi) {
      return response.json([])
    }

    const query = { lukuvuosiId: aktiivinenVuosi._id }

    // Suodatetaan koulun mukaan jos kouluId löytyy
    if (request.kouluId) {
      query.kouluId = request.kouluId
    }

    const kurssit = await Kurssi.find(query).populate({
      path: 'aineId',
      strictPopulate: false
    })

    kurssiCache = { _kouluId: kouluId, _lukuvuosiId: lvKey, _data: kurssit }
    kurssiCacheTime = now

    response.json(kurssit)

  } catch (error) {
    next(error)
  }
})

kurssitRouter.post('/tuonti', requireKouluHallinta, requireKouluEiPoistettu, async (request, response, next) => {
  try {
    if (!request.kouluId) {
      return response.status(400).json({
        error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).'
      })
    }
    const { kurssit: rivit } = request.body
    if (!Array.isArray(rivit) || rivit.length === 0) {
      return response.status(400).json({ error: 'Bodyssa pitää olla taulukko "kurssit".' })
    }
    const { effective: aktiivinenVuosi } = await getEffectiveLukuvuosiForRequest(request)
    if (!aktiivinenVuosi) {
      return response.status(500).json({ error: 'Ei aktiivista lukuvuotta' })
    }
    let luotu = 0
    for (const body of rivit) {
      if (!body || !body.nimi) {
        continue
      }
      const kurssi = new Kurssi({
        nimi: body.nimi,
        aste: body.aste || 'lukio',
        luokka: Array.isArray(body.luokka) ? body.luokka : [],
        vvt: body.vvt != null ? String(body.vvt) : '',
        opiskelijat: body.opiskelijat != null ? String(body.opiskelijat) : '',
        opettaja: Array.isArray(body.opettaja) ? body.opettaja.map(String) : [],
        opetus: Array.isArray(body.opetus) ? body.opetus : [],
        lukuvuosiId: aktiivinenVuosi._id,
        kouluId: request.kouluId,
        vvtRyhmaId: body.vvtRyhmaId && String(body.vvtRyhmaId).trim()
          ? String(body.vvtRyhmaId).trim()
          : null,
      })
      if (body.aineId && mongoose.Types.ObjectId.isValid(body.aineId)) {
        kurssi.aineId = body.aineId
      }
      await kurssi.save()
      luotu += 1
    }
    kurssiCache = null
    request.app.get('io').emit('kurssitPaivitetty')
    response.status(201).json({ luotu, yhteensa: rivit.length })
  } catch (error) {
    next(error)
  }
})

/** Poistaa kaikki koulun kurssit aktiiviselta lukuvuodelta (tuonnin "korvaa kaikki"). */
kurssitRouter.delete(
  '/koulu-kaikki',
  requireKouluHallinta,
  requireKouluEiPoistettu,
  async (request, response, next) => {
    try {
      if (!request.kouluId) {
        return response.status(400).json({
          error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).',
        })
      }
      const { effective: aktiivinenVuosi } = await getEffectiveLukuvuosiForRequest(request)
      if (!aktiivinenVuosi) {
        return response.status(500).json({ error: 'Ei aktiivista lukuvuotta' })
      }
      const result = await Kurssi.deleteMany({
        kouluId: request.kouluId,
        lukuvuosiId: aktiivinenVuosi._id,
      })
      kurssiCache = null
      request.app.get('io').emit('kurssitPaivitetty')
      response.json({ poistettu: result.deletedCount })
    } catch (error) {
      next(error)
    }
  }
)

kurssitRouter.get('/:id', async (request, response, next) => {
  const kurssi = await Kurssi
    .findById(request.params.id)
    .populate({ path: 'aineId', strictPopulate: false })
    .lean()
  if (kurssi) {
    response.json(kurssi)
  } else {
    response.status(404).end()
  }
})

kurssitRouter.delete('/:id', requireKouluEiPoistettu, async (request, response, next) => {
  await Kurssi.findByIdAndDelete(request.params.id)
  kurssiCache = null

  request.app.get('io').emit('kurssitPaivitetty')

  response.status(204).end()
})

kurssitRouter.post('/', requireKouluEiPoistettu, async (request, response, next) => {
  const body = request.body

  if (!body.nimi) {
    return next(new Error('kurssin nimi puuttuu'))
  }
  if (!request.kouluId) {
    return response.status(400).json({
      error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).'
    })
  }
  const { effective: aktiivinenVuosi } = await getEffectiveLukuvuosiForRequest(request)
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
    kouluId: request.kouluId,
    vvtRyhmaId: body.vvtRyhmaId && String(body.vvtRyhmaId).trim()
      ? String(body.vvtRyhmaId).trim()
      : null,
  })
  if (body.aineId && mongoose.Types.ObjectId.isValid(body.aineId)) {
    kurssi.aineId = body.aineId
  }
  const savedKurssi = await kurssi.save()
  kurssiCache = null
  request.app.get('io').emit('kurssitPaivitetty')
  response.status(201).json(savedKurssi)
})


kurssitRouter.put('/:id', requireKouluEiPoistettu, async (request, response, next) => {
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
    if (body.aineId !== undefined) {
      kurssi.aineId = body.aineId && mongoose.Types.ObjectId.isValid(body.aineId)
        ? body.aineId
        : null
    }
    if (body.vvtRyhmaId !== undefined) {
      kurssi.vvtRyhmaId = body.vvtRyhmaId && String(body.vvtRyhmaId).trim()
        ? String(body.vvtRyhmaId).trim()
        : null
    }

    const savedKurssi = await kurssi.save()
    kurssiCache = null

    // 🔥 LISÄÄ TÄMÄ
    request.app.get('io').emit('kurssitPaivitetty')
    response.json(savedKurssi)

  } catch (error) {
    next(error)
  }
})

kurssitRouter.patch('/:id', requireKouluHallinta, requireKouluEiPoistettu, async (request, response, next) => {
  try {
    const body = request.body
    const kurssi = await Kurssi.findById(request.params.id)

    if (!kurssi) {
      return response.status(404).end()
    }
    if (
      request.kouluId &&
      kurssi.kouluId &&
      kurssi.kouluId.toString() !== request.kouluId.toString()
    ) {
      return response.status(403).json({ error: 'kurssi kuuluu toiselle koululle' })
    }
    if (body.__v !== undefined && body.__v !== kurssi.__v) {
      return response.status(409).json({
        error: 'Kurssia on muokattu toisaalla. Päivitä sivu.',
      })
    }

    if (body.opetus !== undefined) {
      kurssi.opetus = body.opetus
    }
    if (body.vvtRyhmaId !== undefined) {
      kurssi.vvtRyhmaId = body.vvtRyhmaId && String(body.vvtRyhmaId).trim()
        ? String(body.vvtRyhmaId).trim()
        : null
    }
    if (body.opettaja !== undefined) {
      kurssi.opettaja = Array.isArray(body.opettaja) ? body.opettaja : []
    }

    const savedKurssi = await kurssi.save()
    kurssiCache = null
    request.app.get('io').emit('kurssitPaivitetty')
    response.json(savedKurssi)
  } catch (error) {
    next(error)
  }
})

module.exports = kurssitRouter

