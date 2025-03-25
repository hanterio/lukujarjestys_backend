const { test, after, describe, beforeEach } = require('node:test')
const assert = require('node:assert')
const mongoose = require('mongoose')
const supertest = require('supertest')
const app = require('../app')
const api = supertest(app)
const helper = require('./test_helper')
const Kurssi = require('../models/kurssi')

beforeEach(async () => {
  await Kurssi.deleteMany({})

  let kurssiObject = new Kurssi(helper.initialKurssit[0])
  await kurssiObject.save()

  kurssiObject = new Kurssi(helper.initialKurssit[1])
  await kurssiObject.save()
})

describe('GET-pyynnön testejä', () => {
  test('kurssit are returned as json', async () => {
    await api
      .get('/api/kurssit')
      .expect(200)
      .expect('Content-Type', /application\/json/)
  })
  test('tietokannassa on kaksi kurssia', async () => {
    const response = await api.get('/api/kurssit')

    assert.strictEqual(response.body.length, helper.initialKurssit.length)
  })
})

describe('Kurssien lisäämiseen liittyvät testit', () => {
  test('kurssi lisätään onnistuneesti', async () => {
    const uusiKurssi = {
      nimi: 'TEST1.3',
      aste: 'lukio',
      opiskelijat: '',
      opettaja: '',
      vvt: '1,1',
      opetus: {
        periodi: 1,
        tunnit_viikossa: 3,
        palkki: 'vk',
      },
    }
    await api
      .post('/api/kurssit')
      .send(uusiKurssi)
      .expect(201)
      .expect('Content-Type', /application\/json/)

    const response = await api.get('/api/kurssit')

    const sisalto = response.body.map(r => r.nimi)

    assert.strictEqual(response.body.length, helper.initialKurssit.length + 1)

    assert(sisalto.includes('TEST1.3'))
  })

  test('kurssia ilman nimeä ei tallenneta', async () => {
    const uusiKurssi = {
      aste: 'lukio',
      opiskelijat: '',
      opettaja: '',
      vvt: '1,1',
      opetus: {
        periodi: 1,
        tunnit_viikossa: 3,
        palkki: 'vk',
      },
    }
    await api
      .post('/api/kurssit')
      .send(uusiKurssi)
      .expect(400)

    const response = await api.get('/api/kurssit')

    assert.strictEqual(response.body.length, helper.initialKurssit.length)
  })
  test('tietyn kurssin tietoja voidaan tarkastella', async () => {
    const kurssitAlussa = await helper.kurssitInDb()

    const tarkasteltavaKurssi = kurssitAlussa[0]


    const resultKurssi = await api
      .get(`/api/kurssit/${tarkasteltavaKurssi.id}`)
      .expect(200)
      .expect('Content-Type', /application\/json/)

    assert.deepStrictEqual(resultKurssi.body, tarkasteltavaKurssi)
  })

  test('kurssi voidaan tuhota', async () => {
    const kurssitAlussa = await helper.kurssitInDb()
    const kurssiToDelete = kurssitAlussa[0]

    await api
      .delete(`/api/kurssit/${kurssiToDelete.id}`)
      .expect(204)

    const kurssitLopussa = await helper.kurssitInDb()

    const contents = kurssitLopussa.map(r => r.nimi)
    assert(!contents.includes(kurssiToDelete.nimi))

    assert.strictEqual(kurssitLopussa.length, helper.initialKurssit.length - 1)
  })
})

after(async () => {
  await mongoose.connection.close()
})