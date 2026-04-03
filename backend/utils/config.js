require('dotenv').config()

const PORT = process.env.PORT

const MONGODB_URI = process.env.NODE_ENV === 'test'
  ? process.env.TEST_MONGODB_URI
  : process.env.MONGODB_URI

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID
const SESSION_SECRET = process.env.SESSION_SECRET
const SECRET = process.env.SECRET
const FRONTEND_URL = process.env.FRONTEND_URL
const RESEND_API_KEY = process.env.RESEND_API_KEY
const BACKEND_URL = process.env.BACKEND_URL


module.exports = {
  MONGODB_URI,
  PORT,
  MICROSOFT_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET,
  MICROSOFT_TENANT_ID,
  SESSION_SECRET,
  SECRET,
  FRONTEND_URL,
  RESEND_API_KEY,
  BACKEND_URL
}