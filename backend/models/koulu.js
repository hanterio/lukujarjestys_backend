const mongoose = require('mongoose')

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
})

// Luodaan automaattinen tunniste ennen tallennusta
kouluSchema.pre('save', function(next) {
  if (!this.tunniste) {
    this.tunniste = 'koulu_' + Math.random().toString(36).substr(2, 5)
  }
  next()
})

module.exports = mongoose.model('Koulu', kouluSchema)