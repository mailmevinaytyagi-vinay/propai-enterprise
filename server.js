require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const twilio = require("twilio");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

// =========================
// TWILIO CONFIG
// =========================

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const voiceWebhookBaseUrl =
  process.env.TWILIO_VOICE_WEBHOOK_BASE_URL || process.env.PUBLIC_BASE_URL;
const twilioVoiceFrom =
  process.env.TWILIO_VOICE_FROM || process.env.TWILIO_PHONE_NUMBER;
const twilioWhatsAppFrom =
  process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

const client = twilio(accountSid, authToken);

const maxAnswerRetries = 2;
const maxOutboundCallAttempts = 3;
const retryableCallStatuses = ["failed", "no-answer", "busy", "unanswered", "cancelled", "canceled"];
const invalidAnswerClarification =
  "Sorry, main samajh nahi paaya. Kripya option clear bataiye.";
const hindiMaleTtsOptions = {
  voice: "Google.hi-IN-Standard-B",
  language: "hi-IN"
};

const qualificationQuestions = [
  {
    key: "purpose",
    label: "Buying Purpose",
    prompt: "Namaste, kya aap ye property self use ke liye dekh rahe hain ya investment ke liye?",
    retryPrompt: "Sorry, clear nahi hua. Bas bol dijiye self use, family use, investment, rental income, ya resale.",
    expected: [
      {
        value: "self use",
        patterns: ["self use", "own use", "family use", "personal use", "rehne", "rahne", "khud", "family"]
      },
      {
        value: "investment",
        patterns: ["investment", "invest", "rental income", "rent", "resale", "return", "roi"]
      }
    ]
  },
  {
    key: "configuration",
    label: "Configuration",
    prompt: "Aapko kaunsa configuration chahiye - 1 BHK, 2 BHK, 3 BHK ya kuch aur?",
    retryPrompt: "Sorry, configuration clear nahi hua. Please boliye 1 BHK, 2 BHK, 3 BHK, 4 BHK, jodi flat, shop, office, ya other.",
    expected: [
      {
        value: "1 BHK",
        patterns: ["1 bhk", "one bhk", "one b h k", "1 b h k", "single bedroom", "1 bedroom", "one bedroom"]
      },
      {
        value: "2 BHK",
        patterns: ["2 bhk", "two bhk", "two b h k", "2 b h k", "double bedroom", "2 bedroom", "two bedroom"]
      },
      {
        value: "3 BHK",
        patterns: ["3 bhk", "three bhk", "three b h k", "3 b h k", "3 bedroom", "three bedroom"]
      },
      {
        value: "4 BHK",
        patterns: ["4 bhk", "four bhk", "four b h k", "4 b h k", "4 bedroom", "four bedroom"]
      },
      {
        value: "jodi flat",
        patterns: ["jodi flat", "jodi", "combined flat", "combine flat", "two flats"]
      },
      {
        value: "shop",
        patterns: ["shop", "retail", "dukan", "commercial shop"]
      },
      {
        value: "office",
        patterns: ["office", "office space", "commercial office"]
      },
      {
        value: "other",
        patterns: ["other", "kuch aur", "something else", "different", "not sure"]
      }
    ]
  },
  {
    key: "budgetAmount",
    label: "Approximate Budget",
    prompt: "Aapka approximate budget kya hai? Jaise 50 lakh, 75 lakh, 1 crore, ya 1 crore plus.",
    retryPrompt: "Sorry, budget clear nahi hua. Please amount boliye, jaise 50 lakh, 75 lakh, 1 crore, ya 1 crore plus.",
    expected: []
  },
  {
    key: "budgetReadiness",
    label: "Budget Readiness",
    prompt: "Budget ready hai kya? Loan approval hai, loan planning mein hai, ya self funding?",
    retryPrompt: "Sorry, main samajh nahi paaya. Kripya option clear bataiye.",
    expected: [
      {
        value: "loan approved",
        patterns: ["loan approved", "loan approval", "pre approved", "bank approved", "sanctioned", "loan ho gaya", "approval hai"]
      },
      {
        value: "loan planning",
        patterns: ["loan planning", "planning loan", "loan plan", "loan lena", "loan process", "apply loan", "applying loan"]
      },
      {
        value: "self funding",
        patterns: ["self funding", "own funds", "cash", "ready funds", "funds ready", "self finance"]
      },
      {
        value: "partly ready",
        patterns: ["partly ready", "part ready", "partial ready", "part payment ready", "some funds", "thoda ready"]
      },
      {
        value: "not ready",
        patterns: ["not ready", "budget not ready", "abhi ready nahi", "not arranged", "arrange karna hai"]
      }
    ]
  },
  {
    key: "siteVisit",
    label: "Site Visit",
    prompt: "Aap site visit kab plan karna chahenge - today, tomorrow, weekend, ya next week?",
    retryPrompt: "Sorry, main samajh nahi paaya. Kripya option clear bataiye.",
    expected: [
      {
        value: "today",
        patterns: ["today", "aaj", "same day", "now"]
      },
      {
        value: "tomorrow",
        patterns: ["tomorrow", "kal"]
      },
      {
        value: "this weekend",
        patterns: ["weekend", "saturday", "sunday", "shanivar", "ravivar"]
      },
      {
        value: "next week",
        patterns: ["next week", "agla week", "coming week", "monday", "tuesday", "wednesday", "thursday", "friday"]
      },
      {
        value: "later",
        patterns: ["later", "baad mein", "bad mein", "not now", "some time later", "after some time"]
      }
    ]
  }
];

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
  intelligence: {
    intent: String,
    urgency: String,
    budgetStrength: String,
    recommendedAction: String,
    tags: [String]
  },
  outboundCall: {
    status: String,
    callSid: String,
    error: String,
    startedAt: Date,
    completedAt: Date,
    transcript: [{
      speaker: String,
      text: String,
      question: String,
      rawAnswer: String,
      normalizedAnswer: String,
      valid: Boolean,
      validationStatus: String,
      retryCount: Number,
      at: {
        type: Date,
        default: Date.now
      }
    }],
    answers: [{
      question: String,
      answer: String,
      rawAnswer: String,
      normalizedAnswer: String,
      valid: Boolean,
      validationStatus: String,
      retryCount: Number,
      answeredAt: Date
    }],
    structuredFields: {
      type: Object,
      default: {}
    },
    validationErrors: [String],
    summary: String,
    currentAttemptNumber: Number,
    retry_count: Number,
    next_retry_time: Date,
    callAttempts: [{
      retryAttemptNumber: Number,
      originalLeadId: mongoose.Schema.Types.ObjectId,
      retryTimestamp: Date,
      retryReason: String,
      status: String,
      callSid: String,
      error: String,
      startedAt: Date,
      completedAt: Date
    }],
    attempt_history: [{
      attempt: Number,
      status: String,
      type: String,
      timestamp: {
        type: Date,
        default: Date.now
      }
    }]
  },
  whatsapp_followup: {
    sent: Boolean,
    status: String,
    reason: String,
    message: String,
    timestamp: Date,
    twilio_sid: String,
    error: String
  },
  matchedProperties: [{
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property"
    },
    matchScore: Number,
    reasons: [String]
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

function parseLegacyAttemptHistoryEntry(entry) {

  if (typeof entry !== "string") {
    return entry;
  }

  const value = entry.trim();

  if (!value) {
    return {
      status: "unknown"
    };
  }

  try {
    const parsedValue = JSON.parse(value);

    if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
      return parsedValue;
    }

    return {
      status: String(parsedValue || value)
    };
  }
  catch (err) {
    return {
      status: value
    };
  }
}

function normalizeAttemptHistoryEntry(entry, index) {

  const normalizedEntry = parseLegacyAttemptHistoryEntry(entry) || {};
  const timestamp = normalizedEntry.timestamp ||
    normalizedEntry.retryTimestamp ||
    normalizedEntry.startedAt ||
    normalizedEntry.completedAt ||
    new Date();

  return {
    attempt: normalizedEntry.attempt ||
      normalizedEntry.retryAttemptNumber ||
      index + 1,
    status: normalizedEntry.status ||
      (typeof entry === "string" ? entry : "unknown"),
    type: normalizedEntry.type ||
      normalizedEntry.retryReason ||
      "Legacy attempt",
    timestamp
  };
}

function normalizeLeadAttemptHistory(lead) {
  if (!lead.outboundCall) lead.outboundCall = {};

  if (!Array.isArray(lead.outboundCall.attempt_history)) {
    lead.outboundCall.attempt_history = [];
  }

  lead.outboundCall.attempt_history = lead.outboundCall.attempt_history.map((item, index) => {
    if (typeof item === "string") {
      return {
        attempt: index + 1,
        status: item,
        type: "Legacy attempt",
        timestamp: new Date()
      };
    }
    return item;
  });

  if (!lead.outboundCall.structuredFields) {
    lead.outboundCall.structuredFields = {};
  }
}

const PropertySchema = new mongoose.Schema({
  builder: String,
  title: String,
  location: String,
  price: Number,
  budgetLabel: String,
  bhk: Number,
  possession: String,
  amenities: [String],
  description: String,
  active: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const User = mongoose.model("User", UserSchema);
const Lead = mongoose.model("Lead", LeadSchema);
const Property = mongoose.model("Property", PropertySchema);

const defaultBuilders = {
  builder1: {
    username: "builder1",
    password: "1234",
    company: "Skyline Realty",
    logo: "🏢",
    themeColor: "#1e3a8a"
  },
  builder2: {
    username: "builder2",
    password: "1234",
    company: "Metro Homes",
    logo: "🏠",
    themeColor: "#047857"
  }
};

const defaultProperties = [
  {
    builder: "builder1",
    title: "Skyline Lakeview 2BHK",
    location: "Thane",
    price: 7400000,
    budgetLabel: "74 lakh",
    bhk: 2,
    possession: "Immediate",
    amenities: ["Clubhouse", "Gym", "Parking"],
    description: "Ready 2BHK near schools and upcoming metro corridor."
  },
  {
    builder: "builder1",
    title: "Skyline Central 3BHK",
    location: "Thane",
    price: 11800000,
    budgetLabel: "1.18 Cr",
    bhk: 3,
    possession: "Immediate",
    amenities: ["Pool", "Gym", "Station Access"],
    description: "Ready 3BHK close to station for urgent buyers."
  },
  {
    builder: "builder1",
    title: "Skyline Palm Residences",
    location: "Navi Mumbai",
    price: 9300000,
    budgetLabel: "93 lakh",
    bhk: 2,
    possession: "1 Month",
    amenities: ["Garden", "Security", "Parking"],
    description: "Spacious 2BHK with fast possession and family amenities."
  },
  {
    builder: "builder2",
    title: "Metro Green 1BHK",
    location: "Panvel",
    price: 5200000,
    budgetLabel: "52 lakh",
    bhk: 1,
    possession: "Immediate",
    amenities: ["Security", "Parking"],
    description: "Efficient ready home near the highway."
  },
  {
    builder: "builder2",
    title: "Metro Heights 2BHK",
    location: "Navi Mumbai",
    price: 8400000,
    budgetLabel: "84 lakh",
    bhk: 2,
    possession: "1 Month",
    amenities: ["Clubhouse", "Gym", "Garden"],
    description: "Well-connected home for buyers planning possession soon."
  },
  {
    builder: "builder2",
    title: "Metro Signature 3BHK",
    location: "Navi Mumbai",
    price: 12900000,
    budgetLabel: "1.29 Cr",
    bhk: 3,
    possession: "Immediate",
    amenities: ["Pool", "Concierge", "Station Access"],
    description: "Premium ready apartment near business hubs and station."
  }
];

// =========================
// DEFAULT USERS
// =========================
async function seedUsers() {

  const b1 = await User.findOne({ username: defaultBuilders.builder1.username });

  if (!b1) {
    await User.create(defaultBuilders.builder1);
  }
  else {
    await User.updateOne(
      { username: defaultBuilders.builder1.username },
      { $set: profileDefaults(b1) }
    );
  }

  const b2 = await User.findOne({ username: defaultBuilders.builder2.username });

  if (!b2) {
    await User.create(defaultBuilders.builder2);
  }
  else {
    await User.updateOne(
      { username: defaultBuilders.builder2.username },
      { $set: profileDefaults(b2) }
    );
  }
}

seedUsers();

async function seedProperties() {

  for (const property of defaultProperties) {

    const exists = await Property.findOne({
      builder: property.builder,
      title: property.title
    });

    if (!exists) {
      await Property.create(property);
    }
  }
}

seedProperties();

// =========================
// MIDDLEWARE
// =========================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use(express.static(__dirname));

function builderRoom(builder) {
  return `builder:${builder}`;
}

function profileDefaults(user) {

  const defaults = defaultBuilders[user.username] || {};

  return {
    company: user.company || defaults.company || user.username,
    logo: user.logo || defaults.logo || "🏠",
    themeColor: user.themeColor || defaults.themeColor || "#1e3a8a"
  };
}

async function findBuilder(username) {

  return User.findOne({
    username
  });
}

io.on("connection", (socket) => {

  socket.on("builder:join", async (payload, callback) => {

    const builder = payload && payload.builder;

    const user = builder ? await findBuilder(builder) : null;

    if (!user) {
      if (callback) {
        callback({ success: false });
      }
      return;
    }

    socket.join(builderRoom(builder));

    if (callback) {
      callback({ success: true });
    }
  });
});

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

  return {
    score,
    status: getStatusFromScore(score)
  };
}

function generateLeadIntelligence(data, score) {

  const text = (data.text || "").toLowerCase();
  const tags = [];

  if (
    text.includes("urgent") ||
    text.includes("ready") ||
    text.includes("finalize") ||
    data.timeline === "Immediate"
  ) {
    tags.push("urgent");
  }

  if (text.includes("station")) {
    tags.push("station-preference");
  }

  if (inferBhk(text)) {
    tags.push("bhk-specified");
  }

  if (data.budget === "1 Cr+") {
    tags.push("premium-budget");
  }

  let intent = "Early stage inquiry";

  if (score >= 85) {
    intent = "High purchase intent";
  }
  else if (score >= 65) {
    intent = "Moderate purchase intent";
  }

  const urgency = data.timeline === "Immediate"
    ? "Immediate"
    : data.timeline || "Not specified";

  const budgetStrength = data.budget === "1 Cr+"
    ? "Premium budget"
    : "Standard budget";

  const recommendedAction = score >= 85
    ? "Call immediately and offer a site visit"
    : score >= 65
      ? "Share matched inventory and schedule follow-up"
      : "Nurture with project details and financing options";

  return {
    intent,
    urgency,
    budgetStrength,
    recommendedAction,
    tags
  };
}

function getBudgetRange(budget) {

  if (budget === "50-80 lakh") {
    return {
      min: 5000000,
      max: 8000000
    };
  }

  if (budget === "80 lakh - 1 Cr") {
    return {
      min: 8000000,
      max: 10000000
    };
  }

  if (budget === "1 Cr+") {
    return {
      min: 10000000,
      max: 20000000
    };
  }

  return {
    min: 0,
    max: Number.MAX_SAFE_INTEGER
  };
}

function inferBhk(text) {

  const normalized = (text || "").toLowerCase();

  const match = normalized.match(/([1-5])\s*(bhk|bed|bedroom)/);

  return match ? Number(match[1]) : null;
}

function scorePropertyMatch(lead, property) {

  let score = 0;
  const reasons = [];
  const budgetRange = getBudgetRange(lead.budget);
  const requestedBhk = inferBhk(lead.text);
  const normalizedText = (lead.text || "").toLowerCase();

  if (property.location === lead.location) {
    score += 35;
    reasons.push(`Location match in ${property.location}`);
  }

  if (property.price >= budgetRange.min && property.price <= budgetRange.max) {
    score += 30;
    reasons.push(`Fits ${lead.budget} budget`);
  }
  else if (property.price <= budgetRange.max * 1.15) {
    score += 12;
    reasons.push("Close to selected budget");
  }

  if (property.possession === lead.timeline) {
    score += 20;
    reasons.push(`${property.possession} possession`);
  }
  else if (lead.timeline === "1-3 Months" && property.possession === "1 Month") {
    score += 12;
    reasons.push("Possession aligns with 1-3 month plan");
  }

  if (requestedBhk && property.bhk === requestedBhk) {
    score += 10;
    reasons.push(`${property.bhk}BHK requirement match`);
  }

  if (
    normalizedText.includes("station") &&
    property.amenities.includes("Station Access")
  ) {
    score += 8;
    reasons.push("Station access preference match");
  }

  if (
    normalizedText.includes("ready") &&
    property.possession === "Immediate"
  ) {
    score += 7;
    reasons.push("Ready-to-move preference match");
  }

  return {
    score: Math.min(score, 100),
    reasons
  };
}

async function findPropertyMatches(lead) {

  const properties = await Property.find({
    builder: lead.builder,
    active: true
  });

  return properties
    .map((property) => {

      const match = scorePropertyMatch(lead, property);

      return {
        property,
        matchScore: match.score,
        reasons: match.reasons
      };
    })
    .filter((match) => match.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 3);
}

function serializePropertyMatch(match) {

  return {
    id: match.property._id,
    title: match.property.title,
    location: match.property.location,
    price: match.property.price,
    budgetLabel: match.property.budgetLabel,
    bhk: match.property.bhk,
    possession: match.property.possession,
    amenities: match.property.amenities,
    description: match.property.description,
    matchScore: match.matchScore,
    reasons: match.reasons
  };
}

async function getAnalyticsForBuilder(builder) {

  const total = await Lead.countDocuments({
    builder
  });

  const hot = await Lead.countDocuments({
    builder,
    status: { $in: ["HOT", "HOT 🔥"] }
  });

  const warm = await Lead.countDocuments({
    builder,
    status: { $in: ["WARM", "WARM 🟡"] }
  });

  const cold = await Lead.countDocuments({
    builder,
    status: { $in: ["COLD", "COLD ❄️"] }
  });

  return {
    total,
    hot,
    warm,
    cold
  };
}

function sendBuilderProfile(res, user) {

  const profile = profileDefaults(user);

  res.send({
    username: user.username,
    company: profile.company,
    logo: profile.logo,
    themeColor: profile.themeColor
  });
}

function buildVoiceWebhookUrl(pathname) {

  if (!voiceWebhookBaseUrl) {
    return null;
  }

  return `${voiceWebhookBaseUrl.replace(/\/$/, "")}${pathname}`;
}

function formatIndianPhoneNumber(phone) {

  let rawPhone = String(phone || "").replace(/\D/g, "");

  if (!rawPhone) {
    return "";
  }

  if (rawPhone.length === 11 && rawPhone.startsWith("0")) {
    rawPhone = rawPhone.slice(1);
  }

  if (rawPhone.length === 10) {
    return "+91" + rawPhone;
  }

  if (rawPhone.length === 12 && rawPhone.startsWith("91")) {
    return "+" + rawPhone;
  }

  return rawPhone.startsWith("+") ? rawPhone : "+" + rawPhone;
}

function getLeadCompany(lead) {

  const defaults = defaultBuilders[lead.builder] || {};

  return defaults.company || lead.builder || "our company";
}

function appendCallTranscript(lead, speaker, text) {

  if (!text) {
    return;
  }

  if (!lead.outboundCall) {
    lead.outboundCall = {};
  }

  if (!Array.isArray(lead.outboundCall.transcript)) {
    lead.outboundCall.transcript = [];
  }

  lead.outboundCall.transcript.push({
    speaker,
    text
  });
}

function appendAnswerTranscript(lead, question, rawAnswer, normalizedAnswer, valid, retryCount) {

  if (!lead.outboundCall) {
    lead.outboundCall = {};
  }

  if (!Array.isArray(lead.outboundCall.transcript)) {
    lead.outboundCall.transcript = [];
  }

  lead.outboundCall.transcript.push({
    speaker: "customer",
    text: rawAnswer || "Unknown",
    question: question.label,
    rawAnswer: rawAnswer || "Unknown",
    normalizedAnswer: normalizedAnswer || "Unknown",
    valid,
    validationStatus: valid ? "valid" : "invalid",
    retryCount
  });
}

function normalizeCallText(value) {

  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getQuestionPrompt(step) {

  return qualificationQuestions[step] && qualificationQuestions[step].prompt;
}

function getDtmfAnswer(question, digits) {

  const index = Number(digits) - 1;

  if (
    !digits ||
    Number.isNaN(index) ||
    !Array.isArray(question.expected) ||
    !question.expected[index]
  ) {
    return null;
  }

  return question.expected[index].value;
}

function normalizeSpokenNumbers(value) {

  const numberWords = {
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
    twenty: "20",
    thirty: "30",
    forty: "40",
    fifty: "50",
    sixty: "60",
    seventy: "70",
    eighty: "80",
    ninety: "90"
  };

  return value
    .split(" ")
    .map((word) => numberWords[word] || word)
    .join(" ");
}

function validateBudgetAnswer(rawAnswer) {

  const normalized = normalizeSpokenNumbers(normalizeCallText(rawAnswer))
    .replace(/\blac\b/g, "lakh")
    .replace(/\blacs\b/g, "lakh")
    .replace(/\blakhs\b/g, "lakh")
    .replace(/\bcr\b/g, "crore")
    .replace(/\bcrores\b/g, "crore");

  if (
    !normalized ||
    /\b[a-z]*k\b/.test(normalized) ||
    !/\d/.test(normalized)
  ) {
    return {
      valid: false,
      normalizedAnswer: "",
      answer: rawAnswer || "No answer captured"
    };
  }

  const croreMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(crore|cr)\b/);
  const lakhMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(lakh|lac)\b/);
  const numericOnlyMatch = normalized.match(/^(\d{7,})$/);

  let amount = 0;
  let display = "";

  if (croreMatch) {
    amount = Number(croreMatch[1]) * 10000000;
    display = `${croreMatch[1]} crore`;
  }
  else if (lakhMatch) {
    amount = Number(lakhMatch[1]) * 100000;
    display = `${lakhMatch[1]} lakh`;
  }
  else if (numericOnlyMatch) {
    amount = Number(numericOnlyMatch[1]);
    display = amount >= 10000000
      ? `${Number((amount / 10000000).toFixed(2))} crore`
      : `${Number((amount / 100000).toFixed(2))} lakh`;
  }

  if (!amount || amount < 1000000) {
    return {
      valid: false,
      normalizedAnswer: "",
      answer: rawAnswer
    };
  }

  if (/\b(plus|above|more|higher)\b/.test(normalized)) {
    display += " plus";
  }

  return {
    valid: true,
    normalizedAnswer: display,
    answer: rawAnswer
  };
}

function validateSiteVisitAnswer(rawAnswer) {

  const normalized = normalizeCallText(rawAnswer);

  const datePatterns = [
    /\b\d{1,2}\s*(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/,
    /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s*\d{1,2}\b/,
    /\b\d{1,2}\s+\d{1,2}\s+\d{2,4}\b/,
    /\b\d{1,2}\s+\d{1,2}\b/
  ];

  const hasSpecificDate = datePatterns.some((pattern) =>
    pattern.test(normalized)
  );

  if (!hasSpecificDate) {
    return null;
  }

  return {
    valid: true,
    normalizedAnswer: "specific date",
    answer: rawAnswer
  };
}

function validateQualificationAnswer(question, rawAnswer) {

  const normalized = normalizeCallText(rawAnswer);

  if (!normalized) {
    return {
      valid: false,
      normalizedAnswer: "",
      answer: "No answer captured"
    };
  }

  if (question.key === "budgetAmount") {
    return validateBudgetAnswer(rawAnswer);
  }

  for (const option of question.expected) {
    const matched = option.patterns.some((pattern) =>
      normalized.includes(normalizeCallText(pattern))
    );

    if (matched) {
      return {
        valid: true,
        normalizedAnswer: option.value,
        answer: rawAnswer
      };
    }
  }

  if (question.key === "siteVisit") {
    const siteVisitValidation = validateSiteVisitAnswer(rawAnswer);

    if (siteVisitValidation) {
      return siteVisitValidation;
    }
  }

  return {
    valid: false,
    normalizedAnswer: "",
    answer: rawAnswer
  };
}

function getCompletedCallAnswers(lead) {

  const answers = (lead.outboundCall && lead.outboundCall.answers) || [];

  return qualificationQuestions.reduce((result, question, index) => {

    const answer = answers[index];

    result[question.key] = answer && answer.valid
      ? answer.normalizedAnswer || answer.answer
      : "";

    return result;
  }, {});
}

function getStatusFromScore(score) {

  if (score >= 85) {
    return "HOT 🔥";
  }

  if (score >= 65) {
    return "WARM 🟡";
  }

  return "COLD ❄️";
}

function getPlainLeadStatus(status) {

  if ((status || "").includes("PENDING")) {
    return "PENDING";
  }

  if ((status || "").includes("HOT")) {
    return "HOT";
  }

  if ((status || "").includes("WARM")) {
    return "WARM";
  }

  if ((status || "").includes("COLD")) {
    return "COLD";
  }

  return "PENDING";
}

function hasQualifiedValue(value) {

  const text = String(value || "").trim();

  return Boolean(text) && !["unknown", "null", "undefined", "pending"].includes(text.toLowerCase());
}

function isDisqualifiedValue(value) {

  const text = String(value || "").trim().toLowerCase();

  return text.includes("not interested") ||
    text.includes("disqualified") ||
    text.includes("invalid budget");
}

function calculateLeadStatus(lead) {

  const call = lead.outboundCall || {};
  const status = String(call.status || "").toLowerCase();
  const fields = call.structuredFields || {};
  const values = {
    purpose: fields.purpose,
    configuration: fields.configuration,
    budget: fields.budget,
    fundingStatus: fields.funding || fields.fundingStatus,
    siteVisit: fields.siteVisit
  };
  const fieldValues = Object.values(values);

  if (
    fieldValues.some(isDisqualifiedValue) ||
    ((call.validationErrors || []).some(isDisqualifiedValue))
  ) {
    return "COLD";
  }

  const validCount = fieldValues.filter(hasQualifiedValue).length;

  if (
    ["no-answer", "busy", "unanswered", "failed", "cancelled", "canceled"].includes(status) ||
    validCount === 0
  ) {
    return "PENDING";
  }

  if (validCount === fieldValues.length) {
    return "HOT";
  }

  return "WARM";
}

function displayStructuredValue(value) {

  return hasQualifiedValue(value)
    ? value
    : "Pending";
}

function getCallStructuredFields(lead) {

  const answers = getCompletedCallAnswers(lead);

  return {
    purpose: displayStructuredValue(answers.purpose),
    configuration: displayStructuredValue(answers.configuration),
    budget: displayStructuredValue(answers.budgetAmount),
    funding: displayStructuredValue(answers.budgetReadiness),
    siteVisit: displayStructuredValue(answers.siteVisit)
  };
}

function filterQualifiedFields(fields) {

  return Object.keys(fields || {}).reduce((result, key) => {
    if (hasQualifiedValue(fields[key])) {
      result[key] = fields[key];
    }

    return result;
  }, {});
}

function getCallValidationErrors(lead) {

  const answers = (lead.outboundCall && lead.outboundCall.answers) || [];

  return answers
    .filter((answer) => answer && !answer.valid)
    .map((answer) => `${answer.question}: ${answer.answer || "Unknown"}`);
}

// Structured qualification update: summary and scoring must use only stored call answers.
function updateStructuredQualification(lead) {

  lead.outboundCall = lead.outboundCall || {};
  const existingLeadData = filterQualifiedFields(lead.outboundCall.structuredFields || {});
  const filteredNewValues = filterQualifiedFields(getCallStructuredFields(lead));

  lead.outboundCall.structuredFields = {
    ...existingLeadData,
    ...filteredNewValues
  };
  lead.outboundCall.validationErrors = getCallValidationErrors(lead);
}

function calculateCallLeadScore(lead) {

  const qualifiedStatus = calculateLeadStatus(lead);

  if (qualifiedStatus === "PENDING") {
    return {
      score: lead.score || 0,
      status: "PENDING"
    };
  }

  if (qualifiedStatus === "COLD") {
    return {
      score: 40,
      status: "COLD"
    };
  }

  if (qualifiedStatus === "HOT") {
    return {
      score: 90,
      status: "HOT"
    };
  }

  if (qualifiedStatus === "WARM") {
    return {
      score: 70,
      status: "WARM"
    };
  }

  return {
    score: 0,
    status: "PENDING"
  };
}

function buildQualificationSummary(lead) {

  const fields = (lead.outboundCall && lead.outboundCall.structuredFields) ||
    getCallStructuredFields(lead);
  const status = getPlainLeadStatus(lead.status);

  return `${lead.name || "Unknown"} is a ${status} lead for ${lead.location || "Unknown"}. Purpose: ${displayStructuredValue(fields.purpose)}. Configuration: ${displayStructuredValue(fields.configuration)}. Budget: ${displayStructuredValue(fields.budget)}. Funding: ${displayStructuredValue(fields.funding)}. Site visit: ${displayStructuredValue(fields.siteVisit)}.`;
}

function addQuestionGather(twiml, leadId, step, retryCount = 0, promptOverride = "") {

  const question = qualificationQuestions[step];

  if (!question) {
    return;
  }

  const gather = twiml.gather({
    input: "speech dtmf",
    numDigits: 1,
    timeout: 5,
    speechTimeout: "auto",
    action: `/voice/hot-lead/${leadId}/answer?step=${step}&retry=${retryCount}`,
    method: "POST"
  });

  gather.say(hindiMaleTtsOptions, promptOverride || question.prompt);

  twiml.redirect({
    method: "POST"
  }, `/voice/hot-lead/${leadId}/repeat?step=${step}&retry=${retryCount}`);
}

function ensureOutboundCallAttempts(lead) {

  lead.outboundCall = lead.outboundCall || {};

  if (!Array.isArray(lead.outboundCall.callAttempts)) {
    lead.outboundCall.callAttempts = [];
  }

  if (!lead.outboundCall.callAttempts.length && (lead.outboundCall.status || lead.outboundCall.callSid)) {
    lead.outboundCall.callAttempts.push({
      retryAttemptNumber: 1,
      originalLeadId: lead._id,
      retryTimestamp: lead.outboundCall.startedAt || lead.createdAt || new Date(),
      retryReason: "Initial outbound call",
      status: lead.outboundCall.status || "unknown",
      callSid: lead.outboundCall.callSid,
      error: lead.outboundCall.error,
      startedAt: lead.outboundCall.startedAt,
      completedAt: lead.outboundCall.completedAt
    });
  }

  syncOutboundAttemptMetadata(lead);

  return lead.outboundCall.callAttempts;
}

function syncOutboundAttemptMetadata(lead) {

  lead.outboundCall = lead.outboundCall || {};
  normalizeLeadAttemptHistory(lead);

  const attempts = Array.isArray(lead.outboundCall.callAttempts)
    ? lead.outboundCall.callAttempts
    : [];

  if (attempts.length) {
    lead.outboundCall.attempt_history = attempts.map((attempt, index) => ({
      attempt: attempt.retryAttemptNumber || index + 1,
      status: attempt.status || "unknown",
      type: attempt.retryReason || (index === 0 ? "Initial outbound call" : "Manual retry"),
      timestamp: attempt.retryTimestamp || attempt.startedAt || attempt.completedAt || new Date()
    }));
  }

  lead.outboundCall.retry_count = Math.max(0, attempts.length - 1);
}

function updateNextRetryTime(lead) {

  const call = lead.outboundCall || {};
  const attempts = call.callAttempts || [];

  if (
    retryableCallStatuses.includes(call.status) &&
    attempts.length < maxOutboundCallAttempts
  ) {
    call.next_retry_time = new Date(Date.now() + 60 * 60 * 1000);
    return;
  }

  call.next_retry_time = null;
}

function getWhatsAppFollowupMessage(lead, reason) {

  const status = calculateLeadStatus(lead);
  const fields = (lead.outboundCall && lead.outboundCall.structuredFields) || {};
  const name = hasQualifiedValue(lead.name) ? lead.name : "there";
  const callReason = String(reason || "").toLowerCase();

  if (status === "COLD") {
    return "";
  }

  if (callReason === "busy" || callReason === "no-answer" || callReason === "unanswered") {
    return `Hi ${name}, we tried calling regarding your property enquiry. Please reply with a convenient time.`;
  }

  if (status === "HOT") {
    return `Hi ${name}, thank you for speaking with us. Based on your requirement for ${displayStructuredValue(fields.configuration)} in Navi Mumbai with budget ${displayStructuredValue(fields.budget)}, our team will share suitable options shortly.`;
  }

  return `Hi ${name}, thank you for your interest. We have noted your requirement and our team will contact you.`;
}

function getManualWhatsAppFollowupMessage(lead) {

  const name = hasQualifiedValue(lead.name) ? lead.name : "there";
  const status = calculateLeadStatus(lead);

  if (status === "PENDING") {
    return `Hi ${name}, we tried calling you regarding your property enquiry. Please reply with a convenient time for a callback.`;
  }

  return getWhatsAppFollowupMessage(lead, "manual-dashboard") ||
    `Hi ${name}, we tried calling you regarding your property enquiry. Please reply with a convenient time for a callback.`;
}

async function sendWhatsAppFollowup(lead, reason, manual = false) {

  console.log("📲 sendWhatsAppFollowup entered");
  lead.whatsapp_followup = lead.whatsapp_followup || {};

  if (lead.whatsapp_followup.sent && !manual) {
    return lead.whatsapp_followup;
  }

  const message = manual
    ? getManualWhatsAppFollowupMessage(lead)
    : getWhatsAppFollowupMessage(lead, reason);

  if (!message) {
    lead.whatsapp_followup = {
      sent: false,
      status: "skipped",
      reason,
      message: "",
      timestamp: new Date(),
      twilio_sid: "",
      error: ""
    };
    normalizeLeadAttemptHistory(lead);
    await lead.save();
    return lead.whatsapp_followup;
  }

  const formattedPhone = formatIndianPhoneNumber(lead.phone);
  const whatsappTo = formattedPhone ? `whatsapp:${formattedPhone}` : "";

  if (!formattedPhone || !twilioWhatsAppFrom || !accountSid || !authToken) {
    lead.whatsapp_followup = {
      sent: false,
      status: "failed",
      reason,
      message,
      timestamp: new Date(),
      twilio_sid: "",
      error: "Twilio WhatsApp is not configured"
    };
    normalizeLeadAttemptHistory(lead);
    await lead.save();
    return lead.whatsapp_followup;
  }

  try {
    console.log("📲 WhatsApp From:", process.env.TWILIO_WHATSAPP_FROM);
    console.log("📲 WhatsApp To:", whatsappTo);
    console.log("📲 WhatsApp Message:", message);

    const msg = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: whatsappTo,
      body: message
    });
    console.log("✅ WhatsApp SID:", msg.sid);

    lead.whatsapp_followup = {
      sent: true,
      status: "sent",
      reason,
      message,
      timestamp: new Date(),
      twilio_sid: msg.sid,
      error: ""
    };
  }
  catch (err) {
    console.error("❌ WhatsApp send failed:", err.message);
    console.error(err);

    lead.whatsapp_followup = {
      sent: false,
      status: "failed",
      reason,
      message,
      timestamp: new Date(),
      twilio_sid: "",
      error: err.message
    };
  }

  normalizeLeadAttemptHistory(lead);
  await lead.save();
  return lead.whatsapp_followup;
}

function updateCurrentCallAttempt(lead, updates) {

  const attempts = ensureOutboundCallAttempts(lead);
  const currentAttemptNumber = lead.outboundCall.currentAttemptNumber || attempts.length;
  const attempt = attempts.find((item) => item.retryAttemptNumber === currentAttemptNumber) ||
    attempts[attempts.length - 1];

  if (attempt) {
    Object.keys(updates).forEach((key) => {
      if (updates[key] !== undefined) {
        attempt[key] = updates[key];
      }
    });
    syncOutboundAttemptMetadata(lead);
  }
}

function updateCallAttemptBySid(lead, callSid, updates) {

  const attempts = ensureOutboundCallAttempts(lead);
  const attempt = callSid
    ? attempts.find((item) => item.callSid === callSid)
    : null;

  if (attempt) {
    Object.keys(updates).forEach((key) => {
      if (updates[key] !== undefined) {
        attempt[key] = updates[key];
      }
    });
    syncOutboundAttemptMetadata(lead);
    return attempt;
  }

  updateCurrentCallAttempt(lead, updates);
  return null;
}

async function startHotLeadOutboundCall(lead, options = {}) {

  const isRetry = options.isRetry === true;
  const retryReason = options.retryReason || "Manual retry";

  const attempts = ensureOutboundCallAttempts(lead);
  const attemptNumber = isRetry ? attempts.length + 1 : 1;
  const startedAt = new Date();
  const existingOutboundCall = lead.outboundCall || {};

  if (!lead.phone) {
    lead.outboundCall = {
      status: "skipped",
      error: "Lead phone number is missing",
      structuredFields: existingOutboundCall.structuredFields,
      validationErrors: existingOutboundCall.validationErrors,
      summary: existingOutboundCall.summary,
      currentAttemptNumber: attemptNumber,
      callAttempts: attempts
    };
    attempts.push({
      retryAttemptNumber: attemptNumber,
      originalLeadId: lead._id,
      retryTimestamp: startedAt,
      retryReason: isRetry ? retryReason : "Initial outbound call",
      status: "skipped",
      error: "Lead phone number is missing",
      startedAt
    });
    syncOutboundAttemptMetadata(lead);
    updateNextRetryTime(lead);
    lead.status = calculateLeadStatus(lead);
    normalizeLeadAttemptHistory(lead);
    await lead.save();
    return;
  }

  const webhookUrl = buildVoiceWebhookUrl(`/voice/hot-lead/${lead._id}`);
  const missingTwilioConfig = [];

  if (!accountSid) missingTwilioConfig.push("TWILIO_ACCOUNT_SID");
  if (!authToken) missingTwilioConfig.push("TWILIO_AUTH_TOKEN");
  if (!twilioVoiceFrom) missingTwilioConfig.push("TWILIO_PHONE_NUMBER");
  if (!webhookUrl) missingTwilioConfig.push("TWILIO_VOICE_WEBHOOK_BASE_URL or PUBLIC_BASE_URL");

  if (missingTwilioConfig.length) {
    console.error("❌ Twilio Voice config missing:", missingTwilioConfig.join(", "));
    lead.outboundCall = {
      status: "skipped",
      error: "Twilio Voice is not configured. Set TWILIO_VOICE_WEBHOOK_BASE_URL or PUBLIC_BASE_URL, TWILIO_VOICE_FROM, TWILIO_ACCOUNT_SID, and TWILIO_AUTH_TOKEN.",
      structuredFields: existingOutboundCall.structuredFields,
      validationErrors: existingOutboundCall.validationErrors,
      summary: existingOutboundCall.summary,
      currentAttemptNumber: attemptNumber,
      callAttempts: attempts
    };
    attempts.push({
      retryAttemptNumber: attemptNumber,
      originalLeadId: lead._id,
      retryTimestamp: startedAt,
      retryReason: isRetry ? retryReason : "Initial outbound call",
      status: "skipped",
      error: lead.outboundCall.error,
      startedAt
    });
    syncOutboundAttemptMetadata(lead);
    updateNextRetryTime(lead);
    lead.status = calculateLeadStatus(lead);
    normalizeLeadAttemptHistory(lead);
    await lead.save();
    return;
  }

try
{
const formattedPhone = formatIndianPhoneNumber(lead.phone);
console.log("📞 Twilio formatted phone:", formattedPhone);

const call = await client.calls.create({
      to: formattedPhone,
      from: twilioVoiceFrom,
      url: webhookUrl,
      method: "POST",
      statusCallback: buildVoiceWebhookUrl(`/voice/hot-lead/${lead._id}/status`),
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"]
});
console.log("✅ Twilio call SID:", call.sid);

    attempts.push({
      retryAttemptNumber: attemptNumber,
      originalLeadId: lead._id,
      retryTimestamp: startedAt,
      retryReason: isRetry ? retryReason : "Initial outbound call",
      status: "queued",
      callSid: call.sid,
      startedAt
    });

    lead.outboundCall = {
      status: "queued",
      callSid: call.sid,
      startedAt,
      transcript: [],
      answers: [],
      structuredFields: existingOutboundCall.structuredFields,
      validationErrors: existingOutboundCall.validationErrors,
      summary: existingOutboundCall.summary,
      currentAttemptNumber: attemptNumber,
      callAttempts: attempts
    };
    syncOutboundAttemptMetadata(lead);
    updateNextRetryTime(lead);
    lead.status = calculateLeadStatus(lead);
    normalizeLeadAttemptHistory(lead);
    await lead.save();
  }
  catch (err) {
    attempts.push({
      retryAttemptNumber: attemptNumber,
      originalLeadId: lead._id,
      retryTimestamp: startedAt,
      retryReason: isRetry ? retryReason : "Initial outbound call",
      status: "failed",
      error: err.message,
      startedAt
    });
    lead.outboundCall = {
      status: "failed",
      error: err.message,
      structuredFields: existingOutboundCall.structuredFields,
      validationErrors: existingOutboundCall.validationErrors,
      summary: existingOutboundCall.summary,
      currentAttemptNumber: attemptNumber,
      callAttempts: attempts
    };
    syncOutboundAttemptMetadata(lead);
    updateNextRetryTime(lead);
    lead.status = calculateLeadStatus(lead);
    normalizeLeadAttemptHistory(lead);
    await lead.save();
    console.log(err.message);
  }
}

// =========================
// BUILDER DASHBOARDS
// =========================
// Dashboard route compatibility: keep builder dashboards and add default /dashboard.
app.get("/dashboard", async (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/dashboard/:builder", async (req, res) => {

  const user = await findBuilder(req.params.builder);

  if (!user) {
    return res.status(404).send("Builder dashboard not found");
  }

  res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/builders/:builder", async (req, res) => {

  const user = await findBuilder(req.params.builder);

  if (!user) {
    return res.status(404).send({ error: "Builder not found" });
  }

  sendBuilderProfile(res, user);
});

app.get("/builders/:builder/leads", async (req, res) => {

  const user = await findBuilder(req.params.builder);

  if (!user) {
    return res.status(404).send([]);
  }

  const leads = await Lead.find({
    builder: user.username
  })
  .populate("matchedProperties.property")
  .sort({ createdAt: -1 });

  res.send(leads);
});

app.post("/builders/:builder/leads/:leadId/retry-call", async (req, res) => {

  const user = await findBuilder(req.params.builder);

  if (!user) {
    return res.status(404).send({
      success: false,
      message: "Builder not found"
    });
  }

  const lead = await Lead.findOne({
    _id: req.params.leadId,
    builder: user.username
  });

  if (!lead) {
    return res.status(404).send({
      success: false,
      message: "Lead not found"
    });
  }

  const currentStatus = lead.outboundCall && lead.outboundCall.status;

  if (!retryableCallStatuses.includes(currentStatus)) {
    return res.status(400).send({
      success: false,
      message: "Call status is not eligible for retry"
    });
  }

  const attempts = ensureOutboundCallAttempts(lead);

  if (attempts.length >= maxOutboundCallAttempts) {
    return res.status(400).send({
      success: false,
      message: "Maximum retry limit reached"
    });
  }

  const retryReason = req.body.retryReason || currentStatus || "Manual retry";

  await startHotLeadOutboundCall(lead, {
    isRetry: true,
    retryReason
  });

  const updatedLead = await Lead.findById(lead._id)
    .populate("matchedProperties.property");
  const analytics = await getAnalyticsForBuilder(user.username);
  const responseLead = updatedLead ? updatedLead.toObject() : lead.toObject();

  io.to(builderRoom(user.username)).emit("dashboard:update", {
    lead: responseLead,
    analytics,
    matches: []
  });

  if (
    lead.outboundCall &&
    ["failed", "skipped"].includes(lead.outboundCall.status) &&
    lead.outboundCall.error
  ) {
    return res.status(502).send({
      success: false,
      message: "Retry failed. Please check call configuration.",
      lead: responseLead
    });
  }

  res.send({
    success: true,
    lead: responseLead
  });
});

app.post("/api/leads/:id/whatsapp-followup", async (req, res) => {

  try {
    console.log("📲 WhatsApp route entered");
    const leadId = req.params.id;
    console.log("📲 WhatsApp request:", leadId);

    const lead = await Lead.findById(leadId);
    console.log("📲 Lead found:", lead?._id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead not found"
      });
    }

    console.log("📲 Calling sendWhatsAppFollowup now");
    const result =
      await sendWhatsAppFollowup(
        lead,
        "manual-dashboard",
        true
      );

    return res.json({
      success: true,
      message: "WhatsApp follow-up sent",
      whatsapp_followup: result
    });
  }
  catch (err) {
    console.error(
      "WhatsApp API error:",
      err
    );

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get("/builders/:builder/analytics", async (req, res) => {

  const user = await findBuilder(req.params.builder);

  if (!user) {
    return res.status(404).send({
      total: 0,
      hot: 0,
      warm: 0,
      cold: 0
    });
  }

  const analytics = await getAnalyticsForBuilder(user.username);

  res.send(analytics);
});

app.get("/builders/:builder/properties", async (req, res) => {

  const user = await findBuilder(req.params.builder);

  if (!user) {
    return res.status(404).send([]);
  }

  const properties = await Property.find({
    builder: user.username,
    active: true
  }).sort({ price: 1 });

  res.send(properties);
});

app.post("/match-properties", async (req, res) => {

  const user = await findBuilder(req.body.builder);

  if (!user) {
    return res.status(404).send({
      success: false,
      matches: []
    });
  }

  const matches = await findPropertyMatches(req.body);

  res.send({
    success: true,
    matches: matches.map(serializePropertyMatch)
  });
});

// =========================
// AI OUTBOUND CALLING
// =========================
app.post("/voice/hot-lead/:leadId", async (req, res) => {

  const lead = await Lead.findById(req.params.leadId);

  if (!lead) {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say("Sorry, this lead could not be found.");
    return res.type("text/xml").send(twiml.toString());
  }

  const user = await findBuilder(lead.builder);
  const company = user ? profileDefaults(user).company : getLeadCompany(lead);
  const intro = `Namaste ${lead.name || "there"}, main ${company} se bol raha hoon. Aapki property enquiry mili thi, bas paanch quick sawaal poochunga.`;

  lead.outboundCall = lead.outboundCall || {};
  lead.outboundCall.status = "in-progress";
  lead.outboundCall.startedAt = lead.outboundCall.startedAt || new Date();
  appendCallTranscript(lead, "assistant", intro);
  appendCallTranscript(lead, "assistant", getQuestionPrompt(0));
  lead.markModified("outboundCall");
  normalizeLeadAttemptHistory(lead);
  await lead.save();

  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(hindiMaleTtsOptions, intro);
  addQuestionGather(twiml, lead._id, 0);

  res.type("text/xml").send(twiml.toString());
});

app.post("/voice/hot-lead/:leadId/repeat", async (req, res) => {

  const step = Number(req.query.step || 0);
  const retryCount = Number(req.query.retry || 0);
  const lead = await Lead.findById(req.params.leadId);
  const twiml = new twilio.twiml.VoiceResponse();

  if (!lead || !qualificationQuestions[step]) {
    twiml.say("Thank you. Goodbye.");
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  if (retryCount >= maxAnswerRetries) {
    lead.outboundCall = lead.outboundCall || {};

    if (!Array.isArray(lead.outboundCall.answers)) {
      lead.outboundCall.answers = [];
    }

    lead.outboundCall.answers[step] = {
      question: qualificationQuestions[step].label,
      answer: "Unknown",
      rawAnswer: "Unknown",
      normalizedAnswer: "Unknown",
      valid: false,
      validationStatus: "invalid",
      retryCount,
      answeredAt: new Date()
    };

    appendAnswerTranscript(
      lead,
      qualificationQuestions[step],
      "Unknown",
      "Unknown",
      false,
      retryCount
    );

    const nextStep = step + 1;

    if (qualificationQuestions[nextStep]) {
      updateStructuredQualification(lead);
      appendCallTranscript(lead, "assistant", getQuestionPrompt(nextStep));
      lead.markModified("outboundCall");
      normalizeLeadAttemptHistory(lead);
      await lead.save();
      addQuestionGather(twiml, lead._id, nextStep);
    }
    else {
      updateStructuredQualification(lead);
      const callScore = calculateCallLeadScore(lead);

      lead.score = callScore.score;
      lead.status = callScore.status;
      lead.intelligence = generateLeadIntelligence(lead, lead.score);
      lead.outboundCall.status = "completed";
      lead.outboundCall.completedAt = new Date();
      lead.outboundCall.summary = buildQualificationSummary(lead);
      updateCurrentCallAttempt(lead, {
        status: "completed",
        completedAt: lead.outboundCall.completedAt
      });
      appendCallTranscript(lead, "assistant", "Thank you. Hamari team aapki details review karke jaldi contact karegi.");
      lead.markModified("outboundCall");
      normalizeLeadAttemptHistory(lead);
      await lead.save();
      const updatedLead = await Lead.findById(lead._id)
        .populate("matchedProperties.property");
      io.to(builderRoom(lead.builder)).emit("dashboard:update", {
        lead: updatedLead ? updatedLead.toObject() : lead.toObject(),
        analytics: await getAnalyticsForBuilder(lead.builder),
        matches: []
      });

      twiml.say(hindiMaleTtsOptions, "Thank you. Hamari team aapki details review karke jaldi contact karegi.");
      twiml.hangup();
    }

    return res.type("text/xml").send(twiml.toString());
  }

  addQuestionGather(
    twiml,
    lead._id,
    step,
    retryCount + 1,
    `${invalidAnswerClarification} ${qualificationQuestions[step].prompt}`
  );

  res.type("text/xml").send(twiml.toString());
});

app.post("/voice/hot-lead/:leadId/answer", async (req, res) => {

  const step = Number(req.query.step || 0);
  const retryCount = Number(req.query.retry || 0);
  const lead = await Lead.findById(req.params.leadId);
  const twiml = new twilio.twiml.VoiceResponse();

  if (!lead || !qualificationQuestions[step]) {
    twiml.say("Thank you. Goodbye.");
    twiml.hangup();
    return res.type("text/xml").send(twiml.toString());
  }

  const question = qualificationQuestions[step];
  const dtmfAnswer = getDtmfAnswer(question, req.body.Digits);
  const answer = dtmfAnswer || req.body.SpeechResult || req.body.Digits || "";
  const validation = validateQualificationAnswer(question, answer);

  lead.outboundCall = lead.outboundCall || {};

  if (!Array.isArray(lead.outboundCall.answers)) {
    lead.outboundCall.answers = [];
  }

  if (!validation.valid && retryCount < maxAnswerRetries) {
    appendAnswerTranscript(
      lead,
      question,
      answer || "Unknown",
      "Unknown",
      false,
      retryCount
    );
    lead.markModified("outboundCall");
    normalizeLeadAttemptHistory(lead);
    await lead.save();

    addQuestionGather(
      twiml,
      lead._id,
      step,
      retryCount + 1,
      `${invalidAnswerClarification} ${question.prompt}`
    );

    return res.type("text/xml").send(twiml.toString());
  }

  lead.outboundCall.answers[step] = {
    question: question.label,
    answer: validation.valid ? validation.answer : "Unknown",
    rawAnswer: validation.valid ? validation.answer : answer || "Unknown",
    normalizedAnswer: validation.valid ? validation.normalizedAnswer : "Unknown",
    valid: validation.valid,
    validationStatus: validation.valid ? "valid" : "invalid",
    retryCount,
    answeredAt: new Date()
  };

  appendAnswerTranscript(
    lead,
    question,
    validation.valid ? validation.answer : answer || "Unknown",
    validation.valid ? validation.normalizedAnswer : "Unknown",
    validation.valid,
    retryCount
  );

  const nextStep = step + 1;

  if (qualificationQuestions[nextStep]) {
    updateStructuredQualification(lead);
    appendCallTranscript(lead, "assistant", getQuestionPrompt(nextStep));
    lead.markModified("outboundCall");
    normalizeLeadAttemptHistory(lead);
    await lead.save();
    addQuestionGather(twiml, lead._id, nextStep);
  }
  else {
    updateStructuredQualification(lead);
    const callScore = calculateCallLeadScore(lead);

    lead.score = callScore.score;
    lead.status = callScore.status;
    lead.intelligence = generateLeadIntelligence(lead, lead.score);
    lead.outboundCall.status = "completed";
    lead.outboundCall.completedAt = new Date();
    lead.outboundCall.summary = buildQualificationSummary(lead);
    updateCurrentCallAttempt(lead, {
      status: "completed",
      completedAt: lead.outboundCall.completedAt
    });
    appendCallTranscript(lead, "assistant", "Thank you. Hamari team aapki details review karke jaldi contact karegi.");
    lead.markModified("outboundCall");
    normalizeLeadAttemptHistory(lead);
    await lead.save();
    const updatedLead = await Lead.findById(lead._id)
      .populate("matchedProperties.property");
    io.to(builderRoom(lead.builder)).emit("dashboard:update", {
      lead: updatedLead ? updatedLead.toObject() : lead.toObject(),
      analytics: await getAnalyticsForBuilder(lead.builder),
      matches: []
    });

    twiml.say(hindiMaleTtsOptions, "Thank you. Hamari team aapki details review karke jaldi contact karegi.");
    twiml.hangup();
  }

  res.type("text/xml").send(twiml.toString());
});

app.post("/voice/hot-lead/:leadId/status", async (req, res) => {

  const lead = await Lead.findById(req.params.leadId);

  if (lead) {
    const callbackCallSid = req.body.CallSid;
    const isCurrentCall = !callbackCallSid ||
      !lead.outboundCall ||
      !lead.outboundCall.callSid ||
      callbackCallSid === lead.outboundCall.callSid;

    lead.outboundCall = lead.outboundCall || {};

    if (isCurrentCall) {
      lead.outboundCall.status = req.body.CallStatus || lead.outboundCall.status;
      lead.outboundCall.callSid = callbackCallSid || lead.outboundCall.callSid;
    }

    if (isCurrentCall && req.body.CallStatus === "completed" && !lead.outboundCall.completedAt) {
      lead.outboundCall.completedAt = new Date();
    }

    updateCallAttemptBySid(lead, callbackCallSid, {
      status: req.body.CallStatus || lead.outboundCall.status,
      callSid: callbackCallSid || lead.outboundCall.callSid,
      completedAt: isCurrentCall ? lead.outboundCall.completedAt : undefined
    });
    updateNextRetryTime(lead);
    lead.status = calculateLeadStatus(lead);

    lead.markModified("outboundCall");
    normalizeLeadAttemptHistory(lead);
    await lead.save();

    if (["completed", "busy", "no-answer"].includes(req.body.CallStatus)) {
      await sendWhatsAppFollowup(lead, req.body.CallStatus);
    }

    const updatedLead = await Lead.findById(lead._id)
      .populate("matchedProperties.property");
    io.to(builderRoom(lead.builder)).emit("dashboard:update", {
      lead: updatedLead ? updatedLead.toObject() : lead.toObject(),
      analytics: await getAnalyticsForBuilder(lead.builder),
      matches: []
    });
  }

  res.sendStatus(204);
});

// =========================
// SAVE LEAD
// =========================
async function submitLead(req, res) {

  try {
  const initialScore = 0;
  const initialStatus = "PENDING";
  const intelligence = generateLeadIntelligence(req.body, initialScore);

  const lead = new Lead({
    builder: req.body.builder,
    name: req.body.name,
    phone: req.body.phone,
    location: req.body.location,
    budget: req.body.budget,
    timeline: req.body.timeline,
    text: req.body.text,
    source: req.body.source || "Web",
    score: initialScore,
    status: initialStatus,
    intelligence
  });

  const matches = await findPropertyMatches(lead);

  lead.matchedProperties = matches.map((match) => ({
    property: match.property._id,
    matchScore: match.matchScore,
    reasons: match.reasons
  }));

  normalizeLeadAttemptHistory(lead);
  await lead.save();
  console.log("✅ Lead saved:", lead._id);

  let savedLead = lead;
  let responseLead = savedLead.toObject();
  let postSaveWarning = "";

  try {
    syncOutboundAttemptMetadata(lead);
    lead.markModified("outboundCall");
    normalizeLeadAttemptHistory(lead);
    await lead.save();
    responseLead = savedLead.toObject();
  }
  catch (err) {
    postSaveWarning = "Lead saved but post-save action failed";
    console.error("Post-save attempt metadata failed:", err.message);
  }

  try {
    console.log("📞 Starting outbound call for:", savedLead.phone);
    await startHotLeadOutboundCall(savedLead);
    if (
      savedLead.outboundCall &&
      ["failed", "skipped"].includes(savedLead.outboundCall.status)
    ) {
      throw new Error(savedLead.outboundCall.error || `Outbound call ${savedLead.outboundCall.status}`);
    }
    console.log("✅ Outbound call triggered");
    responseLead = savedLead.toObject();
  }
  catch (err) {
    postSaveWarning = "Lead saved but post-save action failed";
    console.error("❌ Outbound call trigger failed:", err.message);
  }

  try {
    const analytics = await getAnalyticsForBuilder(lead.builder);

    io.to(builderRoom(lead.builder)).emit("dashboard:update", {
      lead: responseLead,
      analytics,
      matches: matches.map(serializePropertyMatch)
    });
  }
  catch (err) {
    postSaveWarning = "Lead saved but post-save action failed";
    console.error("Post-save dashboard update failed:", err.message);
  }

  res.send({
    success: true,
    lead: responseLead,
    data: responseLead,
    matches: matches.map(serializePropertyMatch),
    warning: postSaveWarning || undefined
  });
  }
  catch (err) {
    console.error("Lead submission failed:", err.message);
  res.status(500).send({
      success: false,
      message: err.message || "Error submitting lead"
    });
  }
}

app.post("/qualify", submitLead);
app.post("/api/leads", submitLead);

// =========================
// TEST
// =========================
app.get("/test", (req, res) => {
  res.send("🚀 PropAI Enterprise Running");
});

// =========================
// START
// =========================
server.listen(port, "0.0.0.0", () => {
  console.log(`🚀 PropAI Enterprise Running on ${port}`);
});
