const mongoose = require('mongoose')

mongoose.set('strictQuery', false)

const url = process.env.MONGODB_URI

mongoose.connect(url)
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connecting to MongoDB:', error.message)
  })
  
const opettajaSchema = new mongoose.Schema({
    opettaja: String,
    opv: Number

})

module.exports = mongoose.model('Opettaja', opettajaSchema)