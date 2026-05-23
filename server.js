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

const client = twilio(accountSid, authToken);

const maxAnswerRetries = 2;
const invalidAnswerClarification =
  "Sorry, main samajh nahi paaya. Kripya option clear bataiye.";

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
      purpose: String,
      configuration: String,
      budget: String,
      funding: String,
      siteVisit: String
    },
    validationErrors: [String],
    summary: String
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
    status: "HOT 🔥"
  });

  const warm = await Lead.countDocuments({
    builder,
    status: "WARM 🟡"
  });

  const cold = await Lead.countDocuments({
    builder,
    status: "COLD ❄️"
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

  if ((status || "").includes("HOT")) {
    return "HOT";
  }

  if ((status || "").includes("WARM")) {
    return "WARM";
  }

  return "COLD";
}

function displayStructuredValue(value) {

  return value && value !== "Unknown"
    ? value
    : "Unknown";
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

function getCallValidationErrors(lead) {

  const answers = (lead.outboundCall && lead.outboundCall.answers) || [];

  return answers
    .filter((answer) => answer && !answer.valid)
    .map((answer) => `${answer.question}: ${answer.answer || "Unknown"}`);
}

// Structured qualification update: summary and scoring must use only stored call answers.
function updateStructuredQualification(lead) {

  lead.outboundCall = lead.outboundCall || {};
  lead.outboundCall.structuredFields = getCallStructuredFields(lead);
  lead.outboundCall.validationErrors = getCallValidationErrors(lead);
}

function calculateCallLeadScore(lead) {

  const fields = (lead.outboundCall && lead.outboundCall.structuredFields) ||
    getCallStructuredFields(lead);
  const hasBudget = fields.budget !== "Unknown";
  const hasClearVisit = fields.siteVisit !== "Unknown";
  const hotVisitPlans = ["today", "tomorrow", "this weekend", "next week"];
  const hotFundingStatuses = ["loan approved", "self funding", "partly ready"];
  const warmFundingStatuses = ["loan planning", "not ready"];

  if (
    hasBudget &&
    hotVisitPlans.includes(fields.siteVisit) &&
    hotFundingStatuses.includes(fields.funding)
  ) {
    return {
      score: 90,
      status: "HOT 🔥"
    };
  }

  if (
    hasBudget &&
    fields.siteVisit === "later" &&
    warmFundingStatuses.includes(fields.funding)
  ) {
    return {
      score: 70,
      status: "WARM 🟡"
    };
  }

  if (
    !hasBudget ||
    !hasClearVisit ||
    ((lead.outboundCall && lead.outboundCall.validationErrors) || []).length >= 2
  ) {
    return {
      score: 40,
      status: "COLD ❄️"
    };
  }

  return {
    score: 65,
    status: "WARM 🟡"
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

  gather.say({
    voice: "alice",
    language: "en-IN"
  }, promptOverride || question.prompt);

  twiml.redirect({
    method: "POST"
  }, `/voice/hot-lead/${leadId}/repeat?step=${step}&retry=${retryCount}`);
}

async function startHotLeadOutboundCall(lead) {

  if (lead.status !== "HOT 🔥") {
    return;
  }

  if (!lead.phone) {
    lead.outboundCall = {
      status: "skipped",
      error: "Lead phone number is missing"
    };
    await lead.save();
    return;
  }

  const webhookUrl = buildVoiceWebhookUrl(`/voice/hot-lead/${lead._id}`);

  if (!webhookUrl || !twilioVoiceFrom || !accountSid || !authToken) {
    lead.outboundCall = {
      status: "skipped",
      error: "Twilio Voice is not configured. Set TWILIO_VOICE_WEBHOOK_BASE_URL or PUBLIC_BASE_URL, TWILIO_VOICE_FROM, TWILIO_ACCOUNT_SID, and TWILIO_AUTH_TOKEN."
    };
    await lead.save();
    return;
  }

try
{
const rawPhone = String(lead.phone).replace(/\D/g, "");

let formattedPhone = rawPhone;

if (!formattedPhone.startsWith("91")) {
    formattedPhone = "91" + formattedPhone;
}

formattedPhone = "+" + formattedPhone;

const call = await client.calls.create({
      to: formattedPhone,
      from: twilioVoiceFrom,
      url: webhookUrl,
      method: "POST",
      statusCallback: buildVoiceWebhookUrl(`/voice/hot-lead/${lead._id}/status`),
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"]
});

    lead.outboundCall = {
      status: "queued",
      callSid: call.sid,
      startedAt: new Date(),
      transcript: [],
      answers: []
    };
    await lead.save();
  }
  catch (err) {
    lead.outboundCall = {
      status: "failed",
      error: err.message
    };
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
  await lead.save();

  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({
    voice: "alice",
    language: "en-IN"
  }, intro);
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
      appendCallTranscript(lead, "assistant", "Thank you. Hamari team aapki details review karke jaldi contact karegi.");
      lead.markModified("outboundCall");
      await lead.save();
      const updatedLead = await Lead.findById(lead._id)
        .populate("matchedProperties.property");
      io.to(builderRoom(lead.builder)).emit("dashboard:update", {
        lead: updatedLead ? updatedLead.toObject() : lead.toObject(),
        analytics: await getAnalyticsForBuilder(lead.builder),
        matches: []
      });

      twiml.say({
        voice: "alice",
        language: "en-IN"
      }, "Thank you. Hamari team aapki details review karke jaldi contact karegi.");
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
    appendCallTranscript(lead, "assistant", "Thank you. Hamari team aapki details review karke jaldi contact karegi.");
    lead.markModified("outboundCall");
    await lead.save();
    const updatedLead = await Lead.findById(lead._id)
      .populate("matchedProperties.property");
    io.to(builderRoom(lead.builder)).emit("dashboard:update", {
      lead: updatedLead ? updatedLead.toObject() : lead.toObject(),
      analytics: await getAnalyticsForBuilder(lead.builder),
      matches: []
    });

    twiml.say({
      voice: "alice",
      language: "en-IN"
    }, "Thank you. Hamari team aapki details review karke jaldi contact karegi.");
    twiml.hangup();
  }

  res.type("text/xml").send(twiml.toString());
});

app.post("/voice/hot-lead/:leadId/status", async (req, res) => {

  const lead = await Lead.findById(req.params.leadId);

  if (lead) {
    lead.outboundCall = lead.outboundCall || {};
    lead.outboundCall.status = req.body.CallStatus || lead.outboundCall.status;
    lead.outboundCall.callSid = req.body.CallSid || lead.outboundCall.callSid;

    if (req.body.CallStatus === "completed" && !lead.outboundCall.completedAt) {
      lead.outboundCall.completedAt = new Date();
    }

    lead.markModified("outboundCall");
    await lead.save();
  }

  res.sendStatus(204);
});

// =========================
// SAVE LEAD
// =========================
app.post("/qualify", async (req, res) => {

  const ai = calculateLeadScore(req.body);
  const intelligence = generateLeadIntelligence(req.body, ai.score);

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
    status: ai.status,
    intelligence
  });

  const matches = await findPropertyMatches(lead);

  lead.matchedProperties = matches.map((match) => ({
    property: match.property._id,
    matchScore: match.matchScore,
    reasons: match.reasons
  }));

  await lead.save();

  await startHotLeadOutboundCall(lead);

  const analytics = await getAnalyticsForBuilder(lead.builder);

  io.to(builderRoom(lead.builder)).emit("dashboard:update", {
    lead: lead.toObject(),
    analytics,
    matches: matches.map(serializePropertyMatch)
  });

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
    data: lead,
    matches: matches.map(serializePropertyMatch)
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
server.listen(port, "0.0.0.0", () => {
  console.log(`🚀 PropAI Enterprise Running on ${port}`);
});
