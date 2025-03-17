const mongoose = require('mongoose')

const opettajaSchema = new mongoose.Schema({
  opettaja: {
    type: String,
    required: true
  },
  opv: Number
})

module.exports = mongoose.model('Opettaja', opettajaSchema)