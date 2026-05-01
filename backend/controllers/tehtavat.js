const tehtavatRouter = require('express').Router()
const Tehtava = require('../models/tehtava')
const logger = require('../utils/logger')
const middleware = require('../utils/middleware')
const mongoose = require('mongoose')
const { getEffectiveLukuvuosiForRequest } = require('../utils/effectiveLukuvuosi')

const omaKouluId = '69cc1858f37f1373e6e237ba'

const idsEqual = (a, b) => Boolean(a && b && String(a) === String(b))

/**
 * Luku- ja kirjoitusoikeus tehtävään: koulu täsmää (kun koulu pyynnössä on).
 * Lukuvuosi: jos pyynnön tehokas lukuvuosi on ja tehtävällä on lukuvuosiId, ne täsmäävät.
 */
async function resolveTehtavaForAccess (request) {
  const id = request.params._id
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { status: 400, message: 'virheellinen id' }
  }

  const tehtava = await Tehtava.findById(id)
  if (!tehtava) {
    return { status: 404 }
  }

  const onSuperadmin = request.user?.rooli === 'superadmin'
  if (!request.kouluId) {
    if (onSuperadmin) {
      return { tehtava }
    }
    return { status: 403, message: 'koulu puuttuu' }
  }

  if (!tehtava.kouluId || !idsEqual(tehtava.kouluId, request.kouluId)) {
    return { status: 403, message: 'ei oikeutta' }
  }

  const { effective } = await getEffectiveLukuvuosiForRequest(request)
  if (effective && tehtava.lukuvuosiId && !idsEqual(tehtava.lukuvuosiId, effective._id)) {
    return { status: 403, message: 'ei oikeutta' }
  }

  return { tehtava }
}

tehtavatRouter.get('/',
  middleware.flexUserExtractor,
  async (request, response, next) => {
    try {
      if (request.user?.rooli === 'teacher' && !request.kouluId) {
        return response.json([])
      }

      const kouluId = request.kouluId?.toString()
      const onSuperadmin = request.user?.rooli === 'superadmin'

      let suodatus
      if (onSuperadmin) {
        if (request.kouluId) {
          suodatus = { kouluId: request.kouluId }
        } else {
          suodatus = {}
        }
      } else if (kouluId === omaKouluId) {
        suodatus = { kouluId: new mongoose.Types.ObjectId(omaKouluId) }
      } else {
        suodatus = { kouluId: request.kouluId }
      }

      const { effective } = await getEffectiveLukuvuosiForRequest(request)
      if (suodatus.kouluId) {
        if (!effective) {
          return response.json([])
        }
        suodatus.lukuvuosiId = effective._id
      }

      const tehtavat = await Tehtava.find(suodatus)
      response.json(tehtavat)
    } catch (e) {
      next(e)
    }
  }
)

tehtavatRouter.get('/:_id', async (request, response, next) => {
    try {
      const res = await resolveTehtavaForAccess(request)
      if (res.status) {
        if (res.message) {
          return response.status(res.status).json({ error: res.message })
        }
        return response.status(res.status).end()
      }
      response.json(res.tehtava)
    } catch (error) {
      next(error)
    }
  }
)

tehtavatRouter.delete('/:_id', middleware.requireKouluEiPoistettu, async (request, response, next) => {
  try {
    const res = await resolveTehtavaForAccess(request)
    if (res.status) {
      if (res.message) {
        return response.status(res.status).json({ error: res.message })
      }
      return response.status(res.status).end()
    }
    await Tehtava.findByIdAndDelete(res.tehtava._id)
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

tehtavatRouter.post('/', middleware.requireKouluEiPoistettu, async (request, response, next) => {
  try {
    const body = request.body

    if (!body.kuvaus) {
      return next(new Error('tehtävän kuvaus puuttuu'))
    }

    if (!request.kouluId) {
      return response.status(400).json({ error: 'koulu puuttuu' })
    }

    const { effective } = await getEffectiveLukuvuosiForRequest(request)
    if (!effective) {
      return response.status(400).json({ error: 'Ei aktiivista lukuvuotta' })
    }

    const tehtava = new Tehtava({
      kuvaus: body.kuvaus,
      opettaja: body.opettaja,
      vvt: body.vvt,
      eur: body.eur,
      rahana: body.rahana,
      kouluId: request.kouluId,
      lukuvuosiId: effective._id,
    })
    const savedTehtava = await tehtava.save()
    response.json(savedTehtava)
  } catch (error) {
    next(error)
  }
})

tehtavatRouter.put('/:_id', middleware.requireKouluEiPoistettu, async (request, response, next) => {
  try {
    logger.info('PUT-pyyntö vastaanotettu ID:llä:', request.params._id)
    logger.info('Body data:', request.body)

    const res = await resolveTehtavaForAccess(request)
    if (res.status) {
      if (res.message) {
        return response.status(res.status).json({ error: res.message })
      }
      return response.status(res.status).end()
    }

    const body = request.body
    const paivitys = {
      kuvaus: body.kuvaus,
      opettaja: body.opettaja,
      vvt: body.vvt,
      eur: body.eur,
      rahana: body.rahana,
    }

    const updatedTehtava = await Tehtava.findByIdAndUpdate(
      res.tehtava._id,
      paivitys,
      { new: true }
    )
    response.json(updatedTehtava)
  } catch (error) {
    next(error)
  }
})

module.exports = tehtavatRouter