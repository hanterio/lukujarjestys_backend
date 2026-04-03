const bcrypt = require('bcrypt')
const mongoose = require('mongoose')
const opettajatRouter = require('express').Router()
const Opettaja = require('../models/opettaja')
const middleware = require('../utils/middleware')

const ensureAdmin = (request, response, next) => {
  const u = request.user
  if (u?.rooli === 'superadmin' || u?.rooli === 'school_admin') return next()
  if (u?.admin === true) return next()
  return response.status(403).json({ error: 'admin required' })
}

/** Voiko käyttäjä käsitellä tämän opettajarivin (sama koulu tai superadmin) */
const voiKasitellaOpettajaa = (request, opettajaDoc) => {
  if (request.user?.rooli === 'superadmin') return true
  if (!request.kouluId || !opettajaDoc?.kouluId) return false
  return opettajaDoc.kouluId.toString() === request.kouluId.toString()
}

const resolveUusiKouluId = (request) => {
  if (request.kouluId) {
    return request.kouluId
  }
  if (request.user?.rooli === 'superadmin' && request.body?.kouluId) {
    const raw = request.body.kouluId
    if (mongoose.Types.ObjectId.isValid(raw)) {
      return new mongoose.Types.ObjectId(raw)
    }
  }
  return null
}

opettajatRouter.get('/',
  middleware.flexUserExtractor,
  async (request, response) => {
    const onSuperadmin = request.user?.rooli === 'superadmin'

    let query = {}
    if (onSuperadmin) {
      if (request.kouluId) {
        query = { kouluId: request.kouluId }
      } else {
        query = {}
      }
    } else {
      if (!request.kouluId) {
        return response.json([])
      }
      query = { kouluId: request.kouluId }
    }

    const opettajat = await Opettaja.find(query).sort({ opettaja: 1 })
    response.json(opettajat)
  }
)

opettajatRouter.get('/:id',
  middleware.flexUserExtractor,
  (request, response, next) => {
    Opettaja.findById(request.params.id).then(opettaja => {
      if (!opettaja) {
        return response.status(404).end()
      }
      if (!voiKasitellaOpettajaa(request, opettaja)) {
        return response.status(403).json({ error: 'ei oikeutta' })
      }
      response.json(opettaja)
    })
      .catch(error => next(error))
  }
)

opettajatRouter.delete('/:id',
  middleware.flexUserExtractor,
  ensureAdmin,
  async (request, response, next) => {
    try {
      const opettaja = await Opettaja.findById(request.params.id)
      if (!opettaja) {
        return response.status(404).end()
      }
      if (!voiKasitellaOpettajaa(request, opettaja)) {
        return response.status(403).json({ error: 'ei oikeutta' })
      }
      await Opettaja.findByIdAndDelete(request.params.id)
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  }
)

opettajatRouter.post('/',
  middleware.flexUserExtractor,
  ensureAdmin,
  async (request, response) => {
    const { opettaja, opv, password } = request.body
    const targetKouluId = resolveUusiKouluId(request)

    if (!targetKouluId) {
      return response.status(400).json({
        error: 'kouluId puuttuu (käytä valittua koulua tai lähetä kouluId superadminille)'
      })
    }

    if (!password || password.length < 3) {
      return response.status(400).json({ error: 'salasana liian lyhyt' })
    }

    const saltRounds = 10
    const passwordHash = await bcrypt.hash(password, saltRounds)

    const ope = new Opettaja({
      opettaja,
      opv: opv ?? 0,
      passwordHash,
      kouluId: targetKouluId
    })

    const savedOpettaja = await ope.save()
    response.status(201).json(savedOpettaja)
  }
)

opettajatRouter.put('/:id',
  middleware.flexUserExtractor,
  ensureAdmin,
  async (request, response, next) => {
    try {
      const body = request.body
      const existing = await Opettaja.findById(request.params.id)
      if (!existing) {
        return response.status(404).end()
      }
      if (!voiKasitellaOpettajaa(request, existing)) {
        return response.status(403).json({ error: 'ei oikeutta' })
      }

      const opettaja = {
        opettaja: body.opettaja,
        opv: body.opv
      }

      const updatedOpettaja = await Opettaja.findByIdAndUpdate(
        request.params.id,
        opettaja,
        { new: true }
      )
      response.json(updatedOpettaja)
    } catch (error) {
      next(error)
    }
  }
)

opettajatRouter.put('/:id/password',
  middleware.flexUserExtractor,
  ensureAdmin,
  async (request, response, next) => {
    try {
      const existing = await Opettaja.findById(request.params.id)
      if (!existing) {
        return response.status(404).end()
      }
      if (!voiKasitellaOpettajaa(request, existing)) {
        return response.status(403).json({ error: 'ei oikeutta' })
      }

      const { password } = request.body

      if (!password || password.length < 3) {
        return response.status(400).json({
          error: 'Salasanan pitää olla vähintään 3 merkkiä'
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
  }
)

module.exports = opettajatRouter
