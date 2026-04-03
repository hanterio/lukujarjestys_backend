require('dotenv').config()
const mongoose = require('mongoose')

const MONGODB_URI = process.env.MONGODB_URI

const runMigration = async () => {
  await mongoose.connect(MONGODB_URI)
  console.log('Yhdistetty tietokantaan')

  const kouluId = new mongoose.Types.ObjectId('69cc1858f37f1373e6e237ba')

  const db = mongoose.connection.db
  const kokoelma = db.collection('kurssis')

  // Lasketaan ensin
  const ilmanKoulua = await kokoelma.countDocuments({ kouluId: { $exists: false } })
  console.log(`Kursseja ilman kouluId-kenttää: ${ilmanKoulua}`)

  if (ilmanKoulua === 0) {
    console.log('Kaikilla kursseilla on jo kouluId. Ei tehdä mitään.')
    await mongoose.connection.close()
    return
  }

  // Päivitetään suoraan ilman validointia
  const tulos = await kokoelma.updateMany(
    { kouluId: { $exists: false } },
    { $set: { kouluId: kouluId } }
  )

  console.log(`Päivitetty ${tulos.modifiedCount} kurssia`)

  await mongoose.connection.close()
  console.log('Valmis.')
}

runMigration().catch(err => {
  console.error(err)
  process.exit(1)
})