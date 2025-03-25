const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const loginRouter = require('express').Router()
const Opettaja = require('../models/opettaja')

loginRouter.post('/', async (request, response) => {
  const { opettaja, password } = request.body

  const user = await Opettaja.findOne({ opettaja })
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

  const token = jwt.sign(userForToken, process.env.SECRET)

  response
    .status(200)
    .send({ token, opettaja: user.opettaja })
})

module.exports = loginRouter