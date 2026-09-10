import { Router } from "express";
import bcrypt from "bcryptjs";
import { query, transaction } from "../db.js";
import { authenticate, authorize, signUser } from "../middleware/auth.js";

const router = Router();
const ROLES = ["ADMIN", "MANAGER", "FINANCE", "CLERK"];

router.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
  const result = await query("SELECT id,name,email,password_hash,role,active FROM users WHERE LOWER(email)=LOWER($1)",[email]);
  const user = result.rows[0];
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Invalid email or password" });
  const safe = { id:user.id,name:user.name,email:user.email,role:user.role };
  res.json({ token: signUser(safe), user: safe });
});

router.post("/register", async (req, res) => {
  const { name, email, password, role="ADMIN" } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  const count = Number((await query("SELECT COUNT(*)::int count FROM users")).rows[0].count);
  if (count > 0) return res.status(403).json({ error: "Initial registration is already closed. An administrator must create users." });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
  const hash = await bcrypt.hash(password, 12);
  const result = await query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,active",[name,String(email).trim().toLowerCase(),hash,role]);
  const user = result.rows[0];
  res.status(201).json({ token: signUser(user), user });
});

router.get("/me", authenticate, (req,res) => res.json({ user:req.user }));

router.get("/users", authenticate, authorize("ADMIN"), async (_,res) => {
  res.json((await query("SELECT id,name,email,role,active,created_at,updated_at FROM users ORDER BY created_at ASC")).rows);
});

router.post("/users", authenticate, authorize("ADMIN"), async (req,res) => {
  const { name,email,password,role="CLERK" } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error:"Name, email and password are required" });
  if (password.length < 8) return res.status(400).json({ error:"Password must be at least 8 characters" });
  if (!ROLES.includes(role)) return res.status(400).json({ error:"Invalid role" });
  const hash = await bcrypt.hash(password,12);
  try {
    const result = await query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role,active,created_at",[name,String(email).trim().toLowerCase(),hash,role]);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error:"A user with that email already exists" });
    throw e;
  }
});

router.patch("/users/:id", authenticate, authorize("ADMIN"), async (req,res) => {
  const { name,email,role,active } = req.body;
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ error:"Invalid role" });
  if (req.params.id === req.user.id && active === false) return res.status(400).json({ error:"You cannot deactivate your own account" });
  const result = await query(`UPDATE users SET name=COALESCE($1,name), email=COALESCE($2,email), role=COALESCE($3,role), active=COALESCE($4,active), updated_at=NOW() WHERE id=$5 RETURNING id,name,email,role,active,created_at,updated_at`,[name,email?String(email).trim().toLowerCase():null,role,active,req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error:"User not found" });
  res.json(result.rows[0]);
});

router.post("/users/:id/reset-password", authenticate, authorize("ADMIN"), async (req,res) => {
  const password = String(req.body.password || "");
  if (password.length < 8) return res.status(400).json({ error:"Password must be at least 8 characters" });
  const hash = await bcrypt.hash(password,12);
  const result = await query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2 RETURNING id",[hash,req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error:"User not found" });
  res.json({ ok:true });
});

export default router;
