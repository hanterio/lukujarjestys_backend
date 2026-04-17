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
  }
]

const ruleDisplayName = (rule) => {
  if (rule.ruleType === 'va_palkki_paivan_loppuun') {
    return 'VA-palkit päivän loppuun'
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

const validateRulePayload = (payload) => {
  const errors = []
  const ruleType = payload.ruleType
  if (!['max_aine_parallel', 'va_palkki_paivan_loppuun'].includes(ruleType)) {
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

  return violations
}

module.exports = {
  DEFAULT_RULE_TEMPLATES,
  checkHardConstraintsForPlacement,
  ensureDefaultRulesForKoulu,
  evaluateRulesAgainstSijoitukset,
  haeKoulunSaannot,
  normalizeRule,
  ruleDisplayName,
  validateRulePayload
}
