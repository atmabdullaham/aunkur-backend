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

const { sendMetaCapiEvent } = require('./utils/metaCapi');

const app = express();
const port = process.env.PORT || 5000;



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
const imgkitClient = new ImageKit({
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  urlEndpoint: process.env.PUBLICURL,
});

app.get("/auth", function (req, res) {
  // Your application logic to authenticate the user
  // For example, you can check if the user is logged in or has the necessary permissions
  // If the user is not authenticated, you can return an error response
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
    const studentOfTheYearCollection = database.collection("student_of_the_year")

    // const runCollection = database.collection("run")

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



    // jwt related apis
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '5h' // Token will expire in 5 hour
      })
      res.send({ token })
    })

    // Middleware to verify JWT
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "Unauthorized access" })
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Unauthorized access" })
        }
        req.decoded = decoded;
        next()
      })
    }

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


    app.get("/applications", async (req, res) => {
      const email = req.query.email;
      const query = { email: email }
      const result = await applicationCollection.find(query).toArray()
      res.send(result)
    })

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

    app.post('/applications', async (req, res) => {
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

      const application = req.body;

      // ✅ Guard: Duplicate Transaction ID check
      if (application.transaction_Id) {
        const txnId = application.transaction_Id.trim();
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
        const lastName = name.split(" ").slice(-1)[0] || "";
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
        const name = updatedUser.name_en;
        const lastName = name?.trim()?.split(" ").slice(-1)[0] || "";

        // ✅ Send confirmation SMS
        let message = "";

        if (updatedUser.reg_status === "accepted") {
          message = `Dear ${lastName}, your Aunkur Scholarship'26 application has been accepted!\n\n— Aunkur Scholarship Project'26`;
        } else if (updatedUser.reg_status === "rejected") {
          message = `Dear ${lastName}, your Aunkur Scholarship'26 application was not accepted. If you have made a payment, please contact +8801879891623`;
        }
        try {
          await sendBulkSMS([phone], message);
        } catch (smsError) {
          console.error("❌ Failed to send SMS:", smsError.message);
        }
      }

      res.send(result);
    });


    app.delete('/applications/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const result = await applicationCollection.deleteOne(filter)
      res.send(result)

    })

    app.get('/registrations', verifyToken, verifyAdmin, async (req, res) => {
      const result = await applicationCollection.find().toArray()
      res.send(result)
    })

    app.get('/registrations/search', async (req, res) => {
      try {
        let { phone } = req.query;

        if (!phone) {
          return res.status(400).json({ success: false, message: "Phone number is required" });
        }

        // Clean the input (remove spaces, trim)
        phone = phone.replace(/\s+/g, "").trim();

        // Create regex that ignores spaces inside stored phone_number
        const regex = new RegExp(`^\\s*${phone.split("").join("\\s*")}\\s*$`);

        // Find all registrations that match this regex
        const registrations = await applicationCollection
          .find({ phone_number: { $regex: regex } })
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





    app.get('/registration-details/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await applicationCollection.findOne(filter)
      res.send(result)

    })


    // user collection
    app.post('/user', async (req, res) => {
      const user = req.body;
      const query = { email: user.email }
      const existingUser = await userCollection.findOne(query)
      if (existingUser) {
        return res.send({ message: "User already esists" })
      }
      const result = await userCollection.insertOne(user)
      res.send(result)
    })

    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {

      const result = await userCollection.find().toArray()
      res.send(result)
    })

    app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await userCollection.deleteOne(query)
      res.send(result)
    })

    app.patch('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          role: "admin"
        },
      };
      const result = await userCollection.updateOne(filter, updatedDoc)
      res.send(result)

    })

    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "Forbidden access" })
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === 'admin'
      }
      res.send({ admin })
    })








    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
  app.listen(port, () => {
    // console.log(`Server is running on port ${port}`);
  })
}
run().catch(console.dir);
// Triggering nodemon reload to load updated env credentials again
