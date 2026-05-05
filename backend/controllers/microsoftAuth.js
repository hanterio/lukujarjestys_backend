const passport = require('passport')
const MicrosoftStrategy = require('passport-microsoft').Strategy
const jwt = require('jsonwebtoken')
const config = require('../utils/config')

/**
 * OAuth redirect_uri: täsmälleen sama merkkijono kuin Microsoft Entra -sovelluksen
 * Authentication → Redirect URIs -listassa.
 * Jos BACKEND_URL on asetettu (tuotanto), käytetään absoluuttista osoitetta;
 * muuten suhteellinen polku (localhost / yksi origin).
 */
const microsoftCallbackURL = config.BACKEND_URL
  ? `${String(config.BACKEND_URL).replace(/\/$/, '')}/api/auth/microsoft/callback`
  : '/api/auth/microsoft/callback'

passport.use(new MicrosoftStrategy({
  clientID: config.MICROSOFT_CLIENT_ID,
  clientSecret: config.MICROSOFT_CLIENT_SECRET,
  callbackURL: microsoftCallbackURL,
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