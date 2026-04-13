const ExcelJS = require('exceljs')
const Kurssi = require('../models/kurssi')
const { getEffectiveLukuvuosiForRequest } = require('../utils/effectiveLukuvuosi')

const OPETTAJA_SUMMA_VARI = 'FFD9EAF7'   // vaaleansininen (ARGB)
const AINERYHMA_SUMMA_VARI = 'FFE2F0D9'  // vaaleanvihreä (ARGB)

const opettajaOpetusmaaraExcel = async (req, res) => {

  const { effective: aktiivinen } = await getEffectiveLukuvuosiForRequest(req)

  if (!aktiivinen) {
    return res.status(500).json({ error: 'Ei aktiivista lukuvuotta' })
  }

  const kurssiMatch = { lukuvuosiId: aktiivinen._id }
  if (req.kouluId) {
    kurssiMatch.kouluId = req.kouluId
  }

  const data = await Kurssi.aggregate([
    { $match: kurssiMatch },

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
const opettajienKokonaistyomaaraExcel = async (req, res) => {
  const Kurssi = require('../models/kurssi')
  const Tehtava = require('../models/tehtava')
  const ExcelJS = require('exceljs')
  const { effective: aktiivinen } = await getEffectiveLukuvuosiForRequest(req)

  if (!aktiivinen) {
    return res.status(500).json({ error: 'Ei aktiivista lukuvuotta' })
  }

  const kurssiQuery = { lukuvuosiId: aktiivinen._id }
  if (req.kouluId) {
    kurssiQuery.kouluId = req.kouluId
  }
  const kurssit = await Kurssi.find(kurssiQuery)

  const tehtavaQuery = {}
  if (req.kouluId) {
    tehtavaQuery.kouluId = req.kouluId
  }
  const tehtavat = await Tehtava.find(tehtavaQuery)

  const parseVvt = (value) =>
    Number(String(value || "0").replace(",", "."))

  const kieliAineet = ["SA", "RA", "LA", "VE"]

  const opettajaData = {}

  // ========================
  // ====== KURSSIT =========
  // ========================
  kurssit.forEach(kurssi => {

    const kurssiVvt = parseVvt(kurssi.vvt)
    const opettajat = kurssi.opettaja || []

    if (opettajat.length === 0) return

    const jaettuVvt = kurssiVvt / opettajat.length

    kurssi.opetus?.forEach(opetus => {

      opettajat.forEach(op => {

        if (!opettajaData[op]) {
          opettajaData[op] = {
            ylakoulu: 0,
            lukio: 0,
            muutVvt: 0,
            eur: 0,
            palkit: {}
          }
        }

        const palkkiAvain = `${opetus.periodi}-${opetus.palkki}`

        if (!opettajaData[op].palkit[palkkiAvain]) {
          opettajaData[op].palkit[palkkiAvain] = []
        }

        opettajaData[op].palkit[palkkiAvain].push({
          aste: kurssi.aste,
          vvt: jaettuVvt,
          nimi: kurssi.nimi
        })
      })
    })
  })

  // ========================
  // ====== SUMMAUS =========
  // ========================
  Object.values(opettajaData).forEach(opData => {

    Object.values(opData.palkit).forEach(kurssitSamassaPalkissa => {

      if (kurssitSamassaPalkissa.length === 0) return

      // Tunnistetaan ainekoodi kurssin nimestä
      const aineKoodi = kurssitSamassaPalkissa[0].nimi.substring(0, 2)
      const onKieli = kieliAineet.includes(aineKoodi)

      const vvtLista = kurssitSamassaPalkissa.map(k => k.vvt)

      let laskettava

      if (onKieli) {
        // Kielet → samanaikainen → MAX
        laskettava = Math.max(...vvtLista)
      } else {
        // Muut aineet → peräkkäinen → SUM
        laskettava = vvtLista.reduce((a, b) => a + b, 0)
      }

      const aste = kurssitSamassaPalkissa[0].aste

      if (aste === 'yläkoulu') {
        opData.ylakoulu += laskettava
      }

      if (aste === 'lukio') {
        opData.lukio += laskettava
      }
    })
  })

  // ========================
  // ====== TEHTÄVÄT ========
  // ========================
  tehtavat.forEach(t => {

    const op = t.opettaja

    if (!opettajaData[op]) {
      opettajaData[op] = {
        ylakoulu: 0,
        lukio: 0,
        muutVvt: 0,
        eur: 0,
        palkit: {}
      }
    }

    if (t.rahana) {
      opettajaData[op].eur += Number(t.eur || 0)
    } else {
      opettajaData[op].muutVvt += parseVvt(t.vvt)
    }
  })

  // ========================
  // ====== EXCEL ===========
  // ========================
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Kokonaistyömäärä')

  ws.addRow([
    'Opettaja',
    'Yläkoulu VVT',
    'Lukio VVT',
    'Muut tehtävät VVT',
    'Yhteensä VVT',
    'Muut tehtävät EUR'
  ])

  ws.getRow(1).font = { bold: true }

  let totalY = 0
  let totalL = 0
  let totalM = 0
  let totalE = 0

  Object.entries(opettajaData).forEach(([op, data]) => {

    const yv = Number((data.ylakoulu || 0).toFixed(2))
    const lv = Number((data.lukio || 0).toFixed(2))
    const mv = Number((data.muutVvt || 0).toFixed(2))
    const eur = Number((data.eur || 0).toFixed(2))
    const total = Number((yv + lv + mv).toFixed(2))

    totalY += yv
    totalL += lv
    totalM += mv
    totalE += eur

    ws.addRow([op, yv, lv, mv, total, eur])
  })

  const summaryRow = ws.addRow([
    'YHTEENSÄ',
    totalY.toFixed(2),
    totalL.toFixed(2),
    totalM.toFixed(2),
    (totalY + totalL + totalM).toFixed(2),
    totalE.toFixed(2)
  ])

  summaryRow.font = { bold: true }
  summaryRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2F0D9' }
  }

  ws.columns.forEach(column => {
    let maxLength = 12
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
    'attachment; filename=opettajien_kokonaistyomaara.xlsx'
  )

  await wb.xlsx.write(res)
  res.end()
}

module.exports = {
  opettajaOpetusmaaraExcel,
  opettajienKokonaistyomaaraExcel
}