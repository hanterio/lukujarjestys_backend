const OptimointiSaanto = require('../models/optimointiSaanto')

const DEFAULT_RULE_TEMPLATES = [
  {
    enabled: true,
    ruleType: 'max_aine_parallel',
    params: { aineNimi: 'kotitalous', maxParallel: 2 },
    severity: 'hard',
    message: 'Kotitalouden tunteja korkeintaan 2 samalle tuntipaikalle.'
  },
  {
    enabled: true,
    ruleType: 'max_aine_parallel',
    params: { aineNimi: 'liikunta', maxParallel: 3 },
    severity: 'hard',
    message: 'Liikunnan tunteja korkeintaan 3 samalle tuntipaikalle.'
  },
  {
    enabled: true,
    ruleType: 'va_palkki_paivan_loppuun',
    params: {},
    severity: 'hard',
    message: 'VA-palkit sijoitetaan päivän loppuun.'
  },
  {
    enabled: true,
    ruleType: 'tasaa_luokan_paivakuormat',
    params: { painokerroin: 72, varoituskynnys: 0.3, raakaPainokerroin: 32 },
    severity: 'soft',
    message: 'Tasoita luokkakohtainen tuntikuorma eri päiville (lyhyet päivät huomioiden).'
  }
]

const ruleDisplayName = (rule) => {
  if (rule.ruleType === 'va_palkki_paivan_loppuun') {
    return 'VA-palkit päivän loppuun'
  }
  if (rule.ruleType === 'tasaa_luokan_paivakuormat') {
    const p = Number(rule.params?.painokerroin ?? 72)
    return `Luokan päiväkuorma (paino ${p})`
  }
  const aineNimi = rule.params?.aineNimi || 'aine'
  const maxParallel = Number(rule.params?.maxParallel || 0)
  return `${aineNimi} max ${maxParallel} / slot`
}

const normalizeRule = (rule) => ({
  id: rule._id?.toString() || rule.id,
  enabled: rule.enabled !== false,
  ruleType: rule.ruleType,
  params: rule.params || {},
  severity: rule.severity || 'hard',
  message: rule.message || '',
  updatedBy: rule.updatedBy || ''
})

const PAIVAT_EVAL = ['ma', 'ti', 'ke', 'to', 'pe']
const SLOTIT_EVAL = {
  ma: [1, 2, 3, 4, 5],
  ti: [1, 2, 3, 4, 5],
  ke: [1, 2, 3, 4],
  to: [1, 2, 3, 4, 5],
  pe: [1, 2, 3, 4, 5]
}

const laskeLuokanPaivanKuormaEval = (sijoitukset, luokka, paiva) => {
  return SLOTIT_EVAL[paiva].filter((s) => {
    const avain = `${paiva}-${s}`
    return (sijoitukset[avain] || []).some((k) => k.luokat?.includes(luokka))
  }).length
}

const laskeLuokanPaivaUtilSpread = (sijoitukset, luokka) => {
  const paivaKuormat = PAIVAT_EVAL.map((paiva) => laskeLuokanPaivanKuormaEval(sijoitukset, luokka, paiva))
  const indeksit = PAIVAT_EVAL.map((_, i) => i).filter((i) => paivaKuormat[i] > 0)
  if (indeksit.length < 2) return 0
  const utils = indeksit.map((i) => {
    const paiva = PAIVAT_EVAL[i]
    const maxS = SLOTIT_EVAL[paiva].length
    return maxS ? paivaKuormat[i] / maxS : 0
  })
  return Math.max(...utils) - Math.min(...utils)
}

const validateRulePayload = (payload) => {
  const errors = []
  const ruleType = payload.ruleType
  if (!['max_aine_parallel', 'va_palkki_paivan_loppuun', 'tasaa_luokan_paivakuormat'].includes(ruleType)) {
    errors.push('Tuntematon ruleType')
  }

  let normalizedParams = {}
  if (ruleType === 'max_aine_parallel') {
    const params = payload.params || {}
    const aineNimi = String(params.aineNimi || '').trim()
    const maxParallel = Number(params.maxParallel)

    if (!aineNimi) {
      errors.push('params.aineNimi puuttuu')
    }
    if (!Number.isFinite(maxParallel) || maxParallel < 1) {
      errors.push('params.maxParallel pitää olla kokonaisluku >= 1')
    }
    normalizedParams = {
      aineNimi,
      maxParallel: Math.floor(maxParallel)
    }
  }

  if (ruleType === 'tasaa_luokan_paivakuormat') {
    const params = payload.params || {}
    const painokerroin = Number(params.painokerroin ?? 72)
    const varoituskynnys = Number(params.varoituskynnys ?? 0.3)
    const raakaPainokerroin = Number(params.raakaPainokerroin ?? 32)
    if (!Number.isFinite(painokerroin) || painokerroin < 1) {
      errors.push('params.painokerroin pitää olla luku >= 1')
    }
    if (!Number.isFinite(varoituskynnys) || varoituskynnys < 0 || varoituskynnys > 1) {
      errors.push('params.varoituskynnys pitää olla luku välillä 0–1')
    }
    if (!Number.isFinite(raakaPainokerroin) || raakaPainokerroin < 0 || raakaPainokerroin > 200) {
      errors.push('params.raakaPainokerroin pitää olla luku välillä 0–200')
    }
    normalizedParams = {
      painokerroin: Math.round(painokerroin),
      varoituskynnys: Math.round(varoituskynnys * 1000) / 1000,
      raakaPainokerroin: Math.round(raakaPainokerroin)
    }
  }

  const severity = payload.severity || 'hard'
  if (!['hard', 'soft'].includes(severity)) {
    errors.push('severity pitää olla hard tai soft')
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      enabled: payload.enabled !== false,
      ruleType,
      params: normalizedParams,
      severity,
      message: String(payload.message || '').trim()
    }
  }
}

const ensureDefaultRulesForKoulu = async (kouluId) => {
  const current = await OptimointiSaanto.find({ kouluId })
  const hasMaxAineRule = (aineNimi) => current.some((r) =>
    r.ruleType === 'max_aine_parallel' &&
    String(r.params?.aineNimi || '').toLowerCase() === aineNimi.toLowerCase()
  )
  const hasVaEndRule = current.some((r) => r.ruleType === 'va_palkki_paivan_loppuun')
  const hasTasaaRule = current.some((r) => r.ruleType === 'tasaa_luokan_paivakuormat')

  const toInsert = []
  if (!hasMaxAineRule('kotitalous')) {
    toInsert.push(DEFAULT_RULE_TEMPLATES[0])
  }
  if (!hasMaxAineRule('liikunta')) {
    toInsert.push(DEFAULT_RULE_TEMPLATES[1])
  }
  if (!hasVaEndRule) {
    toInsert.push(DEFAULT_RULE_TEMPLATES[2])
  }
  if (!hasTasaaRule) {
    toInsert.push(DEFAULT_RULE_TEMPLATES[3])
  }

  if (toInsert.length > 0) {
    await OptimointiSaanto.insertMany(
      toInsert.map((rule) => ({
        ...rule,
        kouluId
      }))
    )
  }
}

const haeKoulunSaannot = async (kouluId) => {
  await ensureDefaultRulesForKoulu(kouluId)
  const rows = await OptimointiSaanto
    .find({ kouluId })
    .sort({ createdAt: 1 })
  return rows.map(normalizeRule)
}

const resolveAineIdsByRule = (rule, aineet) => {
  if (rule.ruleType !== 'max_aine_parallel') return []
  const aineNimi = rule.params?.aineNimi?.toLowerCase?.().trim()
  if (!aineNimi) return []
  return aineet
    .filter((a) => a.nimi?.toLowerCase?.().includes(aineNimi))
    .map((a) => a._id.toString())
}

const countRuleCoursesInSlot = ({ sijoitukset, paiva, tunti, aineIds, kurssitData }) => {
  const avain = `${paiva}-${tunti}`
  const solu = sijoitukset[avain] || []
  let maara = 0
  solu.forEach((s) => {
    const kurssi = kurssitData.find((k) => k._id?.toString() === s.kurssiId)
    if (kurssi && aineIds.includes(kurssi.aineId?.toString())) {
      maara++
    }
  })
  return maara
}

const checkHardConstraintsForPlacement = ({
  sijoitukset,
  paiva,
  tunti,
  kurssitToPlace,
  rules,
  aineet,
  kurssitData
}) => {
  const hardRules = rules.filter((r) => r.enabled && r.severity === 'hard')
  const violations = []

  hardRules.forEach((rule) => {
    if (rule.ruleType !== 'max_aine_parallel') return
    const aineIds = resolveAineIdsByRule(rule, aineet)
    if (aineIds.length === 0) return

    const existing = countRuleCoursesInSlot({
      sijoitukset,
      paiva,
      tunti,
      aineIds,
      kurssitData
    })
    const newCount = kurssitToPlace.filter((k) =>
      aineIds.includes(k.aineId?.toString())
    ).length
    const maxParallel = Number(rule.params?.maxParallel || 0)
    const total = existing + newCount

    if (total > maxParallel) {
      violations.push({
        ruleId: rule.id,
        ruleType: rule.ruleType,
        label: ruleDisplayName(rule),
        paiva,
        tunti,
        aineNimi: rule.params?.aineNimi || '',
        maxParallel,
        currentParallel: total,
        message: rule.message || ''
      })
    }
  })

  return {
    ok: violations.length === 0,
    violations
  }
}

const evaluateRulesAgainstSijoitukset = ({
  sijoitukset,
  rules,
  aineet,
  kurssitData
}) => {
  const violations = []

  Object.entries(sijoitukset).forEach(([slotKey]) => {
    const [paiva, tuntiRaw] = slotKey.split('-')
    const tunti = Number(tuntiRaw)

    rules
      .filter((r) => r.enabled)
      .forEach((rule) => {
        if (rule.ruleType !== 'max_aine_parallel') return
        const aineIds = resolveAineIdsByRule(rule, aineet)
        if (aineIds.length === 0) return

        const count = countRuleCoursesInSlot({
          sijoitukset,
          paiva,
          tunti,
          aineIds,
          kurssitData
        })
        const maxParallel = Number(rule.params?.maxParallel || 0)
        if (count > maxParallel) {
          violations.push({
            ruleId: rule.id,
            ruleType: rule.ruleType,
            severity: rule.severity,
            label: ruleDisplayName(rule),
            paiva,
            tunti,
            aineNimi: rule.params?.aineNimi || '',
            maxParallel,
            currentParallel: count,
            message: rule.message || ''
          })
        }
      })
  })

  rules
    .filter((r) => r.enabled && r.ruleType === 'tasaa_luokan_paivakuormat')
    .forEach((rule) => {
      const kynnys = Number(rule.params?.varoituskynnys ?? 0.35)
      const luokat = [...new Set(
        kurssitData
          .filter((k) => k.aste !== 'lukio')
          .flatMap((k) => k.luokka || [])
      )]
      luokat.forEach((luokka) => {
        const spread = laskeLuokanPaivaUtilSpread(sijoitukset, luokka)
        if (spread > kynnys) {
          violations.push({
            ruleId: rule.id,
            ruleType: rule.ruleType,
            severity: rule.severity,
            label: ruleDisplayName(rule),
            luokka,
            spread: Math.round(spread * 1000) / 1000,
            threshold: kynnys,
            message: rule.message || ''
          })
        }
      })
    })

  return violations
}

module.exports = {
  DEFAULT_RULE_TEMPLATES,
  checkHardConstraintsForPlacement,
  ensureDefaultRulesForKoulu,
  evaluateRulesAgainstSijoitukset,
  haeKoulunSaannot,
  laskeLuokanPaivaUtilSpread,
  normalizeRule,
  ruleDisplayName,
  validateRulePayload
}
