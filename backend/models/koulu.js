const mongoose = require('mongoose')

const viikonpaivat = ['ma', 'ti', 'ke', 'to', 'pe']

const slottiSchema = new mongoose.Schema({
  slot: { type: Number, required: true, min: 1 },
  alkaa: { type: String, required: true }, // HH:mm
  loppuu: { type: String, required: true }, // HH:mm
  optimize: { type: Boolean, default: true } // false = esim. ke-5 ei optimointiin
}, { _id: false })

const paivaSchema = new mongoose.Schema({
  paiva: { type: String, enum: viikonpaivat, required: true },
  slotit: { type: [slottiSchema], default: [] }
}, { _id: false })

const asteAikatauluSchema = new mongoose.Schema({
  paivat: { type: [paivaSchema], default: [] }
}, { _id: false })

const aikatauluProfiiliSchema = new mongoose.Schema({
  alakoulu: { type: asteAikatauluSchema, default: () => ({ paivat: [] }) },
  ylakoulu: { type: asteAikatauluSchema, default: () => ({ paivat: [] }) },
  lukio: { type: asteAikatauluSchema, default: () => ({ paivat: [] }) }
}, { _id: false })

const kouluSchema = new mongoose.Schema({
  nimi: { type: String, required: true },
  tunniste: { type: String, unique: true },
  domain: String,
  tila: {
    type: String,
    default: 'kokeilu',
    enum: ['kokeilu', 'aktiivinen', 'poistettu']
  },
  kokeiluAlkoi: { type: Date, default: Date.now },
  kokeiluLoppuu: Date,
  /** Luodaan aktivoinnissa; opettajat liittyvät tällä 6-merkkisellä tunnuksella */
  aktivointitunnus: { type: String, sparse: true, unique: true },
  /** Koulukohtainen aktiivinen lukuvuosi (kurssit, tuonti). Puuttuessa käytetään legacy-globaalia ACTIVE-merkintää ja migroidaan lazy. */
  aktiivinenLukuvuosiId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lukuvuosi',
  },
  /** Kun true, tavalliset käyttäjät eivät voi muokata Kurssit-välilehden opettajatietoja. */
  kurssitMuokkausLukittu: {
    type: Boolean,
    default: false,
  },
  aikatauluProfiili: {
    type: aikatauluProfiiliSchema,
    default: () => ({
      alakoulu: { paivat: [] },
      ylakoulu: { paivat: [] },
      lukio: { paivat: [] }
    })
  }
})

// Luodaan automaattinen tunniste ennen tallennusta
kouluSchema.pre('save', function(next) {
  if (!this.tunniste) {
    this.tunniste = 'koulu_' + Math.random().toString(36).substr(2, 5)
  }
  next()
})

module.exports = mongoose.model('Koulu', kouluSchema)