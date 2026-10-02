const express = require('express');
const bodyParser = require('body-parser');
const helmet = require("helmet");
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const ImageKit = require("@imagekit/nodejs");
const cron = require('node-cron');
const axios = require('axios');
const { rateLimit } = require('express-rate-limit');

const { initializeApp: initFirebaseAdmin, getApps } = require('firebase-admin/app');
const { getAuth: getFirebaseAuth } = require('firebase-admin/auth');

const { sendMetaCapiEvent } = require('./utils/metaCapi');

// Firebase Admin — used only to verify client ID tokens (no service account needed, just the project ID)
let firebaseAuth = null;
try {
  const firebaseAdminApp = getApps().length
    ? getApps()[0]
    : initFirebaseAdmin({ projectId: process.env.FIREBASE_PROJECT_ID || "aunkur-scholarship" });
  firebaseAuth = getFirebaseAuth(firebaseAdminApp);
} catch (fbErr) {
  console.warn("⚠️ Firebase Admin initialization warning:", fbErr.message);
}

const app = express();
const port = process.env.PORT || 5000;

// Behind Vercel's proxy — needed so rate limiting sees the real client IP
app.set('trust proxy', 1);



// Middleware

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://aunkurctgnorth.org',
    'https://www.aunkurctgnorth.org' // ✅ add this line
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
}));
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
      connectSrc: [
        "'self'",
        "https://aunkurctgnorth.org",
        "https://www.aunkurctgnorth.org"
      ],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  })
);
app.use(express.json())
app.use(bodyParser.json())
app.use('/api', require('./routes/routes'))




// --- ImageKit Client ---
let imgkitClient = null;
try {
  if (process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_PUBLIC_KEY && process.env.PUBLICURL) {
    imgkitClient = new ImageKit({
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      urlEndpoint: process.env.PUBLICURL,
    });
  } else {
    console.warn("⚠️ ImageKit environment variables are missing or incomplete.");
  }
} catch (ikErr) {
  console.error("⚠️ ImageKit initialization error:", ikErr.message);
}

app.get("/auth", function (req, res) {
  if (!imgkitClient) {
    return res.status(503).json({
      error: "ImageKit is not configured. Please set IMAGEKIT_PRIVATE_KEY, IMAGEKIT_PUBLIC_KEY, and PUBLICURL in environment variables."
    });
  }
  const { token, expire, signature } =
    imgkitClient.helper.getAuthenticationParameters();
  res.send({
    token,
    expire,
    signature,
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  });
});


// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.cs9shgv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASSWORD}@ac-yg6fc4o-shard-00-00.cs9shgv.mongodb.net:27017,ac-yg6fc4o-shard-00-01.cs9shgv.mongodb.net:27017,ac-yg6fc4o-shard-00-02.cs9shgv.mongodb.net:27017/?ssl=true&replicaSet=atlas-r1j3dw-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0`;

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
    const settingsCollection = database.collection("settings");
    const noticesCollection = database.collection("notices");
    const contactMessagesCollection = database.collection("contact_messages");
    const zoneCollection = database.collection("zones");
    const regionsCollection = database.collection("regions");
    const studentOfTheYearCollection = database.collection("student_of_the_year");
    const countersCollection = database.collection("counters");

    // Ensure critical database indexes for high-speed lookups (Non-blocking background execution)
    let indexesAlreadyEnsured = false;
    const ensureIndexes = async () => {
      if (indexesAlreadyEnsured) return;
      indexesAlreadyEnsured = true;
      const indexTasks = [
        () => applicationCollection.createIndex({ phone_number: 1 }, { background: true }),
        () => applicationCollection.createIndex({ exam_roll: 1 }, { sparse: true, background: true }),
        () => applicationCollection.createIndex({ reg_status: 1 }, { background: true }),
        () => applicationCollection.createIndex({ transaction_Id: 1 }, { sparse: true, background: true }),
        () => applicationCollection.createIndex({ registration_type: 1, reg_status: 1 }, { background: true }),
        () => applicationCollection.createIndex({ form_number: 1 }, { sparse: true, background: true }),
        () => applicationCollection.createIndex({ offline_serial: 1 }, { sparse: true, background: true }),
        () => userCollection.createIndex({ email: 1 }, { unique: true, background: true }),
      ];

      for (const task of indexTasks) {
        try {
          await task();
        } catch (idxErr) {
          console.warn("⚠️ Database index creation notice:", idxErr.message);
        }
      }
    };
    setImmediate(ensureIndexes);

    // Center-wise Numeric Serial Configuration:
    // Chawkbazar: 1001-1999 (base 1000)
    // Chandgaon:  2001-2999 (base 2000)
    // Kotwali:    3001-3999 (base 3000)
    // Nasirabad:  4001-4999 (base 4000)
    // Bayezid:    5001-5999 (base 5000)
    const CENTER_SERIAL_CONFIG = {
      chawkbazar: { base: 1000, label: "চকবাজার" },
      chandgaon:  { base: 2000, label: "চাঁদগাঁও" },
      kotwali:    { base: 3000, label: "কোতোয়ালী" },
      nasirabad:  { base: 4000, label: "নাসিরাবাদ" },
      bayezid:    { base: 5000, label: "বায়েজিদ" },
    };

    // Atomic sequential counter per exam center for offline registrations (100% collision-free)
    const getNextOfflineSerial = async (center = "chawkbazar") => {
      const normalizedCenter = (center || "chawkbazar").toLowerCase().trim();
      const config = CENTER_SERIAL_CONFIG[normalizedCenter] || { base: 1000 };
      const counterId = `offline_serial_${normalizedCenter}`;

      // Step 1: Attempt atomic increment
      const result = await countersCollection.findOneAndUpdate(
        { _id: counterId },
        { $inc: { seq: 1 } },
        { returnDocument: "after" }
      );

      if (result && typeof result.seq === "number") {
        return result.seq;
      }

      // Step 2: Initialize if counter doesn't exist yet for this center
      const lastApp = await applicationCollection
        .find({
          registration_type: "offline",
          exam_center: normalizedCenter,
          offline_serial: { $exists: true }
        })
        .sort({ offline_serial: -1 })
        .limit(1)
        .toArray();

      const maxExisting = lastApp.length > 0 && typeof lastApp[0].offline_serial === "number"
        ? lastApp[0].offline_serial
        : config.base;

      const initialSeq = Math.max(config.base, maxExisting) + 1;

      try {
        await countersCollection.insertOne({ _id: counterId, seq: initialSeq });
        return initialSeq;
      } catch (err) {
        // In case of concurrent insert race condition, increment atomically
        const retry = await countersCollection.findOneAndUpdate(
          { _id: counterId },
          { $inc: { seq: 1 } },
          { returnDocument: "after" }
        );
        return retry.seq;
      }
    };

    // Helper: get or create the single settings document
    const getSettings = async () => {
      let settings = await settingsCollection.findOne({});
      if (!settings) {
        const defaultSettings = {
          registrationEnabled: false,
          enrollmentTimerStart: null,
          enrollmentTimerEnd: null,
          syllabus: [
            { classId: "4", title: "৪র্থ শ্রেণির সিলেবাস", subjects: ["বাংলা", "বিজ্ঞান", "গণিত", "ইংরেজি"], viewLink: "https://drive.google.com/file/d/1kvhzTl9peucxY9Nz2s0PaQijR8vnSR04/view", downloadLink: "https://drive.usercontent.google.com/u/0/uc?id=1kvhzTl9peucxY9Nz2s0PaQijR8vnSR04&export=download", upcoming: false },
            { classId: "5", title: "৫ম শ্রেণির সিলেবাস", subjects: ["বাংলা", "বিজ্ঞান", "গণিত", "ইংরেজি"], viewLink: "https://drive.google.com/file/d/1eHxJmQa6sFP5s8LXSbaNeTOfPZvfepeJ/view?usp=sharing", downloadLink: "https://drive.usercontent.google.com/u/0/uc?id=1eHxJmQa6sFP5s8LXSbaNeTOfPZvfepeJ&export=download", upcoming: false },
            { classId: "6", title: "৬ষ্ঠ শ্রেণির সিলেবাস", subjects: ["বাংলা", "বিজ্ঞান", "গণিত", "ইংরেজি"], viewLink: "https://drive.google.com/file/d/1-xEJXyd4EN_DxsClbVXbTHOUxzP4RVpp/view?usp=sharing", downloadLink: "https://drive.usercontent.google.com/u/0/uc?id=1-xEJXyd4EN_DxsClbVXbTHOUxzP4RVpp&export=download", upcoming: false },
            { classId: "7", title: "৭ম শ্রেণির সিলেবাস", subjects: ["বাংলা", "বিজ্ঞান", "গণিত", "ইংরেজি"], viewLink: "https://drive.google.com/file/d/1Tm8ozD0bCtBiuHzfnwDfGGgr9WScQGdE/view?usp=sharing", downloadLink: "https://drive.usercontent.google.com/u/0/uc?id=1Tm8ozD0bCtBiuHzfnwDfGGgr9WScQGdE&export=download", upcoming: false },
            { classId: "8", title: "৮ম শ্রেণির সিলেবাস", subjects: ["বাংলা", "বিজ্ঞান", "গণিত", "ইংরেজি"], viewLink: "https://drive.google.com/file/d/1VzUDNC9O5ODV0ZNlpVN7-oM8rHvSIlbu/view?usp=sharing", downloadLink: "https://drive.usercontent.google.com/u/0/uc?id=1VzUDNC9O5ODV0ZNlpVN7-oM8rHvSIlbu&export=download", upcoming: false },
            { classId: "9", title: "৯ম শ্রেণির সিলেবাস", subjects: ["বাংলা", "বিজ্ঞান", "গণিত", "ইংরেজি"], viewLink: "https://drive.google.com/file/d/1alrqvdzcF9Swlmd4sAEHMAFjifQX7ZwS/view?usp=sharing", downloadLink: "https://drive.usercontent.google.com/u/0/uc?id=1alrqvdzcF9Swlmd4sAEHMAFjifQX7ZwS&export=download", upcoming: false },
            { classId: "10", title: "১০ শ্রেণির সিলেবাস", subjects: ["বাংলা", "বিজ্ঞান", "গণিত", "ইংরেজি"], viewLink: "https://drive.google.com/file/d/1wO4V8nCI58AKpooTSZ0O_wqA6EwiBPEr/view?usp=sharing", downloadLink: "https://drive.usercontent.google.com/u/0/uc?id=1wO4V8nCI58AKpooTSZ0O_wqA6EwiBPEr&export=download", upcoming: false },
            { classId: "upcoming", title: "", subjects: [], viewLink: "", downloadLink: "", upcoming: true }
          ]
        };
        await settingsCollection.insertOne(defaultSettings);
        return defaultSettings;
      }
      return settings;
    };



    // jwt related apis - issued only against a verified Firebase ID token
    app.post('/jwt', async (req, res) => {
      const idToken = req.body?.idToken;
      if (!idToken || typeof idToken !== "string") {
        return res.status(400).send({ message: "Firebase ID token is required" });
      }

      let decodedIdToken;
      try {
        decodedIdToken = await firebaseAuth.verifyIdToken(idToken);
      } catch (err) {
        return res.status(401).send({ message: "Invalid or expired Firebase token" });
      }

      try {
        // Email comes from the verified token, never from the request body
        const email = decodedIdToken.email?.toLowerCase()?.trim();
        if (!email) {
          return res.status(400).send({ message: "Account has no email address" });
        }

        // Look up user to embed verified database role (cannot be forged by client)
        const existingUser = await userCollection.findOne({ email });

        // Privileged accounts must have a verified email, otherwise someone could create an
        // unverified Firebase account for an admin's address and inherit that role
        const isPrivileged = existingUser?.role === "admin" || existingUser?.role === "coordinator";
        if (isPrivileged && !decodedIdToken.email_verified) {
          return res.status(403).send({ message: "Email must be verified for this account" });
        }

        const userPayload = {
          email,
          role: existingUser?.role || "user"
        };

        const token = jwt.sign(userPayload, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: '7d' // Token expires in 7 days
        });
        res.send({ token });
      } catch (err) {
        res.status(500).send({ message: "Failed to generate token" });
      }
    });

    // Middleware to verify JWT
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      const authHeader = req.headers.authorization;
      const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

      if (!token || token === 'null' || token === 'undefined') {
        return res.status(401).send({ message: "Unauthorized access. No valid token found." });
      }

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // Middleware to verify admin role
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email }
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "Forbidden Access" })
      }
      next()
    }

    // Helper to check if a request has a valid admin token (used for public endpoint bypass)
    const checkIsAdminRequest = async (req) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return false;
        const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
        if (!token || token === 'null' || token === 'undefined') return false;

        const decoded = await new Promise((resolve) => {
          jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, d) => {
            if (err) resolve(null);
            else resolve(d);
          });
        });
        if (!decoded?.email) return false;
        const user = await userCollection.findOne({ email: decoded.email });
        return user?.role === "admin";
      } catch (e) {
        return false;
      }
    };

    // Helper to check if admit cards are currently published for the public
    const isAdmitCardCurrentlyPublished = (admitConfig) => {
      if (!admitConfig) return false;
      if (admitConfig.admit_card_published === false) return false;
      if (admitConfig.admit_card_publish_status === "draft") return false;

      if (admitConfig.admit_card_publish_status === "scheduled") {
        if (!admitConfig.publish_date_time) return false;
        const target = new Date(admitConfig.publish_date_time).getTime();
        if (isNaN(target)) return false;
        return Date.now() >= target;
      }

      return Boolean(admitConfig.admit_card_published !== false);
    };

    // Middleware to verify coordinator or admin role
    const verifyCoordinatorOrAdmin = async (req, res, next) => {
      const email = req.decoded?.email;
      if (!email) {
        return res.status(401).send({ message: "Unauthorized access" });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAuthorized = user?.role === "admin" || user?.role === "coordinator";
      if (!isAuthorized) {
        return res.status(403).send({ message: "Forbidden Access. Coordinator or Admin role required." });
      }
      req.user = user;
      next();
    }



    // Routes
    app.get('/', (req, res) => {
      res.send("Hello Aunkur!")
    })

    app.get("/student-of-the-year", async (req, res) => {
      const result = await studentOfTheYearCollection
        .find()
        .sort({ year: -1 })
        .toArray();
      res.send(result)
    })

    // Admin Student of the Year routes
    app.get("/admin/student-of-the-year", verifyToken, verifyAdmin, async (req, res) => {
      const result = await studentOfTheYearCollection
        .find()
        .sort({ year: -1 })
        .toArray();
      res.send(result)
    })

    app.post("/admin/student-of-the-year", verifyToken, verifyAdmin, async (req, res) => {
      const data = req.body;
      const result = await studentOfTheYearCollection.insertOne({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      res.send(result)
    })

    app.put("/admin/student-of-the-year/:id", verifyToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const data = req.body;
      delete data._id; // prevent updating immutable field
      const result = await studentOfTheYearCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            ...data,
            updatedAt: new Date()
          }
        }
      );
      res.send(result)
    })

    app.delete("/admin/student-of-the-year/:id", verifyToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const result = await studentOfTheYearCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result)
    })


    app.get("/zones", async (req, res) => {
      const result = await zoneCollection
        .find({ status: "active" })
        .sort({ regionSlug: 1, name: 1 })
        .toArray();
      res.send(result);
    })

    app.get("/regions", async (req, res) => {
      try {
        const result = await regionsCollection
          .find({ status: "active" })
          .toArray();
        res.json(result);
      } catch (err) {
        console.error("GET /regions error:", err);
        res.status(500).json({ error: "Failed to fetch regions" });
      }
    })

    // ── Admin Zone CRUD (protected) ──────────────────────────────────────────

    // GET all zones for admin dashboard (includes inactive)
    app.get("/admin/zones", verifyToken, verifyAdmin, async (req, res) => {
      const result = await zoneCollection
        .find({})
        .sort({ regionSlug: 1, name: 1 })
        .toArray();
      res.send(result);
    });

    // POST create new zone
    app.post("/admin/zones", verifyToken, verifyAdmin, async (req, res) => {
      const zone = req.body;
      const result = await zoneCollection.insertOne(zone);
      res.send({ success: true, insertedId: result.insertedId });
    });

    // PUT update zone
    app.put("/admin/zones/:id", verifyToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const update = req.body;
      delete update._id; // don't overwrite _id
      const result = await zoneCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: update }
      );
      res.send({ success: true, modifiedCount: result.modifiedCount });
    });

    // DELETE zone
    app.delete("/admin/zones/:id", verifyToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const result = await zoneCollection.deleteOne(
        { _id: new ObjectId(id) }
      );
      res.send({ success: true, deletedCount: result.deletedCount });
    });

    // ── Admin Region CRUD (protected) ────────────────────────────────────────

    // GET all regions for admin dashboard (includes inactive)
    app.get("/admin/regions", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await regionsCollection
          .find({})
          .toArray();
        res.send(result);
      } catch (err) {
        console.error("GET /admin/regions error:", err);
        res.status(500).json({ error: "Failed to fetch all regions" });
      }
    });

    // POST create new region
    app.post("/admin/regions", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const region = req.body;
        const result = await regionsCollection.insertOne(region);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (err) {
        console.error("POST /admin/regions error:", err);
        res.status(500).json({ error: "Failed to create region" });
      }
    });

    // PUT update region
    app.put("/admin/regions/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const update = req.body;
        delete update._id; // don't overwrite _id
        const result = await regionsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: update }
        );
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (err) {
        console.error("PUT /admin/regions error:", err);
        res.status(500).json({ error: "Failed to update region" });
      }
    });

    // DELETE region
    app.delete("/admin/regions/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const result = await regionsCollection.deleteOne(
          { _id: new ObjectId(id) }
        );
        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (err) {
        console.error("DELETE /admin/regions error:", err);
        res.status(500).json({ error: "Failed to delete region" });
      }
    });


    app.get("/applications", verifyToken, async (req, res) => {
      try {
        const requestedEmail = req.query.email?.toLowerCase()?.trim();
        const userEmail = req.decoded?.email?.toLowerCase()?.trim();

        // If querying another email, verify requester has admin or coordinator privileges
        if (requestedEmail && requestedEmail !== userEmail) {
          const requester = await userCollection.findOne({ email: userEmail });
          const isAuthorized = requester?.role === "admin" || requester?.role === "coordinator";
          if (!isAuthorized) {
            return res.status(403).send({ message: "Forbidden Access" });
          }
        }

        const targetEmail = requestedEmail || userEmail;
        if (!targetEmail) {
          return res.status(400).send({ message: "Valid email is required" });
        }

        const query = { email: targetEmail };
        const result = await applicationCollection.find(query).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch applications" });
      }
    });

    // Helper to format/capitalize last name for SMS (Title Case e.g., 'rahim' -> 'Rahim')
    const formatLastName = (nameEn) => {
      if (!nameEn || typeof nameEn !== "string") return "Applicant";
      const parts = nameEn.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return "Applicant";
      const rawLast = parts[parts.length - 1];
      return rawLast.charAt(0).toUpperCase() + rawLast.slice(1).toLowerCase();
    };

    // sms 
    const sendBulkSMS = async (numbersArray, message) => {
      if (!process.env.BULKSMS_API_KEY || !process.env.BULKSMS_SENDERID) {
        console.warn("⚠️ BulkSMS configuration is missing. Please set BULKSMS_API_KEY and BULKSMS_SENDERID in your .env file.");
        return { response_code: 1003, success_message: "", error_message: "BulkSMS environment variables not configured." };
      }

      const smsData = {
        api_key: process.env.BULKSMS_API_KEY,          // replace with your actual API key
        senderid: process.env.BULKSMS_SENDERID,       // replace with your approved sender ID
        number: numbersArray.join(","),   // example: ['88016xxxxxxx','88019xxxxxxx']
        message: message,
      };

      try {
        const response = await axios.post("http://bulksmsbd.net/api/smsapi", smsData);
        // console.log("✅ SMS sent successfully:", response.data);
        return response.data;
      } catch (error) {
        console.error("❌ SMS sending failed:", error.response?.data || error.message);
        throw error;
      }
    };

    // Function to send Telegram message
    const sendTelegramMessage = async (message) => {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID;

      if (!botToken || !groupChatId) {
        throw new Error("Telegram configuration missing. Set TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_CHAT_ID in server .env");
      }

      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      try {
        await axios.post(url, {
          chat_id: groupChatId.trim(),
          text: message,
        });
      } catch (error) {
        const responseData = error.response?.data;
        const newChatId = responseData?.parameters?.migrate_to_chat_id;

        if (newChatId) {
          console.log(`⚠️ Group upgraded to supergroup. Attempting retry with new chat_id: ${newChatId}`);
          try {
            await axios.post(url, {
              chat_id: String(newChatId).trim(),
              text: message,
            });
            console.log(`✅ Message sent to new supergroup ID: ${newChatId}. Please update TELEGRAM_GROUP_CHAT_ID=${newChatId} in server .env`);
            return;
          } catch (retryError) {
            throw new Error(`Group upgraded to supergroup! Please update server/.env: TELEGRAM_GROUP_CHAT_ID=${newChatId}`);
          }
        }

        const errMsg = responseData?.description || error.message || "Failed to send message";
        console.error("❌ Failed to send Telegram message:", errMsg);
        throw new Error(`Telegram API Error: ${errMsg}`);
      }
    };

    // ─── Daily Telegram Report (Bangladesh Time: 8 AM, 3 PM, 10 PM) ──────────
    const sendDailyReport = async () => {
      const bstTime = new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Dhaka',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      const [pending, accepted, unreadMsg] = await Promise.all([
        applicationCollection.countDocuments({
          $or: [
            { reg_status: "under_review" },
            { reg_status: "pending" },
            { reg_status: { $exists: false } },
          ],
        }),
        applicationCollection.countDocuments({
          reg_status: { $regex: /^accepted$/i },
        }),
        contactMessagesCollection.countDocuments({ isRead: { $ne: true } }),
      ]);

      const report =
        `📊 অংকুর — দৈনিক রিপোর্ট\n` +
        `🕐 সময়: ${bstTime} (BST)\n` +
        `────────────────────\n\n` +
        `📋 Pending Now:    ${pending}\n` +
        `✅ Accepted Registrations :   ${accepted}\n` +
        `📩 Unread Message: ${unreadMsg}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `— অংকুর অটোমেশন সিস্টেম`;

      await sendTelegramMessage(report);
    };

    // ⚠️ node-cron schedules removed — external cron service (cron-job.org) handles scheduling.
    // node-cron does NOT work reliably on Vercel serverless. Use /api/cron/daily-report endpoint instead.

    // Endpoint to manually trigger report anytime
    app.get('/admin/trigger-report', verifyToken, verifyAdmin, async (req, res) => {
      try {
        await sendDailyReport();
        res.send({ success: true, message: "Daily report triggered to Telegram." });
      } catch (err) {
        res.status(500).send({ success: false, message: err.message });
      }
    });

    // ─── External Cron Service Endpoint ──────────────────────────────────────
    // Supports GET & POST (cron-job.org, cron-job.io, EasyCron, UptimeRobot, etc.)
    // Auth: Authorization: Bearer <CRON_SECRET>  OR  ?secret=<CRON_SECRET>
    const handleCronRequest = async (req, res) => {
      const cronSecret = process.env.CRON_SECRET;

      if (!cronSecret) {
        return res.status(503).json({ success: false, message: "CRON_SECRET not set" });
      }

      const authHeader = req.headers['authorization'];
      const querySecret = req.query.secret;

      const headerValid = authHeader === `Bearer ${cronSecret}`;
      const queryValid = querySecret === cronSecret;

      if (!headerValid && !queryValid) {
        console.warn(`⛔ Unauthorized cron attempt — IP: ${req.ip}`);
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const triggeredAt = new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Dhaka',
        hour12: true
      });
      console.log(`🕐 Cron triggered at ${triggeredAt}`);

      try {
        await sendDailyReport();
        return res.json({ success: true, message: "Daily report sent.", triggeredAt });
      } catch (err) {
        console.error("❌ Cron failed:", err.message);
        return res.status(500).json({ success: false, message: err.message });
      }
    };

    app.get('/api/cron/daily-report', handleCronRequest);
    app.post('/api/cron/daily-report', handleCronRequest);
    // ─────────────────────────────────────────────────────────────────────────

    // Notice APIs
    // =============================================

    // GET /notices — public, returns all active notices
    app.get('/notices', async (req, res) => {
      try {
        const result = await noticesCollection.find({ isActive: true }).sort({ createdAt: -1 }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch notices" });
      }
    });



    // GET /admin/notices — admin only, returns all notices
    app.get('/admin/notices', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await noticesCollection.find().sort({ createdAt: -1 }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch all notices" });
      }
    });

    // POST /notices — admin only, create a notice
    app.post('/notices', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { text, link, isActive } = req.body;
        const newNotice = {
          text,
          link: link || "",
          isActive: isActive !== undefined ? Boolean(isActive) : true,
          createdAt: new Date()
        };
        const result = await noticesCollection.insertOne(newNotice);
        res.send({ success: true, insertedId: result.insertedId, notice: newNotice });
      } catch (error) {
        res.status(500).send({ message: "Failed to create notice" });
      }
    });

    // PUT /notices/:id — admin only, update a notice
    app.put('/notices/:id', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const { text, link, isActive } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            text,
            link: link || "",
            isActive: Boolean(isActive),
            updatedAt: new Date()
          }
        };
        const result = await noticesCollection.updateOne(filter, updateDoc);
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).send({ message: "Failed to update notice" });
      }
    });

    // DELETE /notices/:id — admin only, delete a notice
    app.delete('/notices/:id', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const result = await noticesCollection.deleteOne(filter);
        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete notice" });
      }
    });

    // =============================================
    // Contact Submission APIs
    // =============================================

    // POST /contact — public, submit message
    app.post('/contact', async (req, res) => {
      try {
        const { name, email, whatsapp, topic, message } = req.body;
        if (!name || !email || !message) {
          return res.status(400).send({ message: "Name, email, and message are required fields" });
        }
        const newMessage = {
          name,
          email,
          whatsapp: whatsapp || "",
          topic: topic || "",
          message,
          submittedAt: new Date()
        };
        const result = await contactMessagesCollection.insertOne(newMessage);

        // Send Telegram notification
        const telegramText =
          `📩 নতুন বার্তা এসেছে!\n` +
          `👤 নাম: ${name}\n` +
          `📱 WhatsApp: ${whatsapp || "দেওয়া হয়নি"}\n` +
          `📧 Email: ${email}\n` +
          `📌 বিষয়: ${topic || "উল্লেখ নেই"}\n` +
          `💬 বার্তা: ${message}`;
        try {
          await sendTelegramMessage(telegramText);
        } catch (tgErr) {
          console.error("❌ Telegram notification failed:", tgErr.message);
        }

        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ message: "Failed to send message" });
      }
    });

    // GET /contacts — admin only, list all contact submissions
    app.get('/contacts', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await contactMessagesCollection.find().sort({ submittedAt: -1 }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch contact submissions" });
      }
    });

    // DELETE /contacts/:id — admin only, delete message
    app.delete('/contacts/:id', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const result = await contactMessagesCollection.deleteOne(filter);
        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete contact submission" });
      }
    });

    // PATCH /contacts/:id/read — admin only, mark message as read
    app.patch('/contacts/:id/read', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const result = await contactMessagesCollection.updateOne(filter, {
          $set: { isRead: true, readAt: new Date() }
        });
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).send({ message: "Failed to mark message as read" });
      }
    });

    // GET /contacts/unread-count — admin only, returns count of unread messages
    app.get('/contacts/unread-count', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const count = await contactMessagesCollection.countDocuments({ isRead: { $ne: true } });
        res.send({ count });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch unread count" });
      }
    });


    // =============================================
    // ============================================
    // Settings APIs
    // =============================================

    // GET /settings — public, returns registration state + timer
    app.get('/settings', async (req, res) => {
      try {
        const settings = await getSettings();
        const { registrationEnabled, enrollmentTimerStart, enrollmentTimerEnd } = settings;
        res.send({ registrationEnabled, enrollmentTimerStart, enrollmentTimerEnd });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch settings" });
      }
    });

    // PATCH /settings/registration — admin only, toggle registration on/off
    app.patch('/settings/registration', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { registrationEnabled } = req.body;
        await settingsCollection.updateOne(
          {},
          { $set: { registrationEnabled: Boolean(registrationEnabled) } },
          { upsert: true }
        );
        res.send({ success: true, registrationEnabled: Boolean(registrationEnabled) });
      } catch (error) {
        res.status(500).send({ message: "Failed to update registration status" });
      }
    });

    // PATCH /settings/timer — admin only, set enrollment timer
    app.patch('/settings/timer', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { enrollmentTimerStart, enrollmentTimerEnd } = req.body;
        await settingsCollection.updateOne(
          {},
          { $set: { enrollmentTimerStart, enrollmentTimerEnd } },
          { upsert: true }
        );
        res.send({ success: true, enrollmentTimerStart, enrollmentTimerEnd });
      } catch (error) {
        res.status(500).send({ message: "Failed to update timer" });
      }
    });

    // GET /settings/syllabus — public, returns syllabus array
    app.get('/settings/syllabus', async (req, res) => {
      try {
        const settings = await getSettings();
        res.send({ syllabus: settings.syllabus || [] });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch syllabus" });
      }
    });

    // PUT /settings/syllabus — admin only, replace entire syllabus array
    app.put('/settings/syllabus', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { syllabus } = req.body;
        await settingsCollection.updateOne(
          {},
          { $set: { syllabus } },
          { upsert: true }
        );
        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ message: "Failed to update syllabus" });
      }
    });

    // PATCH /settings/syllabus/:index — admin only, update single class entry
    app.patch('/settings/syllabus/:index', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const idx = parseInt(req.params.index);
        const updatedEntry = req.body;
        const settings = await getSettings();
        const syllabus = settings.syllabus || [];
        if (idx < 0 || idx >= syllabus.length) {
          return res.status(400).send({ message: "Invalid syllabus index" });
        }
        syllabus[idx] = { ...syllabus[idx], ...updatedEntry };
        await settingsCollection.updateOne(
          {},
          { $set: { syllabus } },
          { upsert: true }
        );
        res.send({ success: true, entry: syllabus[idx] });
      } catch (error) {
        res.status(500).send({ message: "Failed to update syllabus entry" });
      }
    });

    // GET /applications/check-txn/:txnId — check if Txn ID is already used
    app.get('/applications/check-txn/:txnId', async (req, res) => {
      try {
        const txnId = req.params.txnId?.trim();
        if (!txnId) {
          return res.send({ exists: false });
        }
        // Escaping special characters for safety in regex
        const escapedTxnId = txnId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const existingApp = await applicationCollection.findOne({
          transaction_Id: { $regex: new RegExp(`^${escapedTxnId}$`, "i") }
        });
        if (existingApp) {
          return res.send({
            exists: true,
            message: "এই ট্রানজেকশন আইডি (Transaction ID) টি ইতোমধ্যে একজন আবেদনকারী ব্যবহার করেছেন। প্রতিটি ট্রানজেকশন আইডি কেবল একবার ব্যবহার করা যাবে।"
          });
        }
        res.send({ exists: false });
      } catch (err) {
        console.error("Error checking transaction ID:", err);
        res.status(500).send({ message: "Server error checking Transaction ID" });
      }
    });

    // Online registration limiter - max 10 submissions per IP per hour to prevent bot spam and SMS balance exhaustion
    const onlineRegistrationLimiter = rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        success: false,
        message: "একটি নির্দিষ্ট আইপি থেকে অতিরিক্ত আবেদন করা হয়েছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।"
      }
    });

    app.post('/applications', onlineRegistrationLimiter, async (req, res) => {
      // ✅ Guard: Check if registration is currently open
      try {
        const settings = await getSettings();
        const now = new Date();
        const timerEnd = settings.enrollmentTimerEnd ? new Date(settings.enrollmentTimerEnd) : null;
        const timerExpired = timerEnd && now > timerEnd;

        if (!settings.registrationEnabled || timerExpired) {
          return res.status(403).send({ message: "Registration is currently closed" });
        }
      } catch (err) {
        return res.status(500).send({ message: "Server error checking settings" });
      }

      const application = { ...(req.body || {}) };

      // Prevent mass-assignment / privilege escalation from untrusted client
      delete application._id;
      delete application.reg_status;
      delete application.exam_roll;
      delete application.admit_sms;
      delete application.admit_downloaded;
      delete application.allocated_venue;
      delete application.offline_serial;
      delete application.paper_serial_no;
      delete application.created_by;
      delete application.admin_note;
      delete application.office_note;

      // Enforce immutable server values for online submissions
      application.registration_type = "online";
      application.reg_status = "under_review";
      application.submittedAt = new Date().toISOString();

      // ✅ Guard: Duplicate Transaction ID check
      if (application.transaction_Id) {
        const txnId = String(application.transaction_Id).trim();
        const escapedTxnId = txnId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const existingTxn = await applicationCollection.findOne({
          transaction_Id: { $regex: new RegExp(`^${escapedTxnId}$`, "i") }
        });
        if (existingTxn) {
          return res.status(400).send({
            message: "এই ট্রানজেকশন আইডি (Transaction ID) টি ইতোমধ্যে একজন আবেদনকারী ব্যবহার করেছেন।"
          });
        }
      }

      const result = await applicationCollection.insertOne(application);

      if (result.acknowledged && result.insertedId) {
        const phone = application?.phone_number?.trim() || "";
        const name = application?.name_en?.trim() || "";
        const lastName = formatLastName(name);
        const bkash = application?.bkash_number || "";
        const tnxId = application?.transaction_Id || "";
        const syllabusLink = "aunkurctgnorth.org/syllabus";

        const message = `Dear ${lastName}, your registration is received! You'll get confirmation within 24 hrs. Syllabus: ${syllabusLink}.\nAunkur'26`;

        try {
          await sendBulkSMS([phone], message);
        } catch (smsError) {
          console.error("❌ Failed to send SMS:", smsError.message);
        }

        const telegramText = `📥 New Registration\n👤 Name: ${name}\n📱 Phone: ${phone}\n💳 Bkash: ${bkash}\n🧾 Txn ID: ${tnxId}`;

        try {
          await sendTelegramMessage(telegramText);
        } catch (error) {
          console.error("failed to send admin sms", error.message);
        }

        // ✅ Meta Conversions API (CAPI) Server-side event
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
        const userAgent = req.headers['user-agent'];
        const eventId = application.event_id || (tnxId ? `reg_${tnxId.trim().toUpperCase()}` : `reg_${Date.now()}`);

        try {
          await sendMetaCapiEvent({
            eventName: "CompleteRegistration",
            eventId: eventId,
            userData: {
              name,
              phone,
              clientIp,
              userAgent,
            },
            customData: {
              transaction_Id: tnxId,
              bkash_number: bkash,
            },
          });
        } catch (capiError) {
          console.error("❌ Failed to send Meta CAPI event:", capiError.message);
        }
      }

      res.send(result);
    });

    // POST /applications/offline - for Coordinator and Admin entries
    app.post('/applications/offline', verifyToken, verifyCoordinatorOrAdmin, async (req, res) => {
      try {
        const body = req.body || {};
        // The form now records thana (branch) and ward (sub_branch) instead of the old reference zone
        const branch = typeof body.branch === "string" ? body.branch.trim() : "";
        const subBranch = typeof body.sub_branch === "string" ? body.sub_branch.trim() : "";
        if (!branch || !subBranch) {
          return res.status(400).json({
            success: false,
            message: "থানা ও ওয়ার্ড নির্বাচন করা আবশ্যক (Thana and ward are required)."
          });
        }
        body.branch = branch;
        body.sub_branch = subBranch;
        const currentUser = req.user;
        const examCenter = (body.exam_center || "chawkbazar").toLowerCase().trim();

        // Atomic sequential serial number per exam center (100% collision-free)
        const nextSerial = await getNextOfflineSerial(examCenter);
        const formNumber = `OFF-26-${nextSerial}`;

        const offlineApplication = {
          ...body,
          registration_type: "offline",
          payment_status: "paid",
          reg_status: "under_review",
          offline_serial: nextSerial,
          paper_serial_no: nextSerial,
          form_number: formNumber,
          bkash_number: null,
          transaction_Id: null,
          created_by: {
            user_id: currentUser?._id ? currentUser._id.toString() : null,
            name: currentUser?.name || currentUser?.displayName || req.decoded?.name || "Coordinator",
            email: req.decoded?.email,
            role: currentUser?.role || "coordinator",
            timestamp: new Date().toISOString()
          },
          submittedAt: new Date().toISOString()
        };

        const result = await applicationCollection.insertOne(offlineApplication);

        if (result.acknowledged && result.insertedId) {
          const phone = offlineApplication?.phone_number?.trim() || "";
          const name = offlineApplication?.name_en?.trim() || "";
          const school = offlineApplication?.school_name?.trim() || "";
          const creatorName = currentUser?.name || req.decoded?.email;

          // Send Telegram notification to admins
          const thanaWard = `${offlineApplication.branch} / ${offlineApplication.sub_branch}`;
          const telegramText = `📥 New Registration [OFFLINE]\n📋 Form No: ${formNumber}\n🔢 Paper Serial: ${nextSerial}\n👤 Name: ${name}\n📱 Phone: ${phone}\n🏫 School: ${school}\n🏛️ Thana/Ward: ${thanaWard}\n✍️ Entered by: ${creatorName}`;
          try {
            await sendTelegramMessage(telegramText);
          } catch (error) {
            console.error("Failed to send admin telegram message", error.message);
          }

          return res.send({
            success: true,
            insertedId: result.insertedId,
            form_number: formNumber,
            offline_serial: nextSerial, // the entry form reads this to show the serial
            paper_serial_no: nextSerial,
            data: offlineApplication
          });
        }

        res.status(500).send({ message: "Failed to record offline registration" });
      } catch (err) {
        console.error("Error creating offline registration:", err);
        res.status(500).send({ message: err.message || "Internal server error" });
      }
    });

    // PATCH /applications/batch-accept - Admin batch approval for applications (offline cash batches or online)
    app.patch('/applications/batch-accept', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
          return res.status(400).send({ message: "No application IDs provided" });
        }
        const objectIds = ids.map(id => new ObjectId(id));
        const result = await applicationCollection.updateMany(
          { _id: { $in: objectIds } },
          { $set: { reg_status: "accepted", acceptedAt: new Date().toISOString() } }
        );

        // Fetch numbers to send batch SMS
        try {
          const acceptedApps = await applicationCollection
            .find({ _id: { $in: objectIds } })
            .project({ phone_number: 1, name_en: 1 })
            .toArray();

          const smsPromises = acceptedApps
            .filter(a => a.phone_number && /^01[0-9]{9}$/.test(a.phone_number.trim()))
            .map(a => {
              const phone = a.phone_number.trim();
              const lastName = formatLastName(a.name_en);
              const smsMessage = `Dear ${lastName}, your Aunkur Scholarship'26 application has been accepted!\n\n- Aunkur Scholarship Project'26`;
              return sendBulkSMS([phone], smsMessage);
            });

          if (smsPromises.length > 0) {
            await Promise.allSettled(smsPromises);
          }
        } catch (smsError) {
          console.error("Batch SMS notification failed:", smsError.message);
        }

        res.send(result);
      } catch (err) {
        console.error("Batch accept error:", err);
        res.status(500).send({ message: "Failed to batch accept" });
      }
    });

    const ALLOWED_REG_STATUSES = ["under_review", "accepted", "rejected"];

    app.patch('/applications/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body || {};

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid application ID" });
      }
      if (!ALLOWED_REG_STATUSES.includes(status)) {
        return res.status(400).send({ message: `Status must be one of: ${ALLOWED_REG_STATUSES.join(", ")}` });
      }

      const filter = { _id: new ObjectId(id) };
      const now = new Date().toISOString();
      const updateFields = {
        reg_status: status,
        statusUpdatedAt: now,
        statusUpdatedBy: req.decoded?.email || null,
      };
      if (status === "accepted") {
        updateFields.acceptedAt = now; // matches batch-accept
      }

      // Only touch the record when the status actually changes, so repeat clicks don't re-send SMS
      const result = await applicationCollection.updateOne(
        { ...filter, reg_status: { $ne: status } },
        { $set: updateFields }
      );

      if (result.matchedCount === 0) {
        const exists = await applicationCollection.countDocuments(filter, { limit: 1 });
        if (!exists) {
          return res.status(404).send({ message: "Application not found" });
        }
      }

      // SMS only for a final decision — moving back to under_review notifies nobody
      if (result.modifiedCount > 0 && (status === "accepted" || status === "rejected")) {
        const application = await applicationCollection.findOne(filter, { projection: { phone_number: 1, name_en: 1, registration_type: 1 } });
        const phone = application?.phone_number?.trim() || "";
        const lastName = formatLastName(application?.name_en);

        // Offline entries are verified in person when the paper form and cash are taken,
        // so a rejection is an internal correction — texting the family would only confuse them
        const isOfflineRejection = status === "rejected" && application?.registration_type === "offline";

        if (isOfflineRejection) {
          console.log(`ℹ️ Skipped rejection SMS for offline application ${id}`);
        } else if (/^01[0-9]{9}$/.test(phone)) {
          const message = status === "accepted"
            ? `Dear ${lastName}, your Aunkur Scholarship'26 application has been accepted!\n\n- Aunkur Scholarship Project'26`
            : `Dear ${lastName}, your Aunkur Scholarship'26 application was not accepted. If you have made a payment, please contact +8801879891623`;
          try {
            await sendBulkSMS([phone], message);
          } catch (smsError) {
            console.error("❌ Failed to send SMS:", smsError.message);
          }
        } else {
          console.warn(`⚠️ Skipped status SMS for application ${id}: invalid phone number`);
        }
      }

      res.send(result);
    });


    app.delete('/applications/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid application ID" });
      }
      const filter = { _id: new ObjectId(id) };
      const result = await applicationCollection.deleteOne(filter);
      if (result.deletedCount === 0) {
        return res.status(404).send({ message: "Application not found" });
      }
      res.send(result);
    });

    // ─── Offline entry deletion requests ─────────────────────────────────────
    // Coordinators cannot delete; they ask an admin, who deletes or dismisses the request.

    // POST — the coordinator who created the entry requests its deletion
    app.post('/applications/:id/delete-request', verifyToken, verifyCoordinatorOrAdmin, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid application ID" });
      }
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) {
        return res.status(400).send({ message: "মুছে ফেলার কারণ লিখুন (A reason is required)." });
      }
      if (reason.length > 500) {
        return res.status(400).send({ message: "কারণটি ৫০০ অক্ষরের মধ্যে লিখুন (Reason must be under 500 characters)." });
      }

      const filter = { _id: new ObjectId(id) };
      const application = await applicationCollection.findOne(filter, {
        projection: { registration_type: 1, created_by: 1, delete_request: 1, name_en: 1, form_number: 1, paper_serial_no: 1 },
      });
      if (!application) {
        return res.status(404).send({ message: "Application not found" });
      }

      const requesterEmail = req.decoded?.email?.toLowerCase();
      const isOwner = application.created_by?.email?.toLowerCase() === requesterEmail;
      if (application.registration_type !== "offline" || !isOwner) {
        return res.status(403).send({ message: "আপনি শুধু নিজের অফলাইন এন্ট্রির জন্য অনুরোধ করতে পারবেন।" });
      }
      if (application.delete_request?.status === "pending") {
        return res.status(409).send({ message: "এই এন্ট্রির জন্য ইতোমধ্যে একটি অনুরোধ অপেক্ষমাণ আছে।" });
      }

      const deleteRequest = {
        status: "pending",
        reason,
        requested_by: {
          email: requesterEmail,
          name: req.user?.name || requesterEmail,
        },
        requestedAt: new Date().toISOString(),
      };
      const result = await applicationCollection.updateOne(filter, { $set: { delete_request: deleteRequest } });

      const telegramText =
        `🗑️ Delete Request [OFFLINE]\n` +
        `📋 Form No: ${application.form_number || application.paper_serial_no || "N/A"}\n` +
        `👤 Name: ${application.name_en || "N/A"}\n` +
        `✍️ Requested by: ${deleteRequest.requested_by.name}\n` +
        `💬 Reason: ${reason}`;
      try {
        await sendTelegramMessage(telegramText);
      } catch (error) {
        console.error("Failed to send delete-request telegram message", error.message);
      }

      res.send({ success: true, modifiedCount: result.modifiedCount, delete_request: deleteRequest });
    });

    // DELETE — admin dismisses a pending request (the entry is kept)
    app.delete('/applications/:id/delete-request', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid application ID" });
      }
      const result = await applicationCollection.updateOne(
        { _id: new ObjectId(id), "delete_request.status": "pending" },
        {
          $set: {
            "delete_request.status": "dismissed",
            "delete_request.resolvedBy": req.decoded?.email || null,
            "delete_request.resolvedAt": new Date().toISOString(),
          },
        }
      );
      if (result.matchedCount === 0) {
        return res.status(404).send({ message: "No pending delete request for this application" });
      }
      res.send({ success: true, modifiedCount: result.modifiedCount });
    });

    // ─── Offline Entry Edit & Correction System ─────────────────────────────
    // Admin directly edits; coordinators submit an edit request that an admin must approve.

    // 1. PATCH — Admin directly edits any field of an offline registration
    app.patch('/applications/:id/offline-direct-edit', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid application ID" });
        }

        const filter = { _id: new ObjectId(id) };
        const existing = await applicationCollection.findOne(filter);
        if (!existing) {
          return res.status(404).send({ message: "Application not found" });
        }

        const allowedFields = [
          "name_en", "name_bn", "phone_number", "whatsapp_number", "student_class",
          "school_name", "branch", "sub_branch", "exam_center", "gender",
          "father_name", "father_occupation", "mother_name", "mother_occupation",
          "present_area", "present_thana", "present_zilla",
          "permanent_area", "permanent_thana", "permanent_zilla",
          "form_number", "paper_serial_no", "note"
        ];

        const updates = {};
        for (const field of allowedFields) {
          if (req.body[field] !== undefined) {
            updates[field] = req.body[field];
          }
        }

        updates.last_edited_by = {
          email: req.decoded?.email || null,
          name: req.user?.name || req.decoded?.email || "Admin",
          editedAt: new Date().toISOString(),
        };

        // If there was an active pending edit request, automatically mark it approved/applied
        if (existing.edit_request?.status === "pending") {
          updates["edit_request.status"] = "approved";
          updates["edit_request.resolved_by"] = {
            email: req.decoded?.email || null,
            name: req.user?.name || req.decoded?.email || "Admin",
          };
          updates["edit_request.resolvedAt"] = new Date().toISOString();
        }

        const result = await applicationCollection.updateOne(filter, { $set: updates });
        const updatedDoc = await applicationCollection.findOne(filter);
        res.send({ success: true, modifiedCount: result.modifiedCount, data: updatedDoc });
      } catch (err) {
        console.error("Direct edit error:", err);
        res.status(500).send({ message: "Failed to update registration" });
      }
    });

    // 2. POST — Coordinator submits an edit/correction request
    app.post('/applications/:id/edit-request', verifyToken, verifyCoordinatorOrAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid application ID" });
        }

        const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
        if (!reason) {
          return res.status(400).send({ message: "সংশোধনের কারণ লিখুন (A reason for edit is required)." });
        }
        if (reason.length > 500) {
          return res.status(400).send({ message: "কারণটি ৫০০ অক্ষরের মধ্যে লিখুন (Reason must be under 500 characters)." });
        }

        const filter = { _id: new ObjectId(id) };
        const application = await applicationCollection.findOne(filter);
        if (!application) {
          return res.status(404).send({ message: "Application not found" });
        }

        const requesterEmail = req.decoded?.email?.toLowerCase();
        const isAdmin = req.user?.role === "admin";
        const isOwner = application.created_by?.email?.toLowerCase() === requesterEmail;

        if (!isAdmin && !isOwner) {
          return res.status(403).send({ message: "আপনি শুধু নিজের অফলাইন এন্ট্রির জন্য সংশোধনের অনুরোধ করতে পারবেন।" });
        }

        if (application.edit_request?.status === "pending") {
          return res.status(409).send({ message: "এই এন্ট্রির জন্য ইতোমধ্যে একটি সংশোধনের অনুরোধ অপেক্ষমাণ আছে।" });
        }

        const allowedFields = [
          "name_en", "name_bn", "phone_number", "whatsapp_number", "student_class",
          "school_name", "branch", "sub_branch", "exam_center", "gender",
          "father_name", "father_occupation", "mother_name", "mother_occupation",
          "present_area", "present_thana", "present_zilla",
          "permanent_area", "permanent_thana", "permanent_zilla",
          "form_number", "paper_serial_no", "note"
        ];

        const proposed_data = {};
        for (const field of allowedFields) {
          if (req.body?.proposed_data && req.body.proposed_data[field] !== undefined) {
            proposed_data[field] = req.body.proposed_data[field];
          }
        }

        const editRequest = {
          status: "pending",
          reason,
          requested_by: {
            email: requesterEmail,
            name: req.user?.name || requesterEmail,
          },
          requestedAt: new Date().toISOString(),
          proposed_data,
        };

        const result = await applicationCollection.updateOne(filter, { $set: { edit_request: editRequest } });

        // Telegram Notification for Admins
        const telegramText =
          `✏️ Edit Request [OFFLINE]\n` +
          `📋 Form No: ${application.form_number || application.paper_serial_no || application.offline_serial || "N/A"}\n` +
          `👤 Student: ${application.name_en || "N/A"} (${application.name_bn || ""})\n` +
          `✍️ Requested by: ${editRequest.requested_by.name}\n` +
          `💬 Reason: ${reason}`;
        try {
          await sendTelegramMessage(telegramText);
        } catch (error) {
          console.error("Failed to send edit-request telegram message:", error.message);
        }

        res.send({ success: true, modifiedCount: result.modifiedCount, edit_request: editRequest });
      } catch (err) {
        console.error("Edit request error:", err);
        res.status(500).send({ message: "Failed to submit edit request" });
      }
    });

    // 3. PATCH — Admin approves and applies the pending edit request
    app.patch('/applications/:id/edit-request/approve', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid application ID" });
        }

        const filter = { _id: new ObjectId(id) };
        const application = await applicationCollection.findOne(filter);
        if (!application) {
          return res.status(404).send({ message: "Application not found" });
        }

        if (application.edit_request?.status !== "pending") {
          return res.status(400).send({ message: "কোনো অপেক্ষমাণ সংশোধনের অনুরোধ নেই।" });
        }

        const proposed = application.edit_request.proposed_data || {};
        const updateFields = { ...proposed };

        updateFields["edit_request.status"] = "approved";
        updateFields["edit_request.resolved_by"] = {
          email: req.decoded?.email || null,
          name: req.user?.name || req.decoded?.email || "Admin",
        };
        updateFields["edit_request.resolvedAt"] = new Date().toISOString();
        updateFields.last_edited_by = {
          email: req.decoded?.email || null,
          name: req.user?.name || req.decoded?.email || "Admin",
          editedAt: new Date().toISOString(),
        };

        const result = await applicationCollection.updateOne(filter, { $set: updateFields });
        const updatedDoc = await applicationCollection.findOne(filter);
        res.send({ success: true, modifiedCount: result.modifiedCount, data: updatedDoc });
      } catch (err) {
        console.error("Approve edit request error:", err);
        res.status(500).send({ message: "Failed to approve edit request" });
      }
    });

    // 4. PATCH — Admin rejects/dismisses the pending edit request
    app.patch('/applications/:id/edit-request/reject', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid application ID" });
        }

        const filter = { _id: new ObjectId(id) };
        const application = await applicationCollection.findOne(filter);
        if (!application) {
          return res.status(404).send({ message: "Application not found" });
        }

        if (application.edit_request?.status !== "pending") {
          return res.status(400).send({ message: "কোনো অপেক্ষমাণ সংশোধনের অনুরোধ নেই।" });
        }

        const updateFields = {
          "edit_request.status": "rejected",
          "edit_request.resolved_by": {
            email: req.decoded?.email || null,
            name: req.user?.name || req.decoded?.email || "Admin",
          },
          "edit_request.resolvedAt": new Date().toISOString(),
          "edit_request.admin_note": req.body?.admin_note || "অনুরোধটি বাতিল করা হয়েছে",
        };

        const result = await applicationCollection.updateOne(filter, { $set: updateFields });
        const updatedDoc = await applicationCollection.findOne(filter);
        res.send({ success: true, modifiedCount: result.modifiedCount, data: updatedDoc });
      } catch (err) {
        console.error("Reject edit request error:", err);
        res.status(500).send({ message: "Failed to reject edit request" });
      }
    });

    // ========================================================
    // EXAM ROLL MANAGEMENT CONSTANTS & ENGINE
    // ========================================================
    const EXAM_YEAR = "26"; // 2026

    const EXAM_CENTERS = [
      { key: "chawkbazar", code: "1", label_en: "Chawkbazar", label_bn: "চকবাজার" },
      { key: "chandgaon", code: "2", label_en: "Chandgaon", label_bn: "চাঁদগাঁও" },
      { key: "kotwali", code: "3", label_en: "Kotwali", label_bn: "কোতোয়ালী" },
      { key: "nasirabad", code: "4", label_en: "Nasirabad", label_bn: "নাসিরাবাদ" },
      { key: "bayezid", code: "5", label_en: "Bayezid", label_bn: "বায়েজিদ" },
    ];

    const EXAM_CLASSES = [
      { key: "four", code: "4", label_en: "Class 4", label_bn: "চতুর্থ শ্রেণি" },
      { key: "five", code: "5", label_en: "Class 5", label_bn: "পঞ্চম শ্রেণি" },
      { key: "six", code: "6", label_en: "Class 6", label_bn: "ষষ্ঠ শ্রেণি" },
      { key: "seven", code: "7", label_en: "Class 7", label_bn: "সপ্তম শ্রেণি" },
      { key: "eight", code: "8", label_en: "Class 8", label_bn: "অষ্টম শ্রেণি" },
      { key: "nine", code: "9", label_en: "Class 9", label_bn: "নবম শ্রেণি" },
      { key: "ten", code: "0", label_en: "Class 10", label_bn: "দশম শ্রেণি" },
    ];

    const EXAM_GENDERS = [
      { key: "male", code: "1", label_en: "Boy", label_bn: "ছাত্র" },
      { key: "female", code: "2", label_en: "Girl", label_bn: "ছাত্রী" },
    ];

    const CENTER_LOOKUP = Object.fromEntries(EXAM_CENTERS.map((c) => [c.key, c]));
    const CLASS_LOOKUP = Object.fromEntries(
      EXAM_CLASSES.flatMap((k) => [
        [k.key, k],
        [k.code, k],
        [k.code === "0" ? "10" : k.code, k],
      ])
    );
    const GENDER_LOOKUP = {
      male: EXAM_GENDERS[0],
      boy: EXAM_GENDERS[0],
      female: EXAM_GENDERS[1],
      girl: EXAM_GENDERS[1],
    };

    const resolveCandidateBucket = (app) => {
      const centerRaw = (app.exam_center || "chawkbazar").toString().trim().toLowerCase();
      const center = CENTER_LOOKUP[centerRaw] || EXAM_CENTERS[0];

      const classRaw = (app.student_class || "eight").toString().trim().toLowerCase();
      const studentClass = CLASS_LOOKUP[classRaw] || EXAM_CLASSES[4]; // default 8

      const genderRaw = (app.gender || "male").toString().trim().toLowerCase();
      const gender = GENDER_LOOKUP[genderRaw] || EXAM_GENDERS[0]; // default boy

      const bucketKey = `${center.code}_${studentClass.code}_${gender.code}`;
      return { center, studentClass, gender, bucketKey };
    };

    const resolveCandidateVenue = (cand, allocations = {}) => {
      const { center: matchedCenter } = resolveCandidateBucket(cand);
      const centerData = allocations[matchedCenter.key] || {};
      const venues = Array.isArray(centerData.venues) ? centerData.venues : [];

      if (venues.length === 0) {
        return {
          name_bn: `${matchedCenter.label_bn} কেন্দ্র`,
          name_en: `${matchedCenter.label_en} Center`,
          address_bn: `${matchedCenter.label_bn}, চট্টগ্রাম`,
          address_en: `${matchedCenter.label_en}, Chattogram`,
        };
      }

      if (venues.length === 1) {
        const v = venues[0];
        return {
          name_bn: v.name_bn || `${matchedCenter.label_bn} কেন্দ্র`,
          name_en: v.name_en || `${matchedCenter.label_en} Center`,
          address_bn: v.address_bn || `${matchedCenter.label_bn}, চট্টগ্রাম`,
          address_en: v.address_en || `${matchedCenter.label_en}, Chattogram`,
        };
      }

      const rollStr = String(cand.exam_roll || "");
      const serialPart = parseInt(rollStr.slice(-3), 10) || 1;
      let running = 0;
      for (const v of venues) {
        const cap = parseInt(v.capacity, 10) || 0;
        if (serialPart <= running + cap || v === venues[venues.length - 1]) {
          return {
            name_bn: v.name_bn || `${matchedCenter.label_bn} কেন্দ্র`,
            name_en: v.name_en || `${matchedCenter.label_en} Center`,
            address_bn: v.address_bn || `${matchedCenter.label_bn}, চট্টগ্রাম`,
            address_en: v.address_en || `${matchedCenter.label_en}, Chattogram`,
          };
        }
        running += cap;
      }
      return venues[0];
    };

    const formatClassNumber = (cls) => {
      const map = {
        four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
        "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9", "10": "10"
      };
      return map[String(cls || "").toLowerCase()] || cls || "8";
    };

    const formatSmsMessage = (template, cand) => {
      const lastName = formatLastName(cand.name_en || cand.name_bn || "Candidate");
      const fullName = (cand.name_en || cand.name_bn || "Candidate").trim();
      const roll = cand.exam_roll || "";
      const cls = formatClassNumber(cand.student_class);
      const link = "aunkurctgnorth.org/admitcard";
      const tmpl = template || "Dear {name}, your Aunkur Exam Roll is {roll} (Class {class}). Download Admit Card: {link} - Aunkur'26";
      return tmpl
        .replace(/{last_name}/g, lastName)
        .replace(/{name}/g, lastName)
        .replace(/{full_name}/g, fullName)
        .replace(/{roll}/g, roll)
        .replace(/{class}/g, cls)
        .replace(/{link}/g, link);
    };

    // 1. GET /admin/exam-rolls/summary - Bucket matrix and overall roll stats
    app.get('/admin/exam-rolls/summary', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const settings = await settingsCollection.findOne({}) || {};
        const acceptedApps = await applicationCollection
          .find({ reg_status: "accepted" })
          .project({
            _id: 1,
            name_en: 1,
            exam_center: 1,
            student_class: 1,
            gender: 1,
            exam_roll: 1,
            exam_roll_bucket: 1,
            admit_card: 1,
            admit_downloaded: 1,
          })
          .toArray();

        // Initialize 70 standard buckets
        const bucketMap = {};
        for (const center of EXAM_CENTERS) {
          for (const studentClass of EXAM_CLASSES) {
            for (const gender of EXAM_GENDERS) {
              const bucketKey = `${center.code}_${studentClass.code}_${gender.code}`;
              bucketMap[bucketKey] = {
                bucketKey,
                centerKey: center.key,
                centerCode: center.code,
                centerLabelBn: center.label_bn,
                centerLabelEn: center.label_en,
                classKey: studentClass.key,
                classCode: studentClass.code,
                classLabelBn: studentClass.label_bn,
                classLabelEn: studentClass.label_en,
                genderKey: gender.key,
                genderCode: gender.code,
                genderLabelBn: gender.label_bn,
                genderLabelEn: gender.label_en,
                totalAccepted: 0,
                rollsAssigned: 0,
                rollsPending: 0,
                smsSent: 0,
                smsPending: 0,
                smsFailed: 0,
                admitDownloaded: 0,
                downloadPending: 0,
                maxRoll: null,
                maxSerial: 0,
              };
            }
          }
        }

        let totalAccepted = 0;
        let totalRollsAssigned = 0;
        let totalRollsPending = 0;
        let totalSmsSent = 0;
        let totalSmsPending = 0;
        let totalSmsFailed = 0;
        let totalDownloaded = 0;
        let totalDownloadPending = 0;

        for (const app of acceptedApps) {
          const { bucketKey } = resolveCandidateBucket(app);
          const bucket = bucketMap[bucketKey];
          if (!bucket) continue;

          totalAccepted++;
          bucket.totalAccepted++;

          const hasRoll = Boolean(app.exam_roll);
          if (hasRoll) {
            totalRollsAssigned++;
            bucket.rollsAssigned++;
            // Calculate max serial
            const rollStr = String(app.exam_roll);
            const serialPart = parseInt(rollStr.slice(-3), 10);
            if (!isNaN(serialPart) && serialPart > bucket.maxSerial) {
              bucket.maxSerial = serialPart;
              bucket.maxRoll = rollStr;
            }

            // SMS tracking for candidates with generated rolls
            if (app.admit_sms?.sent) {
              totalSmsSent++;
              bucket.smsSent++;
            } else if (app.admit_sms?.failed || app.admit_sms?.error) {
              totalSmsFailed++;
              bucket.smsFailed++;
            } else {
              totalSmsPending++;
              bucket.smsPending++;
            }
          } else {
            totalRollsPending++;
            bucket.rollsPending++;
          }

          const isDownloaded = Boolean(app.admit_card?.downloaded || app.admit_downloaded);
          if (isDownloaded) {
            totalDownloaded++;
            bucket.admitDownloaded++;
          } else {
            totalDownloadPending++;
            bucket.downloadPending++;
          }
        }

        const buckets = Object.values(bucketMap);

        res.send({
          success: true,
          stats: {
            totalAccepted,
            totalRollsAssigned,
            totalRollsPending,
            totalSmsSent,
            totalSmsPending,
            totalSmsFailed,
            totalDownloaded,
            totalDownloadPending,
            admitCardLocked: Boolean(settings.admitCardLocked),
            admitCardPublished: Boolean(settings.admitCardPublished),
            admitCardLockedAt: settings.admitCardLockedAt || null,
            admitCardPublishedAt: settings.admitCardPublishedAt || null,
          },
          buckets,
        });
      } catch (err) {
        console.error("Exam rolls summary error:", err);
        res.status(500).send({ message: "Failed to load exam rolls summary" });
      }
    });

    // 2. POST /admin/exam-rolls/generate - Generate roll numbers
    app.post('/admin/exam-rolls/generate', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const settings = await settingsCollection.findOne({}) || {};
        if (settings.admitCardLocked) {
          return res.status(403).send({
            message: "রোল নম্বরগুলো লক করা আছে। রোল পরিবর্তন বা তৈরি করতে প্রথমে আনলক করুন।",
          });
        }

        const { bucketKey: targetBucketKey } = req.body || {};

        // Fetch all accepted applications
        const query = { reg_status: "accepted" };
        const acceptedApps = await applicationCollection.find(query).toArray();

        // Group into buckets
        const bucketBuckets = {};
        for (const app of acceptedApps) {
          const { bucketKey, center, studentClass, gender } = resolveCandidateBucket(app);
          if (targetBucketKey && bucketKey !== targetBucketKey) {
            continue;
          }

          if (!bucketBuckets[bucketKey]) {
            bucketBuckets[bucketKey] = {
              bucketKey,
              center,
              studentClass,
              gender,
              assignedMaxSerial: 0,
              unassigned: [],
            };
          }

          if (app.exam_roll) {
            const serialPart = parseInt(String(app.exam_roll).slice(-3), 10);
            if (!isNaN(serialPart) && serialPart > bucketBuckets[bucketKey].assignedMaxSerial) {
              bucketBuckets[bucketKey].assignedMaxSerial = serialPart;
            }
          } else {
            bucketBuckets[bucketKey].unassigned.push(app);
          }
        }

        const bulkOps = [];
        let totalGenerated = 0;

        for (const bucketKey of Object.keys(bucketBuckets)) {
          const bucket = bucketBuckets[bucketKey];
          if (bucket.unassigned.length === 0) continue;

          // Intelligent Sorting: strictly by Candidate Name (A-Z)
          bucket.unassigned.sort((a, b) => {
            const nameA = (a.name_en || "").trim().toUpperCase();
            const nameB = (b.name_en || "").trim().toUpperCase();
            return nameA.localeCompare(nameB);
          });

          let currentSerial = bucket.assignedMaxSerial;
          for (const cand of bucket.unassigned) {
            currentSerial++;
            const rollStr = `${EXAM_YEAR}${bucket.center.code}${bucket.studentClass.code}${bucket.gender.code}${String(currentSerial).padStart(3, "0")}`;
            bulkOps.push({
              updateOne: {
                filter: { _id: cand._id },
                update: {
                  $set: {
                    exam_roll: rollStr,
                    exam_roll_bucket: bucketKey,
                    exam_roll_generated_at: new Date().toISOString(),
                    exam_roll_generated_by: req.decoded?.email || "Admin",
                  },
                },
              },
            });
            totalGenerated++;
          }
        }

        if (bulkOps.length > 0) {
          await applicationCollection.bulkWrite(bulkOps);
        }

        res.send({
          success: true,
          generatedCount: totalGenerated,
          message: `${totalGenerated} জন শিক্ষার্থীর রোল নম্বর সফলভাবে তৈরি করা হয়েছে।`,
        });
      } catch (err) {
        console.error("Generate rolls error:", err);
        res.status(500).send({ message: "Failed to generate exam rolls" });
      }
    });

    // 3. PATCH /admin/exam-rolls/lock - Lock or unlock rolls
    app.patch('/admin/exam-rolls/lock', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const locked = Boolean(req.body.locked);
        await settingsCollection.updateOne(
          {},
          {
            $set: {
              admitCardLocked: locked,
              admitCardLockedAt: new Date().toISOString(),
              admitCardLockedBy: req.decoded?.email || "Admin",
            },
          },
          { upsert: true }
        );
        res.send({
          success: true,
          admitCardLocked: locked,
          message: locked ? "রোল নম্বর সফলভাবে লক করা হয়েছে।" : "রোল নম্বর আনলক করা হয়েছে।",
        });
      } catch (err) {
        console.error("Lock rolls error:", err);
        res.status(500).send({ message: "Failed to update roll lock status" });
      }
    });

    // 4. PATCH /admin/exam-rolls/publish - Publish or unpublish admit cards
    app.patch('/admin/exam-rolls/publish', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const published = Boolean(req.body.published);
        await settingsCollection.updateOne(
          {},
          {
            $set: {
              admitCardPublished: published,
              "admit_card_config.admit_card_published": published,
              "admit_card_config.admit_card_publish_status": published ? "published" : "draft",
              admitCardPublishedAt: new Date().toISOString(),
              admitCardPublishedBy: req.decoded?.email || "Admin",
            },
          },
          { upsert: true }
        );
        res.send({
          success: true,
          admitCardPublished: published,
          message: published ? "অ্যাডমিট কার্ড সফলভাবে প্রকাশিত হয়েছে!" : "অ্যাডমিট কার্ড প্রকাশনা স্থগিত করা হয়েছে।",
        });
      } catch (err) {
        console.error("Publish admit cards error:", err);
        res.status(500).send({ message: "Failed to update admit card publication status" });
      }
    });

    // 5. GET /admin/exam-rolls/candidates - Candidates within bucket or search
    app.get('/admin/exam-rolls/candidates', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { bucketKey, center, student_class, gender, search, roll_status, page = 1, limit = 50 } = req.query;

        const filter = { reg_status: "accepted" };

        if (bucketKey) {
          filter.exam_roll_bucket = bucketKey;
        }
        if (center && center !== "all") {
          filter.exam_center = center;
        }
        if (student_class && student_class !== "all") {
          filter.student_class = student_class;
        }
        if (gender && gender !== "all") {
          filter.gender = gender;
        }
        if (roll_status === "assigned") {
          filter.exam_roll = { $exists: true, $nin: [null, ""] };
        } else if (roll_status === "pending") {
          filter.$or = [{ exam_roll: { $exists: false } }, { exam_roll: null }, { exam_roll: "" }];
        }

        if (search && search.trim()) {
          const q = search.trim();
          filter.$or = [
            { name_en: { $regex: q, $options: "i" } },
            { name_bn: { $regex: q, $options: "i" } },
            { exam_roll: { $regex: q, $options: "i" } },
            { phone_number: { $regex: q, $options: "i" } },
            { school_name: { $regex: q, $options: "i" } },
            { form_number: { $regex: q, $options: "i" } },
          ];
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const [candidates, total] = await Promise.all([
          applicationCollection
            .find(filter)
            .sort({ exam_roll: 1, name_en: 1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .project({
              _id: 1,
              name_en: 1,
              name_bn: 1,
              student_class: 1,
              student_section: 1,
              student_roll: 1,
              school_name: 1,
              phone_number: 1,
              exam_center: 1,
              gender: 1,
              exam_roll: 1,
              exam_roll_bucket: 1,
              admit_sms: 1,
              admit_card: 1,
              admit_downloaded: 1,
              registration_type: 1,
              paper_serial_no: 1,
              form_number: 1,
            })
            .toArray(),
          applicationCollection.countDocuments(filter),
        ]);

        res.send({
          success: true,
          candidates,
          total,
          page: parseInt(page, 10),
          totalPages: Math.ceil(total / parseInt(limit, 10)),
        });
      } catch (err) {
        console.error("Fetch roll candidates error:", err);
        res.status(500).send({ message: "Failed to fetch candidates" });
      }
    });

    // 6. GET /admin/exam-centers/allocation - Center & Venue Allocation with live capacity tracking
    app.get('/admin/exam-centers/allocation', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const settings = await settingsCollection.findOne({}) || {};
        const savedAllocations = settings.exam_center_allocations || {};

        // Aggregate accepted candidates per center
        const acceptedApps = await applicationCollection
          .find({ reg_status: "accepted" })
          .project({ exam_center: 1 })
          .toArray();

        const candidateCountMap = {
          chawkbazar: 0,
          chandgaon: 0,
          kotwali: 0,
          nasirabad: 0,
          bayezid: 0,
        };

        for (const app of acceptedApps) {
          const raw = (app.exam_center || "chawkbazar").toString().trim().toLowerCase();
          const matched = CENTER_LOOKUP[raw] || EXAM_CENTERS[0];
          candidateCountMap[matched.key] = (candidateCountMap[matched.key] || 0) + 1;
        }

        let overallCandidates = 0;
        let overallCapacity = 0;

        const centers = EXAM_CENTERS.map((c) => {
          const centerKey = c.key;
          const totalCandidates = candidateCountMap[centerKey] || 0;
          overallCandidates += totalCandidates;

          const centerSaved = savedAllocations[centerKey] || {};
          const rawVenues = Array.isArray(centerSaved.venues) ? centerSaved.venues : [];

          let runningSeq = 0;
          let centerCapacity = 0;

          const venues = rawVenues.map((v, idx) => {
            const cap = Math.max(0, parseInt(v.capacity, 10) || 0);
            centerCapacity += cap;

            const startSeq = runningSeq + 1;
            const endSeq = startSeq + cap - 1;
            runningSeq = endSeq;

            return {
              id: v.id || `v_${idx + 1}`,
              name_bn: v.name_bn || "",
              name_en: v.name_en || "",
              address_bn: v.address_bn || "",
              address_en: v.address_en || "",
              capacity: cap,
              startSeq,
              endSeq,
              assignedCount: Math.min(cap, Math.max(0, totalCandidates - (startSeq - 1))),
            };
          });

          overallCapacity += centerCapacity;
          const shortage = Math.max(0, totalCandidates - centerCapacity);
          const surplus = Math.max(0, centerCapacity - totalCandidates);
          const hasVenues = venues.length > 0;
          const isOverCapacity = hasVenues && centerCapacity < totalCandidates;

          let status = "no_venue";
          if (hasVenues) {
            status = isOverCapacity ? "shortage" : "adequate";
          }

          return {
            centerKey,
            centerCode: c.code,
            centerLabelBn: c.label_bn,
            centerLabelEn: c.label_en,
            totalCandidates,
            centerCapacity,
            shortage,
            surplus,
            isOverCapacity,
            status,
            venues,
          };
        });

        res.send({
          success: true,
          totalCenters: centers.length,
          overallCandidates,
          overallCapacity,
          overallShortage: Math.max(0, overallCandidates - overallCapacity),
          updatedAt: settings.exam_center_allocations_updatedAt || null,
          updatedBy: settings.exam_center_allocations_updatedBy || null,
          centers,
        });
      } catch (err) {
        console.error("Exam center allocation get error:", err);
        res.status(500).send({ message: "Failed to load exam center allocation" });
      }
    });

    // 7. POST /admin/exam-centers/allocation - Save Center & Venue Allocation
    app.post('/admin/exam-centers/allocation', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { allocations } = req.body || {};
        if (!allocations || typeof allocations !== "object") {
          return res.status(400).send({ message: "Invalid allocations payload" });
        }

        // Clean & sanitize allocations
        const sanitized = {};
        for (const center of EXAM_CENTERS) {
          const cData = allocations[center.key] || {};
          const venues = Array.isArray(cData.venues) ? cData.venues : [];

          sanitized[center.key] = {
            venues: venues.map((v, idx) => ({
              id: v.id || `v_${Date.now()}_${idx + 1}`,
              name_bn: (v.name_bn || "").trim(),
              name_en: (v.name_en || "").trim(),
              address_bn: (v.address_bn || "").trim(),
              address_en: (v.address_en || "").trim(),
              capacity: Math.max(0, parseInt(v.capacity, 10) || 0),
            })),
          };
        }

        await settingsCollection.updateOne(
          {},
          {
            $set: {
              exam_center_allocations: sanitized,
              exam_center_allocations_updatedAt: new Date().toISOString(),
              exam_center_allocations_updatedBy: req.decoded?.email || "Admin",
            },
          },
          { upsert: true }
        );

        res.send({
          success: true,
          message: "পরীক্ষা কেন্দ্র ও ভেন্যু বরাদ্দ সফলভাবে সংরক্ষণ করা হয়েছে।",
        });
      } catch (err) {
        console.error("Exam center allocation save error:", err);
        res.status(500).send({ message: "Failed to save exam center allocation" });
      }
    });

    // 8. GET /admin/admit-card/config - Fetch admit card instructions, signature & schedule setup
    app.get('/admin/admit-card/config', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const settings = await settingsCollection.findOne({}) || {};
        const DEFAULT_ADMIT_CONFIG = {
          exam_title: "অংকুর মেধা বৃত্তি পরীক্ষা ২০২৬",
          exam_subtitle: "Aunkur Scholarship Examination 2026",
          exam_date: "ডিসেম্বর ২০২৬",
          exam_date_en: "December 2026",
          exam_time: "সকাল ১০:০০ টা – দুপুর ১২:৩০ টা",
          exam_time_en: "10:00 AM – 12:30 PM",
          reporting_time: "সকাল ৯:৩০ টা",
          reporting_time_en: "9:30 AM",
          instructions: [
            "পরীক্ষার্থীকে পরীক্ষা শুরুর অন্তত ৩০ মিনিট পূর্বে নিজ আসনে উপস্থিত হতে হবে।",
            "মূল প্রবেশপত্র (Admit Card) ব্যতীত কোনো পরীক্ষার্থীকে পরীক্ষা কক্ষে প্রবেশ করতে দেওয়া হবে না।",
            "পরীক্ষার হলে যেকোনো ধরণের মোবাইল ফোন, স্মার্টওয়াচ বা ইলেকট্রনিক ডিভাইস আনা সম্পূর্ণ নিষিদ্ধ।",
            "উত্তরপত্রে প্রার্থীর নাম, রোল নম্বর ও প্রয়োজনীয় তথ্য সতর্কতার সাথে বলপেন দ্বারা পূরণ করতে হবে।",
            "পরীক্ষা কক্ষ ত্যাগের পূর্বে উত্তরপত্র পরিদর্শকের নিকট জমা দিয়ে নিশ্চিত করতে হবে।"
          ],
          controller_name: "পরীক্ষা নিয়ন্ত্রক",
          controller_name_en: "Exam Controller",
          controller_designation: "আহ্বায়ক, পরীক্ষা উপ-কমিটি",
          controller_designation_en: "Convener, Examination Sub-Committee",
          controller_signature_url: "",
          contact_north: "01879-891623, 01805-210314, 01878-284427",
          slogan: "শুভ্রতার স্পর্শে লালিত স্বপ্ন বিকশিত হোক সত্যের ছোঁয়ায়",
          helpline_number: "01879891623",
          emergency_instructions: "যেকোনো জরুরি প্রয়োজনে হটলাইন নম্বরে যোগাযোগ করুন।",
          sms_template: "Dear {name}, your Aunkur Exam Roll is {roll} (Class {class}). Download Admit Card: aunkurctgnorth.org/admitcard - Aunkur'26",
          admit_card_published: true,
          admit_card_publish_status: "published", // "published" | "scheduled" | "draft"
          publish_date_time: "", // e.g. "2026-10-15T10:00"
          publish_notice: "",
        };

        const config = { ...DEFAULT_ADMIT_CONFIG, ...(settings.admit_card_config || {}) };
        res.send({ success: true, config });
      } catch (err) {
        console.error("Fetch admit card config error:", err);
        res.status(500).send({ message: "Failed to load admit card setup" });
      }
    });

    // 9. POST /admin/admit-card/config - Save admit card instructions, signature & schedule setup
    app.post('/admin/admit-card/config', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { config } = req.body || {};
        if (!config || typeof config !== "object") {
          return res.status(400).send({ message: "Invalid config payload" });
        }

        // Sanitize instructions array
        const instructions = Array.isArray(config.instructions)
          ? config.instructions.map((item) => String(item || "").trim()).filter(Boolean)
          : [];

        const publishStatus = ["published", "scheduled", "draft"].includes(config.admit_card_publish_status)
          ? config.admit_card_publish_status
          : (config.admit_card_published === false ? "draft" : "published");

        const sanitized = {
          exam_title: (config.exam_title || "").trim(),
          exam_subtitle: (config.exam_subtitle || "").trim(),
          exam_date: (config.exam_date || "").trim(),
          exam_date_en: (config.exam_date_en || "").trim(),
          exam_time: (config.exam_time || "").trim(),
          exam_time_en: (config.exam_time_en || "").trim(),
          reporting_time: (config.reporting_time || "").trim(),
          reporting_time_en: (config.reporting_time_en || "").trim(),
          instructions,
          controller_name: (config.controller_name || "").trim(),
          controller_name_en: (config.controller_name_en || "").trim(),
          controller_designation: (config.controller_designation || "").trim(),
          controller_designation_en: (config.controller_designation_en || "").trim(),
          controller_signature_url: (config.controller_signature_url || "").trim(),
          contact_north: (config.contact_north || "").trim() || "01879-891623, 01805-210314, 01878-284427",
          slogan: (config.slogan || "").trim() || "শুভ্রতার স্পর্শে লালিত স্বপ্ন বিকশিত হোক সত্যের ছোঁয়ায়",
          helpline_number: (config.helpline_number || "").trim(),
          emergency_instructions: (config.emergency_instructions || "").trim(),
          sms_template: (config.sms_template || "").trim() || "Dear {name}, your Aunkur Exam Roll is {roll} (Class {class}). Download Admit Card: aunkurctgnorth.org/admitcard - Aunkur'26",
          admit_card_published: Boolean(config.admit_card_published !== false && publishStatus !== "draft"),
          admit_card_publish_status: publishStatus,
          publish_date_time: (config.publish_date_time || "").trim(),
          publish_notice: (config.publish_notice || "").trim(),
        };

        await settingsCollection.updateOne(
          {},
          {
            $set: {
              admit_card_config: sanitized,
              admitCardPublished: sanitized.admit_card_published,
              admit_card_config_updatedAt: new Date().toISOString(),
              admit_card_config_updatedBy: req.decoded?.email || "Admin",
            },
          },
          { upsert: true }
        );

        res.send({
          success: true,
          message: "প্রবেশপত্রের নির্দেশনাবলী, সময়সূচি ও স্বাক্ষর সফলভাবে সংরক্ষণ করা হয়েছে।",
          config: sanitized,
        });
      } catch (err) {
        console.error("Save admit card config error:", err);
        res.status(500).send({ message: "Failed to save admit card setup" });
      }
    });

    // 10. GET /admin/admit-cards/list - Paginated list of candidates for admit card management
    app.get('/admin/admit-cards/list', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const {
          center,
          student_class,
          gender,
          branch,
          sub_branch,
          registration_type,
          reg_type,
          download_status,
          sms_status,
          search,
          page = 1,
          limit = 50,
        } = req.query;

        const settings = await settingsCollection.findOne({}) || {};
        const allocations = settings.exam_center_allocations || {};

        const filter = {
          reg_status: "accepted",
          exam_roll: { $exists: true, $nin: [null, ""] },
        };

        if (center && center !== "all") {
          filter.exam_center = center;
        }
        if (student_class && student_class !== "all") {
          filter.student_class = student_class;
        }
        if (gender && gender !== "all") {
          filter.gender = gender;
        }
        if (branch && branch !== "all") {
          filter.branch = branch;
        }
        if (sub_branch && sub_branch !== "all") {
          filter.sub_branch = sub_branch;
        }
        const selectedRegType = registration_type || reg_type;
        if (selectedRegType === "offline") {
          filter.registration_type = "offline";
        } else if (selectedRegType === "online") {
          filter.registration_type = { $ne: "offline" };
        }

        if (download_status === "downloaded") {
          filter.$or = [{ admit_downloaded: true }, { "admit_card.downloaded": true }];
        } else if (download_status === "pending") {
          filter.admit_downloaded = { $ne: true };
          filter["admit_card.downloaded"] = { $ne: true };
        }

        if (sms_status === "sent") {
          filter["admit_sms.sent"] = true;
        } else if (sms_status === "pending") {
          filter["admit_sms.sent"] = { $ne: true };
        }

        if (search && search.trim()) {
          const q = search.trim();
          const searchConditions = [
            { name_en: { $regex: q, $options: "i" } },
            { name_bn: { $regex: q, $options: "i" } },
            { exam_roll: { $regex: q, $options: "i" } },
            { phone_number: { $regex: q, $options: "i" } },
            { school_name: { $regex: q, $options: "i" } },
            { form_number: { $regex: q, $options: "i" } },
          ];
          if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
            delete filter.$or;
          } else {
            filter.$or = searchConditions;
          }
        }

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const [candidates, total, statsDownloaded, statsPending, statsSmsSent, statsSmsPending] = await Promise.all([
          applicationCollection
            .find(filter)
            .sort({ exam_roll: 1, name_en: 1 })
            .skip(skip)
            .limit(parseInt(limit, 10))
            .toArray(),
          applicationCollection.countDocuments(filter),
          applicationCollection.countDocuments({
            reg_status: "accepted",
            exam_roll: { $exists: true, $nin: [null, ""] },
            $or: [{ admit_downloaded: true }, { "admit_card.downloaded": true }],
          }),
          applicationCollection.countDocuments({
            reg_status: "accepted",
            exam_roll: { $exists: true, $nin: [null, ""] },
            admit_downloaded: { $ne: true },
            "admit_card.downloaded": { $ne: true },
          }),
          applicationCollection.countDocuments({
            reg_status: "accepted",
            exam_roll: { $exists: true, $nin: [null, ""] },
            "admit_sms.sent": true,
          }),
          applicationCollection.countDocuments({
            reg_status: "accepted",
            exam_roll: { $exists: true, $nin: [null, ""] },
            "admit_sms.sent": { $ne: true },
          }),
        ]);

        const enrichedCandidates = candidates.map((cand) => {
          const venue = resolveCandidateVenue(cand, allocations);
          const isDownloaded = Boolean(cand.admit_card?.downloaded || cand.admit_downloaded);
          return {
            _id: cand._id,
            name_en: cand.name_en || "",
            name_bn: cand.name_bn || "",
            father_name: cand.father_name || "",
            mother_name: cand.mother_name || "",
            gender: (cand.gender || "male").toLowerCase(),
            student_class: cand.student_class || "",
            student_section: cand.student_section || "",
            student_roll: cand.student_roll || "",
            school_name: cand.school_name || "",
            phone_number: cand.phone_number || "",
            whatsapp_number: cand.whatsapp_number || "",
            present_area: cand.present_area || "",
            present_thana: cand.present_thana || "",
            present_zilla: cand.present_zilla || "",
            form_number: cand.form_number || cand.paper_serial_no || cand.offline_serial || "",
            exam_center: cand.exam_center || "",
            exam_roll: cand.exam_roll || "",
            exam_roll_bucket: cand.exam_roll_bucket || "",
            branch: cand.branch || "",
            sub_branch: cand.sub_branch || "",
            registration_type: cand.registration_type === "offline" ? "offline" : "online",
            admit_downloaded: isDownloaded,
            admit_downloaded_at: cand.admit_card?.downloadedAt || null,
            admit_sms: cand.admit_sms || null,
            allocated_venue: venue,
          };
        });

        res.send({
          success: true,
          candidates: enrichedCandidates,
          total,
          page: parseInt(page, 10),
          totalPages: Math.ceil(total / parseInt(limit, 10)),
          stats: {
            totalEligible: statsDownloaded + statsPending,
            totalDownloaded: statsDownloaded,
            totalDownloadPending: statsPending,
            totalSmsSent: statsSmsSent,
            totalSmsPending: statsSmsPending,
            admitCardLocked: Boolean(settings.admitCardLocked),
            admitCardPublished: Boolean(settings.admitCardPublished),
          },
        });
      } catch (err) {
        console.error("Admit cards list error:", err);
        res.status(500).send({ message: "Failed to load admit cards list" });
      }
    });

    // 11. GET /admin/admit-cards/bulk-data - Full candidate data and config for bulk A4 PDF generation
    app.get('/admin/admit-cards/bulk-data', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const {
          center,
          student_class,
          gender,
          branch,
          sub_branch,
          registration_type,
          reg_type,
          download_status,
          sms_status,
          search,
          limit = 100,
        } = req.query;

        const settings = await settingsCollection.findOne({}) || {};
        const allocations = settings.exam_center_allocations || {};
        const admitConfig = settings.admit_card_config || {};

        const filter = {
          reg_status: "accepted",
          exam_roll: { $exists: true, $nin: [null, ""] },
        };

        if (center && center !== "all") filter.exam_center = center;
        if (student_class && student_class !== "all") filter.student_class = student_class;
        if (gender && gender !== "all") filter.gender = gender;
        if (branch && branch !== "all") filter.branch = branch;
        if (sub_branch && sub_branch !== "all") filter.sub_branch = sub_branch;
        const selectedRegType = registration_type || reg_type;
        if (selectedRegType === "offline") {
          filter.registration_type = "offline";
        } else if (selectedRegType === "online") {
          filter.registration_type = { $ne: "offline" };
        }

        if (download_status === "downloaded") {
          filter.$or = [{ admit_downloaded: true }, { "admit_card.downloaded": true }];
        } else if (download_status === "pending") {
          filter.admit_downloaded = { $ne: true };
          filter["admit_card.downloaded"] = { $ne: true };
        }

        if (sms_status === "sent") {
          filter["admit_sms.sent"] = true;
        } else if (sms_status === "pending") {
          filter["admit_sms.sent"] = { $ne: true };
        }

        if (search && search.trim()) {
          const q = search.trim();
          const searchConditions = [
            { name_en: { $regex: q, $options: "i" } },
            { name_bn: { $regex: q, $options: "i" } },
            { exam_roll: { $regex: q, $options: "i" } },
            { phone_number: { $regex: q, $options: "i" } },
            { school_name: { $regex: q, $options: "i" } },
            { form_number: { $regex: q, $options: "i" } },
          ];
          if (filter.$or) {
            filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
            delete filter.$or;
          } else {
            filter.$or = searchConditions;
          }
        }

        const candidates = await applicationCollection
          .find(filter)
          .sort({ exam_roll: 1 })
          .limit(parseInt(limit, 10))
          .toArray();

        const enrichedCandidates = candidates.map((cand) => ({
          _id: cand._id,
          name_en: cand.name_en || "",
          name_bn: cand.name_bn || "",
          father_name: cand.father_name || "",
          mother_name: cand.mother_name || "",
          gender: (cand.gender || "male").toLowerCase(),
          student_class: cand.student_class || "",
          student_section: cand.student_section || "",
          student_roll: cand.student_roll || "",
          school_name: cand.school_name || "",
          phone_number: cand.phone_number || "",
          whatsapp_number: cand.whatsapp_number || "",
          present_area: cand.present_area || "",
          present_thana: cand.present_thana || "",
          present_zilla: cand.present_zilla || "",
          form_number: cand.form_number || cand.paper_serial_no || cand.offline_serial || "",
          exam_center: cand.exam_center || "",
          exam_roll: cand.exam_roll || "",
          office_note: cand.office_note || cand.note || "",
          allocated_venue: resolveCandidateVenue(cand, allocations),
        }));

        res.send({
          success: true,
          count: enrichedCandidates.length,
          config: admitConfig,
          candidates: enrichedCandidates,
        });
      } catch (err) {
        console.error("Admit cards bulk data error:", err);
        res.status(500).send({ message: "Failed to load bulk admit cards data" });
      }
    });

    // 12. PATCH /admin/admit-cards/mark-downloaded - Record download status
    app.patch('/admin/admit-cards/mark-downloaded', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { candidateIds } = req.body || {};
        if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
          return res.status(400).send({ message: "No candidate IDs provided" });
        }

        const validIds = candidateIds
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id));

        if (validIds.length === 0) {
          return res.status(400).send({ message: "Invalid candidate IDs" });
        }

        const result = await applicationCollection.updateMany(
          { _id: { $in: validIds } },
          {
            $set: {
              admit_downloaded: true,
              "admit_card.downloaded": true,
              "admit_card.downloadedAt": new Date().toISOString(),
              "admit_card.downloadedBy": req.decoded?.email || "Admin",
            },
          }
        );

        res.send({
          success: true,
          modifiedCount: result.modifiedCount,
          message: `${result.modifiedCount} জন প্রার্থীর প্রবেশপত্র ডাউনলোড চিহ্নিত করা হয়েছে।`,
        });
      } catch (err) {
        console.error("Mark downloaded error:", err);
        res.status(500).send({ message: "Failed to mark download status" });
      }
    });

    // 13. POST /admin/admit-card/send-bulk-sms - Send SMS to students with generated rolls (Anti-Duplicate Guarded)
    app.post('/admin/admit-card/send-bulk-sms', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const {
          target = "unsent", // "unsent" | "all" | "selected"
          candidate_ids,
          center,
          student_class,
          gender,
          custom_template
        } = req.body || {};

        const settings = await settingsCollection.findOne({}) || {};
        const admitConfig = settings.admit_card_config || {};
        const template = custom_template || admitConfig.sms_template || "Dear {name}, your Aunkur Exam Roll is {roll} (Class {class}). Download Admit Card: aunkurctgnorth.org/admitcard - Aunkur'26";

        const filter = {
          reg_status: "accepted",
          exam_roll: { $exists: true, $nin: [null, ""] },
        };

        if (target === "unsent") {
          filter["admit_sms.sent"] = { $ne: true };
        }

        if (target === "selected" && Array.isArray(candidate_ids) && candidate_ids.length > 0) {
          filter._id = { $in: candidate_ids.map(id => new ObjectId(id)) };
        } else {
          if (center && center !== "all") filter.exam_center = center;
          if (student_class && student_class !== "all") filter.student_class = student_class;
          if (gender && gender !== "all") filter.gender = gender;
        }

        const candidates = await applicationCollection.find(filter).toArray();

        if (!candidates.length) {
          return res.send({
            success: true,
            message: "কোনো এসএমএস পাঠানোর বাকি শিক্ষার্থী পাওয়া যায়নি (No candidates pending SMS).",
            sentCount: 0,
            failedCount: 0,
            skippedCount: 0,
            totalTargeted: 0,
          });
        }

        let sentCount = 0;
        let failedCount = 0;
        let skippedCount = 0;

        // Process in batches of 20 concurrent requests with delay
        const BATCH_SIZE = 20;
        for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
          const batch = candidates.slice(i, i + BATCH_SIZE);
          await Promise.allSettled(batch.map(async (cand) => {
            const rawPhone = String(cand.phone_number || "").trim();
            const cleanPhone = rawPhone.replace(/[^0-9]/g, "");
            const normalizedPhone = cleanPhone.startsWith("880") ? cleanPhone.slice(2) : cleanPhone;

            if (!/^01[3-9]\d{8}$/.test(normalizedPhone)) {
              skippedCount++;
              return;
            }

            const formattedMsg = formatSmsMessage(template, cand);

            try {
              await sendBulkSMS([normalizedPhone], formattedMsg);
              await applicationCollection.updateOne(
                { _id: cand._id },
                {
                  $set: {
                    "admit_sms.sent": true,
                    "admit_sms.sentAt": new Date().toISOString(),
                    "admit_sms.lastSentBy": req.decoded?.email || "Admin",
                    "admit_sms.phone": normalizedPhone,
                    "admit_sms.lastMessage": formattedMsg,
                  },
                  $inc: { "admit_sms.sentCount": 1 }
                }
              );
              sentCount++;
            } catch (smsErr) {
              console.error(`SMS send error for candidate ${cand._id}:`, smsErr.message);
              failedCount++;
            }
          }));

          if (i + BATCH_SIZE < candidates.length) {
            await new Promise((r) => setTimeout(r, 250));
          }
        }

        res.send({
          success: true,
          message: `${sentCount} জন প্রার্থীর কাছে সফলভাবে এসএমএস পাঠানো হয়েছে। (ব্যর্থ: ${failedCount}, বাদ: ${skippedCount})`,
          sentCount,
          failedCount,
          skippedCount,
          totalTargeted: candidates.length,
        });
      } catch (err) {
        console.error("Bulk SMS error:", err);
        res.status(500).send({ message: "Failed to send bulk SMS: " + (err.message || "Unknown error") });
      }
    });

    // 14. POST /admin/admit-card/resend-single-sms - Resend SMS to a single candidate
    app.post('/admin/admit-card/resend-single-sms', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const { candidateId } = req.body || {};
        if (!candidateId || !ObjectId.isValid(candidateId)) {
          return res.status(400).send({ message: "Invalid candidate ID" });
        }

        const cand = await applicationCollection.findOne({ _id: new ObjectId(candidateId) });
        if (!cand) {
          return res.status(404).send({ message: "প্রার্থী পাওয়া যায়নি।" });
        }
        if (!cand.exam_roll) {
          return res.status(400).send({ message: "এই প্রার্থীর এখনো কোনো রোল নম্বর নেই।" });
        }

        const rawPhone = String(cand.phone_number || "").trim();
        const cleanPhone = rawPhone.replace(/[^0-9]/g, "");
        const normalizedPhone = cleanPhone.startsWith("880") ? cleanPhone.slice(2) : cleanPhone;

        if (!/^01[3-9]\d{8}$/.test(normalizedPhone)) {
          return res.status(400).send({ message: "প্রার্থীর ফোন নম্বরটি সঠিক নয় (" + rawPhone + ")" });
        }

        const settings = await settingsCollection.findOne({}) || {};
        const admitConfig = settings.admit_card_config || {};
        const template = admitConfig.sms_template || "Dear {name}, your Aunkur Exam Roll is {roll} (Class {class}). Download Admit Card: aunkurctgnorth.org/admitcard - Aunkur'26";

        const formattedMsg = formatSmsMessage(template, cand);
        await sendBulkSMS([normalizedPhone], formattedMsg);

        await applicationCollection.updateOne(
          { _id: cand._id },
          {
            $set: {
              "admit_sms.sent": true,
              "admit_sms.sentAt": new Date().toISOString(),
              "admit_sms.lastSentBy": req.decoded?.email || "Admin",
              "admit_sms.phone": normalizedPhone,
              "admit_sms.lastMessage": formattedMsg,
            },
            $inc: { "admit_sms.sentCount": 1 }
          }
        );

        res.send({
          success: true,
          message: `${normalizedPhone} নম্বরে সফলভাবে এসএমএস পাঠানো হয়েছে।`,
          phone: normalizedPhone,
          messagePreview: formattedMsg,
        });
      } catch (err) {
        console.error("Single SMS resend error:", err);
        res.status(500).send({ message: "Failed to resend SMS: " + (err.message || "Unknown error") });
      }
    });

    // -------------------------------------------------------------
    // PUBLIC CANDIDATE ADMIT CARD DOWNLOAD PORTAL ENDPOINTS
    // -------------------------------------------------------------

    // GET /public/admit-card/status - Check publication status and countdown schedule
    app.get('/public/admit-card/status', async (req, res) => {
      try {
        const settings = await settingsCollection.findOne({}) || {};
        const config = settings.admit_card_config || {};
        const isPublished = isAdmitCardCurrentlyPublished(config);

        res.send({
          success: true,
          is_published: isPublished,
          publish_status: config.admit_card_publish_status || (config.admit_card_published === false ? "draft" : "published"),
          publish_date_time: config.publish_date_time || null,
          publish_notice: config.publish_notice || "",
          server_time: new Date().toISOString(),
        });
      } catch (err) {
        console.error("Admit card status fetch error:", err);
        res.status(500).send({ success: false, message: "স্ট্যাটাস লোড করা যায়নি।" });
      }
    });

    // Admit Card Rate Limiter - 15 minutes, maximum 10 tries per IP to prevent brute-force
    const admitCardLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        success: false,
        message: "অতিরিক্ত চেষ্টা করা হয়েছে। অনুগ্রহ করে ১৫ মিনিট পর আবার চেষ্টা করুন।"
      }
    });

    // POST /public/admit-card/verify-phone - Step 1: Verify phone number
    app.post('/public/admit-card/verify-phone', admitCardLimiter, async (req, res) => {
      try {
        // Enforce publish status for non-admin requests
        const isAdmin = await checkIsAdminRequest(req);
        if (!isAdmin) {
          const settings = await settingsCollection.findOne({}) || {};
          const config = settings.admit_card_config || {};
          const isPublished = isAdmitCardCurrentlyPublished(config);
          if (!isPublished) {
            return res.status(403).send({
              success: false,
              is_not_published: true,
              publish_status: config.admit_card_publish_status || "draft",
              publish_date_time: config.publish_date_time || null,
              message: config.publish_notice || "প্রবেশপত্র এখনো প্রকাশ করা হয়নি। নির্ধারিত সময়ে প্রকাশ করা হবে।",
            });
          }
        }

        const { phone } = req.body || {};
        const raw = String(phone || "").trim();
        const clean = raw.replace(/[^0-9]/g, "");
        const normalized = clean.startsWith("880") ? clean.slice(2) : clean;

        if (!/^01[3-9]\d{8}$/.test(normalized)) {
          return res.status(400).send({
            success: false,
            message: "সঠিক ১১ ডিজিটের মোবাইল নম্বর প্রদান করুন (যেমন: 018XXXXXXXX)",
          });
        }

        const apps = await applicationCollection.find({
          $or: [
            { phone_number: normalized },
            { phone_number: `+88${normalized}` },
            { phone_number: `88${normalized}` },
            { phone_number: { $regex: new RegExp(`${normalized}$`) } },
          ]
        }).toArray();

        if (!apps.length) {
          return res.status(404).send({
            success: false,
            message: "এই মোবাইল নম্বরে কোনো রেজিস্ট্রেশন খুঁজে পাওয়া যায়নি। অনুগ্রহ করে আবেদনে ব্যবহৃত মোবাইল নম্বরটি দিন।",
          });
        }

        const acceptedWithRoll = apps.filter(a => a.reg_status === "accepted" && a.exam_roll);
        if (!acceptedWithRoll.length) {
          const underReview = apps.some(a => a.reg_status === "under_review" || !a.reg_status);
          if (underReview) {
            return res.status(400).send({
              success: false,
              message: "আপনার আবেদনটি বর্তমানে যাচাই ও পর্যালোচনায় আছে। অনুমোদন সম্পন্ন হলে রোল নম্বর প্রদান করা হবে।",
            });
          }
          const acceptedNoRoll = apps.some(a => a.reg_status === "accepted" && !a.exam_roll);
          if (acceptedNoRoll) {
            return res.status(400).send({
              success: false,
              message: "আপনার আবেদনটি অনুমোদিত হয়েছে! কিন্তু রোল নম্বর এখনো প্রস্তুত হচ্ছে। খুব শীঘ্রই এসএমএসে জানিয়ে দেওয়া হবে।",
            });
          }
          return res.status(400).send({
            success: false,
            message: "আপনার আবেদনটি গৃহীত হয়নি। তথ্যের জন্য হেল্পলাইনে যোগাযোগ করুন।",
          });
        }

        const candidates = acceptedWithRoll.map((cand) => {
          const rollStr = String(cand.exam_roll || "");
          const masked = rollStr.length >= 4 
            ? rollStr.slice(0, 2) + "••••" + rollStr.slice(-2)
            : "••••••••";
          return {
            id: cand._id,
            name_en: cand.name_en || "",
            name_bn: cand.name_bn || "",
            student_class: cand.student_class || "",
            school_name: cand.school_name || "",
            masked_roll: masked,
          };
        });

        res.send({
          success: true,
          phone: normalized,
          candidates,
          message: `${candidates.length} জন প্রার্থীর তথ্য পাওয়া গেছে। প্রবেশপত্র দেখতে এসএমএসে পাওয়া ৮ ডিজিটের রোল নম্বর দিন।`,
        });
      } catch (err) {
        console.error("Public verify phone error:", err);
        res.status(500).send({ success: false, message: "সার্ভারে সমস্যা হয়েছে, কিছুক্ষণ পর চেষ্টা করুন।" });
      }
    });

    // POST /public/admit-card/login - Step 2: Login with Phone & 8-Digit Roll
    app.post('/public/admit-card/login', admitCardLimiter, async (req, res) => {
      try {
        // Enforce publish status for non-admin requests
        const isAdmin = await checkIsAdminRequest(req);
        if (!isAdmin) {
          const settings = await settingsCollection.findOne({}) || {};
          const config = settings.admit_card_config || {};
          const isPublished = isAdmitCardCurrentlyPublished(config);
          if (!isPublished) {
            return res.status(403).send({
              success: false,
              is_not_published: true,
              publish_status: config.admit_card_publish_status || "draft",
              publish_date_time: config.publish_date_time || null,
              message: config.publish_notice || "প্রবেশপত্র এখনো প্রকাশ করা হয়নি। নির্ধারিত সময়ে প্রকাশ করা হবে।",
            });
          }
        }

        const { phone, exam_roll, candidate_id } = req.body || {};
        const rawPhone = String(phone || "").trim();
        const cleanPhone = rawPhone.replace(/[^0-9]/g, "");
        const normalizedPhone = cleanPhone.startsWith("880") ? cleanPhone.slice(2) : cleanPhone;
        const rollInput = String(exam_roll || "").trim();

        if (!rollInput || rollInput.length !== 8) {
          return res.status(400).send({
            success: false,
            message: "অনুগ্রহ করে এসএমএসে পাঠানো ৮ ডিজিটের রোল নম্বর সঠিকভাবে লিখুন।",
          });
        }

        const filter = {
          exam_roll: rollInput,
          reg_status: "accepted",
        };

        if (candidate_id && ObjectId.isValid(candidate_id)) {
          filter._id = new ObjectId(candidate_id);
        } else if (normalizedPhone) {
          filter.$or = [
            { phone_number: normalizedPhone },
            { phone_number: `+88${normalizedPhone}` },
            { phone_number: `88${normalizedPhone}` },
            { phone_number: { $regex: new RegExp(`${normalizedPhone}$`) } },
          ];
        }

        const cand = await applicationCollection.findOne(filter);
        if (!cand) {
          return res.status(401).send({
            success: false,
            message: "মোবাইল নম্বর ও ৮ ডিজিটের রোল নম্বরের মিল পাওয়া যায়নি। অনুগ্রহ করে সঠিক রোল নম্বর দিন।",
          });
        }

        const settings = await settingsCollection.findOne({}) || {};
        const allocations = settings.exam_center_allocations || {};
        const admitConfig = settings.admit_card_config || {};

        const venue = resolveCandidateVenue(cand, allocations);

        const enrichedCandidate = {
          _id: cand._id,
          name_en: cand.name_en || "",
          name_bn: cand.name_bn || "",
          father_name: cand.father_name || "",
          mother_name: cand.mother_name || "",
          gender: (cand.gender || "male").toLowerCase(),
          student_class: cand.student_class || "",
          student_section: cand.student_section || "",
          student_roll: cand.student_roll || "",
          school_name: cand.school_name || "",
          phone_number: cand.phone_number || "",
          whatsapp_number: cand.whatsapp_number || "",
          present_area: cand.present_area || "",
          present_thana: cand.present_thana || "",
          present_zilla: cand.present_zilla || "",
          form_number: cand.form_number || cand.paper_serial_no || cand.offline_serial || "",
          exam_center: cand.exam_center || "",
          exam_roll: cand.exam_roll || "",
          office_note: cand.office_note || cand.note || "",
          allocated_venue: venue,
        };

        res.send({
          success: true,
          candidate: enrichedCandidate,
          config: admitConfig,
          admitConfig: admitConfig,
          venue: venue,
          message: "লগইন সফল হয়েছে!",
        });
      } catch (err) {
        console.error("Public admit card login error:", err);
        res.status(500).send({ success: false, message: "লগইন করতে ব্যর্থ হয়েছে।" });
      }
    });

    // POST /public/admit-card/mark-downloaded - Step 3: Record download
    app.post('/public/admit-card/mark-downloaded', async (req, res) => {
      try {
        const { id, exam_roll } = req.body || {};
        const filter = {};
        if (id && ObjectId.isValid(id)) {
          filter._id = new ObjectId(id);
        } else if (exam_roll) {
          filter.exam_roll = String(exam_roll).trim();
        } else {
          return res.status(400).send({ message: "Candidate ID or roll required" });
        }

        await applicationCollection.updateOne(filter, {
          $set: {
            admit_downloaded: true,
            "admit_card.downloaded": true,
            "admit_card.downloadedAt": new Date().toISOString(),
            "admit_card.downloadedBy": "CandidatePortal",
          }
        });

        res.send({ success: true });
      } catch (err) {
        console.error("Public mark downloaded error:", err);
        res.status(500).send({ message: "Failed to mark downloaded" });
      }
    });

    app.get('/registrations', verifyToken, verifyCoordinatorOrAdmin, async (req, res) => {
      const result = await applicationCollection.find().toArray()
      res.send(result)
    })

    // Offline registrations page.
    // entries: full records for the table — every offline entry for admins, only their own for coordinators.
    // summary: every offline entry, stripped to the fields the summary cards need (no personal details).
    app.get('/offline-registrations', verifyToken, verifyCoordinatorOrAdmin, async (req, res) => {
      try {
        const isAdmin = req.user?.role === "admin";
        // Same rule the page used client-side: typed offline, or carrying a paper serial
        const offlineFilter = {
          $or: [
            { registration_type: "offline" },
            { paper_serial_no: { $exists: true, $nin: [null, ""] } },
            { offline_serial: { $exists: true, $nin: [null, ""] } },
          ],
        };
        const requesterEmail = (req.decoded?.email || "").trim();
        const entriesFilter = isAdmin
          ? offlineFilter
          : {
              ...offlineFilter,
              $or: [
                { "created_by.email": requesterEmail.toLowerCase() },
                { "created_by.email": requesterEmail },
                { "created_by.email": { $regex: new RegExp(`^${requesterEmail}$`, "i") } },
              ],
            };

        const [entries, summary] = await Promise.all([
          applicationCollection.find(entriesFilter).sort({ submittedAt: -1 }).toArray(),
          applicationCollection
            .find(offlineFilter)
            .project({
              _id: 1,
              branch: 1,
              sub_branch: 1,
              reference: 1,
              exam_center: 1,
              reg_status: 1,
              created_by: 1,
              registration_type: 1,
              paper_serial_no: 1,
              offline_serial: 1,
            })
            .toArray(),
        ]);

        res.send({ entries, summary });
      } catch (err) {
        console.error("Error fetching offline registrations:", err);
        res.status(500).send({ message: "Failed to fetch offline registrations" });
      }
    });

    // Public status lookup — limited per IP to slow down phone-number enumeration
    const registrationSearchLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        success: false,
        message: "অনেকবার অনুসন্ধান করা হয়েছে। অনুগ্রহ করে ১৫ মিনিট পর আবার চেষ্টা করুন।"
      },
    });

    // Only what a public status check needs — never contact, address, parent or payment details
    const PUBLIC_SEARCH_PROJECTION = {
      _id: 0,
      name_bn: 1,
      name_en: 1,
      student_class: 1,
      exam_center: 1,
      reg_status: 1,
      submittedAt: 1,
    };

    app.get('/registrations/search', registrationSearchLimiter, async (req, res) => {
      try {
        const phone = typeof req.query.phone === "string" ? req.query.phone.replace(/\s+/g, "") : "";

        // Strict Bangladeshi mobile format — digits only, so it is safe to build a regex from
        if (!/^01[3-9]\d{8}$/.test(phone)) {
          return res.status(400).json({ success: false, message: "সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন।" });
        }

        // Exact match that still tolerates spaces inside stored phone_number values
        const regex = new RegExp(`^\\s*${phone.split("").join("\\s*")}\\s*$`);

        const registrations = await applicationCollection
          .find({ phone_number: { $regex: regex } })
          .project(PUBLIC_SEARCH_PROJECTION)
          .toArray();

        if (!registrations.length) {
          return res.status(404).json({ success: false, message: "No registration found" });
        }

        res.json({ success: true, data: registrations });
      } catch (error) {
        console.error("❌ Error searching registration:", error);
        res.status(500).json({ success: false, message: "Server error" });
      }
    });





    app.get('/registration-details/:id', verifyToken, verifyCoordinatorOrAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid registration ID" });
        }
        const filter = { _id: new ObjectId(id) };
        const result = await applicationCollection.findOne(filter);
        if (!result) {
          return res.status(404).send({ message: "Registration not found" });
        }
        // Coordinators may only open entries they created themselves
        const isAdmin = req.user?.role === "admin";
        const isOwner = result.created_by?.email?.toLowerCase() === req.decoded?.email?.toLowerCase();
        if (!isAdmin && !isOwner) {
          return res.status(403).send({ message: "আপনি শুধু নিজের এন্ট্রির বিস্তারিত দেখতে পারবেন।" });
        }
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch registration details" });
      }
    });


    // user collection - secure self-registration
    app.post('/user', async (req, res) => {
      try {
        const email = req.body?.email?.toLowerCase()?.trim();
        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const query = { email: email };
        const existingUser = await userCollection.findOne(query);
        if (existingUser) {
          return res.send({ message: "User already exists", insertedId: existingUser._id });
        }

        // CRITICAL SECURITY FIX: Enforce role: "user" for self-registration.
        // Role elevation to admin or coordinator must only be granted via PATCH /users/:id by an admin.
        const safeUser = {
          uid: req.body?.uid || null,
          email: email,
          name: req.body?.name || "",
          role: "user",
          createdAt: new Date().toISOString()
        };

        const result = await userCollection.insertOne(safeUser);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to create user record" });
      }
    });

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {

      const result = await userCollection.find().toArray()
      res.send(result)
    })

    const ALLOWED_ROLES = ["user", "coordinator", "admin"];

    // True when removing admin rights from this user would leave the site with no admin
    const isLastAdmin = async (targetUser) => {
      if (targetUser?.role !== "admin") return false;
      const adminCount = await userCollection.countDocuments({ role: "admin" });
      return adminCount <= 1;
    };

    app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid user ID" });
      }
      const query = { _id: new ObjectId(id) };

      const targetUser = await userCollection.findOne(query);
      if (!targetUser) {
        return res.status(404).send({ message: "User not found" });
      }
      if (await isLastAdmin(targetUser)) {
        return res.status(409).send({ message: "Cannot delete the last admin. Make another user admin first." });
      }

      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    app.patch('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const requestedRole = req.body?.role;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid user ID" });
      }
      // Never fall back to a default role — a missing or unknown role is rejected
      if (!ALLOWED_ROLES.includes(requestedRole)) {
        return res.status(400).send({ message: `Role must be one of: ${ALLOWED_ROLES.join(", ")}` });
      }

      const filter = { _id: new ObjectId(id) };
      const targetUser = await userCollection.findOne(filter);
      if (!targetUser) {
        return res.status(404).send({ message: "User not found" });
      }
      if (requestedRole !== "admin" && await isLastAdmin(targetUser)) {
        return res.status(409).send({ message: "Cannot demote the last admin. Make another user admin first." });
      }

      const updatedDoc = {
        $set: {
          role: requestedRole,
          roleUpdatedBy: req.decoded?.email || null,
          roleUpdatedAt: new Date().toISOString(),
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      const isCoordinator = user?.role === 'coordinator' || isAdmin;
      res.send({ 
        admin: isAdmin, 
        coordinator: isCoordinator, 
        role: user?.role || 'user',
        name: user?.name,
        email: user?.email
      });
    });








    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }

  // Only start listening when not running in Vercel serverless runtime
  if (!process.env.VERCEL) {
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  }
}
run().catch(console.dir);

module.exports = app;
