const opettajatRouter = require('express').Router()
const Opettaja = require('../models/opettaja')
const logger = require('../utils/logger')

opettajatRouter.get('/', (request, response) => {
  Opettaja.find({}).then(opettajat => {
    response.json(opettajat)
  })
})

opettajatRouter.get('/:_id', (request, response, next) => {
  Opettaja.findById(request.params._id).then(opettaja => {
    if (opettaja) {
      response.json(opettaja)
    } else {
      response.status(404).end()
    }
  })
    .catch(error => next(error))
})

opettajatRouter.delete('/:_id', (request, response, next) => {
  Opettaja.findByIdAndDelete(request.params._id)
    .then(() => {
      response.status(204).end()
    })
    .catch(error => next(error))
})

opettajatRouter.post('/api/opettajat', (request, response, next) => {
  const body = request.body

  if (!body.opettaja) {
    return next(new Error('opettajatunnus puuttuu'))
  }

  const opettaja = new Opettaja({
    'opettaja': body.opettaja,
    'opv': body.opv,
  })
  opettaja.save()
    .then(savedOpettaja => {
      response.json(savedOpettaja)
    })
    .catch(error => next(error))
})

opettajatRouter.put('/:_id', (request, response, next) => {
  logger.info('PUT-pyyntö vastaanotettu ID:llä:', request.params._id)
  logger.info('Body data:', request.body)

  const body = request.body

  const opettaja = {
    opettaja: body.opettaja,
    opv: body.opv,
  }

  Opettaja.findByIdAndUpdate(request.params._id, opettaja, { new: true })
    .then(updatedOpettaja => {
      response.json(updatedOpettaja)
    })
    .catch(error => next(error))
})

module.exports = opettajatRouter