const kurssitRouter = require('express').Router()
const Kurssi = require('../models/kurssi')

kurssitRouter.get('/', async (request, response) => {
  const kurssit = await Kurssi.find({})
  response.json(kurssit)
})

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

  const kurssi = new Kurssi({
    'nimi': body.nimi,
    'aste': body.aste,
    'luokka': body.luokka,
    'vvt': body.vvt,
    'opiskelijat': body.opiskelijat,
    'opettaja': body.opettaja,
    'opetus': body.opetus,
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

