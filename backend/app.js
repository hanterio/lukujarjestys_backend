const config = require('./utils/config')
const logger = require('./utils/logger')
const express = require('express')
require('express-async-errors')
const app = express()

// Render / reverse proxy: luota ensimmäiseen proxyyn (HTTPS, Host) — tärkeää Passport/Microsoft OAuthille
if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
  app.set('trust proxy', 1)
}

const morgan = require('morgan')
const cors = require('cors')
const middleware = require('./utils/middleware')
const kurssitRouter = require('./controllers/kurssit')
const opettajatRouter = require('./controllers/opettajat')
const tehtavatRouter = require('./controllers/tehtavat')
const infoRouter = require('./controllers/info')
const loginRouter = require('./controllers/login')
const aineetRouter = require('./controllers/aineet')
const raportitRouter = require('./routes/raportit')
const lukuvuosiRouter = require('./controllers/lukuvuodet')
const lukujarjestysRouter = require('./routes/lukujarjestykset')
const optimointiRouter = require('./routes/optimointi')
const session = require('express-session')
const passport = require('./controllers/microsoftAuth')
const jwt = require('jsonwebtoken')
const kayttajaAuthRouter = require('./controllers/kayttajaAuth')
const kouluRouter = require('./controllers/koulu')
const superadminRouter = require('./controllers/superadmin')
const mongoose = require('mongoose')

mongoose.set('strictQuery', false)

const url = config.MONGODB_URI
// Älä koskaan logaa täyttä URI:ta — salasana vuotaa tuotantolokeihin.
const mongoUriForLog = url.replace(/:([^:@]+)@/, ':***@')

logger.info('connecting to', mongoUriForLog)
mongoose.connect(url)
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connecting to MongoDB:', error.message)
  })
app.use(session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}))
app.use(passport.initialize())
app.use(passport.session())
app.use(cors())
app.use(express.static('dist'))
app.use(express.json())
app.use(middleware.requestLogger)


morgan.token('body', (req) => {
  return req.body ? JSON.stringify(req.body) : ''
})
app.use(morgan(':method :url :status :res[content-length] - :response-time ms :body'))

app.use('/api/kurssit', middleware.flexUserExtractor, kurssitRouter)
app.use('/api/raportit', raportitRouter)
app.use('/api/opettajat', opettajatRouter)
app.use('/api/tehtavat', middleware.flexUserExtractor, tehtavatRouter)
app.use('/info', infoRouter)
app.use('/api/login', loginRouter)
app.use('/api/aineet', aineetRouter)
app.use('/api/lukujarjestykset', middleware.flexUserExtractor, lukujarjestysRouter)
app.use('/api/lukuvuosi', middleware.flexUserExtractor, lukuvuosiRouter)
app.use('/api/optimointi', middleware.flexUserExtractor, optimointiRouter)
app.use('/api/kayttaja', kayttajaAuthRouter)
app.use('/api/koulu', middleware.flexUserExtractor, kouluRouter)
app.use('/api/superadmin', superadminRouter)

app.get('/api/auth/microsoft',
  passport.authenticate('microsoft'))

app.get('/api/auth/microsoft/callback',
  passport.authenticate('microsoft', { failureRedirect: '/login' }),
  async (req, res) => {
    const user = req.user
    const Kayttaja = require('./models/kayttaja')
    const Koulu = require('./models/koulu')
    const { generateUniqueTrialNimi } = require('./utils/kouluTrial')

    // Etsi tai luo käyttäjä
    let kayttaja = await Kayttaja.findOne({ email: user.email })
    if (!kayttaja) {
      const nimi = await generateUniqueTrialNimi()
      const koulu = await Koulu.create({
        nimi,
        tila: 'kokeilu',
        kokeiluLoppuu: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      })
      kayttaja = await Kayttaja.create({
        email: user.email,
        nimi: user.nimi,
        rooli: 'school_admin',
        koulu: koulu._id
      })
    }

    const token = jwt.sign(
      { 
        email: kayttaja.email, 
        nimi: user.nimi,
        id: kayttaja._id,
        rooli: kayttaja.rooli,
        koulu: kayttaja.koulu
      },
      config.SECRET,
      { expiresIn: '8h' }
    )
    res.redirect(`${config.FRONTEND_URL}/?token=${token}&nimi=${encodeURIComponent(user.nimi)}&rooli=${kayttaja.rooli}`)
  }
)

app.use(middleware.unknownEndpoint)
app.use(middleware.errorHandler)

module.exports = app