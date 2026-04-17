const mongoose = require('mongoose')
const Lukujarjestys = require('../models/lukujarjestys')
const Kurssi = require('../models/kurssi')
const Aine = require('../models/aine')
const {
  checkHardConstraintsForPlacement,
  evaluateRulesAgainstSijoitukset,
  haeKoulunSaannot
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

const kaikkiTuntipaikat = () => {
  const paikat = []
  PAIVAT.forEach(paiva => {
    SLOTIT[paiva].forEach(tunti => {
      paikat.push({ paiva, tunti })
    })
  })
  return paikat
}

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

// ─── KONFLIKTITARKISTUKSET ───────────────────────────────────
const onOpettajaKonflikti = (sijoitukset, opettajat, paiva, tunti) => {
  if (!opettajat || opettajat.length === 0) return false
  const avain = `${paiva}-${tunti}`
  const solu = sijoitukset[avain] || []
  return solu.some(k => k.opettajat?.some(o => opettajat.includes(o)))
}

const onLuokkaKonflikti = (sijoitukset, luokat, paiva, tunti) => {
  if (!luokat || luokat.length === 0) return false
  const avain = `${paiva}-${tunti}`
  const solu = sijoitukset[avain] || []
  return solu.some(k => k.luokat?.some(l => luokat.includes(l)))
}

const onPalkkiJoSamanaPaivana = (sijoitukset, palkkiKey, paiva) => {
  if (!palkkiKey) return false
  return Object.entries(sijoitukset).some(([avain, solu]) => {
    const [slotPaiva] = avain.split('-')
    if (slotPaiva !== paiva) return false
    return (solu || []).some((k) => k.palkkiKey === palkkiKey)
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
        luokat: kurssi.luokka || []
      })
    })
  })

  return kopio
}

const onLaitatunti = (paiva, tunti) => {
  const slotit = SLOTIT[paiva]
  return tunti === slotit[0] || tunti === slotit[slotit.length - 1]
}

const onLaitatupla = (paiva, t1, t2) => {
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

const onPaivanViimeinenTupla = (paiva, t1, t2) => {
  const slotit = SLOTIT[paiva]
  const pari = [t1, t2].sort((a, b) => a - b)
  const lopusta = [slotit[slotit.length - 2], slotit[slotit.length - 1]]
  return pari[0] === lopusta[0] && pari[1] === lopusta[1]
}

const aiheuttaaHyppytunninSijoitus = (sijoitukset, yksikko, paikat) => {
  const simuloitu = simuloiSijoitus(sijoitukset, yksikko, paikat)
  return yksikko.luokat.some((luokka) =>
    PAIVAT.some((paiva) => onLuokallaHyppytunti(simuloitu, luokka, paiva))
  )
}

const laskeHyppyJaTasaisuusPenalty = (sijoitukset, yksikko, paikat) => {
  const simuloitu = simuloiSijoitus(sijoitukset, yksikko, paikat)
  let penalty = 0

  yksikko.luokat.forEach((luokka) => {
    // Hyppytunnit: erittäin vahva rangaistus.
    PAIVAT.forEach((paiva) => {
      if (onLuokallaHyppytunti(simuloitu, luokka, paiva)) {
        penalty += 250
      }
    })

    // Päivien tasaisuus: rankaise suurta vaihtelua aktiivisissa koulupäivissä.
    const paivaKuormat = PAIVAT.map((paiva) => laskeLuokanPaivaKuorma(simuloitu, luokka, paiva))
    const aktiiviset = paivaKuormat.filter((m) => m > 0)
    if (aktiiviset.length >= 2) {
      const maxKuorma = Math.max(...aktiiviset)
      const minKuorma = Math.min(...aktiiviset)
      penalty += (maxKuorma - minKuorma) * 8
    }
  })

  return penalty
}

const kloonaaSijoitukset = (sijoitukset) => {
  const kopio = {}
  Object.entries(sijoitukset).forEach(([k, v]) => {
    kopio[k] = [...v]
  })
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

const ajaGapFix = ({
  sijoitukset,
  kurssitData,
  saannot,
  aineet,
  periodi,
  vaPalkkiPaivanLoppuun
}) => {
  const luokat = [...new Set(
    kurssitData
      .filter((k) => k.aste !== 'lukio')
      .flatMap((k) =>
        (k.opetus || []).some((o) => Number(o.periodi) === Number(periodi))
          ? (k.luokka || [])
          : []
      )
  )]

  const kurssiMap = new Map(kurssitData.map((k) => [k._id?.toString(), k]))
  const maxPasses = 6

  for (let pass = 0; pass < maxPasses; pass++) {
    let muutos = false
    const aukotEnnen = laskeKaikkiAukot(sijoitukset, luokat)

    for (const luokka of luokat) {
      for (const paiva of PAIVAT) {
        const aukkotunnit = haePaivanAukkotunnit(sijoitukset, luokka, paiva)
        if (aukkotunnit.length === 0) continue

        for (const targetTunti of aukkotunnit) {
          const sourceTunnit = SLOTIT[paiva].filter((s) => s !== targetTunti)
          let siirrettiin = false

          for (const sourceTunti of sourceTunnit) {
            const sourceKey = `${paiva}-${sourceTunti}`
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

              if (vaPalkkiPaivanLoppuun && String(palkkiKey).toUpperCase().includes('VA')) {
                const slotit = SLOTIT[paiva]
                const onViimeinen = targetTunti === slotit[slotit.length - 1]
                if (!onViimeinen) continue
              }

              const muutSamanaPaivana = SLOTIT[paiva].some((s) => {
                if (s === sourceTunti) return false
                const avain = `${paiva}-${s}`
                return (sijoitukset[avain] || []).some((k) => k.palkkiKey === palkkiKey)
              })
              if (muutSamanaPaivana) continue

              const temp = kloonaaSijoitukset(sijoitukset)
              temp[sourceKey] = (temp[sourceKey] || []).filter((k) => k.palkkiKey !== palkkiKey)
              if (temp[sourceKey].length === 0) delete temp[sourceKey]

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
              const aukotJalkeen = laskeKaikkiAukot(temp, luokat)
              if (aukotJalkeen < aukotEnnen) {
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
        p1.paiva
      )

      const laitaehtoOk = !yksikko.vaatiiLaitapaikan || onLaitatupla(p1.paiva, p1.tunti, p2.tunti)
      const paateehtoOk = !yksikko.vaatiiPaivaanPaatteeksi || onPaivanViimeinenTupla(p1.paiva, p1.tunti, p2.tunti)

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
        const lisapenalty = laskeHyppyJaTasaisuusPenalty(sijoitukset, yksikko, [p1, p2])
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
        paiva
      )

      const laitaehtoOk = !yksikko.vaatiiLaitapaikan || onLaitatunti(paiva, tunti)
      const paateehtoOk = !yksikko.vaatiiPaivaanPaatteeksi || onPaivanViimeinenTunti(paiva, tunti)

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
          [{ paiva, tunti }]
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
        luokat: kurssi.luokka || []
      })
    })
  })
}

// ─── MUODOSTA SIJOITETTAVAT YKSIKÖT ─────────────────────────
const muodostaYksikot = (periodi, kurssit, tuplatuntiAineet, options = {}) => {
  const yksikot = []
  const palkit = {}

  kurssit.forEach(kurssi => {
    if (kurssi.aste === 'lukio') return
    kurssi.opetus
      .filter(o => o.periodi === periodi)
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

    const onVainLiikuntaa =
      liKurssit.length > 0 && muutKurssit.length === 0 && koKurssit.length === 0
    const onVainKotitaloutta =
      koKurssit.length > 0 && muutKurssit.length === 0 && liKurssit.length === 0

    // ─── VAIN KOTITALOUS / LIIKUNTA → tuplatunti mahdollista ─
    if (onVainLiikuntaa || onVainKotitaloutta) {
      const tuplatunteja = Math.floor(palkki.tunnit / 2)
      const yksittaisia = palkki.tunnit % 2
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
          vaatiiPaivaanPaatteeksi: onValinnainenPalkki && vaPalkkiPaivanLoppuun,
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
          prioriteetti: (onValinnainenPalkki && vaPalkkiPaivanLoppuun) ? 0 : 2,
          vaatiiLaitapaikan: false,
          vaatiiPaivaanPaatteeksi: onValinnainenPalkki && vaPalkkiPaivanLoppuun,
          opettajat: [...new Set(kurssitTuplaan.flatMap(k => k.opettaja || []))],
          luokat: [...new Set(kurssitTuplaan.flatMap(k => k.luokka || []))]
        })
      }

    // ─── NORMAALI PALKKI ──────────────────────────────────────
    } else {
      for (let i = 0; i < palkki.tunnit; i++) {
        yksikot.push({
          id: `${palkki.palkkiKey}_${i}`,
          tyyppi: 'palkki',
          palkkiKey: palkki.palkkiKey,
          kurssit: palkki.kurssit,
          tunnit: 1,
          prioriteetti: (onValinnainenPalkki && vaPalkkiPaivanLoppuun) ? 0 : 3,
          vaatiiLaitapaikan: false,
          vaatiiPaivaanPaatteeksi: onValinnainenPalkki && vaPalkkiPaivanLoppuun,
          opettajat: [...new Set(palkki.kurssit.flatMap(k => k.opettaja || []))],
          luokat: [...new Set(palkki.kurssit.flatMap(k => k.luokka || []))]
        })
      }
    }
  })

  yksikot.sort((a, b) => a.prioriteetti - b.prioriteetti)
  return yksikot
}

// ─── PÄÄFUNKTIO ──────────────────────────────────────────────
const optimoi = async (req, res) => {
  const { periodi, lukuvuosiId } = req.body

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
    const saannot = await haeKoulunSaannot(kouluId)

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
          .filter(o => o.periodi === periodi)
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

    const sijoitukset = {}
    const lukitutAvaimet = new Set()

    lukioLukujarjestykset.forEach(lj => {
      lj.tunnit.forEach(t => {
        const avain = `${t.paiva}-${t.tunti}`
        if (!sijoitukset[avain]) sijoitukset[avain] = []
        t.kurssit.forEach(k => {
          const kurssiData = kurssit.find(kr => kr._id?.toString() === k.kurssiId)
          sijoitukset[avain].push({
            kurssiId: k.kurssiId,
            kurssiNimi: k.kurssiNimi,
            palkkiKey: lj.nimi,
            yhdistetytIdt: k.yhdistetytIdt || [],
            opettajat: kurssiData?.opettaja || [],
            luokat: []
          })
        })
        lukitutAvaimet.add(avain)
      })
    })

    console.log(`Lukittuja tunteja: ${lukitutAvaimet.size}`)

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
            .filter(o => o.periodi === periodi)
            .forEach(o => {
              if (!palkit[o.palkki]) palkit[o.palkki] = 0
              if (o.tunnit_viikossa > palkit[o.palkki]) {
                palkit[o.palkki] = o.tunnit_viikossa
              }
            })
          return palkit
        }, {})
    ).reduce((sum, v) => sum + v, 0)

    console.log(`Tarvitaan: ${tarvitaanPaikkoja}, vapaita: ${mahdollisetRuudut.length}`)

    const vaPalkkiPaivanLoppuun = saannot.some((s) =>
      s.enabled && s.ruleType === 'va_palkki_paivan_loppuun'
    )
    const yksikot = muodostaYksikot(periodi, kurssit, tuplatuntiAineet, {
      vaPalkkiPaivanLoppuun
    })

    console.log(`Sijoitettavia yksiköitä: ${yksikot.length}`)

    const sijoittamattomat = []

    yksikot.forEach(yksikko => {
      const tulos = etsiParasPaikka(
        yksikko,
        sijoitukset,
        mahdollisetRuudut,
        kurssit,
        saannot,
        aineet
      )

      if (tulos) {
        sijoitaYksikko(yksikko, tulos, sijoitukset)
      } else {
        sijoittamattomat.push({
          palkkiKey: yksikko.palkkiKey,
          tyyppi: yksikko.tyyppi,
          luokat: yksikko.luokat
        })
        console.warn(`Ei paikkaa: ${yksikko.palkkiKey}`)
      }
    })

    console.log(`Valmis. Sijoittamatta: ${sijoittamattomat.length}`)
    ajaGapFix({
      sijoitukset,
      kurssitData: kurssit,
      saannot,
      aineet,
      periodi,
      vaPalkkiPaivanLoppuun
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
        const palkkiKey = s.palkkiKey
        if (!palkkiKey) return
        if (lukioPalkkiNimet.has(palkkiKey)) return

        if (!palkkiMap[palkkiKey]) palkkiMap[palkkiKey] = {}
        if (!palkkiMap[palkkiKey][avain]) palkkiMap[palkkiKey][avain] = []

        palkkiMap[palkkiKey][avain].push({
          kurssiId: s.kurssiId,
          kurssiNimi: s.kurssiNimi,
          palkkiKey: s.palkkiKey,
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
      viesti: sijoittamattomat.length === 0
        ? 'Kaikki kurssit sijoitettu!'
        : `${sijoittamattomat.length} yksikköä jäi sijoittamatta`
    })

  } catch (error) {
    console.error('OPTIMOINTI VIRHE:', error)
    res.status(500).json({ error: error.message })
  }
}

module.exports = { optimoi }