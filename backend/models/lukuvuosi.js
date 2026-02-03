const { default: mongoose } = require('mongoose')

const lukuvuosiSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'ARCHIVED'],
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

module.exports = mongoose.model('Lukuvuosi', lukuvuosiSchema)