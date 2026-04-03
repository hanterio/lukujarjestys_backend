require('dotenv').config()
const mongoose = require('mongoose')
const Kayttaja = require('../models/kayttaja')

const createSuperAdmin = async () => {
  await mongoose.connect(process.env.MONGODB_URI)
  
  const olemassa = await Kayttaja.findOne({ rooli: 'superadmin' })
  if (olemassa) {
    console.log('Superadmin on jo olemassa:', olemassa.email)
    process.exit(0)
  }

  const superadmin = await Kayttaja.create({
    email: 'hannes.vieth@outlook.com', // ← vaihda omaksesi
    nimi: 'Super Admin',
    rooli: 'superadmin',
  })

  console.log('Superadmin luotu:', superadmin.email)
  process.exit(0)
}

createSuperAdmin()