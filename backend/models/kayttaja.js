const mongoose = require('mongoose')

const kayttajaSchema = new mongoose.Schema({
  email: { type: String, unique: true, sparse: true },
  nimi: String,
  opetunnus: { type: String, sparse: true },
  microsoftId: { type: String, unique: true, sparse: true },
  koulu: { type: mongoose.Schema.Types.ObjectId, ref: 'Koulu' },
  rooli: {
    type: String,
    default: 'school_admin',
    enum: ['superadmin', 'school_admin', 'teacher']
  },
  luotu: { type: Date, default: Date.now },
})

module.exports = mongoose.model('Kayttaja', kayttajaSchema)