require('dotenv').config()
const mongoose = require('mongoose')
const Kurssi = require('../models/kurssi')
const Aine = require('../models/aine')

const run = async () => {

  await mongoose.connect(process.env.MONGODB_URI)
  console.log("Yhdistetty")

  // hae oikeat aineet
  const englanti = await Aine.findOne({ nimi: 'englanti' })
  const venaja = await Aine.findOne({ nimi: 'venäjä' })

  if (!englanti || !venaja) {
    console.log("Aineita ei löytynyt")
    process.exit(1)
  }

  // hae kurssit jotka
  // - alkavat vENA
  // - mutta aineId on venäjä
  const virheelliset = await Kurssi.find({
    nimi: { $regex: /^VENA/i },
    aineId: venaja._id
  })

  console.log("Korjattavia:", virheelliset.length)

  for (const k of virheelliset) {
    k.aineId = englanti._id
    await k.save()
  }

  console.log("Korjaus valmis")
  await mongoose.connection.close()
}

run().catch(console.error)
