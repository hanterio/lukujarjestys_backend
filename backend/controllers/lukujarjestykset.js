// controllers/lukujarjestykset.js
const mongoose = require('mongoose')
const Lukujarjestys = require('../models/lukujarjestys')

const tarkistaKonflikti = async (req, res) => {
  const { paiva, tunti, periodi, lukuvuosiId } = req.query
  const ignorePalkkiKey = String(req.query.ignorePalkkiKey || '').trim()
  const ignoreKurssiIdt = String(req.query.ignoreKurssiIdt || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const ignoreSet = new Set(ignoreKurssiIdt)

  if (!req.kouluId) {
    return res.json({ varatutKurssiIdt: [] })
  }

  try {
    const kaikki = await Lukujarjestys.find({
      periodi: Number(periodi),
      lukuvuosiId: new mongoose.Types.ObjectId(lukuvuosiId),
      kouluId: req.kouluId,
      'tunnit.paiva': paiva,
      'tunnit.tunti': Number(tunti)
    })

    const varatutKurssiIdt = []
    kaikki.forEach(lj => {
      lj.tunnit
        .filter(t => t.paiva === paiva && t.tunti === Number(tunti))
        .forEach(t => {
          t.kurssit.forEach(k => {
            if (ignorePalkkiKey && k.palkkiKey === ignorePalkkiKey) {
              return
            }
            if (!ignoreSet.has(k.kurssiId)) {
              varatutKurssiIdt.push(k.kurssiId)
            }
            if (k.yhdistetytIdt) {
              k.yhdistetytIdt.forEach((id) => {
                if (!ignoreSet.has(id)) {
                  varatutKurssiIdt.push(id)
                }
              })
            }
          })
        })
    })

    res.json({ varatutKurssiIdt })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}

const getOne = async (req, res) => {
  const { nimi, tyyppi, periodi, lukuvuosiId } = req.query

  try {
    if (!lukuvuosiId) return res.json([])
    if (!req.kouluId) return res.json([])

    const objectId = new mongoose.Types.ObjectId(lukuvuosiId)

    const kaikki = await Lukujarjestys.find({
      tyyppi: "palkki",
      periodi: Number(periodi),
      lukuvuosiId: objectId,
      kouluId: req.kouluId
    })

    res.json(kaikki)

  } catch (error) {
    console.error("GET ERROR:", error)
    res.status(500).json({ error: error.message })
  }
}

const save = async (req, res) => {
  const { nimi, tyyppi, periodi, lukuvuosiId, tunnit, optimointiAsetus } = req.body

  if (!nimi || !tyyppi || !periodi || !lukuvuosiId) {
    return res.status(400).json({ error: 'Puuttuvia tietoja' })
  }

  if (!req.kouluId) {
    return res.status(400).json({
      error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).' })
  }

  try {
    const objectId = new mongoose.Types.ObjectId(lukuvuosiId)

    const setFields = {
      tunnit: tunnit || [],
      kouluId: req.kouluId
    }
    if (optimointiAsetus && typeof optimointiAsetus === 'object') {
      const kurssiAsetukset = Array.isArray(optimointiAsetus.kurssiAsetukset)
        ? optimointiAsetus.kurssiAsetukset
          .filter((k) => String(k?.kurssiId || '').trim())
          .map((k) => ({
            kurssiId: String(k.kurssiId).trim(),
            tupla: ['default', 'prefer', 'avoid'].includes(k?.tupla) ? k.tupla : 'default'
          }))
        : []
      setFields.optimointiAsetus = {
        laita: optimointiAsetus.laita === true,
        tupla: ['default', 'prefer', 'avoid'].includes(optimointiAsetus.tupla)
          ? optimointiAsetus.tupla
          : 'default',
        ristiriitaRatkaisu: ['prefer_double', 'prefer_single'].includes(optimointiAsetus.ristiriitaRatkaisu)
          ? optimointiAsetus.ristiriitaRatkaisu
          : 'prefer_double',
        kurssiAsetukset
      }
    }

    const paivitetty = await Lukujarjestys.findOneAndUpdate(
      { nimi, tyyppi, periodi, lukuvuosiId: objectId, kouluId: req.kouluId },
      {
        $set: setFields
      },
      { new: true, upsert: true, runValidators: true }
    )

    res.json(paivitetty)

  } catch (error) {
    console.error("SAVE ERROR:", error)
    res.status(400).json({ error: error.message })
  }
}

const saveOptimointiAsetukset = async (req, res) => {
  const { periodi, lukuvuosiId, asetukset } = req.body || {}

  if (!periodi || !lukuvuosiId || !Array.isArray(asetukset)) {
    return res.status(400).json({ error: 'Puuttuvia tietoja' })
  }
  if (!req.kouluId) {
    return res.status(400).json({
      error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).' })
  }

  try {
    const objectId = new mongoose.Types.ObjectId(lukuvuosiId)
    const ops = asetukset
      .filter((a) => String(a?.palkkiKey || '').trim())
      .map((a) => {
        const palkkiKey = String(a.palkkiKey).trim()
        const tupla = ['default', 'prefer', 'avoid'].includes(a?.tupla)
          ? a.tupla
          : 'default'
        const laita = a?.laita === true
        const ristiriitaRatkaisu = ['prefer_double', 'prefer_single'].includes(a?.ristiriitaRatkaisu)
          ? a.ristiriitaRatkaisu
          : 'prefer_double'
        const kurssiAsetukset = Array.isArray(a?.kurssiAsetukset)
          ? a.kurssiAsetukset
            .filter((k) => String(k?.kurssiId || '').trim())
            .map((k) => ({
              kurssiId: String(k.kurssiId).trim(),
              tupla: ['default', 'prefer', 'avoid'].includes(k?.tupla) ? k.tupla : 'default'
            }))
          : []
        return Lukujarjestys.findOneAndUpdate(
          { nimi: palkkiKey, tyyppi: 'palkki', periodi: Number(periodi), lukuvuosiId: objectId, kouluId: req.kouluId },
          {
            $set: {
              kouluId: req.kouluId,
              optimointiAsetus: { laita, tupla, ristiriitaRatkaisu, kurssiAsetukset }
            },
            $setOnInsert: {
              tunnit: []
            }
          },
          { new: true, upsert: true, runValidators: true }
        )
      })

    await Promise.all(ops)
    return res.json({ ok: true, paivitetty: ops.length })
  } catch (error) {
    return res.status(400).json({ error: error.message })
  }
}

module.exports = { getOne, save, tarkistaKonflikti, saveOptimointiAsetukset }
