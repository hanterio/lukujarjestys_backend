const mongoose = require('mongoose')
const Lukujarjestys = require('../models/lukujarjestys')
const Kurssi = require('../models/kurssi')
const Aine = require('../models/aine')
const Koulu = require('../models/koulu')
const {
  checkHardConstraintsForPlacement,
  evaluateRulesAgainstSijoitukset
} = require('../utils/optimointiSaannot')

// ─── VAKIOT ──────────────────────────────────────────────────
const PAIVAT = ['ma', 'ti', 'ke', 'to', 'pe']
const SLOTIT = {
  ma: [1, 2, 3, 4, 5],
  ti: [1, 2, 3, 4, 5],
  ke: [1, 2, 3, 4],
  to: [1, 2, 3, 4, 5],
  pe: [1, 2, 3, 4, 5]
}

const sijoitusIntervalMapRef = new WeakMap()
const sijoitusDebugStatsRef = new WeakMap()

const normalizeAste = (asteRaw) => {
  const s = String(asteRaw || '').toLowerCase()
  if (s.includes('lukio')) return 'lukio'
  if (s.includes('ala')) return 'alakoulu'
  return 'ylakoulu'
}

const parseHHMM = (hhmm) => {
  const m = String(hhmm || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

const buildIntervalMapFromScheduleProfile = (profile) => {
  const map = {}
  ;['alakoulu', 'ylakoulu', 'lukio'].forEach((aste) => {
    map[aste] = {}
    const paivat = profile?.[aste]?.paivat || []
    paivat.forEach((p) => {
      const paiva = p?.paiva
      if (!paiva) return
      map[aste][paiva] = map[aste][paiva] || {}
      ;(p.slotit || []).forEach((s) => {
        const slot = Number(s?.slot)
        const alku = parseHHMM(s?.alkaa)
        const loppu = parseHHMM(s?.loppuu)
        if (!Number.isFinite(slot) || alku == null || loppu == null) return
        map[aste][paiva][slot] = { start: alku, end: loppu, optimize: s.optimize !== false }
      })
    })
  })
  return map
}

const defaultIntervalForSlot = (slot) => {
  const s = Number(slot)
  return { start: s * 100, end: s * 100 + 50, optimize: true }
}

const getIntervalFor = (intervalMap, aste, paiva, slot) => {
  const a = normalizeAste(aste)
  return intervalMap?.[a]?.[paiva]?.[Number(slot)] || defaultIntervalForSlot(slot)
}

const intervalsOverlap = (a, b) => a.start < b.end && b.start < a.end

const initDebugStats = () => ({
  teacherCrossSlotOverlapBlocks: 0,
  classCrossSlotOverlapBlocks: 0
})

const listaaHardConflictit = ({ sijoitukset, intervalMap }) => {
  const byDay = {}
  Object.entries(sijoitukset || {}).forEach(([avain, solu]) => {
    const [paiva, tuntiStr] = String(avain).split('-')
    const tunti = Number(tuntiStr)
    if (!paiva || !Number.isFinite(tunti)) return
    const blockMap = new Map()
    ;(solu || []).forEach((e) => {
      const pk = kanoninenPalkkiAvain(e.palkkiKey)
      if (!pk) return
      if (!blockMap.has(pk)) {
        blockMap.set(pk, {
          paiva,
          tunti,
          palkkiKey: pk,
          aste: e.aste || 'ylakoulu',
          opettajat: new Set(),
          luokat: new Set()
        })
      }
      const g = blockMap.get(pk)
      ;(e.opettajat || []).forEach((o) => g.opettajat.add(o))
      ;(e.luokat || []).forEach((l) => g.luokat.add(l))
    })
    if (!byDay[paiva]) byDay[paiva] = []
    blockMap.forEach((g) => {
      byDay[paiva].push({
        ...g,
        opettajat: [...g.opettajat],
        luokat: [...g.luokat]
      })
    })
  })

  const teacher = []
  const luokka = []
  Object.entries(byDay).forEach(([paiva, groups]) => {
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i]
        const b = groups[j]
        if (a.palkkiKey === b.palkkiKey) continue
        const ia = getIntervalFor(intervalMap, a.aste || 'ylakoulu', paiva, a.tunti)
        const ib = getIntervalFor(intervalMap, b.aste || 'ylakoulu', paiva, b.tunti)
        if (!intervalsOverlap(ia, ib)) continue

        a.opettajat.forEach((o) => {
          if (b.opettajat.includes(o)) {
            teacher.push({
              paiva,
              tuntiA: a.tunti,
              tuntiB: b.tunti,
              opettaja: o,
              palkkiA: a.palkkiKey,
              palkkiB: b.palkkiKey
            })
          }
        })
        a.luokat.forEach((l) => {
          if (b.luokat.includes(l)) {
            luokka.push({
              paiva,
              tuntiA: a.tunti,
              tuntiB: b.tunti,
              luokka: l,
              palkkiA: a.palkkiKey,
              palkkiB: b.palkkiKey
            })
          }
        })
      }
    }
  })

  const uniqBy = (arr, keyFn) => {
    const seen = new Set()
    const out = []
    arr.forEach((x) => {
      const k = keyFn(x)
      if (seen.has(k)) return
      seen.add(k)
      out.push(x)
    })
    return out
  }

  const byDayBlock = new Map()
  Object.entries(byDay).forEach(([paiva, groups]) => {
    groups.forEach((g) => {
      const k = `${paiva}|${g.palkkiKey}`
      if (!byDayBlock.has(k)) byDayBlock.set(k, new Set())
      byDayBlock.get(k).add(g.tunti)
    })
  })
  const sameBlock = []
  byDayBlock.forEach((setti, key) => {
    const [paiva, palkkiKey] = key.split('|')
    const tunnit = [...setti].sort((a, b) => a - b)
    const isAdjacentPair =
      tunnit.length === 2 &&
      Math.abs(Number(tunnit[1]) - Number(tunnit[0])) === 1
    const isProblem =
      tunnit.length > 2 ||
      (tunnit.length === 2 && !isAdjacentPair)
    if (isProblem) sameBlock.push({ paiva, palkkiKey, tunnit })
  })

  return {
    teacherConflicts: uniqBy(teacher, (x) => [x.paiva, x.tuntiA, x.tuntiB, x.opettaja, x.palkkiA, x.palkkiB].join('|')),
    classConflicts: uniqBy(luokka, (x) => [x.paiva, x.tuntiA, x.tuntiB, x.luokka, x.palkkiA, x.palkkiB].join('|')),
    sameBlockPerDay: uniqBy(sameBlock, (x) => [x.paiva, x.palkkiKey, (x.tunnit || []).join(',')].join('|'))
  }
}

const arvioiTuplaToiveet = ({ sijoitukset, optimointiAsetukset }) => {
  const slotitByPalkki = new Map()
  Object.entries(sijoitukset || {}).forEach(([avain, solu]) => {
    const [paiva, tuntiStr] = String(avain).split('-')
    const tunti = Number(tuntiStr)
    if (!paiva || !Number.isFinite(tunti)) return
    ;(solu || []).forEach((e) => {
      const pk = kanoninenPalkkiAvain(e.palkkiKey)
      if (!pk) return
      if (!slotitByPalkki.has(pk)) slotitByPalkki.set(pk, new Map())
      const paivaMap = slotitByPalkki.get(pk)
      if (!paivaMap.has(paiva)) paivaMap.set(paiva, new Set())
      paivaMap.get(paiva).add(tunti)
    })
  })

  const out = []
  Object.entries(optimointiAsetukset || {}).forEach(([palkkiKey, asetus]) => {
    const coursePrefer = Array.isArray(asetus?.kurssiAsetukset) &&
      asetus.kurssiAsetukset.some((k) => k?.tupla === 'prefer')
    const requested = asetus?.tupla === 'prefer' || coursePrefer
    if (!requested) return
    const paivaMap = slotitByPalkki.get(palkkiKey) || new Map()
    let fulfilled = false
    paivaMap.forEach((slotSet) => {
      const s = [...slotSet].sort((a, b) => a - b)
      for (let i = 0; i < s.length - 1; i++) {
        if (Math.abs(Number(s[i + 1]) - Number(s[i])) === 1) {
          fulfilled = true
          break
        }
      }
    })
    out.push({
      palkkiKey,
      requested: true,
      fulfilled
    })
  })
  return out
}

const HARDCODED_CONSTRAINTS = [
  {
    key: 'teacher_conflict',
    title: 'Ei opettajakonfliktia samassa ajassa',
    description: 'Sama opettaja ei voi olla päällekkäisissä sloteissa.'
  },
  {
    key: 'class_conflict',
    title: 'Ei luokkakonfliktia samassa ajassa',
    description: 'Sama luokka ei voi olla päällekkäisissä sloteissa.'
  },
  {
    key: 'same_block_per_day',
    title: 'Sama palkki vain kerran päivässä',
    description: 'Sama palkkiKey pyritään pitämään yhdessä slotissa per päivä.'
  },
  {
    key: 'edge_definition',
    title: 'Laitatunti-määritelmä',
    description: 'Yksittäinen = päivän eka/vika, tupla = päivän kaksi ekaa tai kaksi vikaa.'
  },
  {
    key: 'gap_minimization',
    title: 'Hyppytuntien minimointi',
    description: 'Gap-fix ja polish-vaiheet vähentävät välitunteja yläkoulussa.'
  },
  {
    key: 'unit_difficulty_sorting',
    title: 'Vaikeat yksiköt ensin',
    description: 'Useita opettajia/luokkia sisältävät yksiköt sijoitetaan ensin.'
  }
]

const kaikkiTuntipaikat = () => {
  const paikat = []
  PAIVAT.forEach(paiva => {
    SLOTIT[paiva].forEach(tunti => {
      paikat.push({ paiva, tunti })
    })
  })
  return paikat
}

const SLOTTEJA_VIIKOSSA = Object.values(SLOTIT).reduce((sum, arr) => sum + arr.length, 0)

const perakkaiseTPaikat = () => {
  const parit = []
  PAIVAT.forEach(paiva => {
    const slotit = SLOTIT[paiva]
    for (let i = 0; i < slotit.length - 1; i++) {
      parit.push([
        { paiva, tunti: slotit[i] },
        { paiva, tunti: slotit[i + 1] }
      ])
    }
  })
  return parit
}

const rakennaKurssiMap = (kurssitData) => new Map(
  kurssitData.map((k) => [k._id?.toString(), k])
)

const haeYlaLuokatPeriodille = (kurssitData, periodi) => [...new Set(
  kurssitData
    .filter((k) => k.aste !== 'lukio')
    .flatMap((k) =>
      (k.opetus || []).some((o) => Number(o.periodi) === Number(periodi))
        ? (k.luokka || [])
        : []
    )
)]

const rakennaPaivaPalkkiIndex = (sijoitukset) => {
  const index = new Map()
  Object.entries(sijoitukset).forEach(([avain, solu]) => {
    const [paiva] = avain.split('-')
    if (!index.has(paiva)) index.set(paiva, new Set())
    const setti = index.get(paiva)
    ;(solu || []).forEach((k) => {
      const canonical = kanoninenPalkkiAvain(k.palkkiKey)
      if (canonical) setti.add(canonical)
    })
  })
  return index
}

const laskeLuokkienAukkoSumma = (sijoitukset, luokat) => {
  let summa = 0
  luokat.forEach((luokka) => {
    summa += laskeLuokanKaikkiAukot(sijoitukset, luokka)
  })
  return summa
}

/** Tallennusnimi (esim. VA8_82) — optimoinnin virtuaaliavaimet muodossa VA8_82~ks_<id> katkaistaan. */
const kanoninenPalkkiAvain = (key) => {
  if (!key) return key
  const s = String(key)
  const i = s.indexOf('~')
  return i === -1 ? s : s.slice(0, i)
}

const virtuaaliPalkkiAvainYhdelleKurssille = (palkkiKey, kurssi) => {
  const id = kurssi._id?.toString() || kurssi.id || 'unknown'
  return `${palkkiKey}~ks_${id}`
}

// ─── KONFLIKTITARKISTUKSET ───────────────────────────────────
const onOpettajaKonflikti = (sijoitukset, opettajat, paiva, tunti) => {
  if (!opettajat || opettajat.length === 0) return false
  const intervalMap = sijoitusIntervalMapRef.get(sijoitukset)
  if (!intervalMap) {
    const avain = `${paiva}-${tunti}`
    const solu = sijoitukset[avain] || []
    return solu.some(k => k.opettajat?.some(o => opettajat.includes(o)))
  }

  const candidateInterval = getIntervalFor(intervalMap, 'ylakoulu', paiva, tunti)
  const currentSlot = Number(tunti)
  let crossSlotOverlapHit = false
  const found = Object.entries(sijoitukset).some(([avain, solu]) => {
    const [slotPaiva, slotTuntiStr] = avain.split('-')
    if (slotPaiva !== paiva) return false
    const slotTunti = Number(slotTuntiStr)
    const existingList = Array.isArray(solu) ? solu : []
    return existingList.some((k) => {
      const existingInterval = getIntervalFor(intervalMap, k.aste || 'ylakoulu', slotPaiva, slotTunti)
      if (!intervalsOverlap(candidateInterval, existingInterval)) return false
      const teacherMatch = k.opettajat?.some((o) => opettajat.includes(o))
      if (teacherMatch && slotTunti !== currentSlot) crossSlotOverlapHit = true
      return teacherMatch
    })
  })
  if (found && crossSlotOverlapHit) {
    const stats = sijoitusDebugStatsRef.get(sijoitukset)
    if (stats) stats.teacherCrossSlotOverlapBlocks += 1
  }
  return found
}

const onLuokkaKonflikti = (sijoitukset, luokat, paiva, tunti) => {
  if (!luokat || luokat.length === 0) return false
  const intervalMap = sijoitusIntervalMapRef.get(sijoitukset)
  if (!intervalMap) {
    const avain = `${paiva}-${tunti}`
    const solu = sijoitukset[avain] || []
    return solu.some(k => k.luokat?.some(l => luokat.includes(l)))
  }

  const candidateInterval = getIntervalFor(intervalMap, 'ylakoulu', paiva, tunti)
  const currentSlot = Number(tunti)
  let crossSlotOverlapHit = false
  const found = Object.entries(sijoitukset).some(([avain, solu]) => {
    const [slotPaiva, slotTuntiStr] = avain.split('-')
    if (slotPaiva !== paiva) return false
    const slotTunti = Number(slotTuntiStr)
    const existingList = Array.isArray(solu) ? solu : []
    return existingList.some((k) => {
      const existingInterval = getIntervalFor(intervalMap, k.aste || 'ylakoulu', slotPaiva, slotTunti)
      if (!intervalsOverlap(candidateInterval, existingInterval)) return false
      const classMatch = k.luokat?.some((l) => luokat.includes(l))
      if (classMatch && slotTunti !== currentSlot) crossSlotOverlapHit = true
      return classMatch
    })
  })
  if (found && crossSlotOverlapHit) {
    const stats = sijoitusDebugStatsRef.get(sijoitukset)
    if (stats) stats.classCrossSlotOverlapBlocks += 1
  }
  return found
}

const onPalkkiJoSamanaPaivana = (sijoitukset, palkkiKey, paiva, paivaPalkkiIndex = null) => {
  if (!palkkiKey) return false
  const canonicalTarget = kanoninenPalkkiAvain(palkkiKey)
  if (paivaPalkkiIndex) {
    return paivaPalkkiIndex.get(paiva)?.has(canonicalTarget) || false
  }
  return Object.entries(sijoitukset).some(([avain, solu]) => {
    const [slotPaiva] = avain.split('-')
    if (slotPaiva !== paiva) return false
    return (solu || []).some((k) => kanoninenPalkkiAvain(k.palkkiKey) === canonicalTarget)
  })
}

const onLuokallaHyppytunti = (sijoitukset, luokka, paiva) => {
  const paivanSlotit = SLOTIT[paiva]
  const varatut = paivanSlotit.filter((s) => {
    const avain = `${paiva}-${s}`
    const solu = sijoitukset[avain] || []
    return solu.some((k) => k.luokat?.includes(luokka))
  })

  if (varatut.length <= 1) return false
  const eka = Math.min(...varatut)
  const vika = Math.max(...varatut)
  const valissa = paivanSlotit.filter((s) => s >= eka && s <= vika)
  return valissa.some((s) => !varatut.includes(s))
}

const laskeLuokanPaivaKuorma = (sijoitukset, luokka, paiva) => {
  return SLOTIT[paiva].filter((s) => {
    const avain = `${paiva}-${s}`
    const solu = sijoitukset[avain] || []
    return solu.some((k) => k.luokat?.includes(luokka))
  }).length
}

const simuloiSijoitus = (sijoitukset, yksikko, paikat) => {
  const kopio = {}
  Object.entries(sijoitukset).forEach(([key, value]) => {
    kopio[key] = [...value]
  })
  const intervalMap = sijoitusIntervalMapRef.get(sijoitukset)
  if (intervalMap) sijoitusIntervalMapRef.set(kopio, intervalMap)
  const stats = sijoitusDebugStatsRef.get(sijoitukset)
  if (stats) sijoitusDebugStatsRef.set(kopio, stats)

  paikat.forEach(({ paiva, tunti }) => {
    const avain = `${paiva}-${tunti}`
    if (!kopio[avain]) kopio[avain] = []
    yksikko.kurssit.forEach((kurssi) => {
      kopio[avain].push({
        kurssiId: kurssi._id?.toString() || kurssi.id,
        kurssiNimi: kurssi.nimi,
        palkkiKey: yksikko.palkkiKey,
        yhdistetytIdt: null,
        opettajat: kurssi.opettaja || [],
        luokat: kurssi.luokka || [],
        aste: normalizeAste(kurssi.aste)
      })
    })
  })

  return kopio
}

const onPaivanLaitaTunti = (paiva, tunti) => {
  const slotit = SLOTIT[paiva]
  return tunti === slotit[0] || tunti === slotit[slotit.length - 1]
}

const onPaivanLaitaTupla = (paiva, t1, t2) => {
  const slotit = SLOTIT[paiva]
  const pari = [t1, t2].sort((a, b) => a - b)
  const alusta = [slotit[0], slotit[1]]
  const lopusta = [slotit[slotit.length - 2], slotit[slotit.length - 1]]
  return (
    pari[0] === alusta[0] && pari[1] === alusta[1]
  ) || (
    pari[0] === lopusta[0] && pari[1] === lopusta[1]
  )
}

const onPaivanViimeinenTunti = (paiva, tunti) => {
  const slotit = SLOTIT[paiva]
  return tunti === slotit[slotit.length - 1]
}

const parsiPaivaJaTuntiAvain = (avain) => {
  const [paiva, tuntiStr] = String(avain || '').split('-')
  return { paiva, tunti: Number(tuntiStr) }
}

const yritaJalkiHajottaaPalkkeja = ({
  sijoitukset,
  optimointiAsetukset,
  kurssitData,
  aineet,
  saannot
}) => {
  const kurssiMap = new Map(kurssitData.map((k) => [k._id?.toString() || k.id, k]))
  const report = []

  const haePalkinEntriestSlotista = (slotKey, canonicalKey) =>
    (sijoitukset[slotKey] || []).filter((e) => kanoninenPalkkiAvain(e.palkkiKey) === canonicalKey)

  Object.entries(optimointiAsetukset || {}).forEach(([canonicalKey, asetus]) => {
    const kurs = Array.isArray(asetus?.kurssiAsetukset) ? asetus.kurssiAsetukset : []
    const preferIds = new Set(kurs.filter((k) => k.tupla === 'prefer').map((k) => String(k.kurssiId)))
    const avoidIds = new Set(kurs.filter((k) => k.tupla === 'avoid').map((k) => String(k.kurssiId)))
    if (preferIds.size === 0 || avoidIds.size === 0) return

    const slotKeys = Object.keys(sijoitukset).filter((slotKey) =>
      haePalkinEntriestSlotista(slotKey, canonicalKey).length > 0
    )
    if (slotKeys.length < 2) {
      report.push({ palkkiKey: canonicalKey, changed: false, reason: 'not_enough_slots' })
      return
    }

    let changed = false
    let reason = 'no_candidate_move'
    let from = null
    let to = null

    for (const targetKey of slotKeys) {
      if (changed) break
      const { paiva: targetPaiva, tunti: targetTunti } = parsiPaivaJaTuntiAvain(targetKey)
      const targetEntries = haePalkinEntriestSlotista(targetKey, canonicalKey)
      const targetPrefer = targetEntries.filter((e) => preferIds.has(String(e.kurssiId)))
      if (targetPrefer.length === 0) continue

      const mahdollisetTunnit = [targetTunti - 1, targetTunti + 1]
      for (const newTunti of mahdollisetTunnit) {
        if (changed) break
        if (!SLOTIT[targetPaiva]?.includes(newTunti)) continue
        const newKey = `${targetPaiva}-${newTunti}`

        for (const sourceKey of slotKeys) {
          if (changed) break
          if (sourceKey === targetKey) continue

          const sourceEntries = haePalkinEntriestSlotista(sourceKey, canonicalKey)
          const moveEntries = sourceEntries.filter((e) => preferIds.has(String(e.kurssiId)))
          const otherEntries = sourceEntries.filter((e) => !preferIds.has(String(e.kurssiId)))
          if (moveEntries.length === 0 || otherEntries.length === 0) continue
          if (haePalkinEntriestSlotista(newKey, canonicalKey).length > 0) continue

          const opettajat = [...new Set(moveEntries.flatMap((e) => e.opettajat || []))]
          const luokat = [...new Set(moveEntries.flatMap((e) => e.luokat || []))]
          if (onOpettajaKonflikti(sijoitukset, opettajat, targetPaiva, newTunti)) continue
          if (onLuokkaKonflikti(sijoitukset, luokat, targetPaiva, newTunti)) continue

          const kurssitToPlace = [...new Set(moveEntries.map((e) => String(e.kurssiId)))]
            .map((id) => kurssiMap.get(id))
            .filter(Boolean)
          if (kurssitToPlace.length === 0) continue
          const hardCheck = checkHardConstraintsForPlacement({
            sijoitukset,
            paiva: targetPaiva,
            tunti: newTunti,
            kurssitToPlace,
            rules: saannot,
            aineet,
            kurssitData
          })
          if (!hardCheck.ok) continue

          // Apply move
          sijoitukset[sourceKey] = (sijoitukset[sourceKey] || []).filter(
            (e) => !(kanoninenPalkkiAvain(e.palkkiKey) === canonicalKey && preferIds.has(String(e.kurssiId)))
          )
          const moved = moveEntries.map((e) => ({
            ...e,
            palkkiKey: `${canonicalKey}~postsplit_A`
          }))
          if (!sijoitukset[newKey]) sijoitukset[newKey] = []
          sijoitukset[newKey].push(...moved)
          changed = true
          reason = 'moved_prefer_group_adjacent'
          from = sourceKey
          to = newKey
        }
      }
    }

    report.push({ palkkiKey: canonicalKey, changed, reason, from, to })
  })

  return report
}

const aiheuttaaHyppytunninSijoitus = (sijoitukset, yksikko, paikat) => {
  const simuloitu = simuloiSijoitus(sijoitukset, yksikko, paikat)
  return yksikko.luokat.some((luokka) =>
    PAIVAT.some((paiva) => onLuokallaHyppytunti(simuloitu, luokka, paiva))
  )
}

const laskeHyppyJaTasaisuusPenalty = (sijoitukset, yksikko, paikat, tasaisuusOpts = null) => {
  const simuloitu = simuloiSijoitus(sijoitukset, yksikko, paikat)
  let penalty = 0
  const tasOpts = tasaisuusOpts || { mode: 'count', multiplier: 8 }

  yksikko.luokat.forEach((luokka) => {
    // Hyppytunnit: erittäin vahva rangaistus.
    PAIVAT.forEach((paiva) => {
      if (onLuokallaHyppytunti(simuloitu, luokka, paiva)) {
        penalty += 250
      }
    })

    // Päivien tasaisuus: joko raakamäärä (vanha) tai täyttöaste eri päivillä (sääntö käytössä).
    const paivaKuormat = PAIVAT.map((paiva) => laskeLuokanPaivaKuorma(simuloitu, luokka, paiva))
    if (tasOpts.mode === 'util') {
      const indeksit = PAIVAT.map((_, i) => i).filter((i) => paivaKuormat[i] > 0)
      if (indeksit.length >= 2) {
        const utils = indeksit.map((i) => {
          const paiva = PAIVAT[i]
          const maxS = SLOTIT[paiva].length
          return maxS ? paivaKuormat[i] / maxS : 0
        })
        penalty += (Math.max(...utils) - Math.min(...utils)) * tasOpts.multiplier
      }
      // Raakamääräinen ero (max − min tuntia / päivä): tärkeä kun yksi päivä on lähes tyhjä mutta täyttöaste-ero näyttää pieneltä.
      const raaka = Number(tasOpts.raakaPainokerroin ?? 0)
      if (raaka > 0) {
        penalty += (Math.max(...paivaKuormat) - Math.min(...paivaKuormat)) * raaka
      }
    } else {
      const aktiiviset = paivaKuormat.filter((m) => m > 0)
      if (aktiiviset.length >= 2) {
        const maxKuorma = Math.max(...aktiiviset)
        const minKuorma = Math.min(...aktiiviset)
        penalty += (maxKuorma - minKuorma) * tasOpts.multiplier
      }
    }
  })

  return penalty
}

const kloonaaSijoitukset = (sijoitukset) => {
  const kopio = {}
  Object.entries(sijoitukset).forEach(([k, v]) => {
    kopio[k] = [...v]
  })
  const intervalMap = sijoitusIntervalMapRef.get(sijoitukset)
  if (intervalMap) sijoitusIntervalMapRef.set(kopio, intervalMap)
  const stats = sijoitusDebugStatsRef.get(sijoitukset)
  if (stats) sijoitusDebugStatsRef.set(kopio, stats)
  return kopio
}

const laskeLuokanPaivanAukot = (sijoitukset, luokka, paiva) => {
  const slotit = SLOTIT[paiva]
  const varatut = slotit.filter((s) => {
    const avain = `${paiva}-${s}`
    return (sijoitukset[avain] || []).some((k) => k.luokat?.includes(luokka))
  })
  if (varatut.length <= 1) return 0
  const eka = Math.min(...varatut)
  const vika = Math.max(...varatut)
  return slotit.filter((s) => s > eka && s < vika && !varatut.includes(s)).length
}

const laskeKaikkiAukot = (sijoitukset, luokat) => {
  let aukot = 0
  luokat.forEach((luokka) => {
    PAIVAT.forEach((paiva) => {
      aukot += laskeLuokanPaivanAukot(sijoitukset, luokka, paiva)
    })
  })
  return aukot
}

const listaaLuokkaPaivaAukot = (sijoitukset, luokat) => {
  const rivit = []
  luokat.forEach((luokka) => {
    PAIVAT.forEach((paiva) => {
      const aukot = laskeLuokanPaivanAukot(sijoitukset, luokka, paiva)
      if (aukot > 0) rivit.push({ luokka, paiva, aukot })
    })
  })
  rivit.sort((a, b) => b.aukot - a.aukot || String(a.luokka).localeCompare(String(b.luokka)) || String(a.paiva).localeCompare(String(b.paiva)))
  return rivit
}

const valitseSplitTargetitBudgetilla = ({
  candidates,
  luokkaSlackByName
}) => {
  const remaining = {}
  Object.entries(luokkaSlackByName || {}).forEach(([luokka, slack]) => {
    remaining[luokka] = Math.max(0, Number(slack || 0))
  })
  const sorted = [...(candidates || [])].sort((a, b) => {
    if (Boolean(a.splitPrioriteetti) !== Boolean(b.splitPrioriteetti)) {
      return a.splitPrioriteetti ? -1 : 1
    }
    if (Number(a.minSlack || 0) !== Number(b.minSlack || 0)) {
      return Number(a.minSlack || 0) - Number(b.minSlack || 0)
    }
    return String(a.palkkiKey).localeCompare(String(b.palkkiKey))
  })

  const selected = []
  const skipped = []
  sorted.forEach((c) => {
    const luokat = Array.isArray(c.luokat) ? c.luokat : []
    const ok = luokat.length > 0 && luokat.every((l) => Number(remaining[l] || 0) >= 1)
    if (!ok) {
      skipped.push({
        palkkiKey: c.palkkiKey,
        splitPrioriteetti: c.splitPrioriteetti === true,
        minSlack: Number(c.minSlack || 0),
        reason: 'class_budget_exhausted'
      })
      return
    }
    luokat.forEach((l) => { remaining[l] = Number(remaining[l] || 0) - 1 })
    selected.push(c)
  })

  return { selected, skipped, remaining }
}

const laskeLuokanKaikkiAukot = (sijoitukset, luokka) => {
  return PAIVAT.reduce((sum, paiva) => sum + laskeLuokanPaivanAukot(sijoitukset, luokka, paiva), 0)
}

const haePaivanAukkotunnit = (sijoitukset, luokka, paiva) => {
  const slotit = SLOTIT[paiva]
  const varatut = slotit.filter((s) => {
    const avain = `${paiva}-${s}`
    return (sijoitukset[avain] || []).some((k) => k.luokat?.includes(luokka))
  })
  if (varatut.length <= 1) return []
  const eka = Math.min(...varatut)
  const vika = Math.max(...varatut)
  return slotit.filter((s) => s > eka && s < vika && !varatut.includes(s))
}

const haeLuokanAukot = (sijoitukset, luokka) => {
  const aukot = []
  PAIVAT.forEach((paiva) => {
    haePaivanAukkotunnit(sijoitukset, luokka, paiva).forEach((tunti) => {
      aukot.push({ paiva, tunti })
    })
  })
  return aukot
}

const slotinKonfliktiSiirrolle = (sijoitukset, paiva, tunti, siirrettavat) => {
  const avain = `${paiva}-${tunti}`
  const kohde = sijoitukset[avain] || []
  const opettajat = [...new Set(siirrettavat.flatMap((k) => k.opettajat || []))]
  const luokat = [...new Set(siirrettavat.flatMap((k) => k.luokat || []))]
  return (
    kohde.some((k) => (k.opettajat || []).some((o) => opettajat.includes(o))) ||
    kohde.some((k) => (k.luokat || []).some((l) => luokat.includes(l)))
  )
}

const poistaPalkkiSlotista = (sijoitukset, paiva, tunti, palkkiKey) => {
  const avain = `${paiva}-${tunti}`
  sijoitukset[avain] = (sijoitukset[avain] || []).filter((e) => e.palkkiKey !== palkkiKey)
  if (sijoitukset[avain].length === 0) delete sijoitukset[avain]
}

const lisaaSlotiin = (sijoitukset, paiva, tunti, entries) => {
  const avain = `${paiva}-${tunti}`
  if (!sijoitukset[avain]) sijoitukset[avain] = []
  sijoitukset[avain].push(...entries)
}

const entriesKonfliktoivat = (entriesA, entriesB) => {
  const opA = [...new Set(entriesA.flatMap((e) => e.opettajat || []))]
  const opB = [...new Set(entriesB.flatMap((e) => e.opettajat || []))]
  const luA = [...new Set(entriesA.flatMap((e) => e.luokat || []))]
  const luB = [...new Set(entriesB.flatMap((e) => e.luokat || []))]
  const opeKonf = opA.some((o) => opB.includes(o))
  const luokkaKonf = luA.some((l) => luB.includes(l))
  return opeKonf || luokkaKonf
}

const haeKonfliktoivatPalkitSlotista = (sijoitukset, paiva, tunti, entries) => {
  const avain = `${paiva}-${tunti}`
  const solu = sijoitukset[avain] || []
  const palkkiMap = new Map()
  solu.forEach((e) => {
    if (!e.palkkiKey) return
    if (!palkkiMap.has(e.palkkiKey)) palkkiMap.set(e.palkkiKey, [])
    palkkiMap.get(e.palkkiKey).push(e)
  })
  return [...palkkiMap.entries()]
    .filter(([key, arr]) => Boolean(key) && entriesKonfliktoivat(arr, entries))
    .map(([key, arr]) => ({ palkkiKey: key, entries: arr }))
}

const voikoNoudattaaPalkkiLaitaa = (
  palkkiKey,
  paiva,
  tunti,
  vaPalkkiPaivanLoppuun,
  optimointiAsetukset = {}
) => {
  const canonical = kanoninenPalkkiAvain(palkkiKey)
  const asetus = optimointiAsetukset?.[canonical] || {}
  const vaatiiLaita =
    asetus?.laita === true ||
    (vaPalkkiPaivanLoppuun && String(canonical || '').toUpperCase().includes('VA'))
  if (!vaatiiLaita) return true
  return onPaivanLaitaTunti(paiva, tunti)
}

const yritaSijoittaaKetjusiirrolla = ({
  sijoitukset,
  movingEntries,
  movingPalkkiKey,
  targetPaiva,
  targetTunti,
  mahdollisetRuudut,
  kurssitData,
  kurssiMap,
  saannot,
  aineet,
  vaPalkkiPaivanLoppuun,
  optimointiAsetukset,
  depth,
  visitedPalkit,
  deadlineMs
}) => {
  const paivaPalkkiIndex = rakennaPaivaPalkkiIndex(sijoitukset)
  if (deadlineMs && Date.now() > deadlineMs) return null
  if (depth < 0) return null
  if (visitedPalkit.has(movingPalkkiKey)) return null
  if (!voikoNoudattaaPalkkiLaitaa(movingPalkkiKey, targetPaiva, targetTunti, vaPalkkiPaivanLoppuun, optimointiAsetukset)) return null
  if (onPalkkiJoSamanaPaivana(sijoitukset, movingPalkkiKey, targetPaiva, paivaPalkkiIndex)) return null

  if (voikoPalkinSijoittaaSlotiin({
    sijoitukset,
    paiva: targetPaiva,
    tunti: targetTunti,
    entries: movingEntries,
    kurssiMap,
    kurssitData,
    saannot,
    aineet
  })) {
    const done = kloonaaSijoitukset(sijoitukset)
    lisaaSlotiin(done, targetPaiva, targetTunti, movingEntries)
    return done
  }

  if (depth === 0) return null

  const blockers = haeKonfliktoivatPalkitSlotista(
    sijoitukset,
    targetPaiva,
    targetTunti,
    movingEntries
  )
  const nextVisited = new Set(visitedPalkit)
  nextVisited.add(movingPalkkiKey)

  for (const blocker of blockers) {
    if (nextVisited.has(blocker.palkkiKey)) continue
    for (const alt of mahdollisetRuudut) {
      if (alt.paiva === targetPaiva && alt.tunti === targetTunti) continue
      if (!voikoNoudattaaPalkkiLaitaa(blocker.palkkiKey, alt.paiva, alt.tunti, vaPalkkiPaivanLoppuun, optimointiAsetukset)) continue

      const temp = kloonaaSijoitukset(sijoitukset)
      poistaPalkkiSlotista(temp, targetPaiva, targetTunti, blocker.palkkiKey)
      const afterBlockerMoved = yritaSijoittaaKetjusiirrolla({
        sijoitukset: temp,
        movingEntries: blocker.entries,
        movingPalkkiKey: blocker.palkkiKey,
        targetPaiva: alt.paiva,
        targetTunti: alt.tunti,
        mahdollisetRuudut,
        kurssiMap,
        kurssitData,
        saannot,
        aineet,
        vaPalkkiPaivanLoppuun,
        optimointiAsetukset,
        depth: depth - 1,
        visitedPalkit: nextVisited,
        deadlineMs
      })
      if (!afterBlockerMoved) continue

      if (voikoPalkinSijoittaaSlotiin({
        sijoitukset: afterBlockerMoved,
        paiva: targetPaiva,
        tunti: targetTunti,
        entries: movingEntries,
        kurssiMap,
        kurssitData,
        saannot,
        aineet
      })) {
        lisaaSlotiin(afterBlockerMoved, targetPaiva, targetTunti, movingEntries)
        return afterBlockerMoved
      }
    }
  }
  return null
}

const ajaHardGapKorjaus = ({
  sijoitukset,
  kurssitData,
  saannot,
  aineet,
  periodi,
  vaPalkkiPaivanLoppuun,
  mahdollisetRuudut,
  optimointiAsetukset
}) => {
  const luokat = haeYlaLuokatPeriodille(kurssitData, periodi)
  const kurssiMap = rakennaKurssiMap(kurssitData)
  const maxClassAttempts = 2
  const chainDepth = 4
  const deadlineMs = Date.now() + 1800

  for (const luokka of luokat) {
    if (Date.now() > deadlineMs) break
    let attempts = 0
    while (laskeLuokanKaikkiAukot(sijoitukset, luokka) > 0 && attempts < maxClassAttempts) {
      if (Date.now() > deadlineMs) break
      attempts++
      const aukot = haeLuokanAukot(sijoitukset, luokka)
      if (aukot.length === 0) break
      const target = aukot[0]

      const sourcePaikat = mahdollisetRuudut.filter(({ paiva, tunti }) => {
        const avain = `${paiva}-${tunti}`
        return (sijoitukset[avain] || []).some((e) => e.luokat?.includes(luokka))
      })

      let solved = false
      for (const src of sourcePaikat) {
        if (Date.now() > deadlineMs) break
        const sourceKey = `${src.paiva}-${src.tunti}`
        const sourceSolu = sijoitukset[sourceKey] || []
        const palkit = [...new Set(
          sourceSolu
            .filter((e) => e.luokat?.includes(luokka))
            .map((e) => e.palkkiKey)
            .filter(Boolean)
        )]

        for (const palkkiKey of palkit) {
          if (Date.now() > deadlineMs) break
          const movingEntries = sourceSolu.filter((e) => e.palkkiKey === palkkiKey)
          if (movingEntries.length === 0) continue
          const temp = kloonaaSijoitukset(sijoitukset)
          poistaPalkkiSlotista(temp, src.paiva, src.tunti, palkkiKey)
          const result = yritaSijoittaaKetjusiirrolla({
            sijoitukset: temp,
            movingEntries,
            movingPalkkiKey: palkkiKey,
            targetPaiva: target.paiva,
            targetTunti: target.tunti,
            mahdollisetRuudut,
            kurssiMap,
            kurssitData,
            saannot,
            aineet,
            vaPalkkiPaivanLoppuun,
            optimointiAsetukset,
            depth: chainDepth,
            visitedPalkit: new Set(),
            deadlineMs
          })
          if (!result) continue

          const beforeTotal = laskeKaikkiAukot(sijoitukset, luokat)
          const afterTotal = laskeKaikkiAukot(result, luokat)
          if (afterTotal <= beforeTotal) {
            kopioiSijoituksetYli(sijoitukset, result)
            solved = true
            break
          }
        }
        if (solved) break
      }

      if (!solved) break
    }
  }
}

const laskeLuokanPaivaKuormatLista = (sijoitukset, luokka) =>
  PAIVAT.map((paiva) => laskeLuokanPaivaKuorma(sijoitukset, luokka, paiva))

const laskeRawSpreadLuokalle = (sijoitukset, luokka) => {
  const k = laskeLuokanPaivaKuormatLista(sijoitukset, luokka)
  return Math.max(...k) - Math.min(...k)
}

/** Montako tuntislottia palkki vie luokalla annettuna päivänä (tuplat = 2 → ohitetaan tasauksessa). */
const laskePalkinSlottejaLuokallaPaivalla = (sijoitukset, luokka, paiva, palkkiKey) => {
  let n = 0
  SLOTIT[paiva].forEach((tunti) => {
    const avain = `${paiva}-${tunti}`
    const solu = sijoitukset[avain] || []
    if (solu.some((e) => e.palkkiKey === palkkiKey && e.luokat?.includes(luokka))) {
      n++
    }
  })
  return n
}

const ajaPaivakuormanTasapainotus = ({
  sijoitukset,
  kurssitData,
  saannot,
  aineet,
  periodi,
  vaPalkkiPaivanLoppuun,
  mahdollisetRuudut,
  optimointiAsetukset
}) => {
  const tasaa = (saannot || []).find((r) => r.enabled && r.ruleType === 'tasaa_luokan_paivakuormat')
  if (!tasaa) return

  const luokat = haeYlaLuokatPeriodille(kurssitData, periodi)
  const kurssiMap = rakennaKurssiMap(kurssitData)
  const maxPasses = 10
  const deadlineMs = Date.now() + 1500

  for (let pass = 0; pass < maxPasses; pass++) {
    if (Date.now() > deadlineMs) break
    let muutos = false

    for (const luokka of luokat) {
      if (Date.now() > deadlineMs) break
      const spreadEnnen = laskeRawSpreadLuokalle(sijoitukset, luokka)
      if (spreadEnnen <= 2) continue

      const kuormat = laskeLuokanPaivaKuormatLista(sijoitukset, luokka)
      let maxP = PAIVAT[0]
      let minP = PAIVAT[0]
      let maxV = -1
      let minV = 999
      PAIVAT.forEach((paiva, i) => {
        const v = kuormat[i]
        if (v > maxV) {
          maxV = v
          maxP = paiva
        }
        if (v < minV) {
          minV = v
          minP = paiva
        }
      })
      if (maxP === minP) continue

      const sourcePaikat = mahdollisetRuudut.filter((p) => p.paiva === maxP)
      const targetPaikat = mahdollisetRuudut.filter((p) => p.paiva === minP)

      let siirrettiin = false
      for (const { tunti: sourceTunti } of sourcePaikat) {
        if (Date.now() > deadlineMs) break
        const sourceKey = `${maxP}-${sourceTunti}`
        const sourceSolu = sijoitukset[sourceKey] || []
        const palkkiKeys = [...new Set(
          sourceSolu
            .filter((k) => k.luokat?.includes(luokka))
            .map((k) => k.palkkiKey)
            .filter(Boolean)
        )]

        for (const palkkiKey of palkkiKeys) {
          if (laskePalkinSlottejaLuokallaPaivalla(sijoitukset, luokka, maxP, palkkiKey) !== 1) continue

          const siirrettavat = sourceSolu.filter((k) => k.palkkiKey === palkkiKey)
          if (siirrettavat.length === 0) continue

          for (const { tunti: targetTunti } of targetPaikat) {
            if (Date.now() > deadlineMs) break
            if (!voikoNoudattaaPalkkiLaitaa(palkkiKey, minP, targetTunti, vaPalkkiPaivanLoppuun, optimointiAsetukset)) continue

            const temp = kloonaaSijoitukset(sijoitukset)
            temp[sourceKey] = (temp[sourceKey] || []).filter((k) => k.palkkiKey !== palkkiKey)
            if (temp[sourceKey].length === 0) delete temp[sourceKey]

            if (onPalkkiJoSamanaPaivana(temp, palkkiKey, minP)) continue
            if (slotinKonfliktiSiirrolle(temp, minP, targetTunti, siirrettavat)) continue

            const kurssitToPlace = siirrettavat.map((s) => kurssiMap.get(s.kurssiId)).filter(Boolean)
            const placementCheck = checkHardConstraintsForPlacement({
              sijoitukset: temp,
              paiva: minP,
              tunti: targetTunti,
              kurssitToPlace,
              rules: saannot,
              aineet,
              kurssitData
            })
            if (!placementCheck.ok) continue

            const targetKey = `${minP}-${targetTunti}`
            if (!temp[targetKey]) temp[targetKey] = []
            temp[targetKey].push(...siirrettavat)

            const spreadJalkeen = laskeRawSpreadLuokalle(temp, luokka)
            if (spreadJalkeen >= spreadEnnen) continue

            const aukotEnnen = laskeKaikkiAukot(sijoitukset, luokat)
            const aukotJalkeen = laskeKaikkiAukot(temp, luokat)
            if (aukotJalkeen > aukotEnnen) continue

            kopioiSijoituksetYli(sijoitukset, temp)
            muutos = true
            siirrettiin = true
            break
          }
          if (siirrettiin) break
        }
        if (siirrettiin) break
      }
    }

    if (!muutos) break
  }
}

const ajaGapFix = ({
  sijoitukset,
  kurssitData,
  saannot,
  aineet,
  periodi,
  vaPalkkiPaivanLoppuun,
  mahdollisetRuudut,
  optimointiAsetukset
}) => {
  const luokat = haeYlaLuokatPeriodille(kurssitData, periodi)
  const kurssiMap = rakennaKurssiMap(kurssitData)
  const maxPasses = 6

  for (let pass = 0; pass < maxPasses; pass++) {
    let muutos = false

    for (const luokka of luokat) {
      for (const paiva of PAIVAT) {
        const aukkotunnit = haePaivanAukkotunnit(sijoitukset, luokka, paiva)
        if (aukkotunnit.length === 0) continue

        for (const targetTunti of aukkotunnit) {
          const sourcePaikat = mahdollisetRuudut.filter(
            (p) => !(p.paiva === paiva && p.tunti === targetTunti)
          )
          let siirrettiin = false

          for (const { paiva: sourcePaiva, tunti: sourceTunti } of sourcePaikat) {
            const sourceKey = `${sourcePaiva}-${sourceTunti}`
            const sourceSolu = sijoitukset[sourceKey] || []
            const candidatePalkit = [...new Set(
              sourceSolu
                .filter((k) => k.luokat?.includes(luokka))
                .map((k) => k.palkkiKey)
                .filter(Boolean)
            )]

            for (const palkkiKey of candidatePalkit) {
              const siirrettavat = sourceSolu.filter((k) => k.palkkiKey === palkkiKey)
              if (siirrettavat.length === 0) continue

              if (!voikoNoudattaaPalkkiLaitaa(palkkiKey, paiva, targetTunti, vaPalkkiPaivanLoppuun, optimointiAsetukset)) continue

              const temp = kloonaaSijoitukset(sijoitukset)
              temp[sourceKey] = (temp[sourceKey] || []).filter((k) => k.palkkiKey !== palkkiKey)
              if (temp[sourceKey].length === 0) delete temp[sourceKey]

              // Älä hajota sääntöä "sama palkki vain kerran / päivä"
              if (onPalkkiJoSamanaPaivana(temp, palkkiKey, paiva)) continue

              if (slotinKonfliktiSiirrolle(temp, paiva, targetTunti, siirrettavat)) {
                continue
              }

              const targetKey = `${paiva}-${targetTunti}`
              if (!temp[targetKey]) temp[targetKey] = []
              const kurssitToPlace = siirrettavat
                .map((s) => kurssiMap.get(s.kurssiId))
                .filter(Boolean)
              const placementCheck = checkHardConstraintsForPlacement({
                sijoitukset: temp,
                paiva,
                tunti: targetTunti,
                kurssitToPlace,
                rules: saannot,
                aineet,
                kurssitData
              })
              if (!placementCheck.ok) continue

              temp[targetKey].push(...siirrettavat)
              const luokkaAukotEnnen = laskeLuokanKaikkiAukot(sijoitukset, luokka)
              const luokkaAukotJalkeen = laskeLuokanKaikkiAukot(temp, luokka)
              const vaikuttavatLuokat = [...new Set(siirrettavat.flatMap((k) => k.luokat || []))]
              const vaikuttavatAukotEnnen = laskeLuokkienAukkoSumma(sijoitukset, vaikuttavatLuokat)
              const vaikuttavatAukotJalkeen = laskeLuokkienAukkoSumma(temp, vaikuttavatLuokat)
              const parantaaLuokkaa = luokkaAukotJalkeen < luokkaAukotEnnen
              const eiHuononnaGlobaalia = vaikuttavatAukotJalkeen <= vaikuttavatAukotEnnen
              if (parantaaLuokkaa && eiHuononnaGlobaalia) {
                Object.keys(sijoitukset).forEach((k) => delete sijoitukset[k])
                Object.entries(temp).forEach(([k, v]) => { sijoitukset[k] = v })
                muutos = true
                siirrettiin = true
                break
              }
            }
            if (siirrettiin) break
          }
          if (siirrettiin) break
        }
      }
    }

    if (!muutos) break
  }
}

const ajaSingleGapPolish = ({
  sijoitukset,
  kurssitData,
  saannot,
  aineet,
  periodi,
  vaPalkkiPaivanLoppuun,
  mahdollisetRuudut,
  optimointiAsetukset
}) => {
  const luokat = haeYlaLuokatPeriodille(kurssitData, periodi)
  const kurssiMap = rakennaKurssiMap(kurssitData)
  const gapitEnnen = new Map(luokat.map((l) => [l, laskeLuokanKaikkiAukot(sijoitukset, l)]))
  const deadlineMs = Date.now() + 1400

  const arvioiJaHyvaksy = (temp, kohdeLuokka) => {
    let huonontaaMuuta = false
    for (const muu of luokat) {
      const ennen = gapitEnnen.get(muu) || 0
      const jalkeen = laskeLuokanKaikkiAukot(temp, muu)
      if (muu === kohdeLuokka) {
        if (jalkeen >= ennen) {
          huonontaaMuuta = true
          break
        }
      } else if (jalkeen > ennen) {
        huonontaaMuuta = true
        break
      }
    }
    return !huonontaaMuuta
  }

  // Käsitellään ensin ne luokat, joilla on 1 aukko (esim 7A),
  // jotta yhden aukon poistot eivät huku yleiseen optimointiin.
  const luokatJarjestyksessa = [...luokat].sort((a, b) => {
    const ga = gapitEnnen.get(a) || 0
    const gb = gapitEnnen.get(b) || 0
    if (ga === 1 && gb !== 1) return -1
    if (gb === 1 && ga !== 1) return 1
    return String(a).localeCompare(String(b))
  })

  for (const luokka of luokatJarjestyksessa) {
    if (Date.now() > deadlineMs) break
    if (gapitEnnen.get(luokka) !== 1) continue
    const targetAukot = haeLuokanAukot(sijoitukset, luokka)
    if (targetAukot.length !== 1) continue
    const target = targetAukot[0]

    const sourceSlots = mahdollisetRuudut.filter(({ paiva, tunti }) => {
      const avain = `${paiva}-${tunti}`
      return (sijoitukset[avain] || []).some((e) => e.luokat?.includes(luokka))
    })

    let onnistui = false
    for (const { paiva: sourcePaiva, tunti: sourceTunti } of sourceSlots) {
      if (Date.now() > deadlineMs) break
      const sourceKey = `${sourcePaiva}-${sourceTunti}`
      const sourceSolu = sijoitukset[sourceKey] || []
      const palkkiKeys = [...new Set(
        sourceSolu
          .filter((e) => e.luokat?.includes(luokka))
          .map((e) => e.palkkiKey)
          .filter(Boolean)
      )]

      for (const palkkiKey of palkkiKeys) {
        if (Date.now() > deadlineMs) break
        const siirrettavat = sourceSolu.filter((e) => e.palkkiKey === palkkiKey)
        if (siirrettavat.length === 0) continue

        if (!voikoNoudattaaPalkkiLaitaa(palkkiKey, target.paiva, target.tunti, vaPalkkiPaivanLoppuun, optimointiAsetukset)) continue

        const temp = kloonaaSijoitukset(sijoitukset)
        temp[sourceKey] = (temp[sourceKey] || []).filter((e) => e.palkkiKey !== palkkiKey)
        if (temp[sourceKey].length === 0) delete temp[sourceKey]

        if (onPalkkiJoSamanaPaivana(temp, palkkiKey, target.paiva)) continue
        if (slotinKonfliktiSiirrolle(temp, target.paiva, target.tunti, siirrettavat)) continue

        const kurssitToPlace = siirrettavat
          .map((s) => kurssiMap.get(s.kurssiId))
          .filter(Boolean)
        const placementCheck = checkHardConstraintsForPlacement({
          sijoitukset: temp,
          paiva: target.paiva,
          tunti: target.tunti,
          kurssitToPlace,
          rules: saannot,
          aineet,
          kurssitData
        })
        if (!placementCheck.ok) continue

        const targetKey = `${target.paiva}-${target.tunti}`
        if (!temp[targetKey]) temp[targetKey] = []
        temp[targetKey].push(...siirrettavat)

        if (!arvioiJaHyvaksy(temp, luokka)) continue

        kopioiSijoituksetYli(sijoitukset, temp)
        onnistui = true
        break
      }
      // Jos suora siirto ei onnistunut, kokeile lyhyttä ketjusiirtoa (depth 2)
      if (!onnistui) {
        for (const palkkiKey of palkkiKeys) {
          if (Date.now() > deadlineMs) break
          const siirrettavat = sourceSolu.filter((e) => e.palkkiKey === palkkiKey)
          if (siirrettavat.length === 0) continue
          if (vaPalkkiPaivanLoppuun && String(palkkiKey).toUpperCase().includes('VA')) {
            if (!onPaivanLaitaTunti(target.paiva, target.tunti)) continue
          }

          const temp = kloonaaSijoitukset(sijoitukset)
          temp[sourceKey] = (temp[sourceKey] || []).filter((e) => e.palkkiKey !== palkkiKey)
          if (temp[sourceKey].length === 0) delete temp[sourceKey]
          const ketjutettu = yritaSijoittaaKetjusiirrolla({
            sijoitukset: temp,
            movingEntries: siirrettavat,
            movingPalkkiKey: palkkiKey,
            targetPaiva: target.paiva,
            targetTunti: target.tunti,
            mahdollisetRuudut,
            kurssiMap,
            kurssitData,
            saannot,
            aineet,
            vaPalkkiPaivanLoppuun,
            depth: 2,
            visitedPalkit: new Set(),
            deadlineMs
          })
          if (!ketjutettu) continue
          if (!arvioiJaHyvaksy(ketjutettu, luokka)) continue
          kopioiSijoituksetYli(sijoitukset, ketjutettu)
          onnistui = true
          break
        }
      }
      if (onnistui) break
    }
  }
}

const ajaKohdennettuAukkoKorjaus = ({
  sijoitukset,
  kurssitData,
  saannot,
  aineet,
  periodi,
  mahdollisetRuudut,
  vaPalkkiPaivanLoppuun,
  optimointiAsetukset
}) => {
  const luokat = haeYlaLuokatPeriodille(kurssitData, periodi)
  const kurssiMap = rakennaKurssiMap(kurssitData)
  const sallittuSet = new Set((mahdollisetRuudut || []).map((p) => `${p.paiva}-${p.tunti}`))
  const aukkoRivit = listaaLuokkaPaivaAukot(sijoitukset, luokat)
  if (aukkoRivit.length === 0) {
    return { changed: false, reason: 'no_gaps' }
  }

  const totalBefore = laskeKaikkiAukot(sijoitukset, luokat)
  let best = null

  aukkoRivit.slice(0, 6).forEach(({ luokka, paiva, aukot }) => {
    const targetTunnit = haePaivanAukkotunnit(sijoitukset, luokka, paiva)
      .filter((tunti) => sallittuSet.has(`${paiva}-${tunti}`))
    if (targetTunnit.length === 0) return

    const sourceTunnit = SLOTIT[paiva].filter((tunti) => {
      if (targetTunnit.includes(tunti)) return false
      const avain = `${paiva}-${tunti}`
      return (sijoitukset[avain] || []).some((e) => e.luokat?.includes(luokka))
    })

    targetTunnit.forEach((targetTunti) => {
      sourceTunnit.forEach((srcTunti) => {
        const sourceKey = `${paiva}-${srcTunti}`
        const sourceSolu = sijoitukset[sourceKey] || []
        const palkit = [...new Set(
          sourceSolu
            .filter((e) => e.luokat?.includes(luokka))
            .map((e) => e.palkkiKey)
            .filter(Boolean)
        )]

        palkit.forEach((palkkiKey) => {
          if (!voikoNoudattaaPalkkiLaitaa(palkkiKey, paiva, targetTunti, vaPalkkiPaivanLoppuun, optimointiAsetukset)) return
          const movingEntries = sourceSolu.filter((e) => e.palkkiKey === palkkiKey)
          if (movingEntries.length === 0) return

          const temp = kloonaaSijoitukset(sijoitukset)
          poistaPalkkiSlotista(temp, paiva, srcTunti, palkkiKey)
          const paivaPalkkiIndex = rakennaPaivaPalkkiIndex(temp)
          if (onPalkkiJoSamanaPaivana(temp, palkkiKey, paiva, paivaPalkkiIndex)) return

          if (!voikoPalkinSijoittaaSlotiin({
            sijoitukset: temp,
            paiva,
            tunti: targetTunti,
            entries: movingEntries,
            kurssiMap,
            kurssitData,
            saannot,
            aineet
          })) return

          lisaaSlotiin(temp, paiva, targetTunti, movingEntries)
          const totalAfter = laskeKaikkiAukot(temp, luokat)
          const classDayAfter = laskeLuokanPaivanAukot(temp, luokka, paiva)
          if (totalAfter >= totalBefore || classDayAfter >= aukot) return

          const candidate = {
            totalAfter,
            luokka,
            paiva,
            srcTunti,
            targetTunti,
            palkkiKey,
            sijoitukset: temp
          }
          if (!best || candidate.totalAfter < best.totalAfter) best = candidate
        })
      })
    })
  })

  if (!best) return { changed: false, reason: 'no_safe_move' }
  kopioiSijoituksetYli(sijoitukset, best.sijoitukset)
  return {
    changed: true,
    reason: 'targeted_single_gap_fix',
    luokka: best.luokka,
    paiva: best.paiva,
    from: `${best.paiva}-${best.srcTunti}`,
    to: `${best.paiva}-${best.targetTunti}`,
    palkkiKey: best.palkkiKey,
    aukotBefore: totalBefore,
    aukotAfter: best.totalAfter
  }
}

const kopioiSijoituksetYli = (target, source) => {
  Object.keys(target).forEach((k) => delete target[k])
  Object.entries(source).forEach(([k, v]) => { target[k] = v })
}

const hashString = (value) => {
  const text = String(value || '')
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h) + text.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

const voikoPalkinSijoittaaSlotiin = ({
  sijoitukset,
  paiva,
  tunti,
  entries,
  kurssiMap,
  kurssitData,
  saannot,
  aineet
}) => {
  if (entries.length === 0) return false
  if (slotinKonfliktiSiirrolle(sijoitukset, paiva, tunti, entries)) return false
  const kurssitToPlace = entries
    .map((e) => kurssiMap.get(e.kurssiId))
    .filter(Boolean)
  const placementCheck = checkHardConstraintsForPlacement({
    sijoitukset,
    paiva,
    tunti,
    kurssitToPlace,
    rules: saannot,
    aineet,
    kurssitData
  })
  return placementCheck.ok
}

const yritaKorjataSijoittamattomat = ({
  sijoitukset,
  sijoittamattomatYksikot,
  mahdollisetRuudut,
  kurssitData,
  kurssiMap,
  saannot,
  aineet,
  vaPalkkiPaivanLoppuun
}) => {
  const jaljella = []

  sijoittamattomatYksikot.forEach((yksikko) => {
    // 1) yritä ensin normaalisti uudelleen nykytilanteeseen
    const direct = etsiParasPaikka(
      yksikko,
      sijoitukset,
      mahdollisetRuudut,
      kurssitData,
      saannot,
      aineet
    )
    if (direct) {
      sijoitaYksikko(yksikko, direct, sijoitukset)
      return
    }

    // 2) vain yksittäisille: yritä vapauttaa paikka siirtämällä yksi estävä palkki
    if (yksikko.tyyppi === 'tuplatunti') {
      jaljella.push(yksikko)
      return
    }

    let onnistui = false
    for (const { paiva, tunti } of mahdollisetRuudut) {
      if (onPalkkiJoSamanaPaivana(sijoitukset, yksikko.palkkiKey, paiva)) continue
      if (yksikko.vaatiiPaivaanPaatteeksi && !onPaivanViimeinenTunti(paiva, tunti)) continue

      const avain = `${paiva}-${tunti}`
      const solu = sijoitukset[avain] || []

      const estavat = solu.filter((k) => {
        const opettajaKonflikti = (k.opettajat || []).some((o) => yksikko.opettajat.includes(o))
        const luokkaKonflikti = (k.luokat || []).some((l) => yksikko.luokat.includes(l))
        return opettajaKonflikti || luokkaKonflikti
      })
      if (estavat.length === 0) continue

      const blockerKeys = [...new Set(estavat.map((e) => e.palkkiKey).filter(Boolean))]
      for (const blockerKey of blockerKeys) {
        const blockerEntries = solu.filter((e) => e.palkkiKey === blockerKey)
        if (blockerEntries.length === 0) continue

        const blockerVaatiiPaatetta =
          vaPalkkiPaivanLoppuun && String(blockerKey).toUpperCase().includes('VA')

        for (const kohde of mahdollisetRuudut) {
          if (kohde.paiva === paiva && kohde.tunti === tunti) continue
          if (blockerVaatiiPaatetta && !onPaivanLaitaTunti(kohde.paiva, kohde.tunti)) continue

          const temp = kloonaaSijoitukset(sijoitukset)
          temp[avain] = (temp[avain] || []).filter((e) => e.palkkiKey !== blockerKey)
          if (temp[avain].length === 0) delete temp[avain]

          if (onPalkkiJoSamanaPaivana(temp, blockerKey, kohde.paiva)) continue

          if (!voikoPalkinSijoittaaSlotiin({
            sijoitukset: temp,
            paiva: kohde.paiva,
            tunti: kohde.tunti,
            entries: blockerEntries,
            kurssiMap,
            kurssitData,
            saannot,
            aineet
          })) continue

          const kohdeKey = `${kohde.paiva}-${kohde.tunti}`
          if (!temp[kohdeKey]) temp[kohdeKey] = []
          temp[kohdeKey].push(...blockerEntries)

          // Nyt pitäisi voida sijoittaa alkuperäinen yksikkö vapautettuun ruutuun.
          // Jos vielä jää estäjiä, yritä siirtää yksi lisäblokkeri.
          if (onOpettajaKonflikti(temp, yksikko.opettajat, paiva, tunti) ||
              onLuokkaKonflikti(temp, yksikko.luokat, paiva, tunti)) {
            const targetSolu = temp[avain] || []
            const lisablockerKeys = [...new Set(
              targetSolu
                .filter((k) => {
                  const opeKonf = (k.opettajat || []).some((o) => yksikko.opettajat.includes(o))
                  const luokkaKonf = (k.luokat || []).some((l) => yksikko.luokat.includes(l))
                  return opeKonf || luokkaKonf
                })
                .map((k) => k.palkkiKey)
                .filter((k) => k && k !== yksikko.palkkiKey)
            )]

            let siirrettiinToinen = false
            for (const blocker2 of lisablockerKeys) {
              const blocker2Entries = (temp[avain] || []).filter((e) => e.palkkiKey === blocker2)
              if (blocker2Entries.length === 0) continue
              const blocker2VaatiiPaatetta =
                vaPalkkiPaivanLoppuun && String(blocker2).toUpperCase().includes('VA')

              for (const kohde2 of mahdollisetRuudut) {
                if (kohde2.paiva === paiva && kohde2.tunti === tunti) continue
                if (blocker2VaatiiPaatetta && !onPaivanLaitaTunti(kohde2.paiva, kohde2.tunti)) continue
                if (onPalkkiJoSamanaPaivana(temp, blocker2, kohde2.paiva)) continue
                if (!voikoPalkinSijoittaaSlotiin({
                  sijoitukset: temp,
                  paiva: kohde2.paiva,
                  tunti: kohde2.tunti,
                  entries: blocker2Entries,
                  kurssiMap,
                  kurssitData,
                  saannot,
                  aineet
                })) continue

                temp[avain] = (temp[avain] || []).filter((e) => e.palkkiKey !== blocker2)
                if (temp[avain].length === 0) delete temp[avain]
                const kohde2Key = `${kohde2.paiva}-${kohde2.tunti}`
                if (!temp[kohde2Key]) temp[kohde2Key] = []
                temp[kohde2Key].push(...blocker2Entries)
                siirrettiinToinen = true
                break
              }
              if (siirrettiinToinen) break
            }
          }

          if (onOpettajaKonflikti(temp, yksikko.opettajat, paiva, tunti)) continue
          if (onLuokkaKonflikti(temp, yksikko.luokat, paiva, tunti)) continue

          const kurssitToPlace = yksikko.kurssit
            .map((k) => kurssiMap.get(k._id?.toString()))
            .filter(Boolean)
          const placementCheck = checkHardConstraintsForPlacement({
            sijoitukset: temp,
            paiva,
            tunti,
            kurssitToPlace,
            rules: saannot,
            aineet,
            kurssitData
          })
          if (!placementCheck.ok) continue

          sijoitaYksikko(yksikko, [{ paiva, tunti }], temp)
          kopioiSijoituksetYli(sijoitukset, temp)
          onnistui = true
          break
        }
        if (onnistui) break
      }
      if (onnistui) break
    }

    if (!onnistui) {
      jaljella.push(yksikko)
    }
  })

  return jaljella
}

// ─── PISTEYTYSFUNKTIO ────────────────────────────────────────
const laskeSijoitusPisteet = (sijoitukset, luokat, paiva, tunti) => {
  let pisteet = 0
  luokat.forEach(luokka => {
    let tunnitTallaPayvalla = 0
    SLOTIT[paiva].forEach(s => {
      const avain = `${paiva}-${s}`
      const solu = sijoitukset[avain] || []
      if (solu.some(k => k.luokat?.includes(luokka))) {
        tunnitTallaPayvalla++
      }
    })
    pisteet += tunnitTallaPayvalla * 2

    const slotit = SLOTIT[paiva]
    const indeksi = slotit.indexOf(tunti)
    if (indeksi > 0) {
      const onYlapuolellaJotain = slotit.slice(0, indeksi).some(s => {
        const a = `${paiva}-${s}`
        return (sijoitukset[a] || []).some(k => k.luokat?.includes(luokka))
      })
      const onValissaTyhja = slotit.slice(0, indeksi).some(s => {
        const a = `${paiva}-${s}`
        return !(sijoitukset[a] || []).some(k => k.luokat?.includes(luokka))
      })
      if (onYlapuolellaJotain && onValissaTyhja) {
        pisteet += 10
      }
    }
  })
  return pisteet
}

// ─── ETSI PARAS TUNTIPAIKKA ──────────────────────────────────
const etsiParasPaikka = (
  yksikko,
  sijoitukset,
  mahdollisetRuudut,
  kurssitData,
  saannot,
  aineet
) => {
  const paivaPalkkiIndex = rakennaPaivaPalkkiIndex(sijoitukset)
  const tasaaRule = (saannot || []).find(
    (r) => r.enabled && r.ruleType === 'tasaa_luokan_paivakuormat'
  )
  const tasaisuusOpts = tasaaRule
    ? {
        mode: 'util',
        multiplier: Math.max(1, Number(tasaaRule.params?.painokerroin ?? 72)),
        raakaPainokerroin: Math.max(0, Number(tasaaRule.params?.raakaPainokerroin ?? 32))
      }
    : { mode: 'count', multiplier: 8 }
  const kandidaatit = []

  // ─── TUPLATUNTI (vain KO/LI) ─────────────────────────────
  if (yksikko.tyyppi === 'tuplatunti') {
    const parit = perakkaiseTPaikat()
    parit.forEach(([p1, p2]) => {
      const konflikti1 =
        onOpettajaKonflikti(sijoitukset, yksikko.opettajat, p1.paiva, p1.tunti) ||
        onLuokkaKonflikti(sijoitukset, yksikko.luokat, p1.paiva, p1.tunti)
      const konflikti2 =
        onOpettajaKonflikti(sijoitukset, yksikko.opettajat, p2.paiva, p2.tunti) ||
        onLuokkaKonflikti(sijoitukset, yksikko.luokat, p2.paiva, p2.tunti)
      const lukittu1 = !mahdollisetRuudut.some(
        r => r.paiva === p1.paiva && r.tunti === p1.tunti
      )
      const lukittu2 = !mahdollisetRuudut.some(
        r => r.paiva === p2.paiva && r.tunti === p2.tunti
      )
      const samaPaivaVarattu = onPalkkiJoSamanaPaivana(
        sijoitukset,
        yksikko.palkkiKey,
        p1.paiva,
        paivaPalkkiIndex
      )

      const laitaehtoOk = !yksikko.vaatiiLaitapaikan || onPaivanLaitaTupla(p1.paiva, p1.tunti, p2.tunti)
      const paateehtoOk = !yksikko.vaatiiPaivaanPaatteeksi || onPaivanLaitaTupla(p1.paiva, p1.tunti, p2.tunti)

      if (!konflikti1 && !konflikti2 && !lukittu1 && !lukittu2 && !samaPaivaVarattu && laitaehtoOk && paateehtoOk) {
        const placementCheck1 = checkHardConstraintsForPlacement({
          sijoitukset,
          paiva: p1.paiva,
          tunti: p1.tunti,
          kurssitToPlace: yksikko.kurssit,
          rules: saannot,
          aineet,
          kurssitData
        })
        if (!placementCheck1.ok) return

        const placementCheck2 = checkHardConstraintsForPlacement({
          sijoitukset,
          paiva: p2.paiva,
          tunti: p2.tunti,
          kurssitToPlace: yksikko.kurssit,
          rules: saannot,
          aineet,
          kurssitData
        })
        if (!placementCheck2.ok) return

        const pisteetPerus = laskeSijoitusPisteet(
          sijoitukset, yksikko.luokat, p1.paiva, p1.tunti
        )
        const lisapenalty = laskeHyppyJaTasaisuusPenalty(sijoitukset, yksikko, [p1, p2], tasaisuusOpts)
        const aiheuttaaGap = aiheuttaaHyppytunninSijoitus(sijoitukset, yksikko, [p1, p2])
        kandidaatit.push({
          paikat: [p1, p2],
          pisteet: pisteetPerus + lisapenalty,
          aiheuttaaGap
        })
      }
    })

  // ─── NORMAALI YKSITTÄINEN ─────────────────────────────────
  } else {
    mahdollisetRuudut.forEach(({ paiva, tunti }) => {
      const konflikti =
        onOpettajaKonflikti(sijoitukset, yksikko.opettajat, paiva, tunti) ||
        onLuokkaKonflikti(sijoitukset, yksikko.luokat, paiva, tunti)

      const samaPaivaVarattu = onPalkkiJoSamanaPaivana(
        sijoitukset,
        yksikko.palkkiKey,
        paiva,
        paivaPalkkiIndex
      )

      const laitaehtoOk = !yksikko.vaatiiLaitapaikan || onPaivanLaitaTunti(paiva, tunti)
      const paateehtoOk = !yksikko.vaatiiPaivaanPaatteeksi || onPaivanLaitaTunti(paiva, tunti)

      if (!konflikti && !samaPaivaVarattu && laitaehtoOk && paateehtoOk) {
        const placementCheck = checkHardConstraintsForPlacement({
          sijoitukset,
          paiva,
          tunti,
          kurssitToPlace: yksikko.kurssit,
          rules: saannot,
          aineet,
          kurssitData
        })
        if (!placementCheck.ok) return

        const pisteetPerus = laskeSijoitusPisteet(sijoitukset, yksikko.luokat, paiva, tunti)
        const lisapenalty = laskeHyppyJaTasaisuusPenalty(
          sijoitukset,
          yksikko,
          [{ paiva, tunti }],
          tasaisuusOpts
        )
        const aiheuttaaGap = aiheuttaaHyppytunninSijoitus(
          sijoitukset,
          yksikko,
          [{ paiva, tunti }]
        )
        kandidaatit.push({
          paikat: [{ paiva, tunti }],
          pisteet: pisteetPerus + lisapenalty,
          aiheuttaaGap
        })
      }
    })
  }

  if (kandidaatit.length === 0) return null
  const ilmanHyppyja = kandidaatit.filter((k) => !k.aiheuttaaGap)
  const valittavat = ilmanHyppyja.length > 0 ? ilmanHyppyja : kandidaatit
  valittavat.sort((a, b) => a.pisteet - b.pisteet)
  return valittavat.at(0).paikat
}

// ─── SIJOITA YKSIKKÖ ─────────────────────────────────────────
const sijoitaYksikko = (yksikko, tulos, sijoitukset) => {
  const paikat = Array.isArray(tulos) ? tulos : []
  paikat.forEach(({ paiva, tunti }) => {
    const avain = `${paiva}-${tunti}`
    if (!sijoitukset[avain]) sijoitukset[avain] = []
    yksikko.kurssit.forEach(kurssi => {
      sijoitukset[avain].push({
        kurssiId: kurssi._id?.toString() || kurssi.id,
        kurssiNimi: kurssi.nimi,
        palkkiKey: yksikko.palkkiKey,
        yhdistetytIdt: null,
        opettajat: kurssi.opettaja || [],
        luokat: kurssi.luokka || [],
        aste: normalizeAste(kurssi.aste)
      })
    })
  })
}

// ─── MUODOSTA SIJOITETTAVAT YKSIKÖT ─────────────────────────
const muodostaYksikot = (periodi, kurssit, tuplatuntiAineet, options = {}) => {
  const periodiKey = String(periodi)
  const yksikot = []
  const palkit = {}

  kurssit.forEach(kurssi => {
    if (kurssi.aste === 'lukio') return
    kurssi.opetus
      .filter(o => String(o.periodi) === periodiKey)
      .forEach(opetus => {
        const key = opetus.palkki
        if (!palkit[key]) {
          palkit[key] = { palkkiKey: key, kurssit: [], tunnit: opetus.tunnit_viikossa }
        }
        if (opetus.tunnit_viikossa > palkit[key].tunnit) {
          palkit[key].tunnit = opetus.tunnit_viikossa
        }
        palkit[key].kurssit.push(kurssi)
      })
  })

  Object.values(palkit).forEach(palkki => {
    const nahtyKurssi = new Set()
    palkki.kurssit = palkki.kurssit.filter((k) => {
      const kid = k._id?.toString() || k.id || k.nimi
      if (nahtyKurssi.has(kid)) return false
      nahtyKurssi.add(kid)
      return true
    })

    const koKurssit = palkki.kurssit.filter(k =>
      tuplatuntiAineet.kotitalous.includes(k.aineId?.toString())
    )
    const liKurssit = palkki.kurssit.filter(k =>
      tuplatuntiAineet.liikunta.includes(k.aineId?.toString())
    )
    const muutKurssit = palkki.kurssit.filter(k =>
      !tuplatuntiAineet.kotitalous.includes(k.aineId?.toString()) &&
      !tuplatuntiAineet.liikunta.includes(k.aineId?.toString())
    )

    const onValinnainenPalkki = String(palkki.palkkiKey || '').toUpperCase().includes('VA')
    const vaPalkkiPaivanLoppuun = options.vaPalkkiPaivanLoppuun === true
    const palkkiAsetus = options.optimointiAsetukset?.[palkki.palkkiKey] || {}
    const tuplaAsetus = ['default', 'prefer', 'avoid'].includes(palkkiAsetus.tupla)
      ? palkkiAsetus.tupla
      : 'default'
    const vaadiLaita = palkkiAsetus.laita === true || (onValinnainenPalkki && vaPalkkiPaivanLoppuun)
    const ristiriitaRatkaisu = ['prefer_double', 'prefer_single'].includes(palkkiAsetus.ristiriitaRatkaisu)
      ? palkkiAsetus.ristiriitaRatkaisu
      : 'prefer_double'
    const salliKurssiHajotus = options.salliKurssiHajotus !== false
    const splitOnlyPalkkiKey = String(options.splitOnlyPalkkiKey || '').trim()
    const splitTargetMatch = !splitOnlyPalkkiKey || splitOnlyPalkkiKey === palkki.palkkiKey
    const luokkaSlackByName = options.luokkaSlackByName || {}
    const kurssiTuplaMap = new Map(
      (Array.isArray(palkkiAsetus.kurssiAsetukset) ? palkkiAsetus.kurssiAsetukset : [])
        .map((k) => [
          String(k.kurssiId || '').trim(),
          ['default', 'prefer', 'avoid'].includes(k.tupla) ? k.tupla : 'default'
        ])
    )

    const onVainLiikuntaa =
      liKurssit.length > 0 && muutKurssit.length === 0 && koKurssit.length === 0
    const onVainKotitaloutta =
      koKurssit.length > 0 && muutKurssit.length === 0 && liKurssit.length === 0

    const tunnitKurssillePalkissa = (kurssi) => {
      const o = (kurssi.opetus || []).find(
        (x) => Number(x.periodi) === Number(periodi) && x.palkki === palkki.palkkiKey
      )
      return o ? Number(o.tunnit_viikossa) || 0 : 0
    }

    const rakennaKokoPalkkiYksikot = (asetus) => {
      const preferDouble = asetus === 'prefer'
      const tuplatunteja = preferDouble ? Math.floor(palkki.tunnit / 2) : 0
      const yksittaisia = preferDouble ? (palkki.tunnit % 2) : palkki.tunnit
      for (let i = 0; i < tuplatunteja; i++) {
        yksikot.push({
          id: `${palkki.palkkiKey}_whole_tupa_${i}`,
          tyyppi: 'tuplatunti',
          palkkiKey: palkki.palkkiKey,
          kurssit: palkki.kurssit,
          tunnit: 2,
          prioriteetti: 1,
          vaatiiLaitapaikan: false,
          vaatiiPaivaanPaatteeksi: vaadiLaita,
          opettajat: [...new Set(palkki.kurssit.flatMap(k => k.opettaja || []))],
          luokat: [...new Set(palkki.kurssit.flatMap(k => k.luokka || []))]
        })
      }
      for (let i = 0; i < yksittaisia; i++) {
        yksikot.push({
          id: `${palkki.palkkiKey}_whole_yksi_${i}`,
          tyyppi: 'yksittainen',
          palkkiKey: palkki.palkkiKey,
          kurssit: palkki.kurssit,
          tunnit: 1,
          prioriteetti: vaadiLaita ? 0 : 3,
          vaatiiLaitapaikan: false,
          vaatiiPaivaanPaatteeksi: vaadiLaita,
          opettajat: [...new Set(palkki.kurssit.flatMap(k => k.opettaja || []))],
          luokat: [...new Set(palkki.kurssit.flatMap(k => k.luokka || []))]
        })
      }
    }

    // Hajota vain kun KO/LI on mukana: kaksi kotitalousryhmää, KO+LI, tai KO/LI + muut (esim. kieli).
    // Pelkkä muut (esim. kaksi kieltä samassa VA-palkissa) → säilytä yhteinen palkki.
    const vaSekapalkkiHajota =
      onValinnainenPalkki &&
      vaPalkkiPaivanLoppuun &&
      (
        koKurssit.length >= 2 ||
        (koKurssit.length >= 1 && liKurssit.length >= 1) ||
        (muutKurssit.length > 0 && (koKurssit.length >= 1 || liKurssit.length >= 1))
      )

    // Jos jokaisella kurssilla on sama tunnit_viikossa kuin palkin max, data on todennäköisesti
    // "yhteinen palkki, sama luku kopioitu" — älä kerro tunteja kurssimäärällä (synnyttää liikaa yksiköitä).
    const tunnitList = palkki.kurssit.map(tunnitKurssillePalkissa)
    const vaSekapalkkiTunnitNäyttävätKopioduilta =
      palkki.kurssit.length > 1 &&
      tunnitList.every((h) => h > 0 && h === palkki.tunnit)
    const kurssiTuplaAsetukset = palkki.kurssit
      .map((k) => kurssiTuplaMap.get(k._id?.toString() || k.id || '') || 'default')
      .filter((v) => v !== 'default')
    const onKurssiToiveita = kurssiTuplaAsetukset.length > 0
    const kurssiPrefer = kurssiTuplaAsetukset.includes('prefer')
    const kurssiAvoid = kurssiTuplaAsetukset.includes('avoid')
    const ristiriitaisetKurssiToiveet = kurssiPrefer && kurssiAvoid
    const effectiveTuplaAsetus = (() => {
      if (ristiriitaisetKurssiToiveet) {
        return ristiriitaRatkaisu === 'prefer_double' ? 'prefer' : 'avoid'
      }
      if (kurssiPrefer) return 'prefer'
      if (kurssiAvoid) return 'avoid'
      return tuplaAsetus
    })()
    const hajotaKurssiToiveilla =
      onKurssiToiveita &&
      effectiveTuplaAsetus === 'prefer' &&
      (
        kurssiAvoid ||
        (kurssiPrefer && (muutKurssit.length > 0 || liKurssit.length > 0 || koKurssit.length > 1))
      )

    // ─── VAIN KOTITALOUS / LIIKUNTA → tuplatunti mahdollista ─
    if (onVainLiikuntaa || onVainKotitaloutta) {
      const kaytaTuplia = effectiveTuplaAsetus !== 'avoid'
      const tuplatunteja = kaytaTuplia ? Math.floor(palkki.tunnit / 2) : 0
      const yksittaisia = kaytaTuplia ? (palkki.tunnit % 2) : palkki.tunnit
      const kurssitTuplaan = onVainLiikuntaa ? liKurssit : koKurssit
      const tyyppiPrefix = onVainLiikuntaa ? 'li' : 'ko'

      for (let i = 0; i < tuplatunteja; i++) {
        yksikot.push({
          id: `${palkki.palkkiKey}_${tyyppiPrefix}_tupa_${i}`,
          tyyppi: 'tuplatunti',
          palkkiKey: palkki.palkkiKey,
          kurssit: kurssitTuplaan,
          tunnit: 2,
          prioriteetti: 1,
          vaatiiLaitapaikan: false,
          vaatiiPaivaanPaatteeksi: vaadiLaita,
          opettajat: [...new Set(kurssitTuplaan.flatMap(k => k.opettaja || []))],
          luokat: [...new Set(kurssitTuplaan.flatMap(k => k.luokka || []))]
        })
      }
      for (let i = 0; i < yksittaisia; i++) {
        yksikot.push({
          id: `${palkki.palkkiKey}_${tyyppiPrefix}_yksi_${i}`,
          tyyppi: 'yksittainen',
          palkkiKey: palkki.palkkiKey,
          kurssit: kurssitTuplaan,
          tunnit: 1,
          prioriteetti: vaadiLaita ? 0 : 2,
          vaatiiLaitapaikan: false,
          vaatiiPaivaanPaatteeksi: vaadiLaita,
          opettajat: [...new Set(kurssitTuplaan.flatMap(k => k.opettaja || []))],
          luokat: [...new Set(kurssitTuplaan.flatMap(k => k.luokka || []))]
        })
      }

    // ─── VA-SEKAPALKKI: hillitty hajotus (enintään yksi KO/LI irrotus), ettei palkki räjähdä monelle slotille ─
    } else if (
      options.enableSubblockSplit === true &&
      splitTargetMatch &&
      (vaSekapalkkiHajota || hajotaKurssiToiveilla) &&
      (onKurssiToiveita || !vaSekapalkkiTunnitNäyttävätKopioduilta) &&
      effectiveTuplaAsetus === 'prefer' &&
      salliKurssiHajotus
    ) {
      const preferKurssit = palkki.kurssit.filter(
        (k) => (kurssiTuplaMap.get(k._id?.toString() || k.id || '') === 'prefer')
      )
      const avoidKurssit = palkki.kurssit.filter(
        (k) => (kurssiTuplaMap.get(k._id?.toString() || k.id || '') === 'avoid')
      )
      const defaultKurssit = palkki.kurssit.filter((k) => {
        const t = kurssiTuplaMap.get(k._id?.toString() || k.id || '') || 'default'
        return t === 'default'
      })

      // Alapalkit:
      // A = tuplaa suosivat (tai fallbackina KO),
      // B = yksittäisiä suosivat + default (tai fallbackina muut).
      let subA = []
      let subB = []
      if (preferKurssit.length > 0) {
        subA = preferKurssit
        subB = [...avoidKurssit, ...defaultKurssit]
      } else if (koKurssit.length > 0) {
        subA = koKurssit
        subB = palkki.kurssit.filter((k) => !subA.includes(k))
      } else {
        subA = [...liKurssit]
        subB = palkki.kurssit.filter((k) => !subA.includes(k))
      }

      const palkinLuokat = [...new Set(palkki.kurssit.flatMap((k) => k.luokka || []))]
      const minSlack = palkinLuokat.length > 0
        ? Math.min(...palkinLuokat.map((l) => Number(luokkaSlackByName[l] ?? 0)))
        : 0

      const voiIrrottaaYhden =
        subA.length > 0 &&
        subB.length > 0 &&
        palkki.tunnit >= 2 &&
        minSlack >= 1

      if (voiIrrottaaYhden) {
        const jaetutTunnit = Math.max(1, palkki.tunnit - 1)
        // Split-mallissa yhteinen runko pidetään yksittäisinä tunteina.
        // Muuten kaikki ryhmät voivat edelleen päätyä samaan tuplatuntiin,
        // jolloin KO-tuplatoiveen hyöty katoaa.
        for (let i = 0; i < jaetutTunnit; i++) {
          yksikot.push({
            id: `${palkki.palkkiKey}_mixed_shared_yksi_${i}`,
            tyyppi: 'yksittainen',
            palkkiKey: palkki.palkkiKey,
            kurssit: palkki.kurssit,
            tunnit: 1,
            prioriteetti: vaadiLaita ? 0 : 3,
            vaatiiLaitapaikan: false,
            vaatiiPaivaanPaatteeksi: vaadiLaita,
            opettajat: [...new Set(palkki.kurssit.flatMap(k => k.opettaja || []))],
            luokat: [...new Set(palkki.kurssit.flatMap(k => k.luokka || []))]
          })
        }

        yksikot.push({
          id: `${palkki.palkkiKey}_mixed_subA_0`,
          tyyppi: 'yksittainen',
          palkkiKey: `${palkki.palkkiKey}~sb_A`,
          kurssit: subA,
          tunnit: 1,
          prioriteetti: 1,
          vaatiiLaitapaikan: false,
          vaatiiPaivaanPaatteeksi: vaadiLaita,
          opettajat: [...new Set(subA.flatMap((k) => k.opettaja || []))],
          luokat: [...new Set(subA.flatMap((k) => k.luokka || []))]
        })
        yksikot.push({
          id: `${palkki.palkkiKey}_mixed_subB_0`,
          tyyppi: 'yksittainen',
          palkkiKey: `${palkki.palkkiKey}~sb_B`,
          kurssit: subB,
          tunnit: 1,
          prioriteetti: 1,
          vaatiiLaitapaikan: false,
          vaatiiPaivaanPaatteeksi: vaadiLaita,
          opettajat: [...new Set(subB.flatMap((k) => k.opettaja || []))],
          luokat: [...new Set(subB.flatMap((k) => k.luokka || []))]
        })
      } else {
        const fallbackTupla = effectiveTuplaAsetus
        if (fallbackTupla === 'prefer' || fallbackTupla === 'avoid') {
          rakennaKokoPalkkiYksikot(fallbackTupla)
        } else {
          for (let i = 0; i < palkki.tunnit; i++) {
            yksikot.push({
              id: `${palkki.palkkiKey}_${i}`,
              tyyppi: 'palkki',
              palkkiKey: palkki.palkkiKey,
              kurssit: palkki.kurssit,
              tunnit: 1,
              prioriteetti: vaadiLaita ? 0 : 3,
              vaatiiLaitapaikan: false,
              vaatiiPaivaanPaatteeksi: vaadiLaita,
              opettajat: [...new Set(palkki.kurssit.flatMap(k => k.opettaja || []))],
              luokat: [...new Set(palkki.kurssit.flatMap(k => k.luokka || []))]
            })
          }
        }
      }

    // ─── NORMAALI PALKKI ──────────────────────────────────────
    } else {
      const fallbackTupla = effectiveTuplaAsetus
      if (fallbackTupla === 'prefer' || fallbackTupla === 'avoid') {
        rakennaKokoPalkkiYksikot(fallbackTupla)
      } else {
        for (let i = 0; i < palkki.tunnit; i++) {
          yksikot.push({
            id: `${palkki.palkkiKey}_${i}`,
            tyyppi: 'palkki',
            palkkiKey: palkki.palkkiKey,
            kurssit: palkki.kurssit,
            tunnit: 1,
            prioriteetti: vaadiLaita ? 0 : 3,
            vaatiiLaitapaikan: false,
            vaatiiPaivaanPaatteeksi: vaadiLaita,
            opettajat: [...new Set(palkki.kurssit.flatMap(k => k.opettaja || []))],
            luokat: [...new Set(palkki.kurssit.flatMap(k => k.luokka || []))]
          })
        }
      }
    }
  })

  // Sijoita ensin vaikeimmat yksiköt:
  // enemmän opettajia + enemmän luokkia + enemmän kursseja.
  // Tämä vähentää todennäköisyyttä, että korkean sidonnaisuuden palkit jäävät loppuun jumiin.
  const laskeVaikeus = (y) => {
    const opettajaCount = (y.opettajat || []).length
    const luokkaCount = (y.luokat || []).length
    const kurssiCount = (y.kurssit || []).length
    const moniOpettajaLuokkaBonus =
      (opettajaCount >= 2 ? 6 : 0) +
      (luokkaCount >= 2 ? 8 : 0)
    return (opettajaCount * 3) + (luokkaCount * 4) + (kurssiCount * 2) + moniOpettajaLuokkaBonus
  }

  const attemptIndex = Number(options.attemptIndex || 0)
  const splitFirstPalkkiKey = String(options.splitFirstPalkkiKey || '').trim()

  yksikot.sort((a, b) => {
    if (splitFirstPalkkiKey) {
      const aTarget = kanoninenPalkkiAvain(a.palkkiKey) === splitFirstPalkkiKey
      const bTarget = kanoninenPalkkiAvain(b.palkkiKey) === splitFirstPalkkiKey
      if (aTarget !== bTarget) return aTarget ? -1 : 1
    }
    if (a.prioriteetti !== b.prioriteetti) {
      return a.prioriteetti - b.prioriteetti
    }
    const vaikeusA = laskeVaikeus(a)
    const vaikeusB = laskeVaikeus(b)
    if (vaikeusA !== vaikeusB) {
      return vaikeusB - vaikeusA
    }
    if (attemptIndex > 0) {
      const avainA = hashString(`${a.id}:${attemptIndex}`)
      const avainB = hashString(`${b.id}:${attemptIndex}`)
      if (avainA !== avainB) return avainA - avainB
    }
    return String(a.id).localeCompare(String(b.id))
  })
  return yksikot
}

// ─── PÄÄFUNKTIO ──────────────────────────────────────────────
const optimoi = async (req, res) => {
  const { periodi, lukuvuosiId } = req.body
  const periodiKey = String(periodi)

  if (!periodi || !lukuvuosiId) {
    return res.status(400).json({ error: 'Puuttuvia tietoja' })
  }

  if (!req.kouluId) {
    return res.status(400).json({
      error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).' })
  }

  const kouluId = req.kouluId

  try {
    console.log(`Optimointi alkaa – periodi ${periodi}`)

    const kurssit = await Kurssi.find({ lukuvuosiId, kouluId })
    const aineet = await Aine.find({})
    const saannot = []
    const koulu = await Koulu.findById(kouluId).select('aikatauluProfiili').lean()
    const intervalMap = buildIntervalMapFromScheduleProfile(koulu?.aikatauluProfiili || {})

    const tuplatuntiAineet = {
      kotitalous: aineet
        .filter(a => a.nimi?.toLowerCase().includes('kotitalous'))
        .map(a => a._id.toString()),
      liikunta: aineet
        .filter(a => a.nimi?.toLowerCase().includes('liikunta'))
        .map(a => a._id.toString())
    }

    // lukion palkit
    const lukioPalkkiNimet = new Set()
    kurssit.forEach(k => {
      if (k.aste === 'lukio') {
        k.opetus
          .filter(o => String(o.periodi) === periodiKey)
          .forEach(o => lukioPalkkiNimet.add(o.palkki))
      }
    })

    const objectId = new mongoose.Types.ObjectId(lukuvuosiId)

    // hae lukion sijoitukset pohjaksi
    const lukioLukujarjestykset = await Lukujarjestys.find({
      periodi,
      lukuvuosiId: objectId,
      kouluId,
      nimi: { $in: [...lukioPalkkiNimet] }
    })

    const rakennaPohjaSijoitukset = () => {
      const pohja = {}
      lukioLukujarjestykset.forEach(lj => {
        lj.tunnit.forEach(t => {
          const avain = `${t.paiva}-${t.tunti}`
          if (!pohja[avain]) pohja[avain] = []
          t.kurssit.forEach(k => {
            const kurssiData = kurssit.find(kr => kr._id?.toString() === k.kurssiId)
            pohja[avain].push({
              kurssiId: k.kurssiId,
              kurssiNimi: k.kurssiNimi,
              palkkiKey: lj.nimi,
              yhdistetytIdt: k.yhdistetytIdt || [],
              opettajat: kurssiData?.opettaja || [],
              luokat: [],
              aste: normalizeAste(kurssiData?.aste || 'lukio')
            })
          })
        })
      })
      sijoitusIntervalMapRef.set(pohja, intervalMap)
      sijoitusDebugStatsRef.set(pohja, initDebugStats())
      return pohja
    }

    const lukittujaAvaimia = new Set(Object.keys(rakennaPohjaSijoitukset()))
    console.log(`Lukittuja tunteja: ${lukittujaAvaimia.size}`)

    // vapaat tuntipaikat (ke-5 ei käytössä yläkoululle)
    const mahdollisetRuudut = kaikkiTuntipaikat().filter(({ paiva, tunti }) => {
      if (paiva === 'ke' && tunti === 5) return false
      return true
    })

    console.log(`Mahdollisia ruutuja: ${mahdollisetRuudut.length}`)

    // laske tarvittavat tuntipaikat
    const tarvitaanPaikkoja = Object.values(
      kurssit
        .filter(k => k.aste !== 'lukio')
        .reduce((palkit, kurssi) => {
          kurssi.opetus
            .filter(o => String(o.periodi) === periodiKey)
            .forEach(o => {
              if (!palkit[o.palkki]) palkit[o.palkki] = 0
              if (o.tunnit_viikossa > palkit[o.palkki]) {
                palkit[o.palkki] = o.tunnit_viikossa
              }
            })
          return palkit
        }, {})
    ).reduce((sum, v) => sum + v, 0)
    const kapasiteettiYlijäämä = mahdollisetRuudut.length - tarvitaanPaikkoja

    const luokkaPalkkiTunnit = {}
    kurssit
      .filter((k) => k.aste !== 'lukio')
      .forEach((k) => {
        const luokat = k.luokka || []
        ;(k.opetus || [])
          .filter((o) => Number(o.periodi) === Number(periodi))
          .forEach((o) => {
            luokat.forEach((l) => {
              if (!luokkaPalkkiTunnit[l]) luokkaPalkkiTunnit[l] = {}
              const prev = Number(luokkaPalkkiTunnit[l][o.palkki] || 0)
              if (Number(o.tunnit_viikossa) > prev) {
                luokkaPalkkiTunnit[l][o.palkki] = Number(o.tunnit_viikossa)
              }
            })
          })
      })
    const luokkaSlackByName = {}
    Object.entries(luokkaPalkkiTunnit).forEach(([luokka, palkitObj]) => {
      const required = Object.values(palkitObj).reduce((s, v) => s + Number(v || 0), 0)
      luokkaSlackByName[luokka] = SLOTTEJA_VIIKOSSA - required
    })

    console.log(`Tarvitaan: ${tarvitaanPaikkoja}, vapaita: ${mahdollisetRuudut.length}`)

    const vaPalkkiPaivanLoppuun = saannot.some((s) =>
      s.enabled && s.ruleType === 'va_palkki_paivan_loppuun'
    )
    const palkkiDocs = await Lukujarjestys.find({
      tyyppi: 'palkki',
      periodi: Number(periodi),
      lukuvuosiId: new mongoose.Types.ObjectId(lukuvuosiId),
      kouluId
    }).select('nimi optimointiAsetus')
    const optimointiAsetukset = {}
    palkkiDocs.forEach((d) => {
      const key = String(d.nimi || '').trim()
      if (!key) return
      optimointiAsetukset[key] = {
        laita: d.optimointiAsetus?.laita === true,
        tupla: ['default', 'prefer', 'avoid'].includes(d.optimointiAsetus?.tupla)
          ? d.optimointiAsetus.tupla
          : 'default',
        ristiriitaRatkaisu: ['prefer_double', 'prefer_single'].includes(d.optimointiAsetus?.ristiriitaRatkaisu)
          ? d.optimointiAsetus.ristiriitaRatkaisu
          : 'prefer_double',
        splitPrioriteetti: d.optimointiAsetus?.splitPrioriteetti === true,
        kurssiAsetukset: Array.isArray(d.optimointiAsetus?.kurssiAsetukset)
          ? d.optimointiAsetus.kurssiAsetukset
              .filter((k) => String(k?.kurssiId || '').trim())
              .map((k) => ({
                kurssiId: String(k.kurssiId).trim(),
                tupla: ['default', 'prefer', 'avoid'].includes(k?.tupla) ? k.tupla : 'default'
              }))
          : []
      }
    })
    const kaikkiYlaLuokat = haeYlaLuokatPeriodille(kurssit, periodi)
    const kurssiMap = rakennaKurssiMap(kurssit)

    const attempts = 6
    let paras = null
    const trialSummary = []

    const ajaVariantti = ({ enableSubblockSplit, splitOnlyPalkkiKey = '' }) => {
      const kurssitPalkittain = {}
      kurssit
        .filter((k) => k.aste !== 'lukio')
        .forEach((k) => {
          (k.opetus || [])
            .filter((o) => Number(o.periodi) === Number(periodi))
            .forEach((o) => {
              if (!kurssitPalkittain[o.palkki]) kurssitPalkittain[o.palkki] = []
              kurssitPalkittain[o.palkki].push(k)
            })
        })

      let variantBest = null
      for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex++) {
        const sijoituksetCandidate = rakennaPohjaSijoitukset()
        const yksikot = muodostaYksikot(periodi, kurssit, tuplatuntiAineet, {
          vaPalkkiPaivanLoppuun,
          optimointiAsetukset,
          luokkaSlackByName,
          enableSubblockSplit,
          splitOnlyPalkkiKey,
          splitFirstPalkkiKey: enableSubblockSplit ? splitOnlyPalkkiKey : '',
          salliKurssiHajotus: true,
          attemptIndex
        })

        let debugPalkkiHajotusVariant = []
        if (attemptIndex === 0) {
          debugPalkkiHajotusVariant = Object.entries(optimointiAsetukset)
            .filter(([palkkiKey, asetus]) => {
              const onToiveita =
                asetus?.tupla === 'prefer' ||
                asetus?.tupla === 'avoid' ||
                (Array.isArray(asetus?.kurssiAsetukset) && asetus.kurssiAsetukset.length > 0)
              return onToiveita && Boolean(kurssitPalkittain[palkkiKey]?.length)
            })
            .map(([palkkiKey, asetus]) => {
              const palkinYksikot = yksikot.filter((y) => kanoninenPalkkiAvain(y.palkkiKey) === palkkiKey)
              const onIrrotus = palkinYksikot.some((y) => String(y.id).includes('_mixed_sub'))
              const onKurssiVirtuaali = palkinYksikot.some((y) => String(y.palkkiKey).includes('~ks_') || String(y.palkkiKey).includes('~sb_'))
              const tyyppiYhteenveto = [...new Set(palkinYksikot.map((y) => y.tyyppi))].join(', ')
              const coursePrefs = Array.isArray(asetus?.kurssiAsetukset) ? asetus.kurssiAsetukset : []
              const coursePrefer = coursePrefs.some((c) => c?.tupla === 'prefer')
              const tuplaRequested = asetus?.tupla === 'prefer' || coursePrefer
              const tuplaUnitPresent = palkinYksikot.some((y) => y.tyyppi === 'tuplatunti')
              const tuplaRequestFailed = tuplaRequested && !tuplaUnitPresent
              return {
                palkkiKey,
                enableSubblockSplit,
                splitOnlyPalkkiKey: splitOnlyPalkkiKey || null,
                kapasiteettiYlijäämä,
                salliKurssiHajotus: true,
                minLuokkaSlack: (() => {
                  const c = kurssitPalkittain[palkkiKey] || []
                  const luokat = [...new Set(c.flatMap((k) => k.luokka || []))]
                  if (luokat.length === 0) return null
                  return Math.min(...luokat.map((l) => Number(luokkaSlackByName[l] ?? 0)))
                })(),
                palkkiTupla: asetus?.tupla || 'default',
                kurssiToiveita: Array.isArray(asetus?.kurssiAsetukset) ? asetus.kurssiAsetukset.length : 0,
                hajotusYritetty: onIrrotus || onKurssiVirtuaali,
                yksikkoTyypit: tyyppiYhteenveto || '-',
                yksikkoja: palkinYksikot.length,
                tuplaRequested,
                tuplaUnitPresent,
                tuplaRequestFailed
              }
            })
          console.log(`Sijoitettavia yksiköitä: ${yksikot.length} (split=${enableSubblockSplit}, target=${splitOnlyPalkkiKey || 'all'})`)
        }

        const sijoittamattomat = []
        const sijoittamattomatYksikot = []
        yksikot.forEach(yksikko => {
          const tulos = etsiParasPaikka(
            yksikko,
            sijoituksetCandidate,
            mahdollisetRuudut,
            kurssit,
            saannot,
            aineet
          )
          if (tulos) {
            sijoitaYksikko(yksikko, tulos, sijoituksetCandidate)
          } else {
            sijoittamattomat.push({
              palkkiKey: yksikko.palkkiKey,
              tyyppi: yksikko.tyyppi,
              luokat: yksikko.luokat
            })
            sijoittamattomatYksikot.push(yksikko)
          }
        })

        if (sijoittamattomatYksikot.length > 0) {
          const edelleenSijoittamatta = yritaKorjataSijoittamattomat({
            sijoitukset: sijoituksetCandidate,
            sijoittamattomatYksikot,
            mahdollisetRuudut,
            kurssitData: kurssit,
            kurssiMap,
            saannot,
            aineet,
            vaPalkkiPaivanLoppuun
          })
          if (edelleenSijoittamatta.length !== sijoittamattomatYksikot.length) {
            sijoittamattomat.length = 0
            edelleenSijoittamatta.forEach((y) => {
              sijoittamattomat.push({
                palkkiKey: y.palkkiKey,
                tyyppi: y.tyyppi,
                luokat: y.luokat
              })
            })
          }
        }

        ajaGapFix({
          sijoitukset: sijoituksetCandidate,
          kurssitData: kurssit,
          saannot,
          aineet,
          periodi,
          vaPalkkiPaivanLoppuun,
          mahdollisetRuudut,
          optimointiAsetukset
        })
        ajaSingleGapPolish({
          sijoitukset: sijoituksetCandidate,
          kurssitData: kurssit,
          saannot,
          aineet,
          periodi,
          vaPalkkiPaivanLoppuun,
          mahdollisetRuudut,
          optimointiAsetukset
        })
        try {
          ajaHardGapKorjaus({
            sijoitukset: sijoituksetCandidate,
            kurssitData: kurssit,
            saannot,
            aineet,
            periodi,
            vaPalkkiPaivanLoppuun,
            mahdollisetRuudut,
            optimointiAsetukset
          })
        } catch (err) {
          console.warn('Hard gap korjaus ohitettu virheen vuoksi:', err.message)
        }
        try {
          ajaPaivakuormanTasapainotus({
            sijoitukset: sijoituksetCandidate,
            kurssitData: kurssit,
            saannot,
            aineet,
            periodi,
            vaPalkkiPaivanLoppuun,
            mahdollisetRuudut,
            optimointiAsetukset
          })
        } catch (err) {
          console.warn('Päiväkuorman tasapainotus ohitettu virheen vuoksi:', err.message)
        }

        const aukot = laskeKaikkiAukot(sijoituksetCandidate, kaikkiYlaLuokat)
        const score = (sijoittamattomat.length * 1000) + aukot
        console.log(`Attempt ${attemptIndex + 1}/${attempts} (split=${enableSubblockSplit}, target=${splitOnlyPalkkiKey || 'all'}): sijoittamatta=${sijoittamattomat.length}, aukot=${aukot}, score=${score}`)

        let paivitaParas = false
        let valintaSyy = ''
        if (!paras) {
          paivitaParas = true
          valintaSyy = 'first_candidate'
        } else if (score < paras.score) {
          paivitaParas = true
          valintaSyy = 'better_score'
        } else if (
          score === paras.score &&
          Boolean(enableSubblockSplit) &&
          !Boolean(paras.enableSubblockSplit)
        ) {
          paivitaParas = true
          valintaSyy = 'tie_prefer_split'
        }

        if (paivitaParas) {
          const debugTimeOverlap = sijoitusDebugStatsRef.get(sijoituksetCandidate) || initDebugStats()
          paras = {
            score,
            sijoitukset: kloonaaSijoitukset(sijoituksetCandidate),
            sijoittamattomat,
            enableSubblockSplit,
            splitOnlyPalkkiKey: splitOnlyPalkkiKey || null,
            debugPalkkiHajotus: debugPalkkiHajotusVariant,
            debugTimeOverlap,
            selectionReason: valintaSyy
          }
        }

        if (
          !variantBest ||
          score < variantBest.score ||
          (score === variantBest.score && attemptIndex < variantBest.attemptIndex)
        ) {
          variantBest = {
            split: enableSubblockSplit,
            target: splitOnlyPalkkiKey || 'all',
            yksikot: yksikot.length,
            score,
            sijoittamatta: sijoittamattomat.length,
            aukot,
            attemptIndex
          }
        }
        if (score === 0) break
      }
      if (variantBest) trialSummary.push(variantBest)
    }

    // 1) Baseline ilman hajotusta
    ajaVariantti({ enableSubblockSplit: false, splitOnlyPalkkiKey: '' })

    // 2) Kohdennettu trial: vain yksi palkki kerrallaan
    const splitCandidateInfo = Object.entries(optimointiAsetukset)
      .map(([palkkiKey, asetus]) => {
        const coursePrefs = Array.isArray(asetus?.kurssiAsetukset) ? asetus.kurssiAsetukset : []
        const hasPrefer = coursePrefs.some((c) => c.tupla === 'prefer')
        const hasAvoid = coursePrefs.some((c) => c.tupla === 'avoid')
        if (!hasPrefer || !hasAvoid) return null
        const palkinLuokat = [...new Set(
          kurssit
            .filter((k) => k.aste !== 'lukio')
            .filter((k) => (k.opetus || []).some((o) => String(o.periodi) === periodiKey && o.palkki === palkkiKey))
            .flatMap((k) => k.luokka || [])
        )]
        const minSlack = palkinLuokat.length > 0
          ? Math.min(...palkinLuokat.map((l) => Number(luokkaSlackByName[l] ?? 0)))
          : 0
        if (minSlack < 1) return null
        return {
          palkkiKey,
          luokat: palkinLuokat,
          minSlack,
          splitPrioriteetti: asetus?.splitPrioriteetti === true
        }
      })
      .filter(Boolean)
    const splitBudget = valitseSplitTargetitBudgetilla({
      candidates: splitCandidateInfo,
      luokkaSlackByName
    })
    const splitTargets = splitBudget.selected.map((c) => c.palkkiKey)
    splitTargets.forEach((targetKey) => {
      ajaVariantti({ enableSubblockSplit: true, splitOnlyPalkkiKey: targetKey })
    })

    const sijoitukset = paras ? paras.sijoitukset : {}
    const sijoittamattomat = paras ? paras.sijoittamattomat : []
    const debugPalkkiHajotus = paras?.debugPalkkiHajotus || []
    const debugTimeOverlap = paras?.debugTimeOverlap || initDebugStats()
    console.log(`Valmis. Paras tulos: sijoittamatta=${sijoittamattomat.length}, score=${paras?.score ?? 'n/a'}, split=${paras?.enableSubblockSplit}`)

    const postSplitReport = yritaJalkiHajottaaPalkkeja({
      sijoitukset,
      optimointiAsetukset,
      kurssitData: kurssit,
      aineet,
      saannot
    })
    const targetedGapFixReport = ajaKohdennettuAukkoKorjaus({
      sijoitukset,
      kurssitData: kurssit,
      saannot,
      aineet,
      periodi,
      vaPalkkiPaivanLoppuun,
      mahdollisetRuudut,
      optimointiAsetukset
    })
    const debugAukot = listaaLuokkaPaivaAukot(sijoitukset, kaikkiYlaLuokat)
    const finalAukot = laskeKaikkiAukot(sijoitukset, kaikkiYlaLuokat)
    const debugHardConflicts = listaaHardConflictit({
      sijoitukset,
      intervalMap
    })
    const debugTuplaToiveet = arvioiTuplaToiveet({
      sijoitukset,
      optimointiAsetukset
    })

    const ruleViolations = evaluateRulesAgainstSijoitukset({
      sijoitukset,
      rules: saannot,
      aineet,
      kurssitData: kurssit
    })

    // muunna tallennusmuotoon
    const palkkiMap = {}

    Object.entries(sijoitukset).forEach(([avain, kurssitSolussa]) => {
      kurssitSolussa.forEach(s => {
        const palkkiKey = kanoninenPalkkiAvain(s.palkkiKey)
        if (!palkkiKey) return
        if (lukioPalkkiNimet.has(palkkiKey)) return

        if (!palkkiMap[palkkiKey]) palkkiMap[palkkiKey] = {}
        if (!palkkiMap[palkkiKey][avain]) palkkiMap[palkkiKey][avain] = []

        palkkiMap[palkkiKey][avain].push({
          kurssiId: s.kurssiId,
          kurssiNimi: s.kurssiNimi,
          palkkiKey,
          yhdistetytIdt: s.yhdistetytIdt || null
        })
      })
    })

    // tallenna
    await Promise.all(
      Object.entries(palkkiMap).map(([palkkiKey, solut]) => {
        const tunnitArray = Object.entries(solut).map(([avain, kurssiLista]) => {
          const [paiva, tuntiStr] = avain.split('-')
          return {
            paiva,
            tunti: Number(tuntiStr),
            kurssit: kurssiLista
          }
        })

        return Lukujarjestys.findOneAndUpdate(
          { nimi: palkkiKey, tyyppi: 'palkki', periodi, lukuvuosiId: objectId, kouluId },
          { $set: { tunnit: tunnitArray, kouluId } },
          { new: true, upsert: true, runValidators: true }
        )
      })
    )

    console.log(`Tallennettu ${Object.keys(palkkiMap).length} palkkia`)

    res.json({
      ok: true,
      sijoitettu: Object.keys(palkkiMap).length,
      sijoittamattomat,
      violations: ruleViolations,
      debugPalkkiHajotus,
      trialSummary: trialSummary.map((t) => ({
        ...t,
        attempt: Number(t.attemptIndex ?? 0) + 1,
        selected:
          Boolean(paras) &&
          t.split === Boolean(paras.enableSubblockSplit) &&
          String(t.target) === String(paras.splitOnlyPalkkiKey || 'all') &&
          Number(t.score) === Number(paras.score),
        selectedReason:
          Boolean(paras) &&
          t.split === Boolean(paras.enableSubblockSplit) &&
          String(t.target) === String(paras.splitOnlyPalkkiKey || 'all') &&
          Number(t.score) === Number(paras.score)
            ? paras.selectionReason || null
            : null
      })),
      postSplitReport,
      targetedGapFixReport,
      debugSplitBudget: {
        selected: splitBudget.selected.map((c) => ({
          palkkiKey: c.palkkiKey,
          minSlack: c.minSlack,
          splitPrioriteetti: c.splitPrioriteetti === true
        })),
        skipped: splitBudget.skipped,
        remainingByLuokka: splitBudget.remaining
      },
      debugTimeOverlap,
      debugTuplaToiveet,
      debugHardConflicts: {
        teacherConflicts: (debugHardConflicts.teacherConflicts || []).slice(0, 100),
        classConflicts: (debugHardConflicts.classConflicts || []).slice(0, 100),
        sameBlockPerDay: (debugHardConflicts.sameBlockPerDay || []).slice(0, 100),
        counts: {
          teacher: (debugHardConflicts.teacherConflicts || []).length,
          class: (debugHardConflicts.classConflicts || []).length,
          sameBlockPerDay: (debugHardConflicts.sameBlockPerDay || []).length
        }
      },
      debugAukot: debugAukot.slice(0, 20),
      finalAukot,
      viesti: sijoittamattomat.length === 0
        ? 'Kaikki kurssit sijoitettu!'
        : `${sijoittamattomat.length} yksikköä jäi sijoittamatta`
    })

  } catch (error) {
    console.error('OPTIMOINTI VIRHE:', error)
    res.status(500).json({ error: error.message })
  }
}

const metadata = async (req, res) => {
  if (!req.kouluId) {
    return res.status(400).json({
      error: 'Koulu ei ole tiedossa. Valitse koulu (superadmin).'
    })
  }
  const koulu = await Koulu.findById(req.kouluId).select('aikatauluProfiili').lean()
  return res.json({
    hardcodedConstraints: HARDCODED_CONSTRAINTS,
    schoolRules: [],
    scheduleProfile: koulu?.aikatauluProfiili || {
      alakoulu: { paivat: [] },
      ylakoulu: { paivat: [] },
      lukio: { paivat: [] }
    }
  })
}

module.exports = { optimoi, metadata }