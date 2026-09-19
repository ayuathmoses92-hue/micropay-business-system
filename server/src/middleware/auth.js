import jwt from "jsonwebtoken";
import { query } from "../db.js";

const secret = process.env.JWT_SECRET;
if (!secret) console.warn("JWT_SECRET is not set. Authentication will not work until it is configured.");

async function loadAccess(userId) {
  const r = await query(`
    SELECT
      u.id,u.name,u.email,u.role,u.active,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',ro.id,'code',ro.code,'name',ro.name,'system_role',ro.system_role)) FILTER (WHERE ro.id IS NOT NULL),'[]'::jsonb) AS roles,
      (SELECT jsonb_build_object('id',pr.id,'code',pr.code,'name',pr.name,'system_role',pr.system_role)
         FROM user_roles pur JOIN roles pr ON pr.id=pur.role_id
        WHERE pur.user_id=u.id AND pur.is_primary=TRUE AND pr.active=TRUE
        LIMIT 1) AS primary_role,
      COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL),ARRAY[]::text[]) AS permissions
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id=u.id
    LEFT JOIN roles ro ON ro.id=ur.role_id AND ro.active=TRUE
    LEFT JOIN role_permissions rp ON rp.role_id=ro.id
    LEFT JOIN permissions p ON p.id=rp.permission_id
    WHERE u.id=$1
    GROUP BY u.id,u.name,u.email,u.role,u.active`, [userId]);
  return r.rows[0];
}

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const payload = jwt.verify(token, secret);
    const user = await loadAccess(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: "User account is inactive or not found" });
    req.user = user;
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
