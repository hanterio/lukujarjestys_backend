const logger = require('./logger')
const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const Opettaja = require('../models/opettaja')
const Kayttaja = require('../models/kayttaja')


const requestLogger = (request, response, next) => {
  logger.info('Method:', request.method)
  logger.info('Path:  ', request.path)
  logger.info('Body:  ', request.body)
  logger.info('---')
  next()
}

const unknownEndpoint = (request, response) => {
  response.status(404).send({ error: 'unknown endpoint' })
}

const errorHandler = (error, request, response, next) => {
  logger.error(error.message)

  if (error.message === 'kurssin nimi puuttuu') {
    return response.status(400).json({ error: error.message })
  }

  if (error.name === 'CastError') {
    return response.status(400).send({ error: 'virheellinen id' })
  } else if (error.name === 'ValidationError') {
    return response.status(400).json({ error: error.message })
  } else if (error.name === 'MongoServerError' && error.message.includes('E11000 duplicate key error')) {
    return response.status(400).json({ error: 'expected `opettaja` to be unique' })
  }

  next(error)
}
const flexUserExtractor = async (request, response, next) => {
  const authorization = request.get('authorization')

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return response.status(401).json({ error: 'token missing' })
  }

  const token = authorization.replace('Bearer ', '')

  try {
    const decodedToken = jwt.verify(token, process.env.SECRET)
    console.log('decoded token:', decodedToken) // ← lisää tämä
    // Uusi käyttäjä (rooli-kenttä tokenissa)
    if (decodedToken.rooli) {
      const kayttaja = await Kayttaja.findById(decodedToken.id).populate('koulu')
      if (!kayttaja) {
        return response.status(401).json({ error: 'user not found' })
      }
      request.user = kayttaja
      request.kouluId = kayttaja.koulu?._id

      // Superadmin voi valita koulun näkymän (frontend lähettää otsakkeen)
      if (kayttaja.rooli === 'superadmin') {
        const headerKoulu = request.get('x-valittu-koulu-id')
        if (headerKoulu && mongoose.Types.ObjectId.isValid(headerKoulu)) {
          request.kouluId = new mongoose.Types.ObjectId(headerKoulu)
        }
      }
      return next()
    }

    // Vanha JWT (Opettaja-malli, login POST /api/login) — sama oletuskoulu kuin login.js OLETUS_KOULU_ID
    if (decodedToken.id) {
      const user = await Opettaja.findById(decodedToken.id)
      if (!user) {
        return response.status(401).json({ error: 'user not found' })
      }
      request.user = user
      request.kouluId = new mongoose.Types.ObjectId('69cc1858f37f1373e6e237ba')
      return next()
    }

    return response.status(401).json({ error: 'token invalid' })

  } catch (error) {
    return response.status(401).json({ error: 'token invalid' })
  }
}
const userExtractor = async (request, response, next) => {
  const authorization = request.get('authorization')

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return response.status(401).json({ error: 'token missing' })
  }

  const token = authorization.replace('Bearer ', '')

  try {
    const decodedToken = jwt.verify(token, process.env.SECRET)

    if (!decodedToken.id) {
      return response.status(401).json({ error: 'token invalid' })
    }

    const user = await Opettaja.findById(decodedToken.id)

    if (!user) {
      return response.status(401).json({ error: 'user not found' })
    }

    request.user = user
    next()

  } catch (error) {
    return response.status(401).json({ error: 'token invalid' })
  }
}
const adminOnly = (request, response, next) => {
  if (!request.user || !request.user.admin) {
    return response.status(403).json({ error: 'admin required' })
  }

  next()
}

module.exports = {
  requestLogger,
  unknownEndpoint,
  errorHandler,
  userExtractor,
  adminOnly,
  flexUserExtractor
}