const express = require('express')
const morgan = require('morgan')
const cors = require('cors')

const app = express()

app.use(express.json())
app.use(cors())
app.use(express.static('dist'))

morgan.token('body', (req, res) => {
    return req.body ? JSON.stringify(req.body) : ''
})
app.use(morgan(':method :url :status :res[content-length] - :response-time ms :body'))



let kurssit = [
      {
        "id": "1",
        "nimi": "BI01.1",
        "aste": "lukio",
        "opiskelijat": "2",
        "opettaja": [],
        "opetus": [
          {
            "periodi": 2,
            "palkki": "1",
            "tunnit_viikossa": 3
          }
        ]
      },
      {
        "id": "2",
        "nimi": "BI01.2",
        "aste": "lukio",
        "opiskelijat": "3",
        "opettaja": [],
        "opetus": [
          {
            "periodi": 3,
            "palkki": "3",
            "tunnit_viikossa": 3
          }
        ]
      },
      {
        "id": "3",
        "nimi": "BI01.3",
        "aste": "lukio",
        "opiskelijat": "1",
        "opettaja": [],
        "opetus": [
          {
            "periodi": 4,
            "palkki": "1",
            "tunnit_viikossa": 3
          }
        ]
      }] 


app.get('/info', (request, response) => {
    response.send('<h1>Tervetuloa suunnittelusovellukseen!</h1>')
  })
  
app.get('/api/kurssit', (request, response) => {
response.json(kurssit)
})

app.get('/api/kurssit/:id', (request, response) => {
    const id = request.params.id
    const kurssi = kurssit.find(kurssi => kurssi.id === id)
    
    if (kurssi) {    
        response.json(kurssi)
    } else {
        response.status(404).end()
    }
})

app.delete('/api/kurssit/:id', (request, response) => {
    const id = request.params.id
    kurssit = kurssit.filter(kurssi => kurssi.id !== id)
  
    response.status(204).end()
  })

  
  app.post('/api/kurssit', (request, response) => {
    const uusiId = kurssit.length > 0
        ? Math.floor(Math.random() * 1000000000) 
        : 1

    const body = request.body

    if (!body.nimi) {
        return response.status(400).json({
            error: 'kurssin nimi puuttuu'
        })
    }

    const kurssi = {
        "nimi": body.nimi,
        "aste": body.aste,
        "id": String(uusiId),
        "opiskelijat": body.aste,
        "opettaja": body.aste,
        "opetus": body.opetus

    }

    kurssit = kurssit.concat(kurssi)

    response.json(kurssi)
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})