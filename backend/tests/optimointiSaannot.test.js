const { describe, test } = require('node:test')
const assert = require('node:assert')
const {
  checkHardConstraintsForPlacement,
  evaluateRulesAgainstSijoitukset,
  validateRulePayload
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
})
