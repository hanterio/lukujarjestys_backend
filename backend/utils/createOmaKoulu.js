require('dotenv').config()
const mongoose = require('mongoose')
const Koulu = require('../models/koulu')

const createOmaKoulu = async () => {
  await mongoose.connect(process.env.MONGODB_URI)

  const olemassa = await Koulu.findOne({ domain: 'normaalilyseo.fi' })
  if (olemassa) {
    console.log('Koulu on jo olemassa:', olemassa)
    process.exit(0)
  }

  const koulu = await Koulu.create({
    nimi: 'Helsingin normaalilyseo', // ← vaihda koulusi oikea nimi
    domain: 'normaalilyseo.fi',  // ← vaihda oikea domain
    tila: 'aktiivinen',          // suoraan aktiivinen, ei kokeilu
    tunniste: 'oma_koulu'        // helppo tunnistaa
  })

  console.log('Koulu luotu:', koulu)
  process.exit(0)
}

createOmaKoulu()