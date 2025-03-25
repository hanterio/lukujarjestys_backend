const { test } = require('node:test')
const assert = require('node:assert')

const kurssiApuri = require('../utils/kurssi_apuri')

const muutamaKurssi = [
  {
    nimi: 'BI_91.1',
    aste: 'yläkoulu',
    luokka: [
      '9A'
    ],
    vvt: '1,05',
    opettaja: [
      'SPP'
    ],
    opetus: [
      {
        periodi: 2,
        palkki: '9lk_2',
        tunnit_viikossa: 3,
        _id: '67dd9d9b96721a96ee614a31'
      }
    ],
    id: '67dd9d9b96721a96ee614a31'
  },
  {
    nimi: 'KO_91.1',
    aste: 'yläkoulu',
    luokka: [
      '9A'
    ],
    vvt: '1,05',
    opettaja: [
      'SPP'
    ],
    opetus: [
      {
        periodi: 2,
        palkki: '9lk_2',
        tunnit_viikossa: 3,
        _id: '67dd9d9b96721a96ee614a32'
      }
    ],
    id: '67dd9d9b96721a96ee614a33'
  },
  {
    nimi: 'KE_91.1',
    aste: 'yläkoulu',
    luokka: [
      '9A'
    ],
    vvt: '1,20',
    opettaja: [
      'SPP'
    ],
    opetus: [
      {
        periodi: 3,
        palkki: '9lk_2',
        tunnit_viikossa: 3,
        _id: '67dd9d9b96721a96ee614a39'
      }
    ],
    id: '67dd9d9b96721a96ee614a39'
  }
]

test('kursseja on yhteensä', () => {
  const result = kurssiApuri.kurssienMaara(muutamaKurssi)

  assert.strictEqual(result, 3)
})