const kurssitRouter = require('express').Router()
const Kurssi = require('../models/kurssi')
const Lukuvuosi = require('../models/lukuvuosi')

kurssitRouter.get('/', async (request, response, next) => {
  try {
    const aktiivinenVuosi = await Lukuvuosi.findOne({ status: 'ACTIVE' })
    if (!aktiivinenVuosi) {
      return response.status(500).json({ error: 'Ei aktiivista lukuvuotta' })
    }

    const kurssit = await Kurssi.find({
      lukuvuosiId: aktiivinenVuosi._id
    })
    response.json(kurssit)
  } catch (error) {
    next(error)
  }})

kurssitRouter.get('/:id', async (request, response, next) => {
  const kurssi = await Kurssi.findById(request.params.id)
  if (kurssi) {
    response.json(kurssi)
  } else {
    response.status(404).end()
  }
})

kurssitRouter.delete('/:id', async (request, response, next) => {
  await Kurssi.findByIdAndDelete(request.params.id)
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
  response.status(201).json(savedKurssi)
})


kurssitRouter.put('/:id', (request, response, next) => {
  const body = request.body

  const kurssi = {
    nimi: body.nimi,
    aste: body.aste,
    luokka: body.luokka,
    vvt: body.vvt,
    opiskelijat: body.opiskelijat,
    opettaja: body.opettaja,
    opetus: body.opetus,
  }

  Kurssi.findByIdAndUpdate(request.params.id, kurssi, { new: true })
    .then(updatedKurssi => {
      response.json(updatedKurssi)
    })
    .catch(error => next(error))
})

module.exports = kurssitRouter

