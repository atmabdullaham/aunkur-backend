const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

const user = process.env.DB_USER;
const password = process.env.DB_PASSWORD;
console.log(`Database User: ${user}`);
console.log(`Database Password: ${password}`);

// Middleware
app.use(cors())
app.use(express.json())

app.get('/', (req, res)=>{
    res.send("Hello Aunkur!")
})

app.listen(port, ()=>{
    console.log(`Server is running on port ${port}`);
})