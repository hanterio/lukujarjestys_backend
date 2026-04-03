const jwt = require('jsonwebtoken')
const { Resend } = require('resend')
const config = require('../utils/config')
const router = require('express').Router()
const Kayttaja = require('../models/kayttaja')
const Koulu = require('../models/koulu')

const resend = new Resend(config.RESEND_API_KEY)

// Suojatut domainit - näille ei luoda uutta koulua magic linkillä
const suojatutDomainit = ['normaalilyseo.fi'] // ← vaihda oman koulusi domain

router.post('/send', async (req, res) => {
  const { email, kouluNimi } = req.body

  if (!email) {
    return res.status(400).json({ error: 'Sähköposti puuttuu' })
  }

  // Tarkista onko suojattu domain
  const domain = email.split('@')[1]
  if (suojatutDomainit.includes(domain)) {
    return res.status(403).json({ 
      error: 'Tämä koulu käyttää erillistä kirjautumista' 
    })
  }

  const token = jwt.sign(
    { email, kouluNimi },
    config.SECRET,
    { expiresIn: '15m' }
  )

  const magicLink = `${config.BACKEND_URL}/api/magiclink/verify?token=${token}`

  await resend.emails.send({
    from: 'onboarding@resend.dev',
    to: email,
    subject: 'Kirjautumislinkki sovellukseen',
    html: `
      <p>Hei!</p>
      <p>Klikkaa alla olevaa linkkiä kirjautuaksesi sisään. 
      Linkki on voimassa 15 minuuttia.</p>
      <a href="${magicLink}">Kirjaudu sisään</a>
      <p>Jos et pyytänyt tätä linkkiä, 
      voit jättää tämän viestin huomiotta.</p>
    `
  })

  res.json({ message: 'Linkki lähetetty sähköpostiisi' })
})

router.get('/verify', async (req, res) => {
  const { token } = req.query

  try {
    const decoded = jwt.verify(token, config.SECRET)
    const { email, kouluNimi } = decoded

    console.log('decoded:', decoded) // ← pidä tämä toistaiseksi

    // Tarkista ensin onko superadmin
    const superadmin = await Kayttaja.findOne({ email, rooli: 'superadmin' })
if (superadmin) {
  console.log('löytyi superadmin')
      const userToken = jwt.sign(
        { email: superadmin.email, id: superadmin._id, rooli: superadmin.rooli },
        config.SECRET,
        { expiresIn: '8h' }
      )
      return res.redirect(
        `${config.FRONTEND_URL}/?token=${userToken}&nimi=${encodeURIComponent(email)}&rooli=superadmin`
      )
    }

    // Etsi olemassaoleva tavallinen käyttäjä
    let kayttaja = await Kayttaja.findOne({ email })
console.log('findOne tulos:', kayttaja) // ← lisää tämä

    if (!kayttaja) {
        try {
            const koulu = await Koulu.create({
            nimi: kouluNimi || 'Nimetön koulu',
            kokeiluLoppuu: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            })
            console.log('Koulu luotu:', koulu)

            kayttaja = await Kayttaja.create({
            email,
            rooli: 'school_admin',
            koulu: koulu._id
            })
            console.log('Käyttäjä luotu:', kayttaja)
        } catch (err) {
            console.error('Virhe luotaessa koulua/käyttäjää:', err)
            return res.status(500).json({ error: 'Virhe luotaessa käyttäjää' })
        }
        }

    const userToken = jwt.sign(
      {
        email: kayttaja.email,
        id: kayttaja._id,
        rooli: kayttaja.rooli,
        koulu: kayttaja.koulu
      },
      config.SECRET,
      { expiresIn: '8h' }
    )

    res.redirect(
      `${config.FRONTEND_URL}/?token=${userToken}&nimi=${encodeURIComponent(email)}&rooli=${kayttaja.rooli}`
    )
  } catch (error) {
    console.error('verify error:', error)
    res.status(400).json({ error: 'Linkki on vanhentunut tai virheellinen' })
  }
})

module.exports = router