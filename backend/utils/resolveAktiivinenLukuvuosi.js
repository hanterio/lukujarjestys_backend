const mongoose = require('mongoose')
const Koulu = require('../models/koulu')
const Lukuvuosi = require('../models/lukuvuosi')

async function haeLegacyAktiivinenLukuvuosi() {
  // Vanhassa mallissa voi olla useita ACTIVE-rivejä; käytetään aina uusinta.
  return Lukuvuosi.findOne({ status: 'ACTIVE' }).sort({ createdAt: -1 })
}

/**
 * Palauttaa aktiivisen lukuvuosi-dokumentin.
 * - Jos kouluId on annettu: ensisijaisesti koulun `aktiivinenLukuvuosiId`, muuten lazy-migraatio
 *   (asetetaan sama kuin globaali ACTIVE) ja legacy `Lukuvuosi.findOne({ status: 'ACTIVE' })`.
 * - Ilman kouluId (esim. superadmin ilman valittua koulua): globaali ACTIVE.
 *
 * Legacy-haarat ja siivouslista: projektin juuren @BACKLOG.md (kohta «Lukuvuosi — legacy ja siivous»).
 */
async function getAktiivinenLukuvuosiForKoulu(kouluId) {
  if (!kouluId) {
    return haeLegacyAktiivinenLukuvuosi()
  }

  if (!mongoose.Types.ObjectId.isValid(kouluId)) {
    return haeLegacyAktiivinenLukuvuosi()
  }

  const kid = new mongoose.Types.ObjectId(kouluId)
  const koulu = await Koulu.findById(kid).select('aktiivinenLukuvuosiId tila').lean()
  if (!koulu) {
    return haeLegacyAktiivinenLukuvuosi()
  }

  // Kokeilukouluilla käytetään aina uusinta aktiivista lukuvuotta,
  // jotta superadminin oletusnimen päivitys näkyy heti myös kokeilukäyttäjillä.
  if (koulu.tila === 'kokeilu') {
    const legacy = await haeLegacyAktiivinenLukuvuosi()
    if (!legacy) return null
    if (!koulu.aktiivinenLukuvuosiId || String(koulu.aktiivinenLukuvuosiId) !== String(legacy._id)) {
      await Koulu.updateOne(
        { _id: kid },
        { $set: { aktiivinenLukuvuosiId: legacy._id } }
      )
    }
    return legacy
  }

  if (!koulu.aktiivinenLukuvuosiId) {
    const legacy = await haeLegacyAktiivinenLukuvuosi()
    if (legacy) {
      await Koulu.updateOne(
        {
          _id: kid,
          $or: [
            { aktiivinenLukuvuosiId: { $exists: false } },
            { aktiivinenLukuvuosiId: null },
          ],
        },
        { $set: { aktiivinenLukuvuosiId: legacy._id } }
      )
      return legacy
    }
    return null
  }

  const doc = await Lukuvuosi.findById(koulu.aktiivinenLukuvuosiId)
  if (doc) {
    return doc
  }

  return haeLegacyAktiivinenLukuvuosi()
}

module.exports = { getAktiivinenLukuvuosiForKoulu }
