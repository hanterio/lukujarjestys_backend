const Kurssi = require('../models/kurssi')

const initialKurssit = [
  {
    nimi: 'TEST1.1',
    aste: 'yläkoulu',
    opiskelijat: '',
    opettaja: '',
    opetus: {
      periodi: 1,
      tunnit_viikossa: 3,
      palkki: 'vk'  }
  },
  {
    nimi: 'TEST1.2',
    aste: 'yläkoulu',
    opiskelijat: '',
    opettaja: '',
    opetus: [{
      periodi: 1,
      tunnit_viikossa: 3,
      palkki: 'vk'  }]
  }
]

const nonExistingId = async () => {
  const kurssi = new Kurssi({ nimi: 'poistetaanpian' })
  await kurssi.save()
  await kurssi.deleteOne()

  return kurssi._id.toString()
}

const kurssitInDb = async () => {
  const kurssit = await Kurssi.find({})
  return kurssit.map(kurssi => kurssi.toJSON())
}

module.exports = {
  initialKurssit, nonExistingId, kurssitInDb
}