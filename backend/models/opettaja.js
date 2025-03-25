const mongoose = require('mongoose')

const opettajaSchema = new mongoose.Schema({
  opettaja: {
    type: String,
    required: true,
    unique: true
  },
  opv: Number,
  passwordHash: String
})

opettajaSchema.set('toJSON', {
  transform: (document, returnedObject) => {
    returnedObject.id = returnedObject._id.toString()
    delete returnedObject._id
    delete returnedObject.__v
    // the passwordHash should not be revealed
    delete returnedObject.passwordHash
  }
})

module.exports = mongoose.model('Opettaja', opettajaSchema)