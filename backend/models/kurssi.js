const mongoose = require('mongoose')

mongoose.set('strictQuery', false)

const url = process.env.MONGODB_URI

console.log('connecting to', url)
mongoose.connect(url)
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connecting to MongoDB:', error.message)
  })

const opetusSchema = new mongoose.Schema({
  periodi: Number,
  palkki: String,
  tunnit_viikossa: Number
})

const kurssiSchema = new mongoose.Schema({
  nimi: String,
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