const bcrypt = require('bcrypt')
const opettajatRouter = require('express').Router()
const Opettaja = require('../models/opettaja')
const logger = require('../utils/logger')

opettajatRouter.get('/', async (request, response) => {
  const opettajat = await Opettaja.find({})
  response.json(opettajat)
  })

opettajatRouter.get('/:id', (request, response, next) => {
  Opettaja.findById(request.params.id).then(opettaja => {
    if (opettaja) {
      response.json(opettaja)
    } else {
      response.status(404).end()
    }
  })
    .catch(error => next(error))
})

opettajatRouter.delete('/:id', (request, response, next) => {
  Opettaja.findByIdAndDelete(request.params.id)
    .then(() => {
      response.status(204).end()
    })
    .catch(error => next(error))
})

opettajatRouter.post('/', async (request, response) => {
  const { opettaja, opv, password } = request.body

  const saltRounds = 10
  const passwordHash = await bcrypt.hash(password, saltRounds)

  const ope = new Opettaja({
    opettaja,
    opv,
    passwordHash
  })

  const savedOpettaja = await ope.save()
  response.status(201).json(savedOpettaja)
})

opettajatRouter.put('/:id', (request, response, next) => {
  logger.info('PUT-pyyntö vastaanotettu ID:llä:', request.params.id)
  logger.info('Body data:', request.body)

  const body = request.body

  const opettaja = {
    opettaja: body.opettaja,
    opv: body.opv,
  }

  Opettaja.findByIdAndUpdate(request.params.id, opettaja, { new: true })
    .then(updatedOpettaja => {
      response.json(updatedOpettaja)
    })
    .catch(error => next(error))
})

module.exports = opettajatRouter