const mongoose = require('mongoose')
const Koulu = require('../models/koulu')
const Lukuvuosi = require('../models/lukuvuosi')

/**
 * Palauttaa koulun julkaistun lukuvuoden (aktiivinenLukuvuosiId),
 * tai lazy-asettaa uusimman ACTIVE-lukuvuoden koululle jos puuttuu.
 */
async function getAktiivinenLukuvuosiForKoulu(kouluId) {
  if (!kouluId || !mongoose.Types.ObjectId.isValid(kouluId)) {
    return null
  }

  const kid = new mongoose.Types.ObjectId(kouluId)
  const koulu = await Koulu.findById(kid).select('aktiivinenLukuvuosiId').lean()
  if (!koulu) {
    return null
  }

  if (koulu.aktiivinenLukuvuosiId) {
    const doc = await Lukuvuosi.findById(koulu.aktiivinenLukuvuosiId).lean()
    if (
      doc &&
      doc.kouluId &&
      String(doc.kouluId) === String(kid)
    ) {
      return Lukuvuosi.findById(doc._id)
    }
  }

  const fallback = await Lukuvuosi.findOne({ kouluId: kid, status: 'ACTIVE' })
    .sort({ createdAt: -1 })

  if (fallback) {
    await Koulu.updateOne(
      { _id: kid },
      { $set: { aktiivinenLukuvuosiId: fallback._id } }
    )
    return fallback
  }

  return null
}

module.exports = { getAktiivinenLukuvuosiForKoulu }
