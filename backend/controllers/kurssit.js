const kurssitRouter = require('express').Router()
const Kurssi = require('../models/kurssi')

kurssitRouter.get('/', (request, response) => {
  Kurssi.find({}).then(kurssit => {
    response.json(kurssit)
  })
})

kurssitRouter.get('/:id', (request, response, next) => {
  Kurssi.findById(request.params.id).then(kurssi => {
    if (kurssi) {
      response.json(kurssi)
    } else {
      response.status(404).end()
    }
  })
    .catch(error => next(error))
})

kurssitRouter.delete('/:id', (request, response, next) => {
  Kurssi.findByIdAndDelete(request.params.id)
    .then(() => {
      response.status(204).end()
    })
    .catch(error => next(error))
})

kurssitRouter.post('/', (request, response, next) => {
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
  kurssi.save()
    .then(savedKurssi => {
      response.json(savedKurssi)
    })
    .catch(error => next(error))
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

