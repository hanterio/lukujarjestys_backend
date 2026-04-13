const mongoose = require('mongoose')

const kayttajaSchema = new mongoose.Schema({
  email: { type: String, unique: true, sparse: true },
  etunimi: String,
  sukunimi: String,
  nimi: String,
  opetunnus: { type: String, sparse: true },
  /** Sähköposti + salasana -kirjautuminen (bcrypt) */
  passwordHash: { type: String, sparse: true },
  microsoftId: { type: String, unique: true, sparse: true },
  koulu: { type: mongoose.Schema.Types.ObjectId, ref: 'Koulu' },
  rooli: {
    type: String,
    default: 'school_admin',
    enum: ['superadmin', 'school_admin', 'teacher']
  },
  luotu: { type: Date, default: Date.now },
  /** Yksi käyttö: salasanan nollauslinkki (vanhenee) */
  passwordResetToken: { type: String, sparse: true, unique: true },
  passwordResetExpires: Date
})

module.exports = mongoose.model('Kayttaja', kayttajaSchema)