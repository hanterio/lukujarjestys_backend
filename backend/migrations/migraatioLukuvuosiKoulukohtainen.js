/**
 * Lukuvuodet → koulukohtaisiksi: yhdistää samalle koululle samannimiset rivit,
 * jakaa usean koulun jakamat lukuvuosi-id:t kopioiksi, siivoaa orphan-rivit,
 * luo uniikin indeksin (kouluId + name).
 *
 * Ajo ENNEN uuden backend-version käyttöönottoa (mallissa kouluId pakollinen):
 *   node migrations/migraatioLukuvuosiKoulukohtainen.js
 *
 * Vaatii .env:ssä MONGODB_URI.
 *
 * Kuiva-ajo:
 *   set DRY_RUN=1
 */
require('dotenv').config()
const mongoose = require('mongoose')

const Kurssi = require('../models/kurssi')
const Lukujarjestys = require('../models/lukujarjestys')
const Tehtava = require('../models/tehtava')
const TyomaaraKommentti = require('../models/tyomaaraKommentti')
const Koulu = require('../models/koulu')

/** Sama collection kuin Lukuvuosi, ei pakollista kouluId:tä ennen migraatiota */
const lukuvuosiMigrationSchema = new mongoose.Schema(
  {
    name: String,
    status: String,
    createdAt: Date,
    kouluId: { type: mongoose.Schema.Types.ObjectId, ref: 'Koulu' },
  },
  { strict: false, collection: 'lukuvuosis' }
)
const LukuvuosiM =
  mongoose.models.LukuvuosiMigration || mongoose.model('LukuvuosiMigration', lukuvuosiMigrationSchema)

const MONGODB_URI = process.env.MONGODB_URI
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

async function countGlobalRefs(lvId) {
  const id = lvId
  const k = await Kurssi.countDocuments({ lukuvuosiId: id })
  const j = await Lukujarjestys.countDocuments({ lukuvuosiId: id })
  const t = await Tehtava.countDocuments({ lukuvuosiId: id })
  const ty = await TyomaaraKommentti.countDocuments({ lukuvuosiId: id })
  const ko = await Koulu.countDocuments({ aktiivinenLukuvuosiId: id })
  return k + j + t + ty + ko
}

async function remapSchoolLv(schoolId, fromId, toId) {
  if (DRY_RUN) return
  const sid = schoolId
  await Kurssi.updateMany({ kouluId: sid, lukuvuosiId: fromId }, { $set: { lukuvuosiId: toId } })
  await Lukujarjestys.updateMany({ kouluId: sid, lukuvuosiId: fromId }, { $set: { lukuvuosiId: toId } })
  await Tehtava.updateMany({ kouluId: sid, lukuvuosiId: fromId }, { $set: { lukuvuosiId: toId } })
  await TyomaaraKommentti.updateMany({ kouluId: sid, lukuvuosiId: fromId }, { $set: { lukuvuosiId: toId } })
  await Koulu.updateMany({ _id: sid, aktiivinenLukuvuosiId: fromId }, { $set: { aktiivinenLukuvuosiId: toId } })
}

/** Lukuvuodet jotka koulu käyttää missä tahansa kentässä */
async function lukuvuosiIdsTouchingSchool(schoolId) {
  const sid = schoolId
  const ids = new Set()
  ;(await Kurssi.distinct('lukuvuosiId', { kouluId: sid })).forEach((x) => x && ids.add(String(x)))
  ;(await Lukujarjestys.distinct('lukuvuosiId', { kouluId: sid })).forEach((x) => x && ids.add(String(x)))
  ;(await Tehtava.distinct('lukuvuosiId', { kouluId: sid })).forEach((x) => x && ids.add(String(x)))
  ;(await TyomaaraKommentti.distinct('lukuvuosiId', { kouluId: sid })).forEach((x) => x && ids.add(String(x)))
  const koulu = await Koulu.findById(sid).select('aktiivinenLukuvuosiId').lean()
  if (koulu?.aktiivinenLukuvuosiId) ids.add(String(koulu.aktiivinenLukuvuosiId))
  return [...ids].map((s) => new mongoose.Types.ObjectId(s))
}

async function gatherSchoolsForLv(lvId) {
  const ids = new Set()
  ;(await Kurssi.distinct('kouluId', { lukuvuosiId: lvId })).forEach((x) => x && ids.add(String(x)))
  ;(await Lukujarjestys.distinct('kouluId', { lukuvuosiId: lvId })).forEach((x) => x && ids.add(String(x)))
  ;(await Tehtava.distinct('kouluId', { lukuvuosiId: lvId })).forEach((x) => x && ids.add(String(x)))
  ;(await TyomaaraKommentti.distinct('kouluId', { lukuvuosiId: lvId })).forEach((x) => x && ids.add(String(x)))
  ;(await Koulu.distinct('_id', { aktiivinenLukuvuosiId: lvId })).forEach((x) => x && ids.add(String(x)))
  return [...ids]
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map((s) => new mongoose.Types.ObjectId(s))
}

/** Yhdistää samalle koululle samannimiset lukuvuosi-id:t yhteen kanooniseen riviin */
async function mergeDuplicatesWithinSchool(schoolId) {
  if (DRY_RUN) return { merged: 0 }

  const lvIds = await lukuvuosiIdsTouchingSchool(schoolId)
  if (lvIds.length === 0) return { merged: 0 }

  const docs = await LukuvuosiM.find({ _id: { $in: lvIds } })
    .select('_id name')
    .lean()

  const byName = new Map()
  for (const d of docs) {
    const key = String(d.name || '').trim()
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key).push(d)
  }

  let merged = 0
  for (const [, group] of byName) {
    if (group.length < 2) continue
    group.sort((a, b) => String(a._id).localeCompare(String(b._id)))
    const canonical = group[0]._id
    for (const dup of group.slice(1)) {
      const before = await countGlobalRefs(dup._id)
      if (before === 0) {
        if (!DRY_RUN) await LukuvuosiM.deleteOne({ _id: dup._id })
        continue
      }
      if (!DRY_RUN) await remapSchoolLv(schoolId, dup._id, canonical)
      merged++
      const after = await countGlobalRefs(dup._id)
      if (!DRY_RUN && after === 0) {
        await LukuvuosiM.deleteOne({ _id: dup._id })
      }
    }
  }
  return { merged }
}

async function assignKouluIdIfFree(lvDoc, schoolId) {
  if (DRY_RUN) return { assigned: true }

  const kid = schoolId
  const existing = await LukuvuosiM.findOne({
    kouluId: kid,
    name: lvDoc.name,
    _id: { $ne: lvDoc._id },
  }).lean()

  if (existing) {
    await remapSchoolLv(kid, lvDoc._id, existing._id)
    const left = await countGlobalRefs(lvDoc._id)
    if (left === 0) {
      await LukuvuosiM.deleteOne({ _id: lvDoc._id })
    }
    return { mergedInto: existing._id }
  }

  await LukuvuosiM.updateOne({ _id: lvDoc._id }, { $set: { kouluId: kid } })
  return { assigned: true }
}

async function splitSharedLv(lvDoc, schools) {
  if (DRY_RUN) return

  schools.sort((a, b) => String(a).localeCompare(String(b)))
  const primaryId = schools[0]

  await assignKouluIdIfFree(lvDoc, primaryId)

  const primaryStill = await LukuvuosiM.findById(lvDoc._id).lean()
  if (!primaryStill) return

  for (const sid of schools.slice(1)) {
    const srcId = primaryStill._id
    const dup = await LukuvuosiM.findOne({ kouluId: sid, name: primaryStill.name }).lean()
    if (dup) {
      await remapSchoolLv(sid, srcId, dup._id)
      continue
    }
    const created = await LukuvuosiM.create({
      name: primaryStill.name,
      status: primaryStill.status,
      createdAt: primaryStill.createdAt || new Date(),
      kouluId: sid,
    })
    await remapSchoolLv(sid, srcId, created._id)
  }
}

async function ensureUniqueIndex() {
  const coll = mongoose.connection.db.collection('lukuvuosis')
  const ix = await coll.indexes()
  const has = ix.some((i) => i.name === 'kouluId_1_name_1')
  if (has) {
    console.log('Indeksi kouluId_1_name_1 on jo olemassa.')
    return
  }
  console.log('Luodaan uniikki indeksi { kouluId: 1, name: 1 }...')
  await coll.createIndex({ kouluId: 1, name: 1 }, { unique: true })
}

async function runMigration() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI puuttuu.')
    process.exit(1)
  }

  await mongoose.connect(MONGODB_URI)
  console.log('Yhdistetty.' + (DRY_RUN ? ' DRY_RUN' : ''))

  const koulut = await Koulu.find({}).select('_id nimi').lean()
  console.log(`Vaihe 1: yhdistetään duplikaattinimet ${koulut.length} koululle...`)

  let mergeTotal = 0
  for (const k of koulut) {
    const r = await mergeDuplicatesWithinSchool(k._id)
    mergeTotal += r.merged
    if (r.merged > 0) {
      console.log(`  ${k.nimi}: yhdistettiin viitteitä ${r.merged}`)
    }
  }
  console.log(`Vaihe 1 valmis (yhteensä remap-operaatioita ${mergeTotal}).`)

  console.log('Vaihe 2: kouluId ja jaetut lukuvuodet...')
  if (!DRY_RUN) {
    let lvList = await LukuvuosiM.find({
      $or: [{ kouluId: { $exists: false } }, { kouluId: null }],
    })
      .select('_id name status createdAt')
      .lean()

    let rounds = 0
    while (lvList.length > 0 && rounds < 50) {
      rounds++
      for (const lv of lvList) {
        const schools = await gatherSchoolsForLv(lv._id)
        if (schools.length === 0) {
          const refs = await countGlobalRefs(lv._id)
          if (refs === 0) {
            console.log(`Poistetaan käyttämätön lukuvuosi ${lv._id} (${lv.name})`)
            await LukuvuosiM.deleteOne({ _id: lv._id })
          } else {
            console.warn(`ORPHAN lukuvuosi ${lv._id} (${lv.name}) refs=${refs} — jää ilman kouluId`)
          }
          continue
        }

        if (schools.length === 1) {
          const lvFresh = await LukuvuosiM.findById(lv._id).lean()
          if (!lvFresh) continue
          await assignKouluIdIfFree(lvFresh, schools[0])
        } else {
          const lvFresh = await LukuvuosiM.findById(lv._id).lean()
          if (!lvFresh) continue
          await splitSharedLv(lvFresh, schools)
        }
      }
      lvList = await LukuvuosiM.find({
        $or: [{ kouluId: { $exists: false } }, { kouluId: null }],
      })
        .select('_id')
        .lean()
    }

    const orphan = await LukuvuosiM.countDocuments({
      $or: [{ kouluId: { $exists: false } }, { kouluId: null }],
    })
    if (orphan > 0) {
      console.error(`Virhe: ${orphan} lukuvuotta ilman kouluId — keskeytetään indeksi.`)
      await mongoose.connection.close()
      process.exit(1)
    }

    await ensureUniqueIndex()
  } else {
    const puuttuva = await LukuvuosiM.countDocuments({
      $or: [{ kouluId: { $exists: false } }, { kouluId: null }],
    })
    console.log(`DRY_RUN: vaihe 2 ohitettu; lukuvuosia ilman kouluId: ${puuttuva}`)
    console.log('DRY_RUN: indeksiä ei luotu.')
  }

  console.log('Valmis.')
  await mongoose.connection.close()
}

runMigration().catch((e) => {
  console.error(e)
  process.exit(1)
})
