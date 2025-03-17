const mongoose = require('mongoose')

const tehtavaSchema = new mongoose.Schema({
  kuvaus: {
    type: String,
    required: true
  },
  opettaja: {
    type: String,
    required: true
  },
  vvt: {
    type: Number,
    set: v => parseFloat(String(v).replace(',', '.')) || 0
  },
  eur: Number,
  rahana: Boolean,
})

module.exports = mongoose.model('Tehtava', tehtavaSchema)