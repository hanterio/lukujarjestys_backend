const mongoose = require('mongoose')

const aineSchema = new mongoose.Schema({
  nimi: String,
  aineryhma: String,
  koodit: [String],
  kategoria: String
})

module.exports = mongoose.model('Aine', aineSchema, 'aineet')