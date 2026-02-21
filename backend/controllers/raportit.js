const ExcelJS = require('exceljs')
const Kurssi = require('../models/kurssi')
const Lukuvuosi = require('../models/lukuvuosi')

const OPETTAJA_SUMMA_VARI = 'FFD9EAF7'   // vaaleansininen (ARGB)
const AINERYHMA_SUMMA_VARI = 'FFE2F0D9'  // vaaleanvihreä (ARGB)

const opettajaOpetusmaaraExcel = async (req, res) => {

  const aktiivinen = await Lukuvuosi.findOne({ status: 'ACTIVE' })

  if (!aktiivinen) {
    return res.status(500).json({ error: 'Ei aktiivista lukuvuotta' })
  }

  const data = await Kurssi.aggregate([
    { $match: { lukuvuosiId: aktiivinen._id }},

    {
      $lookup: {
        from: 'aineet',
        localField: 'aineId',
        foreignField: '_id',
        as: 'aine'
      }
    },
    { $unwind: '$aine' },
    { $unwind: '$opettaja' },
    { $unwind: '$opetus' },

    // 1️⃣ Poista tuplat saman palkin sisällä
    {
      $group: {
        _id: {
          aineryhma: '$aine.aineryhma',
          opettaja: '$opettaja',
          oppiaine: '$aine.nimi',
          aste: '$aste',
          periodi: '$opetus.periodi',
          palkki: '$opetus.palkki'
        },
        tunnit: { $first: '$opetus.tunnit_viikossa' }
      }
    },

    // 2️⃣ Yhteensä per periodi
    {
      $group: {
        _id: {
          aineryhma: '$_id.aineryhma',
          opettaja: '$_id.opettaja',
          oppiaine: '$_id.oppiaine',
          aste: '$_id.aste',
          periodi: '$_id.periodi'
        },
        tunnit: { $sum: '$tunnit' }
      }
    },

    // 3️⃣ Muodosta periodit-taulukko
    {
      $group: {
        _id: {
          aineryhma: '$_id.aineryhma',
          opettaja: '$_id.opettaja',
          oppiaine: '$_id.oppiaine',
          aste: '$_id.aste'
        },
        periodit: {
          $push: {
            periodi: '$_id.periodi',
            tunnit: '$tunnit'
          }
        }
      }
    },

    {
      $sort: {
        '_id.aineryhma': 1,
        '_id.opettaja': 1,
        '_id.oppiaine': 1,
        '_id.aste': 1
      }
    }
  ])

  // 👉 Muodosta Excel-rivit
  const rows = data.map(r => {
    const p = {1:0,2:0,3:0,4:0,5:0}
    r.periodit.forEach(x => p[x.periodi] = x.tunnit)

    return [
      r._id.aineryhma,
      r._id.opettaja,
      r._id.oppiaine,
      r._id.aste,
      p[1], p[2], p[3], p[4], p[5]
    ]
  })

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Opettajaopetusmäärä')

  ws.addRow([
    'Aineryhmä',
    'Opettaja',
    'Oppiaine',
    'Aste',
    'Periodi 1',
    'Periodi 2',
    'Periodi 3',
    'Periodi 4',
    'Periodi 5',
    'Yhteensä'
  ])

  ws.getRow(1).font = { bold: true }

  let nykyinenAineryhma = null
  let nykyinenOpettaja = null
  let opettajaSumma = [0,0,0,0,0]
  let aineryhmaSumma = [0,0,0,0,0]

  for (const r of rows) {

    const aineryhma = r[0]
    const opettaja = r[1]

    // 🔁 Uusi aineryhmä
    if (nykyinenAineryhma && aineryhma !== nykyinenAineryhma) {

      let rivi = ws.addRow([
        nykyinenAineryhma,
        '',
        'AINERYHMÄ YHTEENSÄ',
        '',
        ...aineryhmaSumma,
        aineryhmaSumma.reduce((a,b)=>a+b,0)
      ])

      rivi.font = { bold:true }
      rivi.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: AINERYHMA_SUMMA_VARI }
      }

      aineryhmaSumma = [0,0,0,0,0]
    }

    // 🔁 Uusi opettaja
    if (nykyinenOpettaja && opettaja !== nykyinenOpettaja) {

      let rivi = ws.addRow([
        '',
        nykyinenOpettaja,
        'YHTEENSÄ',
        '',
        ...opettajaSumma,
        opettajaSumma.reduce((a,b)=>a+b,0)
      ])

      rivi.font = { bold:true }
      rivi.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: OPETTAJA_SUMMA_VARI }
      }

      opettajaSumma = [0,0,0,0,0]
    }

    // 👉 Normaali rivi
    const periodit = r.slice(4,9)
    const yhteensa = periodit.reduce((a,b)=>a+b,0)

    ws.addRow([...r, yhteensa])

    for (let i=0;i<5;i++) {
      opettajaSumma[i] += periodit[i]
      aineryhmaSumma[i] += periodit[i]
    }

    nykyinenAineryhma = aineryhma
    nykyinenOpettaja = opettaja
  }

  // 🔚 Viimeiset summat
  if (nykyinenOpettaja) {
    let rivi = ws.addRow([
      '',
      nykyinenOpettaja,
      'YHTEENSÄ',
      '',
      ...opettajaSumma,
      opettajaSumma.reduce((a,b)=>a+b,0)
    ])

    rivi.font = { bold:true }
    rivi.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: OPETTAJA_SUMMA_VARI }
    }
  }

  if (nykyinenAineryhma) {
    let rivi = ws.addRow([
      nykyinenAineryhma,
      '',
      'AINERYHMÄ YHTEENSÄ',
      '',
      ...aineryhmaSumma,
      aineryhmaSumma.reduce((a,b)=>a+b,0)
    ])

    rivi.font = { bold:true }
    rivi.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: AINERYHMA_SUMMA_VARI }
    }
  }

  // 📐 Automaattiset sarakeleveydet
  ws.columns.forEach(column => {
    let maxLength = 10
    column.eachCell({ includeEmpty: true }, cell => {
      const value = cell.value ? cell.value.toString() : ''
      maxLength = Math.max(maxLength, value.length)
    })
    column.width = maxLength + 2
  })

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )

  res.setHeader(
    'Content-Disposition',
    'attachment; filename=opettajaopetusmaara.xlsx'
  )

  await wb.xlsx.write(res)
  res.end()
}

module.exports = { opettajaOpetusmaaraExcel }