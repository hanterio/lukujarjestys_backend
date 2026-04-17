const mongoose = require('mongoose')

const optimointiSaantoSchema = new mongoose.Schema({
  kouluId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Koulu',
    required: true,
    index: true
  },
  enabled: {
    type: Boolean,
    default: true
  },
  ruleType: {
    type: String,
    enum: ['max_aine_parallel', 'va_palkki_paivan_loppuun'],
    required: true
  },
  params: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  severity: {
    type: String,
    enum: ['hard', 'soft'],
    default: 'hard'
  },
  message: {
    type: String,
    default: ''
  },
  updatedBy: {
    type: String,
    default: ''
  }
}, { timestamps: true })

module.exports = mongoose.model(
  'OptimointiSaanto',
  optimointiSaantoSchema,
  'optimointiSaannot'
)
