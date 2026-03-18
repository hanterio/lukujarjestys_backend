const bcrypt = require('bcrypt')
const opettajatRouter = require('express').Router()
const Opettaja = require('../models/opettaja')
const logger = require('../utils/logger')
const middleware = require('../utils/middleware')

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

opettajatRouter.delete('/:id',
  middleware.userExtractor,
  middleware.adminOnly,
  (request, response, next) => {

    Opettaja.findByIdAndDelete(request.params.id)
      .then(() => {
        response.status(204).end()
      })
      .catch(error => next(error))
  })

opettajatRouter.post('/',
  middleware.userExtractor,
  middleware.adminOnly,
  async (request, response) => {
    const { opettaja, opv, password } = request.body

    const saltRounds = 10
    const passwordHash = await bcrypt.hash(password, saltRounds)

    const ope = new Opettaja({
      opettaja,
      opv: opv ?? 0,
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

opettajatRouter.put('/:id/password',
  middleware.userExtractor,
  middleware.adminOnly,
  async (request, response, next) => {
    try {
      const { password } = request.body

      if (!password || password.length < 3) {
        return response.status(400).json({
          error: "Salasanan pitää olla vähintään 3 merkkiä"
        })
      }

      const passwordHash = await bcrypt.hash(password, 10)

      const updated = await Opettaja.findByIdAndUpdate(
        request.params.id,
        { passwordHash },
        { new: true }
      )

      response.json(updated)

    } catch (error) {
      next(error)
    }
  })

module.exports = opettajatRouter