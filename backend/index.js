require('dotenv').config()
const express = require('express')
const morgan = require('morgan')
const cors = require('cors')
const Kurssi = require('./models/kurssi')
const Tehtava = require('./models/tehtava')
const Opettaja = require('./models/opettajat')

const app = express()

app.use(express.json())
app.use(cors())
app.use(express.static('dist'))

morgan.token('body', (req) => {
  return req.body ? JSON.stringify(req.body) : ''
})
app.use(morgan(':method :url :status :res[content-length] - :response-time ms :body'))

app.get('/info', (request, response) => {
  response.send('<h1>Tervetuloa suunnittelusovellukseen!</h1>')
})

app.get('/api/kurssit', (request, response) => {
  Kurssi.find({}).then(kurssit => {
    response.json(kurssit)
  })
})

app.get('/api/tehtavat', (request, response) => {
  Tehtava.find({}).then(tehtavat => {
    response.json(tehtavat)
  })
})

app.get('/api/opettajat', (request, response) => {
  Opettaja.find({}).then(opettajat => {
    response.json(opettajat)
  })
})

app.get('/api/kurssit/:id', (request, response, next) => {
  Kurssi.findById(request.params.id).then(kurssi => {
    if (kurssi) {
      response.json(kurssi)
    } else {
      response.status(404).end()
    }
  })
    .catch(error => next(error))
})

app.get('/api/tehtavat/:_id', (request, response, next) => {
  Tehtava.findById(request.params._id).then(tehtava => {
    if (tehtava) {
      response.json(tehtava)
    } else {
      response.status(404).end()
    }
  })
    .catch(error => next(error))
})

app.get('/api/opettajat/:_id', (request, response, next) => {
  Opettaja.findById(request.params._id).then(opettaja => {
    if (opettaja) {
      response.json(opettaja)
    } else {
      response.status(404).end()
    }
  })
    .catch(error => next(error))
})


app.delete('/api/kurssit/:id', (request, response, next) => {
  Kurssi.findByIdAndDelete(request.params.id)
    .then(() => {
      response.status(204).end()
    })
    .catch(error => next(error))
})


app.delete('/api/tehtavat/:_id', (request, response, next) => {
  Tehtava.findByIdAndDelete(request.params._id)
    .then(() => {
      response.status(204).end()
    })
    .catch(error => next(error))
})

app.delete('/api/opettajat/:_id', (request, response, next) => {
  Opettaja.findByIdAndDelete(request.params._id)
    .then(() => {
      response.status(204).end()
    })
    .catch(error => next(error))
})


app.post('/api/kurssit', (request, response, next) => {
  const body = request.body

  if (!body.nimi) {
    return next(new Error('kurssin nimi puuttuu'))
  }

  const kurssi = new Kurssi({
    'nimi': body.nimi,
    'aste': body.aste,
    'luokka': body.luokka,
    'vvt': body.vvt,
    'opiskelijat': body.opiskelijat,
    'opettaja': body.opettaja,
    'opetus': body.opetus,
  })
  kurssi.save().then(savedKurssi => {
    response.json(savedKurssi)
  })
})

app.post('/api/tehtavat', (request, response, next) => {
  const body = request.body

  if (!body.kuvaus) {
    return next(new Error('tehtävän kuvaus puuttuu'))
  }

  const tehtava = new Tehtava({
    'kuvaus': body.kuvaus,
    'opettaja': body.opettaja,
    'vvt': body.vvt,
    'eur': body.eur,
    'rahana': body.rahana,
  })
  tehtava.save().then(savedTehtava => {
    response.json(savedTehtava)
  })
})

app.post('/api/opettajat', (request, response, next) => {
  const body = request.body

  if (!body.opettaja) {
    return next(new Error('opettajatunnus puuttuu'))
  }

  const opettaja = new Opettaja({
    'opettaja': body.opettaja,
    'opv': body.opv,
  })
  opettaja.save().then(savedOpettaja => {
    response.json(savedOpettaja)
  })
})

app.put('/api/kurssit/:id', (request, response, next) => {
  const body = request.body

  const kurssi = {
    nimi: body.nimi,
    aste: body.aste,
    luokka: body.luokka,
    vvt: body.vvt,
    opiskelijat: body.opiskelijat,
    opettaja: body.opettaja,
    opetus: body.opetus,
  }

  Kurssi.findByIdAndUpdate(request.params.id, kurssi, { new: true })
    .then(updatedKurssi => {
      response.json(updatedKurssi)
    })
    .catch(error => next(error))
})

app.put('/api/tehtavat/:_id', (request, response, next) => {
  console.log("PUT-pyyntö vastaanotettu ID:llä:", request.params.id);
  console.log("Body data:", request.body)
  
  const body = request.body

  const tehtava = {
    kuvaus: body.kuvaus,
    opettaja: body.opettaja,
    vvt: body.vvt,
    eur: body.eur,
    rahana: body.rahana,
  }

  Tehtava.findByIdAndUpdate(request.params._id, tehtava, { new: true })
    .then(updatedTehtava => {
      response.json(updatedTehtava)
    })
    .catch(error => next(error))
})

const unknownEndpoint = (request, response) => {
  response.status(404).send({ error: 'unknown endpoint' })
}

app.put('/api/opettajat/:_id', (request, response, next) => {
  console.log("PUT-pyyntö vastaanotettu ID:llä:", request.params.id);
  console.log("Body data:", request.body)
  
  const body = request.body

  const opettaja = {
    opettaja: body.opettaja,
    opv: body.opv,
  }

  Opettaja.findByIdAndUpdate(request.params._id, opettaja, { new: true })
    .then(updatedOpettaja => {
      response.json(updatedOpettaja)
    })
    .catch(error => next(error))
})

// olemattomien osoitteiden käsittely
app.use(unknownEndpoint)

const errorHandler = (error, request, response, next) => {
  console.error(error.message)

  if (error.message === 'kurssin nimi puuttuu') {
    return response.status(400).json({ error: error.message })
  }

  if (error.name === 'CastError') {
    return response.status(400).send({ error: 'virheellinen id' })
  }

  next(error)
}

app.use(errorHandler)

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})