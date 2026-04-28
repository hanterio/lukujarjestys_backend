const KURRE_EXPORT_MAPPING_VERSION = 'kurre-csv-v1'

const UNSUPPORTED_EXPORT_ITEMS = [
  'Palkituslogiikka (kurssien palkkiryhmittely Kurressa)',
  'Periodisijoittelu / tuntien automaattinen sijoitus Kurressa',
  'Jaksotus- ja tuntipohjaikkunoiden sisältö',
]

function csvEscape(value) {
  const s = String(value ?? '')
  return `"${s.replace(/"/g, '""')}"`
}

function normCode(value) {
  return String(value ?? '').trim().toUpperCase()
}

function letterToIndex(letter) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ'
  const i = abc.indexOf(String(letter || '').toUpperCase())
  return i >= 0 ? i + 1 : null
}

function kurssiCodeFromNimi(nimi) {
  const raw = normCode(nimi)
  const m = raw.match(/([A-ZÅÄÖ0-9]+_[0-9]{1,3}(?:\.[0-9]+)?)/)
  return m ? m[1] : ''
}

function kurssiCodeFromAineJaLuokka(aine, luokka) {
  const aineKoodiRaw = Array.isArray(aine?.koodit) ? String(aine.koodit[0] || '') : ''
  const aineKoodi = normCode(aineKoodiRaw).replace(/[^A-ZÅÄÖ0-9]/g, '')
  if (!aineKoodi) return ''

  const luokkaRaw = String((luokka || [])[0] || '').trim().toUpperCase()
  const m = luokkaRaw.match(/^(\d+)\s*([A-ZÅÄÖ])?/)
  if (!m) return `${aineKoodi}_0`
  const grade = m[1]
  const letter = m[2]
  if (!letter) return `${aineKoodi}_${grade}`
  const idx = letterToIndex(letter)
  return `${aineKoodi}_${grade}${idx || ''}`
}

function deriveKurreRyhmaLyhenne(kurssi) {
  const fromName = kurssiCodeFromNimi(kurssi?.nimi)
  if (fromName) return fromName
  const fromAine = kurssiCodeFromAineJaLuokka(kurssi?.aineId, kurssi?.luokka)
  if (fromAine) return fromAine
  return normCode(kurssi?.nimi).replace(/\s+/g, '_').replace(/[^A-ZÅÄÖ0-9_.-]/g, '').slice(0, 30)
}

function mapOpettajaType2(opettaja) {
  const lyhenne = normCode(opettaja.opettaja)
  const opv = Number.isFinite(Number(opettaja.opv)) ? Number(opettaja.opv) : ''
  const cols = [
    lyhenne, // 1 tunniste
    '', // 2 primuksen korttinumero
    lyhenne, // 3 sukunimi
    '', // 4 etunimi
    lyhenne, // 5 lyhenne
    '', // 6 kutsumanimi
    '', // 7 laskentatunniste
    '', // 8
    '', // 9
    '', // 10 tuntiopettaja-rasti
    '', // 11 kuvaus
    '', // 12 vari
    '', // 13 kokonaistyomaara (h)
    opv, // 14 muut tehtavat (h) - paikallinen profiilivalinta
  ]
  return `TYPE:2,${cols.map(csvEscape).join(',')}`
}

function buildType8Rows(kurssit) {
  const luokat = new Map()
  for (const kurssi of kurssit || []) {
    for (const raw of kurssi.luokka || []) {
      const lyhenne = String(raw || '').trim()
      if (!lyhenne) continue
      if (!luokat.has(lyhenne)) {
        const match = lyhenne.match(/^(\d+)/)
        luokat.set(lyhenne, {
          lyhenne,
          luokkaAste: match ? match[1] : '',
        })
      }
    }
  }
  return [...luokat.values()]
    .sort((a, b) => a.lyhenne.localeCompare(b.lyhenne, 'fi', { numeric: true, sensitivity: 'base' }))
    .map((l) => `TYPE:8,${[l.lyhenne, l.luokkaAste, '', '', '', '', '', '', ''].map(csvEscape).join(',')}`)
}

function buildType4Rows(kurssit) {
  const ryhmat = new Map()
  for (const kurssi of kurssit || []) {
    const lyhenne = deriveKurreRyhmaLyhenne(kurssi)
    if (!lyhenne) continue
    const old = ryhmat.get(lyhenne) || { lyhenne, opiskelijat: '', opettajat: new Set(), nimi: '' }
    const opRaw = String(kurssi.opiskelijat || '').trim()
    if (!old.opiskelijat && opRaw) old.opiskelijat = opRaw
    if (!old.nimi) old.nimi = String(kurssi.aineId?.nimi || kurssi.nimi || '').trim()
    for (const o of kurssi.opettaja || []) {
      const k = normCode(o)
      if (k) old.opettajat.add(k)
    }
    ryhmat.set(lyhenne, old)
  }
  return [...ryhmat.values()]
    .sort((a, b) => a.lyhenne.localeCompare(b.lyhenne, 'fi', { numeric: true, sensitivity: 'base' }))
    .map((r) => {
      const vastuuopettaja = [...r.opettajat][0] || ''
      const kurssikoodi = r.lyhenne.replace(/\.\d+$/, '')
      const cols = [
        r.lyhenne, // 1 lyhenne
        r.nimi || r.lyhenne, // 2 tunnus
        '', // 3 edellisen palkin lyhenne
        r.opiskelijat, // 4 opiskelijat
        '', // 5 muut resurssit
        kurssikoodi, // 6 kurssin koodi
        '', // 7 kurssin luokka-aste
        '', // 8 kurssin opsi
        '', // 9 kesto
        '', // 10 IsLahiopetus
        '', // 11 kurssityyppi
        '', // 12 sijoitustyyppi
        vastuuopettaja, // 13 vastuuopettaja
      ]
      return `TYPE:4,${cols.map(csvEscape).join(',')}`
    })
}

function validateExportData(kurssit, opettajat) {
  const virheet = []
  const varoitukset = []

  if (!Array.isArray(kurssit) || kurssit.length === 0) virheet.push('Kursseja ei löytynyt aktiiviselta lukuvuodelta.')
  if (!Array.isArray(opettajat) || opettajat.length === 0) virheet.push('Opettajia ei löytynyt koululle.')

  const opettajaCodes = new Set((opettajat || []).map((o) => normCode(o.opettaja)).filter(Boolean))
  for (const kurssi of kurssit || []) {
    const nimi = String(kurssi.nimi || '').trim() || '(nimeton kurssi)'
    if (!Array.isArray(kurssi.opettaja) || kurssi.opettaja.length === 0) {
      varoitukset.push(`Kurssilta puuttuu opettaja: ${nimi}`)
      continue
    }
    for (const raw of kurssi.opettaja) {
      const koodi = normCode(raw)
      if (koodi && !opettajaCodes.has(koodi)) {
        varoitukset.push(`Kurssin ${nimi} opettaja ei loydy opettajalistasta: ${koodi}`)
      }
    }
  }
  return { virheet, varoitukset }
}

function buildKurreCsv({ kurssit, opettajat, include }) {
  const rows = []
  if (include.type2 !== false) {
    rows.push(...(opettajat || []).map(mapOpettajaType2).filter(Boolean))
  }
  if (include.type4 !== false) {
    rows.push(...buildType4Rows(kurssit))
  }
  if (include.type8 !== false) {
    rows.push(...buildType8Rows(kurssit))
  }
  return rows.join('\r\n')
}

module.exports = {
  KURRE_EXPORT_MAPPING_VERSION,
  UNSUPPORTED_EXPORT_ITEMS,
  validateExportData,
  buildKurreCsv,
}
