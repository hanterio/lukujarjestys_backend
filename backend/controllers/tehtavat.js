const tehtavatRouter = require('express').Router()
const Tehtava = require('../models/tehtava')
const logger = require('../utils/logger')

tehtavatRouter.get('/', (request, response) => {
  Tehtava.find({}).then(tehtavat => {
    response.json(tehtavat)
  })
})

tehtavatRouter.get('/:_id', (request, response, next) => {
  Tehtava.findById(request.params._id).then(tehtava => {
    if (tehtava) {
      response.json(tehtava)
    } else {
      response.status(404).end()
    }
  })
    .catch(error => next(error))
})

tehtavatRouter.delete('/:_id', (request, response, next) => {
  Tehtava.findByIdAndDelete(request.params._id)
    .then(() => {
      response.status(204).end()
    })
    .catch(error => next(error))
})

tehtavatRouter.post('/', (request, response, next) => {
  const body = request.body

  if (!body.kuvaus) {
    return next(new Error('tehtävän kuvaus puuttuu'))
  }

  const tehtava = new Tehtava({
    'kuvaus': body.kuvaus,
    'opettaja': body.opettaja,
    'vvt': body.vvt,
    'eur': body.eur,
    'rahana': body.rahana,
  })
  tehtava.save()
    .then(savedTehtava => {
      response.json(savedTehtava)
    })
    .catch(error => next(error))
})

tehtavatRouter.put('/:_id', (request, response, next) => {
  logger.info('PUT-pyyntö vastaanotettu ID:llä:', request.params._id);
  logger.info('Body data:', request.body)

  const body = request.body

  const tehtava = {
    kuvaus: body.kuvaus,
    opettaja: body.opettaja,
    vvt: body.vvt,
    eur: body.eur,
    rahana: body.rahana,
  }

  Tehtava.findByIdAndUpdate(request.params._id, tehtava, { new: true })
    .then(updatedTehtava => {
      response.json(updatedTehtava)
    })
    .catch(error => next(error))
})

module.exports = tehtavatRouter