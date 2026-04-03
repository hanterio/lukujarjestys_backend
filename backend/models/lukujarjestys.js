const mongoose = require('mongoose')

const kurssiSijoitusSchema = new mongoose.Schema({
  kurssiId: { type: String, required: true },
  kurssiNimi: String,
  palkkiKey: String,
  yhdistetytIdt: [String]  // 🔥 lisätty
}, { _id: false })

const tuntiSchema = new mongoose.Schema({
  paiva: {
    type: String,
    enum: ['ma', 'ti', 'ke', 'to', 'pe'],
    required: true
  },
  tunti: { type: Number, required: true },
  kurssit: [kurssiSijoitusSchema]
}, { _id: false })

const lukujarjestysSchema = new mongoose.Schema({
  nimi: { type: String, required: true },
  tyyppi: {
    type: String,
    enum: ['luokka', 'opettaja', 'palkki'], // 🔥 lisätään palkki
    required: true
  },
  periodi: { type: Number, required: true },
  lukuvuosiId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lukuvuosi',
    required: true
  },
  kouluId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Koulu',
    required: true
  },
  tunnit: [tuntiSchema]
}, { timestamps: true })

lukujarjestysSchema.index(
  { nimi: 1, tyyppi: 1, periodi: 1, lukuvuosiId: 1, kouluId: 1 },
  { unique: true }
)

module.exports = mongoose.model(
  'Lukujarjestys',
  lukujarjestysSchema,
  'lukujarjestys'
)