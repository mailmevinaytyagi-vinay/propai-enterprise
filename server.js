require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const session = require("express-session");
const twilio = require("twilio");

const app = express();

// =========================
// TWILIO CONFIG
// =========================

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const client = twilio(accountSid, authToken);

// =========================
// MONGODB
// =========================

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ MongoDB Connected"))
.catch((err) => console.log(err));

// =========================
// SCHEMAS
// =========================
const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
  company: String,
  logo: String,
  themeColor: String
});

const LeadSchema = new mongoose.Schema({
  builder: String,
  name: String,
  phone: String,
  location: String,
  budget: String,
  timeline: String,
  text: String,
  score: Number,
  status: String,
  source: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const User = mongoose.model("User", UserSchema);
const Lead = mongoose.model("Lead", LeadSchema);

// =========================
// DEFAULT USERS
// =========================
async function seedUsers() {

  const b1 = await User.findOne({ username: "builder1" });

  if (!b1) {
    await User.create({
      username: "builder1",
      password: "1234",
      company: "Skyline Realty",
      logo: "🏢",
      themeColor: "#1e3a8a"
    });
  }

  const b2 = await User.findOne({ username: "builder2" });

  if (!b2) {
    await User.create({
      username: "builder2",
      password: "1234",
      company: "Metro Homes",
      logo: "🏠",
      themeColor: "#047857"
    });
  }
}

seedUsers();

// =========================
// MIDDLEWARE
// =========================
app.use(bodyParser.json());

app.use(session({
  secret: "propai-secret",
  resave: false,
  saveUninitialized: true
}));

app.use(express.static(__dirname));

// =========================
// AI SCORING
// =========================
function calculateLeadScore(data) {

  let score = 50;

  if (data.budget.includes("1 Cr")) {
    score += 25;
  }

  if (data.timeline === "Immediate") {
    score += 25;
  }

  if (data.timeline === "1 Month") {
    score += 15;
  }

  const text = (data.text || "").toLowerCase();

  if (
    text.includes("urgent") ||
    text.includes("ready") ||
    text.includes("finalize")
  ) {
    score += 10;
  }

  if (score > 100) {
    score = 100;
  }

  let status = "COLD ❄️";

  if (score >= 85) {
    status = "HOT 🔥";
  }
  else if (score >= 65) {
    status = "WARM 🟡";
  }

  return {
    score,
    status
  };
}

// =========================
// LOGIN
// =========================
app.post("/login", async (req, res) => {

  const user = await User.findOne({
    username: req.body.username,
    password: req.body.password
  });

  if (!user) {
    return res.send({ success: false });
  }

  req.session.user = user.username;

  res.send({
    success: true,
    company: user.company,
    logo: user.logo,
    themeColor: user.themeColor
  });
});

// =========================
// SAVE LEAD
// =========================
app.post("/qualify", async (req, res) => {

  const ai = calculateLeadScore(req.body);

  const lead = new Lead({
    builder: req.body.builder,
    name: req.body.name,
    phone: req.body.phone,
    location: req.body.location,
    budget: req.body.budget,
    timeline: req.body.timeline,
    text: req.body.text,
    source: req.body.source || "Web",
    score: ai.score,
    status: ai.status
  });

  await lead.save();

  try {

    await client.messages.create({

      from: "whatsapp:+14155238886",

to: process.env.TWILIO_TO,
      body:
`${ai.status} LEAD (${ai.score}/100)

${req.body.name}
${req.body.location}
${req.body.budget}
${req.body.timeline}`

    });

    console.log("✅ WhatsApp Sent");

  } catch (err) {

    console.log(err.message);

  }

  res.send({
    success: true,
    data: lead
  });
});

// =========================
// GET LEADS
// =========================
app.get("/leads", async (req, res) => {

  const leads = await Lead.find({
    builder: req.session.user
  }).sort({ createdAt: -1 });

  res.send(leads);
});

// =========================
// ANALYTICS
// =========================
app.get("/analytics", async (req, res) => {

  const total = await Lead.countDocuments({
    builder: req.session.user
  });

  const hot = await Lead.countDocuments({
    builder: req.session.user,
    status: "HOT 🔥"
  });

  const warm = await Lead.countDocuments({
    builder: req.session.user,
    status: "WARM 🟡"
  });

  const cold = await Lead.countDocuments({
    builder: req.session.user,
    status: "COLD ❄️"
  });

  res.send({
    total,
    hot,
    warm,
    cold
  });
});

// =========================
// TEST
// =========================
app.get("/test", (req, res) => {
  res.send("🚀 PropAI Enterprise Running");
});

// =========================
// START
// =========================
app.listen(3000, "0.0.0.0", () => {
  console.log("🚀 PropAI Enterprise Running on 3000");
});
