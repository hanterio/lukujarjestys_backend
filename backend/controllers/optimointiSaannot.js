const mongoose = require('mongoose')
const OptimointiSaanto = require('../models/optimointiSaanto')
const {
  haeKoulunSaannot,
  normalizeRule,
  validateRulePayload
} = require('../utils/optimointiSaannot')

const list = async (req, res) => {
  if (!req.kouluId) {
    return res.status(400).json({
      error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).'
    })
  }

  const rows = await haeKoulunSaannot(req.kouluId)
  return res.json(rows)
}

const create = async (req, res) => {
  if (!req.kouluId) {
    return res.status(400).json({
      error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).'
    })
  }

  const check = validateRulePayload(req.body || {})
  if (!check.valid) {
    return res.status(400).json({ error: check.errors.join(', ') })
  }

  const updatedBy = req.user?.email || req.user?.opettaja || 'unknown'
  const created = await OptimointiSaanto.create({
    ...check.normalized,
    kouluId: req.kouluId,
    updatedBy
  })
  return res.status(201).json(normalizeRule(created))
}

const update = async (req, res) => {
  const id = req.params.id
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Virheellinen id' })
  }
  if (!req.kouluId) {
    return res.status(400).json({
      error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).'
    })
  }

  const check = validateRulePayload(req.body || {})
  if (!check.valid) {
    return res.status(400).json({ error: check.errors.join(', ') })
  }

  const updatedBy = req.user?.email || req.user?.opettaja || 'unknown'
  const updated = await OptimointiSaanto.findOneAndUpdate(
    { _id: id, kouluId: req.kouluId },
    {
      $set: {
        ...check.normalized,
        updatedBy
      }
    },
    { new: true, runValidators: true }
  )

  if (!updated) {
    return res.status(404).json({ error: 'Sääntöä ei löytynyt' })
  }
  return res.json(normalizeRule(updated))
}

const remove = async (req, res) => {
  const id = req.params.id
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Virheellinen id' })
  }
  if (!req.kouluId) {
    return res.status(400).json({
      error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).'
    })
  }

  const deleted = await OptimointiSaanto.findOneAndDelete({
    _id: id,
    kouluId: req.kouluId
  })
  if (!deleted) {
    return res.status(404).json({ error: 'Sääntöä ei löytynyt' })
  }
  return res.status(204).end()
}

module.exports = {
  list,
  create,
  update,
  remove
}
