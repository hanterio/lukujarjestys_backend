require('dotenv').config()
const mongoose = require('mongoose')

const MONGODB_URI = process.env.MONGODB_URI
const DEFAULT_KOULU_ID = new mongoose.Types.ObjectId('69cc1858f37f1373e6e237ba')

const runMigration = async () => {
  await mongoose.connect(MONGODB_URI)
  console.log('Yhdistetty tietokantaan')

  const db = mongoose.connection.db
  const kokoelma = db.collection('opettajas')

  const ilmanKoulua = await kokoelma.countDocuments({ kouluId: { $exists: false } })
  console.log(`Opettajia ilman kouluId-kenttää: ${ilmanKoulua}`)

  if (ilmanKoulua > 0) {
    const tulos = await kokoelma.updateMany(
      { kouluId: { $exists: false } },
      { $set: { kouluId: DEFAULT_KOULU_ID } }
    )
    console.log(`Päivitetty ${tulos.modifiedCount} opettajaa (kouluId)`)
  }

  try {
    await kokoelma.dropIndex('opettaja_1')
    console.log('Poistettu vanha indeksi opettaja_1')
  } catch (e) {
    console.log('Indeksiä opettaja_1 ei voitu poistaa (ok jos ei ole):', e.message)
  }

  try {
    await kokoelma.createIndex(
      { opettaja: 1, kouluId: 1 },
      { unique: true, name: 'opettaja_1_kouluId_1' }
    )
    console.log('Luotu yhdistelmäindeksi opettaja + kouluId')
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
