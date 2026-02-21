require('dotenv').config()
const mongoose = require('mongoose')
const Kurssi = require('../models/kurssi')
const Aine = require('../models/aine')

const MONGODB_URI = process.env.MONGODB_URI
console.log("Mongo URI:", process.env.MONGODB_URI)

const runMigration = async () => {
  await mongoose.connect(MONGODB_URI)
  console.log("Mongo URI:", MONGODB_URI)
  console.log('Yhdistetty tietokantaan')

  const kurssit = await Kurssi.find({})
  const aineet = await Aine.find({})
  console.log("Ensimmäinen aine:", aineet[0])

  // 🔥 Lajitellaan koodit pisimmästä lyhyimpään
  aineet.forEach(a => {
    a.koodit.sort((a, b) => b.length - a.length)
  })

  let paivitetty = 0
  let eiLoytynyt = []

  for (const kurssi of kurssit) {
    if (!kurssi.nimi) continue
    if (kurssi.aineId) continue

    const nimi = kurssi.nimi.toUpperCase()
    console.log("TEST NIMI:", nimi)

    // 🔎 Etsi aine jonka joku koodi on nimen alku
    let loydettyAine = null

    for (const aine of aineet) {
      for (const koodi of aine.koodit) {
        if (nimi.startsWith(koodi)) {
          console.log("MATCH:", nimi, "→", koodi, "(", aine.nimi, ")")
          loydettyAine = aine
          break
        }
      }
      if (loydettyAine) break
    }

    /*const loydettyAine = aineet.find(a =>
      a.koodit.some(koodi =>
        nimi.startsWith(koodi)
      )
    )*/

    if (loydettyAine) {
      kurssi.aineId = loydettyAine._id
      await kurssi.save()
      paivitetty++
    } else {
      eiLoytynyt.push(nimi)
    }
  }

  console.log("Päivitetty kursseja:", paivitetty)

  if (eiLoytynyt.length > 0) {
    console.log("Näille ei löytynyt ainetta:")
    console.log([...new Set(eiLoytynyt)])
  }

  await mongoose.connection.close()
  console.log("Valmis.")
}

runMigration().catch(err => {
  console.error(err)
  process.exit(1)
})
