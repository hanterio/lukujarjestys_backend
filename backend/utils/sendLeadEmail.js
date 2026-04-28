const { Resend } = require('resend')
const config = require('./config')
const logger = require('./logger')

async function lahetaKoekayttajaLiidi ({
  nimi,
  koulu,
  rooli,
  email,
  puhelin,
  viesti,
  source
}) {
  if (!config.RESEND_API_KEY) {
    logger.error('[lead] RESEND_API_KEY puuttuu, viestiä ei voitu lähettää')
    throw new Error('Sähköpostipalvelu ei ole käytettävissä')
  }

  const resend = new Resend(config.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL || 'SkolApp <onboarding@resend.dev>'
  const to = process.env.LEADS_TO_EMAIL || 'info@skolapp.fi'

  const subject = `Koekäyttäjäilmoittautuminen (${source || 'landing'})`
  const safePuhelin = puhelin || '-'
  const safeViesti = viesti || '-'

  await resend.emails.send({
    from,
    to,
    subject,
    html: `
      <h2>Uusi koekäyttäjäilmoittautuminen</h2>
      <p><strong>Nimi:</strong> ${nimi}</p>
      <p><strong>Koulu:</strong> ${koulu}</p>
      <p><strong>Rooli:</strong> ${rooli}</p>
      <p><strong>Sähköposti:</strong> ${email}</p>
      <p><strong>Puhelin:</strong> ${safePuhelin}</p>
      <p><strong>Lähde:</strong> ${source || '-'}</p>
      <p><strong>Lisätiedot:</strong><br/>${String(safeViesti).replace(/\n/g, '<br/>')}</p>
    `
  })
}

module.exports = { lahetaKoekayttajaLiidi }
