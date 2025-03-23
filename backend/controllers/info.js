const express = require('express')
const infoRouter = express.Router()

infoRouter.get('/', (request, response) => {
  response.send('<h1>Tervetuloa suunnittelusovellukseen!</h1>')
})

module.exports = infoRouter
