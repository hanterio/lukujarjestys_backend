const mongoose = require('mongoose')
const Koulu = require('../models/koulu')
const Kayttaja = require('../models/kayttaja')
const Kurssi = require('../models/kurssi')
const Tehtava = require('../models/tehtava')
const Lukujarjestys = require('../models/lukujarjestys')
const Opettaja = require('../models/opettaja')

/**
 * Poistaa kokeilukoulun ja kaikki siihen viittaavat rivit.
 * Kutsutaan vasta kun yhdelläkään Kayttaja-tilillä ei ole enää viittausta tähän kouluun.
 *
 * @param {import('mongoose').Types.ObjectId|string} kouluId
 */
async function poistaKokeilukouluJaData (kouluId) {
  const id = mongoose.Types.ObjectId.isValid(kouluId)
    ? new mongoose.Types.ObjectId(String(kouluId))
    : null
  if (!id) {
    throw new Error('virheellinen kouluId')
  }

  const k = await Koulu.findById(id).select('tila').lean()
  if (!k) {
    return { poistettu: false, syy: 'ei löydy' }
  }
  if (k.tila !== 'kokeilu') {
    throw new Error('vain kokeilukoulu voidaan poistaa tällä toiminnolla')
  }

  const muitaKayttajia = await Kayttaja.countDocuments({ koulu: id })
  if (muitaKayttajia > 0) {
    throw new Error('kokeilukoulussa on yhä käyttäjiä — ei voida poistaa')
  }

  await Promise.all([
    Kurssi.deleteMany({ kouluId: id }),
    Tehtava.deleteMany({ kouluId: id }),
    Lukujarjestys.deleteMany({ kouluId: id }),
    Opettaja.deleteMany({ kouluId: id })
  ])

  await Koulu.deleteOne({ _id: id })
  return { poistettu: true }
}

module.exports = { poistaKokeilukouluJaData }
