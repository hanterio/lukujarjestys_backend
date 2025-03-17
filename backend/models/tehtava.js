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

const tehtavaSchema = new mongoose.Schema({
    kuvaus: String,
    opettaja: String,
    vvt: {
        type: Number,
        set: v => parseFloat(String(v).replace(',', '.')) || 0
    },
    eur: Number,
    rahana: Boolean,

})

module.exports = mongoose.model('Tehtava', tehtavaSchema)