/**
 * Estää API-testien ajon tuotantotietokantaa vasten.
 * kurssi_api.test.js tekee Kurssi.deleteMany({}) ja Opettaja.deleteMany({}) — ilman tätä
 * koko tietokanta tyhjenee, jos NODE_ENV ei ole "test".
 */
require('dotenv').config()

if (process.env.NODE_ENV !== 'test') {
  // eslint-disable-next-line no-console
  console.error(
    '\n╔════════════════════════════════════════════════════════════════╗\n' +
      '║  API-TESTIT KESKEYTETTY                                        ║\n' +
      '║  Aja aina: npm test                                            ║\n' +
      '║  (asettaa NODE_ENV=test → käyttää TEST_MONGODB_URI:ta)       ║\n' +
      '║  Älä aja: node --test tests/... ilman NODE_ENV=test          ║\n' +
      '╚════════════════════════════════════════════════════════════════╝\n'
  )
  process.exit(1)
}

const testUri = process.env.TEST_MONGODB_URI && String(process.env.TEST_MONGODB_URI).trim()
if (!testUri) {
  // eslint-disable-next-line no-console
  console.error(
    '\n╔════════════════════════════════════════════════════════════════╗\n' +
      '║  TEST_MONGODB_URI puuttuu (.env)                               ║\n' +
      '║  Aseta erillinen testitietokanta (esim. .../lukkariTest).      ║\n' +
      '╚════════════════════════════════════════════════════════════════╝\n'
  )
  process.exit(1)
}

const prodUri = process.env.MONGODB_URI && String(process.env.MONGODB_URI).trim()
if (prodUri && testUri === prodUri) {
  // eslint-disable-next-line no-console
  console.error(
    '\n╔════════════════════════════════════════════════════════════════╗\n' +
      '║  TEST_MONGODB_URI on sama kuin MONGODB_URI — keskeytetään.     ║\n' +
      '╚════════════════════════════════════════════════════════════════╝\n'
  )
  process.exit(1)
}
