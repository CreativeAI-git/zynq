import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import Stripe from "stripe";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import configureApp from "./src/config/routes.js";
import initializeSocket from "./src/utils/socket.js";
// import { send_clinic_email_cron, appointmentReminderCron, invitationReminderCron, deleteGuestDataCron } from "./src/utils/cronJob.js";
import { connectDB } from "./src/config/db.js";
import { loadTreatmentEmbeddings } from "./src/utils/vectorIndex.js";
import initializeCallSocket from "./src/utils/callSocket.js";
import { Server } from "socket.io";
import bodyParser from "body-parser";
import { handleStripeWebhook } from "./src/controllers/api/appointmentController.js";

// --------------------- ENV + PATH CONFIG ---------------------
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);
// --------------------- APP SETUP ---------------------
const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const IS_LIVE = process.env.IS_LIVE === "false" ? false : true;
export const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
export const openai = process.env.OPENAI_API_KEY ? new OpenAI(process.env.OPENAI_API_KEY) : null;
export const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({}) : null;

// --------------------- MIDDLEWARE ---------------------

app.use(
  "/stripe/webhook",
  (req, res, next) => {
    console.log("🟢 Stripe webhook endpoint hit");
    next();
  },
  bodyParser.raw({ type: "application/json" }), // Stripe requires raw body,
  handleStripeWebhook
);



const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Allow non-browser clients (no Origin) and same-origin
    if (!origin) return callback(null, true);
    // If no allowlist configured, allow all origins (dev-friendly)
    if (corsOrigins.length === 0) return callback(null, true);
    return callback(null, corsOrigins.includes(origin));
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use("/", express.static(path.join(__dirname, "src/uploads")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "src/views"));
export let io;
// --------------------- ROUTES ---------------------
configureApp(app);

app.get("/", (req, res) => {
  res.send("Zynq App Working 🚀");
});

// --------------------- START SERVER FUNCTION ---------------------
function startServer() {
  let server;

  if (IS_LIVE) {
    console.log("🔒 SSL is enabled");
    // const sslOptions = {
    //   ca: fs.readFileSync("/var/www/html/ssl/ca_bundle.crt"),
    //   key: fs.readFileSync("/var/www/html/ssl/private.key"),
    //   cert: fs.readFileSync("/var/www/html/ssl/certificate.crt"),
    // };
    const sslOptions = {
      key: fs.readFileSync("/etc/letsencrypt/live/getzynq.io/privkey.pem"),
      cert: fs.readFileSync("/etc/letsencrypt/live/getzynq.io/fullchain.pem"),
    };
    server = https.createServer(sslOptions, app);
  } else {
    server = http.createServer(app);
  }

  // / ✅ Create Socket.IO instance and attach to server
  io = new Server(server, {
    cors: {
      origin: "*", // You can restrict this in production
      methods: ["GET", "POST"]
    }
  });

  // ✅ Now pass io instead of raw server
  initializeSocket(io);
  initializeCallSocket(io);
  server.listen(PORT, () => {
    console.log(`✅ Server running at ${APP_URL}`);
  });

  // 🕒 Start all cron jobs once DB + server are ready
  // appointmentReminderCron();
  // invitationReminderCron();
  // deleteGuestDataCron();
  // console.log("📅 Cron jobs initialized successfully");
}

// --------------------- MAIN STARTUP LOGIC ---------------------
(async () => {
  try {
    await connectDB(); // ✅ connect to DB first
    // await loadTreatmentEmbeddings()
    console.log("🟢 Database connection successful. Starting server...");
    startServer();
  } catch (error) {
    console.error("❌ Failed to connect to database:", error);
    process.exit(1);
  }
})();
