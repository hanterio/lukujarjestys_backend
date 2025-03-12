const mongoose = require('mongoose')

const tehtavaSchema = new mongoose.Schema({
    kuvaus: String,
    opettaja: String,
    vvt: Number,
    eur: Number,
    rahana: Boolean,

})

module.exports = mongoose.model('Tehtava', tehtavaSchema)