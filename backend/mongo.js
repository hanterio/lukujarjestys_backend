const mongoose = require('mongoose')

if (process.argv.length<3) {
  console.log('give password as argument')
  process.exit(1)
}

const password = process.argv[2]
const nimi = process.argv[3]
const aste = process.argv[4]

const url =
    `mongodb+srv://hanterio:${password}@fso2025.b68e4.mongodb.net/testiLukkariApp?retryWrites=true&w=majority&appName=FSO2025`

mongoose.set('strictQuery', false)
mongoose.connect(url)

const opetusSchema = new mongoose.Schema({
  periodi: Number,
  palkki: String,
  tunnit_viikossa: Number
})

const noteSchema = new mongoose.Schema({
  nimi: String,
  aste: String,
  opiskelijat: String,
  opettaja: [String],
  opetus: [opetusSchema]
})

const Kurssi = mongoose.model('Kurssi', noteSchema)

const kurssi = new Kurssi({
  nimi: `${nimi}`,
  aste: `${nimi}`,
  opiskelijat: '',
  opettaja: '',
  opetus: {
    periodi: 1,
    tunnit_viikossa: 3,
    palkki: 'vk'  }
})
/*
Kurssi.find({}).then(result => {
  result.forEach(kurssi => {
    console.log(kurssi)
  })
  mongoose.connection.close()
})*/
/*
const kurssi = new Kurssi({
    "id": "2",
    "nimi": "KOKEILU1.4",
    "aste": "lukio",
    "opiskelijat": "3",
    "opettaja": ["VIE", "LAN"],
    "opetus": [
      {
        "periodi": 2,
        "palkki": "4",
        "tunnit_viikossa": 3
      }
    ]
  })
*/
kurssi.save().then(result => {
  console.log(`Uusi kurssi tallennettu`)
  mongoose.connection.close()
})