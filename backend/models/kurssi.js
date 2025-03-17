const mongoose = require('mongoose')

const opetusSchema = new mongoose.Schema({
  periodi: Number,
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
  opetus: [opetusSchema]
})

kurssiSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    returnedObject.id = returnedObject._id.toString()
    delete returnedObject._id
    delete returnedObject.__v
  }
})

module.exports = mongoose.model('Kurssi', kurssiSchema)