const mongoose = require('mongoose')
const Lukujarjestys = require('../models/lukujarjestys')
const Kurssi = require('../models/kurssi')
const Aine = require('../models/aine')

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

const laskeAinettaTuntipaikalla = (sijoitukset, aineIds, paiva, tunti, kurssitData) => {
  const avain = `${paiva}-${tunti}`
  const solu = sijoitukset[avain] || []
  let maara = 0
  solu.forEach(s => {
    const kurssi = kurssitData.find(k => k._id?.toString() === s.kurssiId)
    if (kurssi && aineIds.includes(kurssi.aineId?.toString())) {
      maara++
    }
  })
  return maara
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
  tuplatuntiAineet,
  kurssitData
) => {
  const kandidaatit = []

  // ─── TUPLATUNTI (liikunta) ────────────────────────────────
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
      if (!konflikti1 && !konflikti2 && !lukittu1 && !lukittu2) {
        const pisteet = laskeSijoitusPisteet(
          sijoitukset, yksikko.luokat, p1.paiva, p1.tunti
        )
        kandidaatit.push({ paikat: [p1, p2], pisteet })
      }
    })

  // ─── KO_PARI (kotitalous + muut peräkkäin) ───────────────
  } else if (yksikko.tyyppi === 'ko_pari') {
    const parit = perakkaiseTPaikat()

    // 1. yritys: KO laitapaikalle
    parit.forEach(([p1, p2]) => {
      const jarjestykset = [[p1, p2], [p2, p1]]
      jarjestykset.forEach(([koP, palkkiP]) => {
        const slotitPaivalle = SLOTIT[koP.paiva]
        const onLaitapaikka =
          koP.tunti === slotitPaivalle.at(0) ||
          koP.tunti === slotitPaivalle.at(-1)

        if (!onLaitapaikka) return

        const koKonflikti =
          onOpettajaKonflikti(
            sijoitukset,
            yksikko.kurssitKo.flatMap(k => k.opettaja || []),
            koP.paiva, koP.tunti
          ) ||
          onLuokkaKonflikti(
            sijoitukset,
            yksikko.kurssitKo.flatMap(k => k.luokka || []),
            koP.paiva, koP.tunti
          )

        const palkkiKonflikti =
          onOpettajaKonflikti(sijoitukset, yksikko.opettajat, palkkiP.paiva, palkkiP.tunti) ||
          onLuokkaKonflikti(sijoitukset, yksikko.luokat, palkkiP.paiva, palkkiP.tunti)

        const koLukittu = !mahdollisetRuudut.some(
          r => r.paiva === koP.paiva && r.tunti === koP.tunti
        )
        const palkkiLukittu = !mahdollisetRuudut.some(
          r => r.paiva === palkkiP.paiva && r.tunti === palkkiP.tunti
        )

        if (!koKonflikti && !palkkiKonflikti && !koLukittu && !palkkiLukittu) {
          const pisteet = laskeSijoitusPisteet(
            sijoitukset, yksikko.luokat, koP.paiva, koP.tunti
          )
          const koMaaraPalkki = laskeAinettaTuntipaikalla(
            sijoitukset, tuplatuntiAineet.kotitalous, palkkiP.paiva, palkkiP.tunti, kurssitData
          )

          // laske kuinka monta KO-kurssia tässä palkissa on
          const koKurssejaTassaPalkissa = yksikko.kurssit.filter(k =>
            tuplatuntiAineet.kotitalous.includes(k.aineId?.toString())
          ).length

          if (koMaaraPalkki + koKurssejaTassaPalkissa > 2) return
          kandidaatit.push({ koP, palkkiP, pisteet })
        }
      })
    })

    // 2. yritys: jos laitapaikkaa ei löydy → kokeile ilman rajoitusta
    if (kandidaatit.length === 0) {
      parit.forEach(([p1, p2]) => {
        const jarjestykset = [[p1, p2], [p2, p1]]
        jarjestykset.forEach(([koP, palkkiP]) => {
          const koKonflikti =
            onOpettajaKonflikti(
              sijoitukset,
              yksikko.kurssitKo.flatMap(k => k.opettaja || []),
              koP.paiva, koP.tunti
            ) ||
            onLuokkaKonflikti(
              sijoitukset,
              yksikko.kurssitKo.flatMap(k => k.luokka || []),
              koP.paiva, koP.tunti
            )

          const palkkiKonflikti =
            onOpettajaKonflikti(sijoitukset, yksikko.opettajat, palkkiP.paiva, palkkiP.tunti) ||
            onLuokkaKonflikti(sijoitukset, yksikko.luokat, palkkiP.paiva, palkkiP.tunti)

          const koLukittu = !mahdollisetRuudut.some(
            r => r.paiva === koP.paiva && r.tunti === koP.tunti
          )
          const palkkiLukittu = !mahdollisetRuudut.some(
            r => r.paiva === palkkiP.paiva && r.tunti === palkkiP.tunti
          )

          if (!koKonflikti && !palkkiKonflikti && !koLukittu && !palkkiLukittu) {
            const pisteet = laskeSijoitusPisteet(
              sijoitukset, yksikko.luokat, koP.paiva, koP.tunti
            )
            const koMaaraPalkki = laskeAinettaTuntipaikalla(
              sijoitukset, tuplatuntiAineet.kotitalous, palkkiP.paiva, palkkiP.tunti, kurssitData
            )

            // laske kuinka monta KO-kurssia tässä palkissa on
            const koKurssejaTassaPalkissa = yksikko.kurssit.filter(k =>
              tuplatuntiAineet.kotitalous.includes(k.aineId?.toString())
            ).length

            if (koMaaraPalkki + koKurssejaTassaPalkissa > 2) return
            kandidaatit.push({ koP, palkkiP, pisteet })
          }
        })
      })
    }

    if (kandidaatit.length === 0) return null
    kandidaatit.sort((a, b) => a.pisteet - b.pisteet)
    return kandidaatit.at(0)

  // ─── NORMAALI YKSITTÄINEN ─────────────────────────────────
  } else {
    mahdollisetRuudut.forEach(({ paiva, tunti }) => {
      const konflikti =
        onOpettajaKonflikti(sijoitukset, yksikko.opettajat, paiva, tunti) ||
        onLuokkaKonflikti(sijoitukset, yksikko.luokat, paiva, tunti)

      if (!konflikti) {
        const ensimmainenKurssi = yksikko.kurssit.at(0)

        const koMaara = laskeAinettaTuntipaikalla(
          sijoitukset, tuplatuntiAineet.kotitalous, paiva, tunti, kurssitData
        )
        if (
          koMaara >= 2 &&
          tuplatuntiAineet.kotitalous.includes(ensimmainenKurssi?.aineId?.toString())
        ) return

        const liMaara = laskeAinettaTuntipaikalla(
          sijoitukset, tuplatuntiAineet.liikunta, paiva, tunti, kurssitData
        )
        if (
          liMaara >= 3 &&
          tuplatuntiAineet.liikunta.includes(ensimmainenKurssi?.aineId?.toString())
        ) return

        const pisteet = laskeSijoitusPisteet(sijoitukset, yksikko.luokat, paiva, tunti)
        kandidaatit.push({ paikat: [{ paiva, tunti }], pisteet })
      }
    })
  }

  if (kandidaatit.length === 0) return null
  kandidaatit.sort((a, b) => a.pisteet - b.pisteet)
  return kandidaatit.at(0).paikat
}

// ─── SIJOITA YKSIKKÖ ─────────────────────────────────────────
const sijoitaYksikko = (yksikko, tulos, sijoitukset) => {
  if (yksikko.tyyppi === 'ko_pari') {
    const { koP, palkkiP } = tulos

    // KO yksin
    const avainKo = `${koP.paiva}-${koP.tunti}`
    if (!sijoitukset[avainKo]) sijoitukset[avainKo] = []
    yksikko.kurssitKo.forEach(kurssi => {
      sijoitukset[avainKo].push({
        kurssiId: kurssi._id?.toString() || kurssi.id,
        kurssiNimi: kurssi.nimi,
        palkkiKey: yksikko.palkkiKey,
        yhdistetytIdt: null,
        opettajat: kurssi.opettaja || [],
        luokat: kurssi.luokka || []
      })
    })

    // koko palkki
    const avainPalkki = `${palkkiP.paiva}-${palkkiP.tunti}`
    if (!sijoitukset[avainPalkki]) sijoitukset[avainPalkki] = []
    yksikko.kurssit.forEach(kurssi => {
      sijoitukset[avainPalkki].push({
        kurssiId: kurssi._id?.toString() || kurssi.id,
        kurssiNimi: kurssi.nimi,
        palkkiKey: yksikko.palkkiKey,
        yhdistetytIdt: null,
        opettajat: kurssi.opettaja || [],
        luokat: kurssi.luokka || []
      })
    })
    return
  }

  // normaali sijoitus
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
const muodostaYksikot = (periodi, kurssit, tuplatuntiAineet, voiIrrottaaKo) => {
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

    // ─── KOTITALOUS + MUITA AINEITA → irrotetaan ─────────────
    if (koKurssit.length > 0 && muutKurssit.length > 0 && voiIrrottaaKo) {
      const muutPalkissa = [...muutKurssit, ...liKurssit]

      // ko_pari: KO yksin + koko palkki peräkkäin
      koKurssit.forEach(ko => {
        yksikot.push({
          id: `${palkki.palkkiKey}_${ko._id}_ko_pari`,
          tyyppi: 'ko_pari',
          palkkiKey: palkki.palkkiKey,
          kurssit: palkki.kurssit,
          kurssitKo: [ko],
          kurssitMuut: muutPalkissa,
          tunnit: 2,
          prioriteetti: 1,
          opettajat: [...new Set(palkki.kurssit.flatMap(k => k.opettaja || []))],
          luokat: [...new Set(palkki.kurssit.flatMap(k => k.luokka || []))]
        })
      })

      // muut ilman KO
      if (muutPalkissa.length > 0) {
        yksikot.push({
          id: `${palkki.palkkiKey}_ilman_ko`,
          tyyppi: 'palkki',
          palkkiKey: palkki.palkkiKey,
          kurssit: muutPalkissa,
          tunnit: 1,
          prioriteetti: 2,
          opettajat: [...new Set(muutPalkissa.flatMap(k => k.opettaja || []))],
          luokat: [...new Set(muutPalkissa.flatMap(k => k.luokka || []))]
        })
      }

    // ─── PELKKÄÄ LIIKUNTAA → tuplatunti ──────────────────────
    } else if (liKurssit.length > 0 && muutKurssit.length === 0 && koKurssit.length === 0) {
      const tuplatunteja = Math.floor(palkki.tunnit / 2)
      const yksittaisia = palkki.tunnit % 2

      for (let i = 0; i < tuplatunteja; i++) {
        yksikot.push({
          id: `${palkki.palkkiKey}_li_tupa_${i}`,
          tyyppi: 'tuplatunti',
          palkkiKey: palkki.palkkiKey,
          kurssit: liKurssit,
          tunnit: 2,
          prioriteetti: 1,
          opettajat: [...new Set(liKurssit.flatMap(k => k.opettaja || []))],
          luokat: [...new Set(liKurssit.flatMap(k => k.luokka || []))]
        })
      }
      for (let i = 0; i < yksittaisia; i++) {
        yksikot.push({
          id: `${palkki.palkkiKey}_li_yksi_${i}`,
          tyyppi: 'yksittainen',
          palkkiKey: palkki.palkkiKey,
          kurssit: liKurssit,
          tunnit: 1,
          prioriteetti: 2,
          opettajat: [...new Set(liKurssit.flatMap(k => k.opettaja || []))],
          luokat: [...new Set(liKurssit.flatMap(k => k.luokka || []))]
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
          prioriteetti: 3,
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

    const voiIrrottaaKo = tarvitaanPaikkoja < mahdollisetRuudut.length

    console.log(`Tarvitaan: ${tarvitaanPaikkoja}, vapaita: ${mahdollisetRuudut.length}, voiIrrottaa: ${voiIrrottaaKo}`)

    const yksikot = muodostaYksikot(periodi, kurssit, tuplatuntiAineet, voiIrrottaaKo)

    console.log(`Sijoitettavia yksiköitä: ${yksikot.length}`)

    const sijoittamattomat = []

    yksikot.forEach(yksikko => {
      const tulos = etsiParasPaikka(
        yksikko,
        sijoitukset,
        mahdollisetRuudut,
        tuplatuntiAineet,
        kurssit
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