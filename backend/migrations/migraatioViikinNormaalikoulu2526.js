/**
 * Siirtää valitun koulun kaiken datan lukuvuodelta 2026–2027 → 2025–2026.
 *
 * Päivittää: kurssit, lukujärjestykset, tehtävät, työmääräkommentit sekä koulun aktiivisen lukuvuoden,
 * jos se osoitti vanhaan lukuvuoteen.
 *
 * Ajo backend-hakemistosta:
 *   node migrations/migraatioViikinNormaalikoulu2526.js
 *
 * Kuiva-ajo (ei kirjoituksia):
 *   set DRY_RUN=1   (PowerShell: $env:DRY_RUN="1")
 *   node migrations/migraatioViikinNormaalikoulu2526.js
 *
 * Vaatii .env:ssä MONGODB_URI.
 */
require('dotenv').config()
const mongoose = require('mongoose')

const Koulu = require('../models/koulu')
const Lukuvuosi = require('../models/lukuvuosi')
const Kurssi = require('../models/kurssi')
const Lukujarjestys = require('../models/lukujarjestys')
const Tehtava = require('../models/tehtava')
const TyomaaraKommentti = require('../models/tyomaaraKommentti')

const MONGODB_URI = process.env.MONGODB_URI
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

/** Lukuvuoden nimi: sallitaan tavallinen tai lyhyt viiva. */
const lvRegex = (vuodet) => ({
  name: { $regex: new RegExp(`^${vuodet.v}\\s*[-–]\\s*${vuodet.p}$`, 'i') },
})

const KOULUNIMI = /^Viikin normaalikoulu$/i

const runMigration = async () => {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI puuttuu ympäristöstä.')
    process.exit(1)
  }

  await mongoose.connect(MONGODB_URI)
  console.log('Yhdistetty tietokantaan' + (DRY_RUN ? ' (DRY_RUN – ei tallennuksia)' : ''))

  const koulu = await Koulu.findOne({ nimi: KOULUNIMI }).lean()
  if (!koulu) {
    const nimia = await Koulu.find({}).select('nimi').sort({ nimi: 1 }).lean()
    console.error('Koulua "Viikin normaalikoulu" ei löytynyt.')
    console.error(
      'Koulut kannassa:',
      nimia.map((x) => x.nimi).join(', ') || '(tyhjä)'
    )
    await mongoose.connection.close()
    process.exit(1)
  }

  const kouluId = koulu._id
  console.log(`Koulu: "${koulu.nimi}" id=${kouluId}`)

  /** Kaikki rivit, joiden nimi vastaa 2026–2027 (voi olla duplikaatteja eri id:llä). */
  const vanhatLv = await Lukuvuosi.find(lvRegex({ v: '2026', p: '2027' }))
    .sort({ status: 1 })
    .lean()
  const uudetLv = await Lukuvuosi.find(lvRegex({ v: '2025', p: '2026' }))
    .sort({ status: 1 })
    .lean()

  if (vanhatLv.length === 0) {
    const kaikki = await Lukuvuosi.find({}).select('name status').sort({ name: 1 }).lean()
    console.error('Lukuvuotta 2026–2027 / 2026-2027 ei löytynyt.')
    console.error('Lukuvuodet:', kaikki.map((x) => `${x.name} (${x.status})`).join(', ') || '(tyhjä)')
    await mongoose.connection.close()
    process.exit(1)
  }

  if (uudetLv.length === 0) {
    const kaikki = await Lukuvuosi.find({}).select('name status').sort({ name: 1 }).lean()
    console.error('Lukuvuotta 2025–2026 / 2025-2026 ei löytynyt. Luo se hallinnasta (Luo lukuvuosi) ja aja skripti uudelleen.')
    console.error('Lukuvuodet:', kaikki.map((x) => `${x.name} (${x.status})`).join(', ') || '(tyhjä)')
    await mongoose.connection.close()
    process.exit(1)
  }

  if (vanhatLv.length > 1) {
    console.warn(
      `Löytyi ${vanhatLv.length} lukuvuotta 2026–2027 -tyyppiä (eri id:t). Siirretään kaikki rivit kohdelukuvuoteen:`
    )
    vanhatLv.forEach((lv) => console.warn(`  - "${lv.name}" (${lv.status}) id=${lv._id}`))
  }
  if (uudetLv.length > 1) {
    console.warn(`Löytyi ${uudetLv.length} lukuvuotta 2025–2026 -tyyppiä. Käytetään ensimmäistä: "${uudetLv[0].name}"`)
    uudetLv.forEach((lv) => console.warn(`  - "${lv.name}" (${lv.status}) id=${lv._id}`))
  }

  const vanhatIds = vanhatLv.map((x) => x._id)
  const uusiId = uudetLv[0]._id

  if (vanhatIds.some((id) => id.equals(uusiId))) {
    console.error('Vanha ja uusi lukuvuosi sisältävät saman id:n – ei mitään tehtävää.')
    await mongoose.connection.close()
    process.exit(1)
  }

  console.log(`Vanhat lukuvuodet (lähde): ${vanhatIds.length} kpl → kohde: "${uudetLv[0].name}" id=${uusiId}`)

  const filter = { kouluId, lukuvuosiId: { $in: vanhatIds } }

  const counts = {
    kurssit: await Kurssi.countDocuments(filter),
    lukujarjestykset: await Lukujarjestys.countDocuments(filter),
    tehtavat: await Tehtava.countDocuments(filter),
    tyomaaraKommentit: await TyomaaraKommentti.countDocuments(filter),
  }

  console.log('Päivitettäviä (koulu + vanha lukuvuosi):', counts)

  const akt = koulu.aktiivinenLukuvuosiId
  const paivitaKoulu = akt && vanhatIds.some((id) => id.toString() === akt.toString())

  if (paivitaKoulu) {
    console.log('Koulun aktiivinenLukuvuosiId osoittaa vanhaan lukuvuoteen → päivitetään uuteen.')
  }

  if (DRY_RUN) {
    console.log('DRY_RUN: ei tehty päivityksiä.')
    await mongoose.connection.close()
    console.log('Valmis.')
    return
  }

  const r1 = await Kurssi.updateMany(filter, { $set: { lukuvuosiId: uusiId } })
  console.log(`kurssis: matched ${r1.matchedCount}, modified ${r1.modifiedCount}`)

  try {
    const r2 = await Lukujarjestys.updateMany(filter, { $set: { lukuvuosiId: uusiId } })
    console.log(`lukujarjestys: matched ${r2.matchedCount}, modified ${r2.modifiedCount}`)
  } catch (e) {
    if (e.code === 11000) {
      console.error(
        'lukujarjestys: uniikki-indeksi esti päivityksen (sama nimi/tyyppi/periodi jo kohdelukuvuodella). Tarkista käsin tai tyhjennä päällekkäiset rivit.'
      )
    }
    throw e
  }

  const r3 = await Tehtava.updateMany(filter, { $set: { lukuvuosiId: uusiId } })
  console.log(`tehtavas: matched ${r3.matchedCount}, modified ${r3.modifiedCount}`)

  const r4 = await TyomaaraKommentti.updateMany(filter, { $set: { lukuvuosiId: uusiId } })
  console.log(`tyomaarakommenttis: matched ${r4.matchedCount}, modified ${r4.modifiedCount}`)

  if (paivitaKoulu) {
    await Koulu.updateOne({ _id: kouluId }, { $set: { aktiivinenLukuvuosiId: uusiId } })
    console.log('koulus: aktiivinenLukuvuosiId päivitetty.')
  }

  await mongoose.connection.close()
  console.log('Valmis.')
}

runMigration().catch((err) => {
  console.error(err)
  process.exit(1)
})
