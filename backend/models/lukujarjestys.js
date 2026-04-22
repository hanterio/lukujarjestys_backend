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

const optimointiAsetusSchema = new mongoose.Schema({
  laita: { type: Boolean, default: false },
  tupla: {
    type: String,
    enum: ['default', 'prefer', 'avoid'],
    default: 'default'
  },
  ristiriitaRatkaisu: {
    type: String,
    enum: ['prefer_double', 'prefer_single'],
    default: 'prefer_double'
  },
  kurssiAsetukset: [{
    kurssiId: { type: String, required: true },
    tupla: {
      type: String,
      enum: ['default', 'prefer', 'avoid'],
      default: 'default'
    }
  }]
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
  tunnit: [tuntiSchema],
  optimointiAsetus: {
    type: optimointiAsetusSchema,
    default: () => ({
      laita: false,
      tupla: 'default',
      ristiriitaRatkaisu: 'prefer_double',
      kurssiAsetukset: []
    })
  }
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