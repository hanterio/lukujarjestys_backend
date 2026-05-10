const mongoose = require('mongoose')
const Lukuvuosi = require('../models/lukuvuosi')
const { getAktiivinenLukuvuosiForKoulu } = require('./resolveAktiivinenLukuvuosi')

/**
 * Hallinta (school_admin, superadmin, vanha Opettaja.admin) voi pyytää tietoja toiselta
 * lukuvuodelta otsakkeella X-Esikatselu-Lukuvuosi-Id — opettajat eivät lähetä sitä.
 * Julkaistu lukuvuosi kaikille: Koulu.aktiivinenLukuvuosiId + resolver.
 */
function canUseEsikatseluLukuvuosi (user) {
  if (!user) return false
  if (user.rooli === 'school_admin' || user.rooli === 'superadmin') return true
  if (user.admin === true) return true
  return false
}

/**
 * @returns {{ effective: import('mongoose').Document|null, published: import('mongoose').Document|null, esikatselu: boolean }}
 */
async function getEffectiveLukuvuosiForRequest (request) {
  const published = await getAktiivinenLukuvuosiForKoulu(request.kouluId)
  const headerRaw = request.get('x-esikatselu-lukuvuosi-id')
  if (!headerRaw || !mongoose.Types.ObjectId.isValid(headerRaw)) {
    return { effective: published, published, esikatselu: false }
  }
  if (!canUseEsikatseluLukuvuosi(request.user)) {
    return { effective: published, published, esikatselu: false }
  }
  const lvLean = await Lukuvuosi.findById(headerRaw).lean()
  if (!lvLean) {
    return { effective: published, published, esikatselu: false }
  }
  if (
    request.kouluId &&
    lvLean.kouluId &&
    String(lvLean.kouluId) !== String(request.kouluId)
  ) {
    return { effective: published, published, esikatselu: false }
  }
  if (published && lvLean._id.toString() === published._id.toString()) {
    return { effective: published, published, esikatselu: false }
  }
  const lvDoc = await Lukuvuosi.findById(headerRaw)
  return { effective: lvDoc, published, esikatselu: true }
}

module.exports = {
  canUseEsikatseluLukuvuosi,
  getEffectiveLukuvuosiForRequest,
}
