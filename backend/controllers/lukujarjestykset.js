// controllers/lukujarjestykset.js
const mongoose = require('mongoose')
const Lukujarjestys = require('../models/lukujarjestys')

const tarkistaKonflikti = async (req, res) => {
  const { paiva, tunti, periodi, lukuvuosiId } = req.query

  try {
    // hae kaikki sijoitukset tälle tuntipaikalle
    const kaikki = await Lukujarjestys.find({
      periodi: Number(periodi),
      lukuvuosiId: new mongoose.Types.ObjectId(lukuvuosiId),
      "tunnit.paiva": paiva,
      "tunnit.tunti": Number(tunti)
    })

    // kerää kaikki kurssiIdt tältä tuntipaikalta
    const varatutKurssiIdt = []
    kaikki.forEach(lj => {
      lj.tunnit
        .filter(t => t.paiva === paiva && t.tunti === Number(tunti))
        .forEach(t => {
          t.kurssit.forEach(k => {
            varatutKurssiIdt.push(k.kurssiId)
            if (k.yhdistetytIdt) {
              varatutKurssiIdt.push(...k.yhdistetytIdt)
            }
          })
        })
    })

    res.json({ varatutKurssiIdt })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}


// 🔍 HAE YKSI
const getOne = async (req, res) => {
  const { nimi, tyyppi, periodi, lukuvuosiId } = req.query

  try {
    if (!lukuvuosiId) return res.json([])

    const objectId = new mongoose.Types.ObjectId(lukuvuosiId)

    // hae kaikki periodin palkit
    const kaikki = await Lukujarjestys.find({
      tyyppi: "palkki",
      periodi: Number(periodi),
      lukuvuosiId: objectId
    })

    res.json(kaikki)

  } catch (error) {
    console.error("GET ERROR:", error)
    res.status(500).json({ error: error.message })
  }
}

// 💾 UPSERT
const save = async (req, res) => {
  const { nimi, tyyppi, periodi, lukuvuosiId, tunnit, irrotetut } = req.body

  if (!nimi || !tyyppi || !periodi || !lukuvuosiId) {
    return res.status(400).json({ error: 'Puuttuvia tietoja' })
  }

  try {
    const objectId = new mongoose.Types.ObjectId(lukuvuosiId)

    const paivitetty = await Lukujarjestys.findOneAndUpdate(
      { nimi, tyyppi, periodi, lukuvuosiId: objectId },
      {
        $set: {
          tunnit: tunnit || []
          // irrotetut poistettu!
        }
      },
      { new: true, upsert: true, runValidators: true }
    )

    res.json(paivitetty)

  } catch (error) {
    console.error("SAVE ERROR:", error)
    res.status(400).json({ error: error.message })
  }
}

module.exports = { getOne, save, tarkistaKonflikti }