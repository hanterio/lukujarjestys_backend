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
  },
  /** Lukuvuodet ovat koulukohtaisia; sama näyttönimi sallittu eri kouluilla. */
  kouluId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Koulu',
    required: true,
  },
})

lukuvuosiSchema.index({ kouluId: 1, name: 1 }, { unique: true })

module.exports = mongoose.model('Lukuvuosi', lukuvuosiSchema)