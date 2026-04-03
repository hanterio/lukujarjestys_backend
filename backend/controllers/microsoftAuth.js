const passport = require('passport')
const MicrosoftStrategy = require('passport-microsoft').Strategy
const jwt = require('jsonwebtoken')
const config = require('../utils/config')

passport.use(new MicrosoftStrategy({
  clientID: config.MICROSOFT_CLIENT_ID,
  clientSecret: config.MICROSOFT_CLIENT_SECRET,
  callbackURL: '/api/auth/microsoft/callback',
  scope: ['user.read'],
  tenant: 'common',
},
async (accessToken, refreshToken, profile, done) => {
  try {
    const user = {
      nimi: profile.displayName,
      email: profile.emails?.[0]?.value || profile._json.mail,
      microsoftId: profile.id,
    }
    return done(null, user)
  } catch (error) {
    return done(error)
  }
}))

passport.serializeUser((user, done) => done(null, user))
passport.deserializeUser((user, done) => done(null, user))

module.exports = passport