const mongoose = require('mongoose')
const Koulu = require('../models/koulu')
const Lukuvuosi = require('../models/lukuvuosi')

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
    return Lukuvuosi.findOne({ status: 'ACTIVE' })
  }

  if (!mongoose.Types.ObjectId.isValid(kouluId)) {
    return Lukuvuosi.findOne({ status: 'ACTIVE' })
  }

  const kid = new mongoose.Types.ObjectId(kouluId)
  const koulu = await Koulu.findById(kid).select('aktiivinenLukuvuosiId').lean()
  if (!koulu) {
    return Lukuvuosi.findOne({ status: 'ACTIVE' })
  }

  if (!koulu.aktiivinenLukuvuosiId) {
    const legacy = await Lukuvuosi.findOne({ status: 'ACTIVE' })
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

  return Lukuvuosi.findOne({ status: 'ACTIVE' })
}

module.exports = { getAktiivinenLukuvuosiForKoulu }
