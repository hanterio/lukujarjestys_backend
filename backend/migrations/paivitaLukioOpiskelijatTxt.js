require('dotenv').config()
const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')
const Kurssi = require('../models/kurssi')
const Koulu = require('../models/koulu')
const Lukuvuosi = require('../models/lukuvuosi')

const MONGODB_URI = process.env.MONGODB_URI
const APPLY = process.argv.includes('--apply')
const INPUT_FILE =
  process.argv.find((a) => a.startsWith('--file='))?.slice('--file='.length) ||
  path.resolve(__dirname, '../../data/lukio_valinnat_15042026.txt')

function parseTxt(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8')
  const lines = txt.split(/\r?\n/)
  const schoolName = String(lines[1] || '')
    .split(';')[0]
    .trim()
  const lukuvuosiNimi = String(lines[0] || '')
    .replace(/^Jaksotus\s+/i, '')
    .split(';')[0]
    .trim()

  const map = new Map()
  const conflicts = []
  let dataRows = 0

  for (const line of lines) {
    if (!line || !line.includes(';')) continue
    const cols = line.split(';')
    // Rakenne: ... ; Ryhmä/palkki ; ; Kurssikoodi ; Koko ; Opettaja ;
    const code = String(cols[8] || '').trim()
    const koko = String(cols[9] || '').trim()
    if (!code || !koko) continue
    if (!/^[A-ZÅÄÖ]{2,}\d+(\.\d+)?$/i.test(code)) continue
    if (!/^\d+$/.test(koko)) continue
    dataRows += 1
    if (map.has(code) && map.get(code) !== koko) {
      conflicts.push({ code, old: map.get(code), new: koko })
    }
    map.set(code, koko)
  }

  return { schoolName, lukuvuosiNimi, map, conflicts, dataRows }
}

async function resolveScope(schoolName, lukuvuosiNimi) {
  const scope = {}
  let koulu = null

  if (schoolName) {
    koulu = await Koulu.findOne({ nimi: schoolName }).select('_id nimi aktiivinenLukuvuosiId')
    if (koulu) scope.kouluId = koulu._id
  }

  let lukuvuosiId = koulu?.aktiivinenLukuvuosiId || null
  if (!lukuvuosiId && lukuvuosiNimi) {
    const lvByName = await Lukuvuosi.findOne({ name: lukuvuosiNimi }).select('_id name')
    if (lvByName) lukuvuosiId = lvByName._id
  }
  if (!lukuvuosiId) {
    const active = await Lukuvuosi.findOne({ status: 'ACTIVE' }).select('_id name')
    if (active) lukuvuosiId = active._id
  }
  if (lukuvuosiId) scope.lukuvuosiId = lukuvuosiId

  return { scope, koulu }
}

async function run() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI puuttuu ympäristöstä.')
  }
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Tiedostoa ei löydy: ${INPUT_FILE}`)
  }

  const { schoolName, lukuvuosiNimi, map, conflicts, dataRows } = parseTxt(INPUT_FILE)

  await mongoose.connect(MONGODB_URI)
  console.log('Yhdistetty tietokantaan')
  console.log(`Lähdetiedosto: ${INPUT_FILE}`)
  console.log(`Koulu tiedostosta: ${schoolName || '(ei löytynyt)'}`)
  console.log(`Lukuvuosi tiedostosta: ${lukuvuosiNimi || '(ei löytynyt)'}`)
  console.log(`Data-rivejä: ${dataRows}, uniikkeja kurssikoodeja: ${map.size}`)
  if (conflicts.length) {
    console.log(`Varoitus: ${conflicts.length} koodia, joilla ristiriitainen Koko.`)
    console.log(conflicts.slice(0, 20))
  }

  const { scope, koulu } = await resolveScope(schoolName, lukuvuosiNimi)
  console.log(`Rajaus kouluId: ${scope.kouluId ? String(scope.kouluId) : '(ei)'}`)
  console.log(`Rajaus lukuvuosiId: ${scope.lukuvuosiId ? String(scope.lukuvuosiId) : '(ei)'}`)
  if (koulu) {
    console.log(`Koulu löytyi: ${koulu.nimi}`)
  } else {
    console.log('Huom: koulua ei löydetty nimellä, päivitys rajataan ilman kouluId:tä.')
  }

  let matchedDocs = 0
  let wouldChange = 0
  let changed = 0
  const notFound = []

  for (const [koodi, koko] of map.entries()) {
    const query = {
      nimi: koodi,
      aste: 'lukio',
      ...scope,
    }
    const docs = await Kurssi.find(query).select('_id nimi opiskelijat __v')
    if (!docs.length) {
      notFound.push(koodi)
      continue
    }
    matchedDocs += docs.length

    for (const d of docs) {
      if (String(d.opiskelijat ?? '') === String(koko)) continue
      wouldChange += 1
      if (APPLY) {
        const res = await Kurssi.updateOne(
          { _id: d._id },
          { $set: { opiskelijat: String(koko) } }
        )
        changed += res.modifiedCount || 0
      }
    }
  }

  console.log('--- Yhteenveto ---')
  console.log(`Matchatut dokumentit: ${matchedDocs}`)
  console.log(`Muuttuisi: ${wouldChange}`)
  if (APPLY) {
    console.log(`Muutettu: ${changed}`)
  } else {
    console.log('Dry-run: mitään ei kirjoitettu. Lisää --apply tehdäksesi muutokset.')
  }
  console.log(`Ei löytynyt: ${notFound.length}`)
  if (notFound.length) {
    console.log(notFound.slice(0, 120))
  }

  await mongoose.connection.close()
  console.log('Valmis.')
}

run().catch(async (err) => {
  console.error(err)
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close()
  }
  process.exit(1)
})
