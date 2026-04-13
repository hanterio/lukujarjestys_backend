const mongoose = require('mongoose')
const Koulu = require('../models/koulu')

/**
 * Kayttaja.koulu voi olla populate-tuotu dokumentti tai pelkkä ObjectId.
 * Älä käytä suoraan ref._id — populatematon ObjectId ei sisällä ._id-kenttää.
 */
function kouluObjectIdKayttajasta (user) {
  if (!user?.koulu) return null
  const r = user.koulu
  if (r._id) return r._id
  if (r instanceof mongoose.Types.ObjectId) return r
  if (mongoose.isValidObjectId(r)) return new mongoose.Types.ObjectId(String(r))
  return null
}

/**
 * Palauttaa käyttäjän koulun tilan (populate tai kouluId).
 */
async function getKouluTila (request) {
  const k = request.user?.koulu
  if (k && typeof k === 'object' && k.tila) {
    return k.tila
  }
  const kid = request.kouluId || kouluObjectIdKayttajasta(request.user)
  if (!kid) {
    return null
  }
  const doc = await Koulu.findById(kid).select('tila').lean()
  return doc?.tila || null
}

module.exports = { getKouluTila, kouluObjectIdKayttajasta }
