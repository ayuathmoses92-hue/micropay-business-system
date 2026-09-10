import jwt from "jsonwebtoken";
import { query } from "../db.js";

const secret = process.env.JWT_SECRET;
if (!secret) console.warn("JWT_SECRET is not set. Authentication will not work until it is configured.");

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const payload = jwt.verify(token, secret);
    const result = await query("SELECT id,name,email,role FROM users WHERE id=$1", [payload.sub]);
    if (!result.rows[0]) return res.status(401).json({ error: "User account not found" });
    req.user = result.rows[0];
    next();
  } catch (_) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "You do not have permission for this action" });
    next();
  };
}

export function signUser(user) {
  return jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: "8h" });
}
