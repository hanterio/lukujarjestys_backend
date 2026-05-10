const kouluRouter = require('express').Router()
const jwt = require('jsonwebtoken')
const Kayttaja = require('../models/kayttaja')
const Koulu = require('../models/koulu')
const Lukuvuosi = require('../models/lukuvuosi')
const mongoose = require('mongoose')
const config = require('../utils/config')
const { generateUniqueAktivointitunnus } = require('../utils/kouluTrial')
const middleware = require('../utils/middleware')
const { poistaKokeilukouluJaData } = require('../utils/poistaKokeilukoulu')
const { kouluObjectIdKayttajasta } = require('../utils/kouluRequest')
const { getAktiivinenLukuvuosiForKoulu } = require('../utils/resolveAktiivinenLukuvuosi')
const { getEffectiveLukuvuosiForRequest } = require('../utils/effectiveLukuvuosi')
const logger = require('../utils/logger')
const viikonpaivat = ['ma', 'ti', 'ke', 'to', 'pe']

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const normalizeAikatauluProfiili = (raw) => {
  const normAste = (asteRaw) => {
    const paivatIn = Array.isArray(asteRaw?.paivat) ? asteRaw.paivat : []
    return {
      paivat: paivatIn
        .filter((p) => viikonpaivat.includes(String(p?.paiva || '')))
        .map((p) => ({
          paiva: p.paiva,
          slotit: (Array.isArray(p.slotit) ? p.slotit : [])
            .filter((s) => Number.isFinite(Number(s?.slot)))
            .map((s) => ({
              slot: Math.max(1, Math.floor(Number(s.slot))),
              alkaa: String(s.alkaa || '').trim(),
              loppuu: String(s.loppuu || '').trim(),
              optimize: s.optimize !== false
            }))
            .filter((s) => HHMM_RE.test(s.alkaa) && HHMM_RE.test(s.loppuu))
            .sort((a, b) => a.slot - b.slot)
        }))
        .sort((a, b) => viikonpaivat.indexOf(a.paiva) - viikonpaivat.indexOf(b.paiva))
    }
  }
  return {
    alakoulu: normAste(raw?.alakoulu),
    ylakoulu: normAste(raw?.ylakoulu),
    lukio: normAste(raw?.lukio)
  }
}

kouluRouter.get('/me', async (request, response) => {
  const u = request.user
  let k = u.koulu
  const kid = kouluObjectIdKayttajasta(u)
  if (!k && request.kouluId) {
    k = await Koulu.findById(request.kouluId).lean()
  }
  if (kid && (!k || k.tila == null)) {
    k = await Koulu.findById(kid).lean()
  }
  const kouluData = k
    ? {
        _id: k._id,
        nimi: k.nimi,
        tila: k.tila,
        kurssitMuokkausLukittu: !!k.kurssitMuokkausLukittu,
        ...(k.tila === 'aktiivinen' && k.aktivointitunnus
          ? { aktivointitunnus: k.aktivointitunnus }
          : {})
      }
    : null
  const kouluPoistettu = !!(k && k.tila === 'poistettu')

  let aktiivinenLukuvuosi = null
  const kouluRefId = request.kouluId || kid || (k && k._id)
  if (kouluRefId) {
    const lv = await getAktiivinenLukuvuosiForKoulu(kouluRefId)
    if (lv) {
      aktiivinenLukuvuosi = {
        _id: lv._id,
        name: lv.name,
        status: lv.status,
      }
    }
  }

  /** Vain jos esikatselu eroaa julkaistusta (sama id = ei erillistä kenttää). */
  let esikatseluLukuvuosi = null
  const eff = await getEffectiveLukuvuosiForRequest(request)
  if (
    eff.esikatselu &&
    eff.effective &&
    aktiivinenLukuvuosi &&
    eff.effective._id.toString() !== aktiivinenLukuvuosi._id.toString()
  ) {
    esikatseluLukuvuosi = {
      _id: eff.effective._id,
      name: eff.effective.name,
      status: eff.effective.status,
    }
  }

  response.json({
    koulu: kouluData,
    rooli: u.rooli,
    needsLiity: u.rooli === 'teacher' && !u.koulu,
    needsKouluAktivointi: u.rooli === 'school_admin' && k && k.tila === 'kokeilu',
    kouluPoistettu,
    kurssitMuokkausLukittu: !!k?.kurssitMuokkausLukittu,
    /** Koululle julkaistu lukuvuosi (opettajat näkevät tämän). */
    aktiivinenLukuvuosi,
    /** Kun hallinta käyttää esikatselua, eri kuin aktiivinenLukuvuosi. */
    esikatseluLukuvuosi,
  })
})

/** Kurssit-välilehden opettajamuokkauksen lukitus (school_admin / superadmin valitulle koululle). */
kouluRouter.patch(
  '/kurssit-lukittu',
  middleware.requireKouluHallinta,
  middleware.requireKouluEiPoistettu,
  async (request, response) => {
    const kid = request.kouluId
    if (!kid) {
      return response.status(400).json({
        error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).',
      })
    }
    const lukittu = request.body?.lukittu
    if (typeof lukittu !== 'boolean') {
      return response.status(400).json({ error: 'Boolean-kenttä "lukittu" vaaditaan.' })
    }
    const paivitetty = await Koulu.findByIdAndUpdate(
      kid,
      { kurssitMuokkausLukittu: lukittu },
      { new: true, runValidators: true },
    ).lean()
    if (!paivitetty) {
      return response.status(404).json({ error: 'Koulua ei löytynyt.' })
    }
    return response.json({ kurssitMuokkausLukittu: !!paivitetty.kurssitMuokkausLukittu })
  },
)

kouluRouter.post('/aktivoi', middleware.requireKouluEiPoistettu, async (request, response) => {
  const u = request.user
  if (!u.rooli || u.rooli !== 'school_admin') {
    return response.status(403).json({ error: 'vain koulun ylläpitäjä' })
  }
  const trialId = kouluObjectIdKayttajasta(u)
  if (!trialId) {
    return response.status(400).json({ error: 'Koulua ei ole tiedossa' })
  }
  const nimi = (request.body.nimi || '').trim()
  if (!nimi) {
    return response.status(400).json({ error: 'Koulun nimi puuttuu' })
  }
  const k = await Koulu.findById(trialId)
  if (!k || k.tila !== 'kokeilu') {
    return response.status(400).json({ error: 'koulu ei ole kokeilutilassa' })
  }
  const aktivointitunnus = await generateUniqueAktivointitunnus()
  k.nimi = nimi
  k.tila = 'aktiivinen'
  k.aktivointitunnus = aktivointitunnus
  await k.save()
  response.json({
    aktivointitunnus,
    koulu: { _id: k._id, nimi: k.nimi, tila: k.tila }
  })
})

kouluRouter.post('/liity', async (request, response) => {
  const u = request.user
  if (!u.rooli) {
    return response.status(400).json({ error: 'Kayttaja-tili vaaditaan' })
  }
  if (u.koulu) {
    return response.status(400).json({ error: 'Olet jo liitetty kouluun' })
  }
  const raw = (request.body.tunnus || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (raw.length !== 6) {
    return response.status(400).json({ error: 'Aktivointitunnus on 6 merkkiä' })
  }
  const k = await Koulu.findOne({ aktivointitunnus: raw, tila: 'aktiivinen' })
  if (!k) {
    return response.status(400).json({ error: 'Virheellinen aktivointitunnus' })
  }
  const kayttaja = await Kayttaja.findById(u._id)
  if (!kayttaja) {
    return response.status(401).json({ error: 'käyttäjä ei löydy' })
  }
  if (kayttaja.koulu) {
    return response.status(400).json({ error: 'Olet jo liitetty kouluun' })
  }
  kayttaja.koulu = k._id
  kayttaja.rooli = 'teacher'
  await kayttaja.save()

  const token = jwt.sign(
    {
      email: kayttaja.email,
      id: kayttaja._id,
      rooli: kayttaja.rooli,
      koulu: kayttaja.koulu
    },
    config.SECRET,
    { expiresIn: '8h' }
  )
  response.json({
    token,
    koulu: { _id: k._id, nimi: k.nimi, tila: k.tila }
  })
})

/**
 * Kokeilukoulun ylläpitäjä syöttää toisen (jo aktiivisen) koulun aktivointitunnuksen:
 * siirtyy opettajaksi kyseiseen kouluun; tyhjä kokeilukoulu ja sen tiedot poistetaan.
 */
kouluRouter.post('/liity-kokeilusta', middleware.requireKouluEiPoistettu, async (request, response) => {
  const u = request.user
  if (!u.rooli || u.rooli !== 'school_admin') {
    return response.status(403).json({ error: 'Toiminto on kokeilukoulun ylläpitäjälle' })
  }
  const trialId = kouluObjectIdKayttajasta(u)
  if (!trialId) {
    return response.status(400).json({ error: 'Koulua ei ole tiedossa' })
  }
  const kTrialCheck = await Koulu.findById(trialId).select('tila')
  if (!kTrialCheck || kTrialCheck.tila !== 'kokeilu') {
    return response.status(400).json({ error: 'Koulusi ei ole kokeilutilassa' })
  }
  const raw = (request.body.tunnus || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (raw.length !== 6) {
    return response.status(400).json({ error: 'Aktivointitunnus on 6 merkkiä' })
  }
  const kohde = await Koulu.findOne({ aktivointitunnus: raw, tila: 'aktiivinen' })
  if (!kohde) {
    return response.status(400).json({ error: 'Virheellinen aktivointitunnus' })
  }
  if (kohde._id.toString() === trialId.toString()) {
    return response.status(400).json({ error: 'Et voi liittyä omaan kokeilukouluusi tällä lomakkeella' })
  }
  const kayttaja = await Kayttaja.findById(u._id)
  if (!kayttaja) {
    return response.status(401).json({ error: 'käyttäjä ei löydy' })
  }
  const nykyinen = kayttaja.koulu?.toString()
  if (nykyinen !== trialId.toString()) {
    return response.status(400).json({ error: 'Koulun tila on muuttunut — päivitä sivu' })
  }
  const kokeiluKouluId = trialId

  kayttaja.koulu = kohde._id
  kayttaja.rooli = 'teacher'
  await kayttaja.save()

  let siivousEpäonnistui = false
  try {
    await poistaKokeilukouluJaData(kokeiluKouluId)
  } catch (err) {
    logger.error('liity-kokeilusta: kokeilukoulun poisto epäonnistui', err.message)
    siivousEpäonnistui = true
  }

  const token = jwt.sign(
    {
      email: kayttaja.email,
      id: kayttaja._id,
      rooli: kayttaja.rooli,
      koulu: kayttaja.koulu
    },
    config.SECRET,
    { expiresIn: '8h' }
  )
  response.json({
    token,
    koulu: { _id: kohde._id, nimi: kohde.nimi, tila: kohde.tila },
    ...(siivousEpäonnistui ? { siivousEpäonnistui: true } : {})
  })
})

/** Koulun Kayttaja-käyttäjät (sähköposti-/Microsoft-tilit). school_admin tai superadmin valitulla koululla. */
kouluRouter.get('/kayttajat', async (request, response) => {
  const u = request.user
  if (!u?.rooli) {
    return response.status(400).json({ error: 'Vain Kayttaja-tili' })
  }
  let kid = request.kouluId
  if (u.rooli === 'school_admin') {
    kid = kouluObjectIdKayttajasta(u)
  } else if (u.rooli !== 'superadmin') {
    return response.status(403).json({ error: 'Ei oikeuksia' })
  }
  if (!kid) {
    return response.status(400).json({
      error: 'Koulu ei ole tiedossa. Superadmin: valitse koulu ylävalikosta.'
    })
  }

  const rivit = await Kayttaja.find({ koulu: kid })
    .select('email nimi rooli etunimi sukunimi luotu microsoftId')
    .sort({ luotu: 1 })
    .lean()

  const list = rivit.map((k) => ({
    _id: k._id,
    email: k.email,
    nimi: k.nimi,
    etunimi: k.etunimi,
    sukunimi: k.sukunimi,
    rooli: k.rooli,
    luotu: k.luotu,
    kirjautuminen: k.microsoftId ? 'Microsoft' : (k.email ? 'Sähköposti' : '—')
  }))

  response.json(list)
})

/**
 * Aseta koulun aktiivinen lukuvuosi (kurssit, tuonti, raportit).
 * Superadmin: valittu koulu otsakkeesta (request.kouluId).
 */
kouluRouter.patch(
  '/aktiivinen-lukuvuosi',
  middleware.requireKouluHallinta,
  middleware.requireKouluEiPoistettu,
  async (request, response, next) => {
    try {
      const kid = request.kouluId
      if (!kid) {
        return response.status(400).json({
          error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).',
        })
      }
      const raw = request.body.lukuvuosiId
      if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
        return response.status(400).json({ error: 'Kelvollinen lukuvuosiId vaaditaan' })
      }
      const lv = await Lukuvuosi.findById(raw)
      if (!lv) {
        return response.status(404).json({ error: 'Lukuvuotta ei löydy' })
      }
      await Koulu.findByIdAndUpdate(kid, { aktiivinenLukuvuosiId: lv._id })
      response.json({
        aktiivinenLukuvuosi: {
          _id: lv._id,
          name: lv.name,
          status: lv.status,
        },
      })
    } catch (error) {
      next(error)
    }
  }
)

kouluRouter.get(
  '/aikataulu-profiili',
  middleware.requireKouluHallinta,
  middleware.requireKouluEiPoistettu,
  async (request, response) => {
    const kid = request.kouluId
    if (!kid) {
      return response.status(400).json({
        error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).',
      })
    }
    const koulu = await Koulu.findById(kid).select('aikatauluProfiili').lean()
    return response.json(
      koulu?.aikatauluProfiili || {
        alakoulu: { paivat: [] },
        ylakoulu: { paivat: [] },
        lukio: { paivat: [] }
      }
    )
  }
)

kouluRouter.patch(
  '/aikataulu-profiili',
  middleware.requireKouluHallinta,
  middleware.requireKouluEiPoistettu,
  async (request, response) => {
    const kid = request.kouluId
    if (!kid) {
      return response.status(400).json({
        error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).',
      })
    }
    const profiili = normalizeAikatauluProfiili(request.body || {})
    const paivitetty = await Koulu.findByIdAndUpdate(
      kid,
      { aikatauluProfiili: profiili },
      { new: true, runValidators: true }
    ).select('aikatauluProfiili').lean()
    return response.json(paivitetty?.aikatauluProfiili || profiili)
  }
)

module.exports = kouluRouter
