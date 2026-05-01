const tyomaaraKommentitRouter = require('express').Router()
const mongoose = require('mongoose')
const TyomaaraKommentti = require('../models/tyomaaraKommentti')
const middleware = require('../utils/middleware')
const { getEffectiveLukuvuosiForRequest } = require('../utils/effectiveLukuvuosi')

const idsEqual = (a, b) => Boolean(a && b && String(a) === String(b))

function canManageKommentit (request) {
  return (
    request.user?.rooli === 'school_admin' ||
    request.user?.rooli === 'superadmin' ||
    request.user?.admin === true
  )
}

async function resolveKommenttiForAccess (request) {
  const id = request.params._id
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { status: 400, message: 'virheellinen id' }
  }
  const kommentti = await TyomaaraKommentti.findById(id)
  if (!kommentti) return { status: 404 }

  const onSuperadmin = request.user?.rooli === 'superadmin'
  if (!request.kouluId) {
    if (onSuperadmin) return { kommentti }
    return { status: 403, message: 'koulu puuttuu' }
  }
  if (!idsEqual(kommentti.kouluId, request.kouluId)) {
    return { status: 403, message: 'ei oikeutta' }
  }

  const { effective } = await getEffectiveLukuvuosiForRequest(request)
  if (effective && !idsEqual(kommentti.lukuvuosiId, effective._id)) {
    return { status: 403, message: 'ei oikeutta' }
  }
  return { kommentti }
}

tyomaaraKommentitRouter.get('/',
  async (request, response, next) => {
    try {
      if (request.user?.rooli === 'teacher' && !request.kouluId) {
        return response.json([])
      }
      if (!request.kouluId) {
        if (request.user?.rooli === 'superadmin') {
          return response.json([])
        }
        return response.status(403).json({ error: 'koulu puuttuu' })
      }
      const { effective } = await getEffectiveLukuvuosiForRequest(request)
      if (!effective) return response.json([])

      const kommentit = await TyomaaraKommentti
        .find({
          kouluId: request.kouluId,
          lukuvuosiId: effective._id,
        })
        .sort({ pvm: -1, createdAt: -1 })
      response.json(kommentit)
    } catch (error) {
      next(error)
    }
  }
)

tyomaaraKommentitRouter.post('/',
  middleware.requireKouluEiPoistettu,
  async (request, response, next) => {
    try {
      if (!canManageKommentit(request)) {
        return response.status(403).json({ error: 'vain hallinta voi lisätä kommentteja' })
      }
      if (!request.kouluId) {
        return response.status(400).json({ error: 'koulu puuttuu' })
      }

      const opettaja = String(request.body?.opettaja || '').trim().toUpperCase()
      const teksti = String(request.body?.teksti || '').trim()
      const pvmRaw = String(request.body?.pvm || '').trim()
      const pvm = pvmRaw ? new Date(pvmRaw) : new Date()

      if (!opettaja) return response.status(400).json({ error: 'opettaja puuttuu' })
      if (!teksti) return response.status(400).json({ error: 'kommentti puuttuu' })
      if (Number.isNaN(pvm.getTime())) {
        return response.status(400).json({ error: 'virheellinen päivämäärä' })
      }

      const { effective } = await getEffectiveLukuvuosiForRequest(request)
      if (!effective) {
        return response.status(400).json({ error: 'Ei aktiivista lukuvuotta' })
      }

      const kommentti = new TyomaaraKommentti({
        opettaja,
        teksti,
        pvm,
        kouluId: request.kouluId,
        lukuvuosiId: effective._id,
        lisaajaNimi: request.user?.nimi || request.user?.name || request.user?.opettaja || '',
      })
      const saved = await kommentti.save()
      response.json(saved)
    } catch (error) {
      next(error)
    }
  }
)

tyomaaraKommentitRouter.delete('/:_id',
  middleware.requireKouluEiPoistettu,
  async (request, response, next) => {
    try {
      if (!canManageKommentit(request)) {
        return response.status(403).json({ error: 'vain hallinta voi poistaa kommentteja' })
      }
      const res = await resolveKommenttiForAccess(request)
      if (res.status) {
        if (res.message) return response.status(res.status).json({ error: res.message })
        return response.status(res.status).end()
      }
      await TyomaaraKommentti.findByIdAndDelete(res.kommentti._id)
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  }
)

tyomaaraKommentitRouter.put('/:_id',
  middleware.requireKouluEiPoistettu,
  async (request, response, next) => {
    try {
      if (!canManageKommentit(request)) {
        return response.status(403).json({ error: 'vain hallinta voi muokata kommentteja' })
      }
      const res = await resolveKommenttiForAccess(request)
      if (res.status) {
        if (res.message) return response.status(res.status).json({ error: res.message })
        return response.status(res.status).end()
      }

      const teksti = String(request.body?.teksti || '').trim()
      const pvmRaw = String(request.body?.pvm || '').trim()
      const pvm = pvmRaw ? new Date(pvmRaw) : res.kommentti.pvm
      if (!teksti) return response.status(400).json({ error: 'kommentti puuttuu' })
      if (Number.isNaN(pvm.getTime())) {
        return response.status(400).json({ error: 'virheellinen päivämäärä' })
      }

      res.kommentti.teksti = teksti
      res.kommentti.pvm = pvm
      const saved = await res.kommentti.save()
      response.json(saved)
    } catch (error) {
      next(error)
    }
  }
)

module.exports = tyomaaraKommentitRouter
