const { describe, test } = require('node:test')
const assert = require('node:assert')
const {
  checkHardConstraintsForPlacement,
  evaluateRulesAgainstSijoitukset,
  validateRulePayload,
  laskeLuokanPaivaUtilSpread
} = require('../utils/optimointiSaannot')

describe('optimointisaantojen validointi', () => {
  test('hyvaksyy toimivan max_aine_parallel payloadin', () => {
    const result = validateRulePayload({
      ruleType: 'max_aine_parallel',
      params: { aineNimi: 'kotitalous', maxParallel: 2 },
      severity: 'hard',
      enabled: true
    })
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.normalized.params.maxParallel, 2)
  })

  test('hylkaa virheellisen payloadin', () => {
    const result = validateRulePayload({
      ruleType: 'max_aine_parallel',
      params: { aineNimi: '', maxParallel: 0 }
    })
    assert.strictEqual(result.valid, false)
  })

  test('hyväksyy tasaa_luokan_paivakuormat payloadin', () => {
    const result = validateRulePayload({
      ruleType: 'tasaa_luokan_paivakuormat',
      params: { painokerroin: 72, varoituskynnys: 0.3, raakaPainokerroin: 32 },
      severity: 'soft',
      enabled: true
    })
    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.normalized.params.painokerroin, 72)
    assert.strictEqual(result.normalized.params.raakaPainokerroin, 32)
  })
})

describe('hard-saantojen evaluointi sijoitukseen', () => {
  test('estaa sijoituksen jos aineen rinnakkaisuus ylittyy', () => {
    const rules = [{
      id: 'r1',
      enabled: true,
      ruleType: 'max_aine_parallel',
      params: { aineNimi: 'kotitalous', maxParallel: 2 },
      severity: 'hard',
      message: ''
    }]
    const aineet = [{ _id: 'a1', nimi: 'Kotitalous' }]
    const kurssitData = [
      { _id: 'k1', aineId: 'a1' },
      { _id: 'k2', aineId: 'a1' },
      { _id: 'k3', aineId: 'a1' }
    ]
    const sijoitukset = {
      'ma-1': [
        { kurssiId: 'k1' },
        { kurssiId: 'k2' }
      ]
    }

    const result = checkHardConstraintsForPlacement({
      sijoitukset,
      paiva: 'ma',
      tunti: 1,
      kurssitToPlace: [{ _id: 'k3', aineId: 'a1' }],
      rules,
      aineet,
      kurssitData
    })

    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.violations.length, 1)
  })
})

describe('valmiin lukujarjestyksen rikeraportti', () => {
  test('tuottaa rikekomponentin ylityksesta', () => {
    const rules = [{
      id: 'r1',
      enabled: true,
      ruleType: 'max_aine_parallel',
      params: { aineNimi: 'liikunta', maxParallel: 2 },
      severity: 'hard',
      message: ''
    }]
    const aineet = [{ _id: 'a2', nimi: 'Liikunta' }]
    const kurssitData = [
      { _id: 'k1', aineId: 'a2' },
      { _id: 'k2', aineId: 'a2' },
      { _id: 'k3', aineId: 'a2' }
    ]
    const sijoitukset = {
      'ti-2': [
        { kurssiId: 'k1' },
        { kurssiId: 'k2' },
        { kurssiId: 'k3' }
      ]
    }

    const violations = evaluateRulesAgainstSijoitukset({
      sijoitukset,
      rules,
      aineet,
      kurssitData
    })
    assert.strictEqual(violations.length, 1)
    assert.strictEqual(violations[0].maxParallel, 2)
    assert.strictEqual(violations[0].currentParallel, 3)
  })

  test('raportoi luokan päiväkuorman epätasaisuudesta', () => {
    const rules = [{
      id: 'r2',
      enabled: true,
      ruleType: 'tasaa_luokan_paivakuormat',
      params: { painokerroin: 48, varoituskynnys: 0.2 },
      severity: 'soft',
      message: ''
    }]
    const aineet = []
    const kurssitData = [{ _id: 'k1', aste: 'ylakoulu', luokka: ['7B'] }]
    const sijoitukset = {
      'ti-1': [{ kurssiId: 'k1', luokat: ['7B'] }],
      'ti-2': [{ kurssiId: 'k1', luokat: ['7B'] }],
      'ti-3': [{ kurssiId: 'k1', luokat: ['7B'] }],
      'ti-4': [{ kurssiId: 'k1', luokat: ['7B'] }],
      'ti-5': [{ kurssiId: 'k1', luokat: ['7B'] }],
      'ke-1': [{ kurssiId: 'k1', luokat: ['7B'] }],
      'ke-2': [{ kurssiId: 'k1', luokat: ['7B'] }]
    }

    const spread = laskeLuokanPaivaUtilSpread(sijoitukset, '7B')
    assert.ok(spread > 0.2)

    const violations = evaluateRulesAgainstSijoitukset({
      sijoitukset,
      rules,
      aineet,
      kurssitData
    })
    assert.ok(violations.some((v) => v.ruleType === 'tasaa_luokan_paivakuormat' && v.luokka === '7B'))
  })
})
