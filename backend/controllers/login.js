const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const mongoose = require('mongoose')
const loginRouter = require('express').Router()
const Opettaja = require('../models/opettaja')

/**
 * Vanha kirjautuminen (Opettaja + salasana): vain tälle koululle.
 * Tarkoitus pitää toistaiseksi käytössä; myöhemmin voidaan poistaa reitti ja siirtyä täysin Kayttaja-kirjautumiseen.
 */
const OLETUS_KOULU_ID = new mongoose.Types.ObjectId('69cc1858f37f1373e6e237ba')

loginRouter.post('/', async (request, response) => {
  const { opettaja, password } = request.body

  const user = await Opettaja.findOne({ opettaja, kouluId: OLETUS_KOULU_ID })
  const passwordCorrect = user === null
    ? false
    : await bcrypt.compare(password, user.passwordHash)

  if (!(user && passwordCorrect)) {
    return response.status(401).json({
      error: 'invalid username or password'
    })
  }

  const userForToken = {
    opettaja: user.opettaja,
    id: user._id,
  }

  const token = jwt.sign(
    userForToken,
    process.env.SECRET,
    { expiresIn: 60*60*12 }
  )

  response
    .status(200)
    .send({
      token,
      opettaja: user.opettaja,
      admin: user.admin
    })
})

module.exports = loginRouter