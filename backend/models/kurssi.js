const mongoose = require('mongoose')

const PERIODI_REGEX = /^\d+[A-Za-zÅÄÖåäö]*$/

const opetusSchema = new mongoose.Schema({
  periodi: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: (v) => PERIODI_REGEX.test(String(v || '')),
      message: 'periodi must be in format 1, 1A, 2B, ...',
    },
  },
  palkki: String,
  tunnit_viikossa: Number
})

const kurssiSchema = new mongoose.Schema({
  nimi: {
    type: String,
    required: true,
  },
  aste: String,
  luokka: [String],
  vvt: String,
  opiskelijat: String,
  opettaja: [String],
  /** Osuus ryhmän vvt:stä jaetaan ryppäiden kesken (1/N), sisällä tasaisesti. Tyhjä/puuttuu = jokainen opettaja oma ryhmä. */
  opettajaRyppaat: [[String]],
  opetus: [opetusSchema],

  lukuvuosiId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lukuvuosi',
    required: true
  },
  aineId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Aine'
  },
  kouluId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Koulu'
  },
  /** Sama tunniste usealla kurssilla: VVT lasketaan kerran ryhmästä (max vvt). Tyhjä = ei ryhmää. */
  vvtRyhmaId: { type: String, default: null }
})


opetusSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    returnedObject.id = returnedObject._id.toString()
    delete returnedObject._id
    delete returnedObject.__v
  }
})

kurssiSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    returnedObject.id = returnedObject._id.toString()
    delete returnedObject._id
    /*delete returnedObject.__v*/
  }
})

module.exports = mongoose.model('Kurssi', kurssiSchema)