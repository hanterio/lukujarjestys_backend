require('dotenv').config()
const mongoose = require('mongoose')

const MONGODB_URI = process.env.MONGODB_URI
const DEFAULT_KOULU_ID = new mongoose.Types.ObjectId('69cc1858f37f1373e6e237ba')

const runMigration = async () => {
  await mongoose.connect(MONGODB_URI)
  console.log('Yhdistetty tietokantaan')

  const db = mongoose.connection.db
  const kokoelma = db.collection('lukujarjestys')

  const ilmanKoulua = await kokoelma.countDocuments({ kouluId: { $exists: false } })
  console.log(`Lukujärjestys-rivejä ilman kouluId: ${ilmanKoulua}`)

  if (ilmanKoulua > 0) {
    const tulos = await kokoelma.updateMany(
      { kouluId: { $exists: false } },
      { $set: { kouluId: DEFAULT_KOULU_ID } }
    )
    console.log(`Päivitetty ${tulos.modifiedCount} riviä`)
  }

  try {
    await kokoelma.dropIndex('nimi_1_tyyppi_1_periodi_1_lukuvuosiId_1')
    console.log('Poistettu vanha yhdistelmäindeksi')
  } catch (e) {
    console.log('Vanhaa indeksiä ei poistettu:', e.message)
  }

  try {
    await kokoelma.createIndex(
      { nimi: 1, tyyppi: 1, periodi: 1, lukuvuosiId: 1, kouluId: 1 },
      { unique: true, name: 'nimi_1_tyyppi_1_periodi_1_lukuvuosiId_1_kouluId_1' }
    )
    console.log('Luotu uusi yhdistelmäindeksi (kouluId mukana)')
  } catch (e) {
    console.log('Indeksin luonti:', e.message)
  }

  await mongoose.connection.close()
  console.log('Valmis.')
}

runMigration().catch(err => {
  console.error(err)
  process.exit(1)
})
