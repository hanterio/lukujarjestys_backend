const config = require('./utils/config')
const logger = require('./utils/logger')
const express = require('express')
require('express-async-errors')
const app = express()
const morgan = require('morgan')
const cors = require('cors')
const middleware = require('./utils/middleware')
const kurssitRouter = require('./controllers/kurssit')
const opettajatRouter = require('./controllers/opettajat')
const tehtavatRouter = require('./controllers/tehtavat')
const infoRouter = require('./controllers/info')
const loginRouter = require('./controllers/login')
const mongoose = require('mongoose')

mongoose.set('strictQuery', false)

const url = config.MONGODB_URI

logger.info('connecting to', url)
mongoose.connect(url)
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connecting to MongoDB:', error.message)
  })

app.use(cors())
app.use(express.static('dist'))
app.use(express.json())
app.use(middleware.requestLogger)


morgan.token('body', (req) => {
  return req.body ? JSON.stringify(req.body) : ''
})
app.use(morgan(':method :url :status :res[content-length] - :response-time ms :body'))

app.use('/api/kurssit', kurssitRouter)
app.use('/api/opettajat', opettajatRouter)
app.use('/api/tehtavat', tehtavatRouter)
app.use('/info', infoRouter)
app.use('/api/login', loginRouter)


app.use(middleware.unknownEndpoint)
app.use(middleware.errorHandler)

module.exports = app