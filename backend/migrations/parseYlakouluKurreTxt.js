require('dotenv').config()
const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')
const Aine = require('../models/aine')

const INPUT_FILE =
  process.argv.find((a) => a.startsWith('--file='))?.slice('--file='.length) ||
  path.resolve(__dirname, '../../data/esimkerkki_kurre_ylakoulu.txt')

const OUTPUT_FILE =
  process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ||
  path.resolve(__dirname, '../../data/ylakoulu_kurre_parsed.json')

const DEFAULT_TUNNIT_PER_VVT = Number(
  process.argv.find((a) => a.startsWith('--tunnit-per-vvt='))?.slice('--tunnit-per-vvt='.length) || 5
)

function parseRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(';').map((c) => String(c || '').trim()))
}

function findPeriodCols(rows) {
  for (const row of rows) {
    const idxs = []
    for (let i = 0; i < row.length; i++) {
      if (/^periodi\s+\d+/i.test(row[i])) idxs.push(i)
    }
    if (idxs.length) return idxs
  }
  return []
}

function findColumnIndex(rows, re) {
  const maxRows = Math.min(rows.length, 20)
  for (let r = 0; r < maxRows; r++) {
    const row = rows[r]
    for (let i = 0; i < row.length; i++) {
      if (re.test(row[i])) return i
    }
  }
  return -1
}

function normalizeAineet(aineet) {
  return (aineet || []).map((a) => ({
    id: String(a._id ?? a.id),
    koodit: [...(a.koodit || [])]
      .map((k) => String(k || '').trim().toUpperCase())
      .filter(Boolean)
      .sort((x, y) => y.length - x.length),
  }))
}

function aineIdKurssille(kurssiNimi, aineet) {
  const upper = String(kurssiNimi || '').toUpperCase()
  for (const a of aineet) {
    for (const koodi of a.koodit) {
      if (upper.startsWith(koodi)) return a.id
    }
  }
  return undefined
}

function parseGradeFromName(nimi) {
  const m = String(nimi || '').match(/_(\d{1,2})/)
  if (!m) return null
  const grade = Number(String(m[1])[0])
  return Number.isNaN(grade) ? null : grade
}

function safeNum(val) {
  const n = Number(String(val || '').replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

function vvtFromHours(hours, ratio) {
  if (!hours || !ratio) return ''
  const raw = hours / ratio
  return Math.round(raw * 100) / 100
}

async function run() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Tiedostoa ei löydy: ${INPUT_FILE}`)
  }
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI puuttuu ympäristöstä')
  }

  await mongoose.connect(process.env.MONGODB_URI)
  const aineet = normalizeAineet(await Aine.find({}).lean())
  const rows = parseRows(fs.readFileSync(INPUT_FILE, 'utf8'))
  const periodCols = findPeriodCols(rows)
  const groupCol = findColumnIndex(rows, /ryhmä|palkki/i)
  const sizeCol = findColumnIndex(rows, /koko/i)

  if (!periodCols.length || groupCol < 0) {
    throw new Error('Otsikoita ei löytynyt: vaatii Periodi-sarakkeet ja Ryhmä/palkki-sarakkeen')
  }

  const kurssit = []
  const warnings = []

  for (const row of rows) {
    const nimi = String(row[groupCol] || '').trim()
    if (!nimi || !/_\d/.test(nimi)) continue

    const grade = parseGradeFromName(nimi)
    const luokka = grade ? [String(grade)] : []
    const opiskelijat = sizeCol >= 0 ? String(row[sizeCol] || '').trim() : ''

    const opetus = []
    for (let p = 0; p < periodCols.length; p++) {
      const col = periodCols[p]
      const n = safeNum(row[col])
      if (!n || n <= 0) continue
      opetus.push({
        periodi: p + 1,
        palkki: String(nimi.split('.', 1)[0] || nimi),
        tunnit_viikossa: n,
      })
    }
    if (!opetus.length) continue

    const maxTunnit = Math.max(...opetus.map((o) => Number(o.tunnit_viikossa || 0)))
    const vvt = vvtFromHours(maxTunnit, DEFAULT_TUNNIT_PER_VVT)
    const aineId = aineIdKurssille(nimi, aineet)
    if (!aineId) {
      warnings.push(`Oppiainetta ei löytynyt kurssille: ${nimi}`)
    }

    const kurssi = {
      nimi,
      aste: 'yläkoulu',
      luokka,
      vvt,
      opiskelijat,
      opettaja: [],
      opetus,
    }
    if (aineId) kurssi.aineId = aineId
    kurssit.push(kurssi)
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      {
        meta: {
          input: INPUT_FILE,
          generatedAt: new Date().toISOString(),
          tunnitPerVvt: DEFAULT_TUNNIT_PER_VVT,
          courses: kurssit.length,
          warnings: warnings.length,
        },
        kurssit,
        warnings,
      },
      null,
      2
    ),
    'utf8'
  )

  console.log(`Valmis. Kurssit: ${kurssit.length}`)
  console.log(`Ulos: ${OUTPUT_FILE}`)
  if (warnings.length) {
    console.log(`Varoituksia: ${warnings.length}`)
    console.log(warnings.slice(0, 30))
  }
  await mongoose.connection.close()
}

run().catch(async (err) => {
  console.error(err)
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close()
  }
  process.exit(1)
})
