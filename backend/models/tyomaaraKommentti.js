const mongoose = require('mongoose')

const tyomaaraKommenttiSchema = new mongoose.Schema(
  {
    opettaja: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    teksti: {
      type: String,
      required: true,
      trim: true,
    },
    pvm: {
      type: Date,
      required: true,
    },
    kouluId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Koulu',
      required: true,
    },
    lukuvuosiId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lukuvuosi',
      required: true,
    },
    lisaajaNimi: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
)

module.exports = mongoose.model('TyomaaraKommentti', tyomaaraKommenttiSchema)
