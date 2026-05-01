/**
 * Asettaa kaikille tehtäville lukuvuosiId:n lukuvuodelle 2026–2027 (tai 2026-2027),
 * jos kenttä puuttuu tai on null.
 *
 * Ajo backend-hakemistosta:
 *   node migrations/migraatioTehtavatLukuvuosi.js
 *
 * Vaatii .env:ssä MONGODB_URI.
 */
require('dotenv').config()
const mongoose = require('mongoose')

const Lukuvuosi = require('../models/lukuvuosi')

const MONGODB_URI = process.env.MONGODB_URI

/** Etsii lukuvuoden nimen perusteella (tavallinen tai lyhyt viiva). */
const lukuvuosi2026_2027Haku = () => ({
  name: { $regex: /^2026\s*[-–]\s*2027$/i },
})

const runMigration = async () => {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI puuttuu ympäristöstä.')
    process.exit(1)
  }

  await mongoose.connect(MONGODB_URI)
  console.log('Yhdistetty tietokantaan')

  const lvLista = await Lukuvuosi.find(lukuvuosi2026_2027Haku())
    .sort({ status: 1 })
    .lean()

  if (lvLista.length === 0) {
    const kaikki = await Lukuvuosi.find({}).select('name status').sort({ name: 1 }).lean()
    console.error(
      'Lukuvuotta 2026–2027 / 2026-2027 ei löytynyt. Luo lukuvuosi hallinnasta tai tarkista nimi.'
    )
    console.error('Lukuvuodet tietokannassa:', kaikki.map((x) => `${x.name} (${x.status})`).join(', ') || '(tyhjä)')
    await mongoose.connection.close()
    process.exit(1)
  }

  if (lvLista.length > 1) {
    console.warn(
      `Löytyi ${lvLista.length} lukuvuotta, jotka vastaavat hakua. Käytetään ensimmäistä: "${lvLista[0].name}" (${lvLista[0]._id})`
    )
  }

  const lukuvuosiId = lvLista[0]._id
  console.log(`Käytettävä lukuvuosi: "${lvLista[0].name}" id=${lukuvuosiId}`)

  const kokoelma = mongoose.connection.db.collection('tehtavas')

  const suodatus = {
    $or: [
      { lukuvuosiId: { $exists: false } },
      { lukuvuosiId: null },
    ],
  }

  const ennen = await kokoelma.countDocuments(suodatus)
  console.log(`Tehtäviä ilman lukuvuosiId: ${ennen}`)

  if (ennen === 0) {
    console.log('Ei päivitettävää.')
    await mongoose.connection.close()
    console.log('Valmis.')
    return
  }

  const tulos = await kokoelma.updateMany(suodatus, {
    $set: { lukuvuosiId: lukuvuosiId },
  })

  console.log(`Päivitetty ${tulos.modifiedCount} tehtävää (matched: ${tulos.matchedCount})`)
  await mongoose.connection.close()
  console.log('Valmis.')
}

runMigration().catch((err) => {
  console.error(err)
  process.exit(1)
})
