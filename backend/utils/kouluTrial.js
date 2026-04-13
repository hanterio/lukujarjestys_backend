const Koulu = require('../models/koulu')

const AKTIVOINNIT = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

async function generateUniqueTrialNimi () {
  for (let i = 0; i < 30; i++) {
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase()
    const nimi = `Kokeilu-${suffix}`
    const exists = await Koulu.findOne({ nimi })
    if (!exists) return nimi
  }
  throw new Error('kokeilunimeä ei voitu luoda')
}

async function generateUniqueAktivointitunnus () {
  for (let i = 0; i < 40; i++) {
    let s = ''
    for (let j = 0; j < 6; j++) {
      s += AKTIVOINNIT[Math.floor(Math.random() * AKTIVOINNIT.length)]
    }
    const exists = await Koulu.findOne({ aktivointitunnus: s })
    if (!exists) return s
  }
  throw new Error('aktivointitunnusta ei voitu luoda')
}

module.exports = {
  generateUniqueTrialNimi,
  generateUniqueAktivointitunnus
}
