const app = require('./app')
const config = require('./utils/config')
const logger = require('./utils/logger')

const http = require('http')
const { Server } = require('socket.io')

// luodaan HTTP serveri expressin ympärille
const server = http.createServer(app)

// luodaan socket.io
const io = new Server(server, {
  cors: {
    origin: '*'
  }
})

// annetaan io käyttöön routeille (esim kurssit.js)
app.set('io', io)

const PORT = config.PORT

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`)
})