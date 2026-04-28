const router = require('express').Router()
const { lahetaKoekayttajaLiidi } = require('../utils/sendLeadEmail')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX = 5
const leadRateLimit = new Map()

function getClientIp (req) {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim()
  }
  return req.ip || req.connection?.remoteAddress || 'unknown'
}

function onkoRateLimited (ip) {
  const nyt = Date.now()
  const osumat = leadRateLimit.get(ip) || []
  const tuoreet = osumat.filter((t) => nyt - t < RATE_LIMIT_WINDOW_MS)
  if (tuoreet.length >= RATE_LIMIT_MAX) {
    leadRateLimit.set(ip, tuoreet)
    return true
  }
  tuoreet.push(nyt)
  leadRateLimit.set(ip, tuoreet)
  return false
}

router.post('/koekayttaja', async (req, res) => {
  const ip = getClientIp(req)
  if (onkoRateLimited(ip)) {
    return res.status(429).json({ error: 'Liian monta lähetystä. Yritä hetken kuluttua uudelleen.' })
  }

  const honeypot = (req.body.honeypot || req.body.website || '').trim()
  if (honeypot) {
    // Hiljainen ok-vastaus bottien houkuttelukentälle.
    return res.status(200).json({ ok: true })
  }

  const nimi = (req.body.nimi || '').trim()
  const koulu = (req.body.koulu || '').trim()
  const rooli = (req.body.rooli || '').trim()
  const email = (req.body.email || '').trim().toLowerCase()
  const puhelin = (req.body.puhelin || '').trim()
  const viesti = (req.body.viesti || '').trim()
  const source = (req.body.source || '').trim()

  if (!nimi || !koulu || !rooli) {
    return res.status(400).json({ error: 'Nimi, koulu ja rooli ovat pakollisia.' })
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Anna kelvollinen sähköposti.' })
  }

  await lahetaKoekayttajaLiidi({
    nimi,
    koulu,
    rooli,
    email,
    puhelin,
    viesti,
    source
  })

  return res.status(200).json({ ok: true })
})

module.exports = router
