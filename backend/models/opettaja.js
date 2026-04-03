const mongoose = require('mongoose')

const opettajaSchema = new mongoose.Schema({
  opettaja: {
    type: String,
    required: true
  },
  kouluId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Koulu',
    required: true
  },
  opv: Number,
  passwordHash: String,
  admin: {
    type: Boolean,
    default: false
  }
})

opettajaSchema.index({ opettaja: 1, kouluId: 1 }, { unique: true })

opettajaSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    returnedObject.id = returnedObject._id.toString()
    delete returnedObject._id
    delete returnedObject.__v
    delete returnedObject.passwordHash
  }
})

module.exports = mongoose.model('Opettaja', opettajaSchema)
