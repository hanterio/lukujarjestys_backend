const { Resend } = require('resend')
const config = require('./config')
const logger = require('./logger')

/**
 * Lähettää salasanan nollauslinkin Resendillä. Ilman RESEND_API_KEY logittaa linkin.
 */
async function lahetaSalasananNollaus (email, resetToken) {
  const base = (config.FRONTEND_URL || '').replace(/\/$/, '') || 'http://localhost:5173'
  const link = `${base}/?resetSalasana=${encodeURIComponent(resetToken)}`

  if (!config.RESEND_API_KEY) {
    logger.info('[salasanan nollaus] RESEND_API_KEY puuttuu — linkki (vain loki):', link)
    return { lahetetty: false, link }
  }

  const resend = new Resend(config.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'Lukujärjestys <onboarding@resend.dev>'

  try {
    await resend.emails.send({
      from,
      to: email,
      subject: 'Salasanan nollaus – Lukujärjestys',
      html: `
        <p>Hei,</p>
        <p>Pyysit salasanan nollauksen. Avaa linkki tai kopioi se selaimeen (voimassa 1 tunti):</p>
        <p><a href="${link}">${link}</a></p>
        <p>Jos et pyytänyt nollauksen, voit jättää tämän viestin huomiotta.</p>
      `
    })
    return { lahetetty: true }
  } catch (e) {
    logger.error('Resend epäonnistui:', e.message)
    throw new Error('Sähköpostin lähetys epäonnistui')
  }
}

module.exports = { lahetaSalasananNollaus }
