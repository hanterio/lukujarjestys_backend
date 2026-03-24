const router = require('express').Router()
const Lukuvuosi = require('../models/lukuvuosi')

// 👉 GET aktiivinen lukuvuosi
router.get('/active', async (req, res) => {
  try {
    const active = await Lukuvuosi.findOne({ status: 'ACTIVE' })

    if (!active) {
      return res.status(404).json({ error: 'Ei aktiivista lukuvuotta' })
    }

    res.json(active)

  } catch (error) {
    console.error('Lukuvuosi virhe:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

module.exports = router