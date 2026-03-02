const aineetRouter = require('express').Router()
const Aine = require('../models/aine')

aineetRouter.get('/', async (req, res) => {
  const aineet = await Aine.find({})
  res.json(aineet)
})

module.exports = aineetRouter