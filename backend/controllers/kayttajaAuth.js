const crypto = require('crypto')
const router = require('express').Router()
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const Kayttaja = require('../models/kayttaja')
const Koulu = require('../models/koulu')
const config = require('../utils/config')
const logger = require('../utils/logger')
const { generateUniqueTrialNimi } = require('../utils/kouluTrial')
const { lahetaSalasananNollaus } = require('../utils/sendResetEmail')

const SALT_ROUNDS = 10

function signKayttajaToken (kayttaja) {
  return jwt.sign(
    {
      email: kayttaja.email,
      id: kayttaja._id,
      rooli: kayttaja.rooli,
      koulu: kayttaja.koulu
    },
    config.SECRET,
    { expiresIn: '8h' }
  )
}

/**
 * Rekisteröityminen sähköpostilla. Valinnainen aktivointitunnus: oikea → teacher + koulu;
 * tyhjä tai väärä → kokeilukoulu + school_admin.
 */
router.post('/rekisteroidy', async (req, res) => {
  const {
    etunimi,
    sukunimi,
    email,
    emailVahvistus,
    password,
    aktivointitunnus,
    ehdotHyvaksytty
  } = req.body

  if (!ehdotHyvaksytty) {
    return res.status(400).json({ error: 'Käyttöehdot ja tietosuoja on hyväksyttävä' })
  }

  const etu = (etunimi || '').trim()
  const suku = (sukunimi || '').trim()
  const em = (email || '').trim().toLowerCase()
  const emV = (emailVahvistus || '').trim().toLowerCase()

  if (!etu || !suku) {
    return res.status(400).json({ error: 'Etunimi ja sukunimi vaaditaan' })
  }
  if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
    return res.status(400).json({ error: 'Kelvollinen sähköposti vaaditaan' })
  }
  if (em !== emV) {
    return res.status(400).json({ error: 'Sähköpostiosoitteet eivät täsmää' })
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Salasanan on oltava vähintään 8 merkkiä' })
  }

  const existing = await Kayttaja.findOne({ email: em })
  if (existing) {
    return res.status(400).json({ error: 'Tällä sähköpostilla on jo tili' })
  }

  const nimi = `${etu} ${suku}`.trim()
  const raw = (aktivointitunnus || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')

  let kouluId
  let rooli

  if (raw.length === 6) {
    const k = await Koulu.findOne({ aktivointitunnus: raw, tila: 'aktiivinen' })
    if (k) {
      kouluId = k._id
      rooli = 'teacher'
    }
  }

  if (!kouluId) {
    const trialNimi = await generateUniqueTrialNimi()
    const koulu = await Koulu.create({
      nimi: trialNimi,
      tila: 'kokeilu',
      kokeiluLoppuu: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    })
    kouluId = koulu._id
    rooli = 'school_admin'
  }

  const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS)

  const kayttaja = await Kayttaja.create({
    email: em,
    etunimi: etu,
    sukunimi: suku,
    nimi,
    rooli,
    koulu: kouluId,
    passwordHash
  })

  const token = signKayttajaToken(kayttaja)
  res.status(201).json({
    token,
    nimi: kayttaja.nimi,
    rooli: kayttaja.rooli
  })
})

router.post('/kirjaudu', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase()
  const password = req.body.password

  if (!email || !password) {
    return res.status(400).json({ error: 'Sähköposti ja salasana vaaditaan' })
  }

  const kayttaja = await Kayttaja.findOne({ email })
  if (!kayttaja || !kayttaja.passwordHash) {
    return res.status(401).json({ error: 'Väärä sähköposti tai salasana' })
  }

  const ok = await bcrypt.compare(String(password), kayttaja.passwordHash)
  if (!ok) {
    return res.status(401).json({ error: 'Väärä sähköposti tai salasana' })
  }

  const token = signKayttajaToken(kayttaja)
  res.json({
    token,
    nimi: kayttaja.nimi,
    rooli: kayttaja.rooli
  })
})

const RESET_VOIMASSA_MS = 60 * 60 * 1000

/**
 * Pyydä salasanan nollaus sähköpostiin (vain tileillä joilla on salasana).
 * Vastaus sama kaikille — ei paljasta onko sähköposti rekisteröity.
 */
router.post('/unohtunut-salasana', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase()
  const okVastaus = {
    viesti:
      'Jos sähköposti on rekisteröity ja siihen voi kirjautua salasanalla, olemme lähettäneet nollauslinkin.'
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Kelvollinen sähköposti vaaditaan' })
  }

  try {
    const kayttaja = await Kayttaja.findOne({ email })
    if (kayttaja && kayttaja.passwordHash) {
      const token = crypto.randomBytes(32).toString('hex')
      kayttaja.passwordResetToken = token
      kayttaja.passwordResetExpires = new Date(Date.now() + RESET_VOIMASSA_MS)
      await kayttaja.save()
      await lahetaSalasananNollaus(email, token)
    }
  } catch (e) {
    logger.error('unohtunut-salasana:', e.message)
  }

  res.json(okVastaus)
})

/**
 * Aseta uusi salasana nollauslinkin tokenilla.
 */
router.post('/nollaa-salasana', async (req, res) => {
  const token = (req.body.token || '').trim()
  const password = req.body.password

  if (!token || token.length < 20) {
    return res.status(400).json({ error: 'Virheellinen tai puuttuva linkki' })
  }
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Salasanan on oltava vähintään 8 merkkiä' })
  }

  const kayttaja = await Kayttaja.findOne({
    passwordResetToken: token,
    passwordResetExpires: { $gt: new Date() }
  })

  if (!kayttaja) {
    return res.status(400).json({ error: 'Linkki on vanhentunut tai virheellinen. Pyydä uusi nollaus.' })
  }

  kayttaja.passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS)
  kayttaja.passwordResetToken = undefined
  kayttaja.passwordResetExpires = undefined
  await kayttaja.save()

  const jwtToken = signKayttajaToken(kayttaja)
  res.json({
    token: jwtToken,
    nimi: kayttaja.nimi,
    rooli: kayttaja.rooli
  })
})

module.exports = router
