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
const openAiApiKey = process.env.OPENAI_API_KEY;
const openAiModel = process.env.OPENAI_MODEL || "gpt-5-mini";

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
  summary: String,
  notes: String,
  finalSummary: String,
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
    capturedAnswers: mongoose.Schema.Types.Mixed,
    structuredFields: {
      type: Object,
      default: {}
    },
    validationErrors: [String],
    summary: String,
    aiSummary: String,
    sentiment: String,
    leadScore: Number,
    suggestedNextAction: String,
    fullTranscript: String,
    aiGeneratedAt: Date,
    aiError: String,
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
  callAnalysis: {
    transcript: {
      type: String,
      default: ""
    },
    summary: {
      type: String,
      default: ""
    },
    sentiment: {
      type: String,
      enum: ["Interested", "Neutral", "Not Interested"],
      default: "Neutral"
    },
    leadScore: {
      type: Number,
      default: 0
    },
    nextAction: {
      type: String,
      default: ""
    },
    analyzedAt: {
      type: Date
    }
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
  crmExport: {
    sent: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      default: "pending"
    },
    exportedAt: Date,
    crmName: String,
    externalId: String
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

  const fields = data.fields || {};
  const text = [
    data.transcript,
    data.summary,
    data.originalRequirement,
    fields.purpose,
    fields.configuration,
    fields.budget,
    fields.funding,
    fields.fundingStatus,
    fields.siteVisit,
    data.timeline
  ].join(" ").toLowerCase();
  let score = 0;

  if (hasBudgetMatch(data)) {
    score += 25;
  }

  if (hasQualifiedValue(fields.purpose)) {
    score += fields.purpose === "investment" ? 10 : 8;
  }

  if (hasQualifiedValue(fields.configuration)) {
    score += 8;
  }

  if (/\bself\s*(funded|funding|finance|financed)\b/.test(text) || text.includes("own funds") || text.includes("cash")) {
    score += 20;
  }

  if (hasSiteVisitPlanned(text)) {
    score += 25;
  }

  if (hasImmediateTimeline(text)) {
    score += 20;
  }

  if (data.sentiment === "Interested") {
    score += 10;
  }

  return Math.min(100, Math.max(0, score));
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

  const amount = extractBudgetAmount(budget);

  if (amount) {
    return {
      min: 0,
      max: amount
    };
  }

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

  const match = normalized.match(/([1-5])\s*(bhk|b h k|bed|bedroom)/);

  return match ? Number(match[1]) : null;
}

function getLeadRecommendationFields(lead) {

  const fields = (lead.outboundCall && lead.outboundCall.structuredFields) || {};

  return {
    purpose: fields.purpose || "",
    configuration: fields.configuration || "",
    budget: fields.budget || lead.budget || "",
    location: lead.location || "",
    text: [
      lead.text,
      fields.purpose,
      fields.configuration,
      fields.budget
    ].filter(Boolean).join(" ")
  };
}

function scorePropertyMatch(lead, property) {

  let score = 0;
  const reasons = [];
  const recommendationFields = getLeadRecommendationFields(lead);
  const budgetRange = getBudgetRange(recommendationFields.budget);
  const requestedBhk = inferBhk(recommendationFields.configuration || recommendationFields.text);
  const normalizedText = recommendationFields.text.toLowerCase();
  const purpose = String(recommendationFields.purpose || "").toLowerCase();

  if (property.location === recommendationFields.location) {
    score += 35;
    reasons.push(`Location match in ${property.location}`);
  }

  if (property.price >= budgetRange.min && property.price <= budgetRange.max) {
    score += 30;
    reasons.push(`Fits ${recommendationFields.budget} budget`);
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
    score += 20;
    reasons.push(`${property.bhk}BHK requirement match`);
  }

  if (purpose.includes("investment")) {
    score += 8;
    reasons.push("Matches investment buying purpose");
  }
  else if (purpose.includes("self") || purpose.includes("family")) {
    score += 8;
    reasons.push("Matches self-use buying purpose");
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

function buildFullTranscript(lead) {

  const transcript = lead.outboundCall && Array.isArray(lead.outboundCall.transcript)
    ? lead.outboundCall.transcript
    : [];

  return transcript
    .map((item) => {
      const speaker = item.speaker || "unknown";
      const text = item.text || item.rawAnswer || "";
      const details = item.question
        ? ` | Question: ${item.question} | Raw: ${item.rawAnswer || text || "Unknown"} | Normalized: ${item.normalizedAnswer || "Unknown"} | Valid: ${item.valid === true ? "yes" : "no"} | Correction attempts: ${item.retryCount || 0}`
        : "";

      return `${speaker}: ${text}${details}`;
    })
    .join("\n");
}

function hasTranscriptText(value) {

  const text = String(value || "").trim();

  return Boolean(text) && text !== "Call transcript is not available yet.";
}

function formatSpeakerLabel(speaker) {

  const normalized = String(speaker || "").trim().toLowerCase();

  if (["ai", "assistant", "agent", "system"].includes(normalized)) {
    return "AI";
  }

  if (["customer", "lead", "user", "caller"].includes(normalized)) {
    return "Customer";
  }

  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : "Unknown";
}

function getQuestionText(questionOrKey) {

  const value = String(questionOrKey || "").trim();

  if (!value) {
    return "";
  }

  const normalized = value.toLowerCase();
  const question = qualificationQuestions.find((item) => {
    return item.key.toLowerCase() === normalized ||
      item.label.toLowerCase() === normalized;
  });

  if (question) {
    return question.prompt;
  }

  return value;
}

function formatTranscriptEntries(entries) {

  if (!Array.isArray(entries) || !entries.length) {
    return "";
  }

  const questionAnswerEntries = entries.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const question = getQuestionText(item.question || item.key || item.field || item.label);
    const answer = item.normalizedAnswer || item.answer || item.rawAnswer || item.value || item.text;

    return question && hasTranscriptText(answer);
  });
  const sourceEntries = questionAnswerEntries.length ? questionAnswerEntries : entries;
  const lines = [];

  sourceEntries.forEach((item) => {
    if (!item) {
      return;
    }

    if (typeof item === "string") {
      if (hasTranscriptText(item)) {
        lines.push(item.trim());
      }
      return;
    }

    const question = getQuestionText(item.question || item.key || item.field || item.label);
    const answer = item.normalizedAnswer || item.answer || item.rawAnswer || item.value || item.text;

    if (question && hasTranscriptText(answer)) {
      lines.push(`AI: ${question}`);
      lines.push(`Customer: ${answer}`);
      return;
    }

    const text = item.text || item.rawAnswer || item.answer || item.value;

    if (hasTranscriptText(text)) {
      lines.push(`${formatSpeakerLabel(item.speaker)}: ${text}`);
    }
  });

  return lines.join("\n\n");
}

function formatCapturedAnswers(capturedAnswers) {

  if (!capturedAnswers) {
    return "";
  }

  if (Array.isArray(capturedAnswers)) {
    return formatTranscriptEntries(capturedAnswers);
  }

  if (typeof capturedAnswers === "string") {
    return capturedAnswers.trim();
  }

  if (typeof capturedAnswers !== "object") {
    return "";
  }

  return formatTranscriptEntries(
    Object.entries(capturedAnswers).map(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return {
          key,
          ...value
        };
      }

      return {
        key,
        value
      };
    })
  );
}

function formatStructuredFields(fields) {

  const fieldMap = [
    ["purpose", "purpose"],
    ["configuration", "configuration"],
    ["budget", "budget"],
    ["fundingStatus", "fundingStatus"],
    ["funding", "fundingStatus"],
    ["budgetReadiness", "fundingStatus"],
    ["siteVisit", "siteVisit"]
  ];
  const entries = [];
  const seen = new Set();

  fieldMap.forEach(([fieldKey, questionKey]) => {
    if (seen.has(questionKey) || !fields || !hasQualifiedValue(fields[fieldKey])) {
      return;
    }

    seen.add(questionKey);
    entries.push({
      key: questionKey,
      value: fields[fieldKey]
    });
  });

  return formatTranscriptEntries(entries);
}

function buildTranscriptFromLead(lead) {

  const callAnalysisTranscript = lead.callAnalysis && lead.callAnalysis.transcript;

  if (hasTranscriptText(callAnalysisTranscript)) {
    return String(callAnalysisTranscript).trim();
  }

  const call = lead.outboundCall || {};
  const outboundTranscript = Array.isArray(call.transcript)
    ? formatTranscriptEntries(call.transcript)
    : call.transcript;

  if (hasTranscriptText(outboundTranscript)) {
    return String(outboundTranscript).trim();
  }

  if (hasTranscriptText(call.fullTranscript)) {
    return String(call.fullTranscript).trim();
  }

  const capturedTranscript = formatCapturedAnswers(call.capturedAnswers || call.answers);

  if (hasTranscriptText(capturedTranscript)) {
    return capturedTranscript.trim();
  }

  const structuredTranscript = formatStructuredFields(call.structuredFields);

  if (hasTranscriptText(structuredTranscript)) {
    return structuredTranscript.trim();
  }

  return [
    call.aiSummary,
    call.summary,
    call.finalSummary,
    lead.finalSummary,
    lead.summary,
    lead.notes,
    Array.isArray(call.validationErrors) && call.validationErrors.length
      ? `Validation results: ${call.validationErrors.join("; ")}`
      : "",
    lead.text
  ]
    .filter(hasTranscriptText)
    .join("\n\n")
    .trim();
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
  const fields = (lead.outboundCall && lead.outboundCall.structuredFields) || {};
  const fieldValues = [
    fields.purpose,
    fields.configuration,
    fields.budget,
    fields.funding || fields.fundingStatus,
    fields.siteVisit
  ];
  const validCount = fieldValues.filter(hasQualifiedValue).length;
  let score = validCount * 12;

  if (qualifiedStatus === "PENDING") {
    return {
      score: Math.min(100, Math.max(0, lead.score || score || 0)),
      status: "PENDING"
    };
  }

  if (qualifiedStatus === "COLD") {
    return {
      score: Math.min(40, Math.max(0, score || 40)),
      status: "COLD"
    };
  }

  if (hasQualifiedValue(fields.purpose)) {
    score += fields.purpose === "investment" ? 10 : 8;
  }

  if (hasQualifiedValue(fields.configuration)) {
    score += 8;
  }

  if (hasQualifiedValue(fields.budget)) {
    score += 10;
  }

  if (["loan approved", "self funding", "partly ready"].includes(String(fields.funding || fields.fundingStatus || "").toLowerCase())) {
    score += 12;
  }

  if (["today", "tomorrow", "this weekend", "specific date"].includes(String(fields.siteVisit || "").toLowerCase())) {
    score += 14;
  }

  if (qualifiedStatus === "HOT") {
    return {
      score: Math.min(100, Math.max(85, score)),
      status: "HOT"
    };
  }

  if (qualifiedStatus === "WARM") {
    return {
      score: Math.min(84, Math.max(55, score)),
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

  return `${lead.name || "Unknown"} is a ${status} lead for ${lead.location || "Unknown"}. Purpose: ${displayStructuredValue(fields.purpose)}. Configuration: ${displayStructuredValue(fields.configuration)}. Budget: ${displayStructuredValue(fields.budget)}. Funding: ${displayStructuredValue(fields.funding || fields.fundingStatus)}. Site visit: ${displayStructuredValue(fields.siteVisit)}.`;
}

function extractBudgetAmount(value) {

  const text = normalizeSpokenNumbers(normalizeCallText(value))
    .replace(/\blac\b/g, "lakh")
    .replace(/\blacs\b/g, "lakh")
    .replace(/\blakhs\b/g, "lakh")
    .replace(/\bcr\b/g, "crore")
    .replace(/\bcrores\b/g, "crore");
  const croreMatch = text.match(/(\d+(?:\.\d+)?)\s*(crore|cr)\b/);
  const lakhMatch = text.match(/(\d+(?:\.\d+)?)\s*(lakh|lac)\b/);
  const numericOnlyMatch = text.match(/\b(\d{7,})\b/);

  if (croreMatch) {
    return Number(croreMatch[1]) * 10000000;
  }

  if (lakhMatch) {
    return Number(lakhMatch[1]) * 100000;
  }

  if (numericOnlyMatch) {
    return Number(numericOnlyMatch[1]);
  }

  return 0;
}

function hasBudgetMatch(data) {

  const selectedBudget = data.leadBudget || data.budget || "";
  const callBudget = (data.fields && data.fields.budget) || data.callBudget || "";
  const amount = extractBudgetAmount(callBudget || data.transcript || data.summary);

  if (!selectedBudget && amount) {
    return true;
  }

  if (!amount) {
    return hasQualifiedValue(callBudget);
  }

  const range = getBudgetRange(selectedBudget);

  return amount >= range.min && amount <= range.max;
}

function hasSiteVisitPlanned(text) {

  return /\b(site visit|visit|today|tomorrow|weekend|saturday|sunday|specific date|book|schedule|planned)\b/.test(text) &&
    !/\b(no visit|not visit|later|not now|cancel)\b/.test(text);
}

function hasImmediateTimeline(text) {

  return /\b(immediate|today|tomorrow|weekend|urgent|asap|ready|this week|same day)\b/.test(text);
}

function getNextActionFromScore(score) {

  if (score > 80) {
    return "Schedule site visit";
  }

  if (score >= 50) {
    return "Sales callback";
  }

  return "Share brochure and follow-up";
}

function mapLegacySentiment(sentiment) {

  if (sentiment === "positive") {
    return "Interested";
  }

  if (sentiment === "negative") {
    return "Not Interested";
  }

  return ["Interested", "Neutral", "Not Interested"].includes(sentiment)
    ? sentiment
    : "Neutral";
}

function analyzeSentimentFromTranscript(transcript) {

  const text = normalizeCallText(transcript);

  if (
    /\b(reject|not interested|no requirement|wrong number|do not call|budget mismatch|too expensive|not looking)\b/.test(text)
  ) {
    return "Not Interested";
  }

  if (
    hasSiteVisitPlanned(text) ||
    hasImmediateTimeline(text) ||
    /\b(interested|yes|ready|self funding|own funds|loan approved|budget available|send details)\b/.test(text)
  ) {
    return "Interested";
  }

  return "Neutral";
}

function fallbackTranscriptSummary(transcript) {

  const cleanTranscript = String(transcript || "").replace(/\s+/g, " ").trim();

  if (!cleanTranscript) {
    return "Call transcript is not available yet.";
  }

  return cleanTranscript.length > 240
    ? `${cleanTranscript.slice(0, 237)}...`
    : cleanTranscript;
}

async function analyzeCallTranscript(transcript) {

  const fallback = {
    summary: fallbackTranscriptSummary(transcript),
    sentiment: analyzeSentimentFromTranscript(transcript)
  };

  if (!openAiApiKey || !String(transcript || "").trim()) {
    return fallback;
  }

  const payload = {
    model: openAiModel,
    input: `Transcript:\n${transcript}`,
    instructions: "Analyze this real estate qualification call. Return concise JSON only. Summary must be one sentence. Sentiment must follow these exact labels: Interested, Neutral, Not Interested. Interested means site visit planned, positive response, immediate timeline, or budget available. Neutral means gathering information or uncertain response. Not Interested means rejected call, no requirement, or budget mismatch.",
    text: {
      format: {
        type: "json_schema",
        name: "call_transcript_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: {
              type: "string"
            },
            sentiment: {
              type: "string",
              enum: ["Interested", "Neutral", "Not Interested"]
            }
          },
          required: ["summary", "sentiment"]
        }
      }
    }
  };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI ${response.status}: ${errorText.slice(0, 250)}`);
    }

    const data = await response.json();
    const parsed = parseJsonObject(extractResponseText(data));

    if (!parsed) {
      throw new Error("OpenAI returned non-JSON call analysis");
    }

    return {
      summary: String(parsed.summary || fallback.summary).trim(),
      sentiment: ["Interested", "Neutral", "Not Interested"].includes(parsed.sentiment)
        ? parsed.sentiment
        : fallback.sentiment
    };
  }
  catch (err) {
    console.error("OpenAI transcript analysis failed:", err.message);
    return fallback;
  }
}

async function applyCallAnalysis(lead) {

  lead.outboundCall = lead.outboundCall || {};
  const transcript = buildTranscriptFromLead(lead);
  const fields = lead.outboundCall.structuredFields || {};
  const aiAnalysis = await analyzeCallTranscript(transcript);
  const sentiment = aiAnalysis.sentiment || analyzeSentimentFromTranscript(transcript);
  const leadScore = calculateLeadScore({
    transcript,
    summary: aiAnalysis.summary,
    sentiment,
    fields,
    leadBudget: lead.budget,
    originalRequirement: lead.text,
    timeline: lead.timeline
  });
  const nextAction = getNextActionFromScore(leadScore);

  lead.callAnalysis = {
    transcript,
    summary: aiAnalysis.summary,
    sentiment,
    leadScore,
    nextAction,
    analyzedAt: new Date()
  };

  return lead.callAnalysis;
}

function extractResponseText(data) {

  if (!data) {
    return "";
  }

  if (data.output_text) {
    return data.output_text;
  }

  const output = Array.isArray(data.output) ? data.output : [];

  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];

    for (const part of content) {
      if (part.text) {
        return part.text;
      }
    }
  }

  return "";
}

function parseJsonObject(value) {

  try {
    return JSON.parse(value);
  }
  catch (err) {
    const match = String(value || "").match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    }
    catch (innerErr) {
      return null;
    }
  }
}

function fallbackCallIntelligence(lead, callScore) {

  const fields = (lead.outboundCall && lead.outboundCall.structuredFields) || {};
  const status = getPlainLeadStatus(callScore.status || lead.status);
  const leadScore = Math.min(100, Math.max(0, Number(callScore.score || lead.score || 0)));
  const summary = buildQualificationSummary(lead);
  const sentiment = status === "HOT" ? "positive" : status === "COLD" ? "negative" : "neutral";
  const suggestedNextAction = status === "HOT"
    ? `Call ${lead.name || "the lead"} now and confirm a site visit for ${displayStructuredValue(fields.siteVisit)}.`
    : status === "WARM"
      ? "Share matched inventory and schedule a sales follow-up."
      : status === "COLD"
        ? "Move to nurture flow unless the lead re-engages."
        : "Retry call or send WhatsApp follow-up to complete qualification.";

  return {
    aiSummary: summary,
    sentiment,
    leadScore,
    suggestedNextAction
  };
}

async function generateOpenAiCallIntelligence(lead, callScore) {

  const fallback = fallbackCallIntelligence(lead, callScore);

  if (!openAiApiKey) {
    return {
      ...fallback,
      aiError: "OPENAI_API_KEY not configured"
    };
  }

  const fields = (lead.outboundCall && lead.outboundCall.structuredFields) || {};
  const fullTranscript = buildFullTranscript(lead);
  const payload = {
    model: openAiModel,
    input: `Lead: ${JSON.stringify({
      name: lead.name,
      phone: lead.phone,
      location: lead.location,
      budget: lead.budget,
      timeline: lead.timeline,
      originalRequirement: lead.text,
      structuredFields: fields,
      deterministicScore: callScore.score,
      deterministicStatus: callScore.status,
      transcript: fullTranscript
    })}`,
    instructions: "You analyze real estate qualification calls. Return concise JSON only. Use the transcript and structured fields. Lead score must be an integer from 0 to 100. Sentiment must be positive, neutral, or negative. Suggested next action must be concrete for a sales team.",
    text: {
      format: {
        type: "json_schema",
        name: "call_intelligence",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            aiSummary: {
              type: "string"
            },
            sentiment: {
              type: "string",
              enum: ["positive", "neutral", "negative"]
            },
            leadScore: {
              type: "integer",
              minimum: 0,
              maximum: 100
            },
            suggestedNextAction: {
              type: "string"
            }
          },
          required: ["aiSummary", "sentiment", "leadScore", "suggestedNextAction"]
        }
      }
    }
  };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI ${response.status}: ${errorText.slice(0, 250)}`);
    }

    const data = await response.json();
    const parsed = parseJsonObject(extractResponseText(data));

    if (!parsed) {
      throw new Error("OpenAI returned non-JSON intelligence");
    }

    return {
      aiSummary: String(parsed.aiSummary || fallback.aiSummary).trim(),
      sentiment: ["positive", "neutral", "negative"].includes(parsed.sentiment)
        ? parsed.sentiment
        : fallback.sentiment,
      leadScore: Math.min(100, Math.max(0, Number(parsed.leadScore || fallback.leadScore))),
      suggestedNextAction: String(parsed.suggestedNextAction || fallback.suggestedNextAction).trim()
    };
  }
  catch (err) {
    console.error("OpenAI call intelligence failed:", err.message);

    return {
      ...fallback,
      aiError: err.message
    };
  }
}

async function updateCallIntelligence(lead, callScore) {

  lead.outboundCall = lead.outboundCall || {};
  lead.outboundCall.fullTranscript = buildTranscriptFromLead(lead);

  const callAnalysis = await applyCallAnalysis(lead);
  const leadScore = Math.min(100, Math.max(0, Number(callAnalysis.leadScore || (callScore && callScore.score) || 0)));
  const legacySentiment = callAnalysis.sentiment === "Interested"
    ? "positive"
    : callAnalysis.sentiment === "Not Interested"
      ? "negative"
      : "neutral";

  lead.outboundCall.aiSummary = callAnalysis.summary;
  lead.outboundCall.summary = callAnalysis.summary || buildQualificationSummary(lead);
  lead.outboundCall.sentiment = legacySentiment;
  lead.outboundCall.leadScore = leadScore;
  lead.outboundCall.suggestedNextAction = callAnalysis.nextAction;
  lead.outboundCall.fullTranscript = callAnalysis.transcript;
  lead.outboundCall.aiGeneratedAt = callAnalysis.analyzedAt;
  lead.outboundCall.aiError = undefined;
  lead.score = leadScore;
  lead.status = getStatusFromScore(leadScore);
  lead.intelligence = {
    ...(lead.intelligence || {}),
    ...generateLeadIntelligence(lead, leadScore),
    recommendedAction: callAnalysis.nextAction
  };
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

app.post("/builders/:builder/leads/:leadId/send-crm", async (req, res) => {

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

  lead.crmExport = {
    sent: true,
    status: "sent",
    exportedAt: new Date(),
    crmName: req.body.crmName || "Demo CRM",
    externalId: `CRM-${String(lead._id).slice(-6).toUpperCase()}`
  };

  await lead.save();

  const updatedLead = await Lead.findById(lead._id)
    .populate("matchedProperties.property");
  const responseLead = updatedLead ? updatedLead.toObject() : lead.toObject();

  io.to(builderRoom(user.username)).emit("dashboard:update", {
    lead: responseLead,
    analytics: await getAnalyticsForBuilder(user.username),
    matches: []
  });

  res.send({
    success: true,
    message: "Sent to CRM",
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

app.post("/api/leads/:id/analyze-call", async (req, res) => {

  try {
    const lead = await Lead.findById(req.params.id);

    if (!lead) {
      return res.status(404).json({
        success: false,
        error: "Lead not found"
      });
    }

    lead.outboundCall = lead.outboundCall || {};

    if (req.body && typeof req.body.transcript === "string" && req.body.transcript.trim()) {
      lead.outboundCall.fullTranscript = req.body.transcript.trim();
      lead.outboundCall.transcript = req.body.transcript
        .split(/\n+/)
        .map((line) => {
          const match = line.match(/^\s*([^:]+):\s*(.*)$/);

          return {
            speaker: match ? match[1].trim().toLowerCase() : "unknown",
            text: match ? match[2].trim() : line.trim()
          };
        })
        .filter((item) => item.text);
      lead.callAnalysis = lead.callAnalysis || {};
      lead.callAnalysis.transcript = req.body.transcript.trim();
    }

    updateStructuredQualification(lead);

    if (
      !Array.isArray(lead.outboundCall.transcript) ||
      !lead.outboundCall.transcript.length
    ) {
      const existingTranscript = lead.outboundCall.fullTranscript ||
        (lead.callAnalysis && lead.callAnalysis.transcript) ||
        "";

      if (existingTranscript) {
        lead.outboundCall.transcript = existingTranscript
          .split(/\n+/)
          .map((line) => {
            const match = line.match(/^\s*([^:]+):\s*(.*)$/);

            return {
              speaker: match ? match[1].trim().toLowerCase() : "unknown",
              text: match ? match[2].trim() : line.trim()
            };
          })
          .filter((item) => item.text);
      }
    }

    lead.callAnalysis = lead.callAnalysis || {};

    if (!hasTranscriptText(lead.callAnalysis.transcript)) {
      lead.callAnalysis.transcript = buildTranscriptFromLead(lead);
    }

    await updateCallIntelligence(lead, calculateCallLeadScore(lead));
    lead.markModified("outboundCall");
    lead.markModified("callAnalysis");
    normalizeLeadAttemptHistory(lead);
    await lead.save();

    const analysis = {
      transcript: lead.callAnalysis.transcript,
      summary: lead.callAnalysis.summary,
      sentiment: lead.callAnalysis.sentiment,
      leadScore: lead.callAnalysis.leadScore,
      nextAction: lead.callAnalysis.nextAction
    };
    const updatedLead = await Lead.findById(lead._id)
      .populate("matchedProperties.property");

    io.to(builderRoom(lead.builder)).emit("dashboard:update", {
      lead: updatedLead ? updatedLead.toObject() : lead.toObject(),
      analytics: await getAnalyticsForBuilder(lead.builder),
      matches: []
    });

    return res.json({
      success: true,
      analysis
    });
  }
  catch (err) {
    console.error("Call analysis API error:", err);

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
      await updateCallIntelligence(lead, callScore);
      lead.markModified("outboundCall");
      lead.markModified("callAnalysis");
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
    await updateCallIntelligence(lead, callScore);
    lead.markModified("outboundCall");
    lead.markModified("callAnalysis");
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

    if (
      isCurrentCall &&
      req.body.CallStatus === "completed" &&
      Array.isArray(lead.outboundCall.transcript) &&
      lead.outboundCall.transcript.length &&
      !(lead.callAnalysis && lead.callAnalysis.analyzedAt)
    ) {
      updateStructuredQualification(lead);
      await updateCallIntelligence(lead, calculateCallLeadScore(lead));
    }

    lead.markModified("outboundCall");
    lead.markModified("callAnalysis");
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
