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
  origin: ['http://localhost:5173', 'http://localhost:5174', 'https://aunkurctgnorth.org'], // Add all frontend origins you use
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
        expiresIn: '5h' // Token will expire in 5 hour
      })
      res.send({token})
    })

    // Middleware to verify JWT
    const verifyToken = (req, res, next) => {
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

    // Middleware to verify admin role
    const verifyAdmin = async (req, res, next)=>{
      const email = req.decoded.email;
      const query = {email: email}
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if(!isAdmin){
        return res.status(403).send({message: "Forbidden Access"})
      }
      next()
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

// sms 
const sendBulkSMS = async (numbersArray, message) => {
  const smsData = {
    api_key: process.env.BULKSMS_API_KEY,          // replace with your actual API key
    senderid: process.env.BULKSMS_SENDERID,       // replace with your approved sender ID
    number: numbersArray.join(","),   // example: ['88016xxxxxxx','88019xxxxxxx']
    message: message,
  };

  try {
    const response = await axios.post("http://bulksmsbd.net/api/smsapi", smsData);
    console.log("✅ SMS sent successfully:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ SMS sending failed:", error.response?.data || error.message);
    throw error;
  }
};

// aplication collection and send sms after successfull saved
app.post('/applications', async(req, res)=>{
  const application = req.body;
  const result = await applicationCollection.insertOne(application)
  if (result.acknowledged && result.insertedId) {
      const id = result.insertedId
      const filter = { _id: new ObjectId(id) };

    // ✅ Fetch user info (to get phone number)
    const newRegistration = await applicationCollection.findOne(filter);
    const phone = newRegistration?.phone_number; // Assuming you store phone number in bkash_number

    // ✅ Send confirmation SMS
const message = `Dear ${newRegistration.name_en}, congratulations! We have received your registration. You will receive a confirmation SMS within 24 hours. Aunkur Scholarship 2025.
`;

    try {
      await sendBulkSMS([phone], message);
    } catch (smsError) {
      console.error("❌ Failed to send SMS:", smsError.message);
    }
  }
  res.send(result)
})




app.patch('/applications/:id', verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  const filter = { _id: new ObjectId(id) };
  const updateDoc = { $set: { reg_status: status } };

  const result = await applicationCollection.updateOne(filter, updateDoc);

  if (result.modifiedCount > 0) {
    // ✅ Fetch user info (to get phone number)
    const updatedUser = await applicationCollection.findOne(filter);
    const phone = updatedUser?.phone_number; // Assuming you store phone number in bkash_number

    // ✅ Send confirmation SMS
    const message = `Dear ${updatedUser.name_en}, your registration is ${status}. 
    Thank you! 
    Aunkur Scholarship 2025`;
    try {
      await sendBulkSMS([phone], message);
    } catch (smsError) {
      console.error("❌ Failed to send SMS:", smsError.message);
    }
  }

  res.send(result);
});


app.delete('/applications/:id',verifyToken,verifyAdmin, async(req, res)=>{
    const id = req.params.id;
    const filter = {_id: new ObjectId(id)}
    const result = await applicationCollection.deleteOne(filter)
    res.send(result)

})

app.get('/registrations',verifyToken,verifyAdmin, async(req, res)=>{
  const result = await applicationCollection.find().toArray()
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

app.get("/users", verifyToken, verifyAdmin, async(req, res)=>{
  
  const result = await userCollection.find().toArray()
  res.send(result)
})

app.delete('/users/:id', verifyToken, verifyAdmin, async(req, res)=>{  
const id = req.params.id;
const query = {_id: new ObjectId(id)}
const result = await userCollection.deleteOne(query)
res.send(result)
})

app.patch('/users/:id', verifyToken, verifyAdmin, async(req, res)=>{
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