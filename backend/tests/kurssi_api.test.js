const { test, after, describe, beforeEach } = require('node:test')
const assert = require('node:assert')
const mongoose = require('mongoose')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const Opettaja = require('../models/opettaja')
const supertest = require('supertest')
const app = require('../app')
const api = supertest(app)
const helper = require('./test_helper')
const Kurssi = require('../models/kurssi')
const Koulu = require('../models/koulu')
const Lukuvuosi = require('../models/lukuvuosi')
const Aine = require('../models/aine')
const config = require('../utils/config')

/** Sama kuin flexUserExtractor-vanha JWT -polku (kokeilukoulu). */
const LEGACY_TEST_KOULU_ID = new mongoose.Types.ObjectId('69cc1858f37f1373e6e237ba')

let authHeaders = {}
let testAineId

beforeEach(async () => {
  await Kurssi.deleteMany({})

  if (!(await Koulu.findById(LEGACY_TEST_KOULU_ID).select('_id').lean())) {
    await new Koulu({
      _id: LEGACY_TEST_KOULU_ID,
      nimi: 'API-testikoulu',
      tila: 'kokeilu',
    }).save()
  }

  let lv = await Lukuvuosi.findOne({ kouluId: LEGACY_TEST_KOULU_ID }).sort({ createdAt: -1 })
  if (!lv) {
    lv = await Lukuvuosi.create({
      name: 'TEST-LV',
      status: 'ACTIVE',
      kouluId: LEGACY_TEST_KOULU_ID,
    })
  }

  let aine = await Aine.findOne().select('_id').lean()
  if (!aine) {
    aine = await Aine.create({ nimi: 'API-testiaine' })
  }
  testAineId = aine._id.toString()

  await Opettaja.deleteMany({})
  const passwordHash = await bcrypt.hash('sekret', 10)
  const opettaja = new Opettaja({
    opettaja: 'root',
    opv: 20,
    passwordHash,
    kouluId: LEGACY_TEST_KOULU_ID,
    admin: true,
  })
  await opettaja.save()
  authHeaders = {
    Authorization: `Bearer ${jwt.sign({ id: opettaja._id.toString() }, config.SECRET)}`,
  }

  let kurssiObject = new Kurssi({
    ...helper.initialKurssit[0],
    kouluId: LEGACY_TEST_KOULU_ID,
    lukuvuosiId: lv._id,
  })
  await kurssiObject.save()

  kurssiObject = new Kurssi({
    ...helper.initialKurssit[1],
    kouluId: LEGACY_TEST_KOULU_ID,
    lukuvuosiId: lv._id,
  })
  await kurssiObject.save()
})

describe('GET-pyynnön testejä', () => {
  test('kurssit are returned as json', async () => {
    await api
      .get('/api/kurssit')
      .set(authHeaders)
      .expect(200)
      .expect('Content-Type', /application\/json/)
  })
  test('tietokannassa on kaksi kurssia', async () => {
    const response = await api.get('/api/kurssit').set(authHeaders)

    assert.strictEqual(response.body.length, helper.initialKurssit.length)
  })
})

describe('Kurssien lisäämiseen liittyvät testit', { concurrency: false }, () => {
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
      .set(authHeaders)
      .send(uusiKurssi)
      .expect(400)

    const response = await api.get('/api/kurssit').set(authHeaders)

    assert.strictEqual(response.body.length, helper.initialKurssit.length)
  })

  test('kurssi lisätään onnistuneesti', async () => {
    const uusiKurssi = {
      nimi: 'TEST1.3',
      aste: 'lukio',
      opiskelijat: '',
      opettaja: '',
      vvt: '1,1',
      aineId: testAineId,
      opetus: {
        periodi: 1,
        tunnit_viikossa: 3,
        palkki: 'vk',
      },
    }
    await api
      .post('/api/kurssit')
      .set(authHeaders)
      .send(uusiKurssi)
      .expect(201)
      .expect('Content-Type', /application\/json/)

    const response = await api.get('/api/kurssit').set(authHeaders)

    const sisalto = response.body.map(r => r.nimi)

    assert.strictEqual(response.body.length, helper.initialKurssit.length + 1)

    assert(sisalto.includes('TEST1.3'))
  })

  test('tietyn kurssin tietoja voidaan tarkastella', async () => {
    const kurssitAlussa = await helper.kurssitInDb()

    const tarkasteltavaKurssi = kurssitAlussa[0]


    const resultKurssi = await api
      .get(`/api/kurssit/${tarkasteltavaKurssi.id}`)
      .set(authHeaders)
      .expect(200)
      .expect('Content-Type', /application\/json/)

    assert.strictEqual(resultKurssi.body.nimi, tarkasteltavaKurssi.nimi)
    const rid = resultKurssi.body.id || resultKurssi.body._id
    assert.strictEqual(String(rid), String(tarkasteltavaKurssi.id))
  })

  test('kurssi voidaan tuhota', async () => {
    const kurssitAlussa = await helper.kurssitInDb()
    const kurssiToDelete = kurssitAlussa[0]

    await api
      .delete(`/api/kurssit/${kurssiToDelete.id}`)
      .set(authHeaders)
      .expect(204)

    const kurssitLopussa = await helper.kurssitInDb()

    const contents = kurssitLopussa.map(r => r.nimi)
    assert(!contents.includes(kurssiToDelete.nimi))

    assert.strictEqual(kurssitLopussa.length, helper.initialKurssit.length - 1)
  })
})

describe('Opettajien lisääminen', () => {
  beforeEach(async () => {
    await Opettaja.deleteMany({})

    const passwordHash = await bcrypt.hash('sekret', 10)
    const opettaja = new Opettaja({
      opettaja: 'root',
      opv: 20,
      passwordHash,
      kouluId: LEGACY_TEST_KOULU_ID,
      admin: true,
    })

    await opettaja.save()
    authHeaders = {
      Authorization: `Bearer ${jwt.sign({ id: opettaja._id.toString() }, config.SECRET)}`,
    }
  })

  test('uuden opettajan luominen onnistuu uniikilla tunnuksella', async () => {
    const opettajatAluksi = await helper.opettajatInDb()

    const newOpe = {
      opettaja: 'KEX',
      opv: 20,
      password: 'salainen',
    }

    await api
      .post('/api/opettajat')
      .set(authHeaders)
      .send(newOpe)
      .expect(201)
      .expect('Content-Type', /application\/json/)

    const opettajatLopuksi = await helper.opettajatInDb()
    assert.strictEqual(opettajatLopuksi.length, opettajatAluksi.length + 1)

    const opettajat = opettajatLopuksi.map(u => u.opettaja)
    assert(opettajat.includes(newOpe.opettaja))
  })
  test('uuden opettajan lisääminen epäonnistuu (ei ole uniikki)', async () => {
    const opettajatAlussa = await helper.opettajatInDb()

    const newOpe = {
      opettaja: 'root',
      opv: 20,
      password: 'salainen',
    }

    const result = await api
      .post('/api/opettajat')
      .set(authHeaders)
      .send(newOpe)
      .expect(400)
      .expect('Content-Type', /application\/json/)

    const opettajatLopuksi = await helper.opettajatInDb()
    assert(result.body.error.includes('expected `opettaja` to be unique'))

    assert.strictEqual(opettajatLopuksi.length, opettajatAlussa.length)
  })
})

after(async () => {
  await mongoose.connection.close()
})