const express = require('express');
const bodyParser = require('body-parser');
const helmet = require("helmet");
const jwt = require('jsonwebtoken');

const cors = require('cors');
require('dotenv').config();
const axios = require('axios');

const app = express();
const port = process.env.PORT || 5000;



// Middleware

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'], // Add all frontend origins you use
}))
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "blob:",
        "https://js-agent.newrelic.com",
        "https://bam.nr-data.net",
        "https://payment.bkash.com", // <-- Add this
        "'unsafe-inline'", // optional, but required for some payment scripts
      ],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  })
);
app.use(express.json())
app.use(bodyParser.json())
app.use('/api', require('./routes/routes'))



const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.cs9shgv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const database = client.db("aunkurDB");
    const applicationCollection = database.collection("applications");
    const userCollection = database.collection("users");



    // jwt related apis
    app.post('/jwt', async(req,res)=>{
     
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET,{
        expiresIn: '1h' // Token will expire in 1 hour
      })
      res.send({token})
    })

    // Middleware to verify JWT
    const verifyToken = (req, res, next) => {
      console.log("Verifying token...", req.headers.authorization);
      if(!req.headers.authorization) {
        return res.status(401).send({message: "Unauthorized access"})
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded)=>{
        if(err){
          return res.status(401).send({message: "Unauthorized access"})
        }
        req.decoded = decoded;
        next()
      })
      
    }

// Routes
app.get('/', (req, res)=>{
    res.send("Hello Aunkur!")
})

app.get("/applications", async(req, res)=>{
  const email = req.query.email;
  const query = {email: email}
  const result = await applicationCollection.find(query).toArray()
  res.send(result)
})

// aplication collection
app.post('/applications', async(req, res)=>{
  const application = req.body;
  console.log(application);
  const result = await applicationCollection.insertOne(application)
  res.send(result)
})

// user collection
app.post('/user', async(req,res)=>{
  const user = req.body;
  const query = {email: user.email}
  const existingUser = await userCollection.findOne(query)
  if(existingUser){
    return res.send({message:"User already esists"})
  }
  const result = await userCollection.insertOne(user)
  res.send(result)
})

app.get("/users", verifyToken, async(req, res)=>{
  
  const result = await userCollection.find().toArray()
  res.send(result)
})

app.delete('/users/:id', async(req, res)=>{  
const id = req.params.id;
const query = {_id: new ObjectId(id)}
const result = await userCollection.deleteOne(query)
res.send(result)
})

app.patch('/users/:id', async(req, res)=>{
  const id = req.params.id;
  const filter = {_id: new ObjectId(id)}
  const updatedDoc = {
    $set: {
      role: "admin"
    },
  };
  const result = await userCollection.updateOne(filter, updatedDoc)
  res.send(result)

})

app.get('/users/admin/:email', verifyToken, async(req, res)=>{
 const email = req.params.email;
 if(email !== req.decoded.email){
  return res.status(403).send({message: "Forbidden access"})
 }
 const query = {email: email};
 const user = await userCollection.findOne(query);
 let admin = false;
 if(user){
  admin = user?.role === 'admin'
 }
 res.send({admin})
})








    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);












app.listen(port, ()=>{
    console.log(`Server is running on port ${port}`);
})