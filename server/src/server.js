import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import api from "./routes/api.js";
import auth from "./routes/auth.js";
import { authenticate } from "./middleware/auth.js";
import { authorizeRequest } from "./middleware/permissions.js";
import { securityHeaders, authRateLimit } from "./middleware/security.js";

dotenv.config();
const app = express();

app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY || 1));

app.use(securityHeaders);
const TEST_FRONTEND_ORIGIN = "https://ayuathmos92-hue.github.io";

app.use(cors({
  origin: TEST_FRONTEND_ORIGIN,
  credentials: false,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204
}));

// Explicitly answer browser CORS preflight requests before authentication.
app.options("*", cors({
  origin: TEST_FRONTEND_ORIGIN,
  credentials: false,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204
}));

app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || "1mb"
}));

app.use(express.urlencoded({
  extended: false,
  limit: process.env.URLENCODED_BODY_LIMIT || "100kb"
}));

app.get("/api/health", (_, res) =>
  res.json({
    status: "ok",
    service: "micropay-api"
  })
);

app.use("/api/auth", authRateLimit, auth);
app.use("/api", authenticate, authorizeRequest, api);

app.use((err, _req, res, _next) => {
  console.error(err);

  if (err?.message === "CORS origin not allowed") {
    return res.status(403).json({
      error: "Origin not allowed"
    });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request payload is too large"
    });
  }

  res.status(500).json({
    error: "Internal server error"
  });
});

const port = process.env.PORT || 4000;

app.listen(port, () =>
  console.log(`Micro Pay API running on ${port}`)
);