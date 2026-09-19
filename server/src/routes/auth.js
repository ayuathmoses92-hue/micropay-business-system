import { Router } from "express";
import bcrypt from "bcryptjs";
import { query, transaction } from "../db.js";
import { authenticate, authorize, signUser } from "../middleware/auth.js";

const router = Router();
const audit = async (client,userId,action,entityType,entityId,details={}) => client.query("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)",[userId||null,action,entityType,entityId||null,JSON.stringify(details)]);
const LEGACY_ROLES = ["ADMIN", "MANAGER", "FINANCE", "CLERK"];

const loadAccess = async (userId) => {
  const r = await query(`
    SELECT u.id,u.name,u.email,u.role,u.active,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',ro.id,'code',ro.code,'name',ro.name,'system_role',ro.system_role)) FILTER (WHERE ro.id IS NOT NULL),'[]'::jsonb) roles,
      COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL),ARRAY[]::text[]) permissions
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id=u.id
    LEFT JOIN roles ro ON ro.id=ur.role_id AND ro.active=TRUE
    LEFT JOIN role_permissions rp ON rp.role_id=ro.id
    LEFT JOIN permissions p ON p.id=rp.permission_id
    WHERE u.id=$1 GROUP BY u.id,u.name,u.email,u.role,u.active`, [userId]);
  return r.rows[0];
};

const validateRoleIds = async (client, roleIds=[]) => {
  const ids = [...new Set((Array.isArray(roleIds)?roleIds:[]).filter(Boolean))];
  if (!ids.length) throw new Error("At least one role must be assigned");
  const r = await client.query("SELECT id,code,name FROM roles WHERE id=ANY($1::uuid[]) AND active=TRUE", [ids]);
  if (r.rowCount !== ids.length) throw new Error("One or more selected roles are invalid or inactive");
  return r.rows;
};

const replaceUserRoles = async (client, userId, roleIds, assignedBy, primaryRoleId=null) => {
  const roles = await validateRoleIds(client, roleIds);
  await client.query("DELETE FROM user_roles WHERE user_id=$1", [userId]);
  const primary = primaryRoleId || roles[0].id;
  for (const role of roles) {
    await client.query("INSERT INTO user_roles(user_id,role_id,assigned_by,is_primary) VALUES($1,$2,$3,$4)", [userId,role.id,assignedBy||null,role.id===primary]);
  }
  return roles;
};

router.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
  const result = await query("SELECT id,name,email,password_hash,role,active FROM users WHERE LOWER(email)=LOWER($1)",[email]);
  const user = result.rows[0];
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Invalid email or password" });
  const safe = await loadAccess(user.id);
  res.json({ token: signUser(safe), user: safe });
});

router.post("/register", async (req, res) => {
  const { name, email, password, role="ADMIN" } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email and password are required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  const count = Number((await query("SELECT COUNT(*)::int count FROM users")).rows[0].count);
  if (count > 0) return res.status(403).json({ error: "Initial registration is already closed. An administrator must create users." });
  if (!LEGACY_ROLES.includes(role)) return res.status(400).json({ error: "Invalid initial role" });
  const hash = await bcrypt.hash(password, 12);
  const result = await transaction(async client => {
    const u=(await client.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id",[name,String(email).trim().toLowerCase(),hash,role])).rows[0];
    const r=(await client.query("SELECT id FROM roles WHERE code=$1 AND active=TRUE",[role])).rows[0];
    if (r) await client.query("INSERT INTO user_roles(user_id,role_id,is_primary) VALUES($1,$2,TRUE) ON CONFLICT DO NOTHING",[u.id,r.id]);
    return u;
  });
  const safe = await loadAccess(result.id);
  res.status(201).json({ token: signUser(safe), user: safe });
});

router.get("/me", authenticate, (req,res) => res.json({ user:req.user }));

router.get("/permissions", authenticate, authorize("ADMIN"), async (_,res) => {
  res.json((await query("SELECT id,code,module,action,name,description FROM permissions ORDER BY module,action,name")).rows);
});

router.get("/roles", authenticate, authorize("ADMIN"), async (_,res) => {
  const rows=(await query(`
    SELECT r.id,r.code,r.name,r.description,r.system_role,r.active,r.created_at,r.updated_at,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'module',p.module,'action',p.action)) FILTER (WHERE p.id IS NOT NULL),'[]'::jsonb) permissions,
      (SELECT COUNT(*)::int FROM user_roles ur2 WHERE ur2.role_id=r.id) user_count
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id=r.id
    LEFT JOIN permissions p ON p.id=rp.permission_id
    GROUP BY r.id ORDER BY r.system_role DESC,r.name`)).rows;
  res.json(rows);
});

router.post("/roles", authenticate, authorize("ADMIN"), async (req,res) => {
  const code=String(req.body.code||"").trim().toUpperCase().replace(/[^A-Z0-9_]+/g,"_").replace(/^_+|_+$/g,"");
  const name=String(req.body.name||"").trim();
  const description=String(req.body.description||"").trim();
  const permissionIds=Array.isArray(req.body.permission_ids)?req.body.permission_ids:[];
  if (!code || !name) return res.status(400).json({error:"Role code and name are required"});
  if (LEGACY_ROLES.includes(code)) return res.status(400).json({error:"The four system roles already exist"});
  try {
    const result=await transaction(async client=>{
      const r=(await client.query("INSERT INTO roles(code,name,description,system_role,created_by) VALUES($1,$2,$3,FALSE,$4) RETURNING *",[code,name,description,req.user.id])).rows[0];
      if(permissionIds.length){
        const p=(await client.query("SELECT id FROM permissions WHERE id=ANY($1::uuid[])",[permissionIds])).rows;
        for(const x of p) await client.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)",[r.id,x.id]);
      }
      await audit(client,req.user.id,"CREATE","ROLE",r.id,{code:r.code,name:r.name,permission_count:permissionIds.length});
      return r;
    });
    res.status(201).json(result);
  } catch(e){ if(e.code==='23505')return res.status(409).json({error:"A role with that code already exists"}); res.status(400).json({error:e.message}); }
});

router.patch("/roles/:id", authenticate, authorize("ADMIN"), async (req,res) => {
  const {name,description,active,permission_ids}=req.body;
  try {
    const result=await transaction(async client=>{
      const old=(await client.query("SELECT * FROM roles WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!old) throw new Error("Role not found");
      if(old.code==='ADMIN' && active===false) throw new Error("The Administrator role cannot be deactivated");
      const r=(await client.query("UPDATE roles SET name=COALESCE($1,name),description=COALESCE($2,description),active=COALESCE($3,active),updated_at=NOW() WHERE id=$4 RETURNING *",[name,description,active,old.id])).rows[0];
      if(Array.isArray(permission_ids)){
        await client.query("DELETE FROM role_permissions WHERE role_id=$1",[old.id]);
        const p=(await client.query("SELECT id FROM permissions WHERE id=ANY($1::uuid[])",[permission_ids])).rows;
        for(const x of p) await client.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)",[old.id,x.id]);
      }
      await audit(client,req.user.id,"EDIT","ROLE",old.id,{name:r.name,active:r.active,permissions_changed:Array.isArray(permission_ids)});
      return r;
    });
    res.json(result);
  } catch(e){res.status(400).json({error:e.message});}
});

router.delete("/roles/:id", authenticate, authorize("ADMIN"), async (req,res) => {
  try {
    const r=(await query("SELECT * FROM roles WHERE id=$1",[req.params.id])).rows[0];
    if(!r) return res.status(404).json({error:"Role not found"});
    if(r.system_role) return res.status(400).json({error:"System roles cannot be deleted"});
    const count=Number((await query("SELECT COUNT(*)::int count FROM user_roles WHERE role_id=$1",[r.id])).rows[0].count);
    if(count>0) return res.status(409).json({error:"This role is assigned to users. Reassign those users before deleting it."});
    await query("DELETE FROM roles WHERE id=$1",[r.id]);
    await query("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)",[req.user.id,"DELETE","ROLE",r.id,JSON.stringify({code:r.code,name:r.name})]);
    res.json({ok:true});
  } catch(e){res.status(400).json({error:e.message});}
});

router.get("/users", authenticate, authorize("ADMIN"), async (_,res) => {
  res.json((await query(`
    SELECT u.id,u.name,u.email,u.role,u.active,u.created_at,u.updated_at,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',r.id,'code',r.code,'name',r.name,'system_role',r.system_role)) FILTER (WHERE r.id IS NOT NULL),'[]'::jsonb) roles
    FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id
    GROUP BY u.id ORDER BY u.created_at ASC`)).rows);
});

router.post("/users", authenticate, authorize("ADMIN"), async (req,res) => {
  const { name,email,password,role="CLERK",role_ids=[] } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error:"Name, email and password are required" });
  if (password.length < 8) return res.status(400).json({ error:"Password must be at least 8 characters" });
  if (!LEGACY_ROLES.includes(role)) return res.status(400).json({error:"Primary role must be one of the four system roles"});
  const hash = await bcrypt.hash(password,12);
  try {
    const result=await transaction(async client=>{
      const u=(await client.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id",[name,String(email).trim().toLowerCase(),hash,role])).rows[0];
      const requested=Array.isArray(role_ids)&&role_ids.length?role_ids:[(await client.query("SELECT id FROM roles WHERE code=$1",[role])).rows[0]?.id];
      await replaceUserRoles(client,u.id,requested,req.user.id);
      await audit(client,req.user.id,"CREATE","USER",u.id,{name,email,role,role_count:requested.length});
      return u;
    });
    res.status(201).json(await loadAccess(result.id));
  } catch (e) { if (e.code === "23505") return res.status(409).json({ error:"A user with that email already exists" }); res.status(400).json({error:e.message}); }
});

router.patch("/users/:id", authenticate, authorize("ADMIN"), async (req,res) => {
  const { name,email,role,active,role_ids } = req.body;
  if (role !== undefined && !LEGACY_ROLES.includes(role)) return res.status(400).json({ error:"Primary role must be one of the four system roles" });
  if (req.params.id === req.user.id && active === false) return res.status(400).json({ error:"You cannot deactivate your own account" });
  if (req.params.id === req.user.id && role !== undefined && role !== "ADMIN") return res.status(400).json({ error:"You cannot remove Administrator access from your own primary role" });
  try {
    const result=await transaction(async client=>{
      const old=(await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!old) throw new Error("User not found");
      const u=(await client.query(`UPDATE users SET name=COALESCE($1,name),email=COALESCE($2,email),role=COALESCE($3,role),active=COALESCE($4,active),updated_at=NOW() WHERE id=$5 RETURNING id`,[name,email?String(email).trim().toLowerCase():null,role,active,old.id])).rows[0];
      if(Array.isArray(role_ids)){
        const primaryRole=(await client.query("SELECT id FROM roles WHERE code=$1",[role||old.role])).rows[0];
        await replaceUserRoles(client,u.id,role_ids,req.user.id,primaryRole?.id);
      }
      await audit(client,req.user.id,"EDIT","USER",u.id,{role_changed:role!==undefined,roles_changed:Array.isArray(role_ids),active});
      return u;
    });
    res.json(await loadAccess(result.id));
  } catch(e){ if(e.code==='23505')return res.status(409).json({error:"A user with that email already exists"}); res.status(400).json({error:e.message}); }
});

router.post("/users/:id/reset-password", authenticate, authorize("ADMIN"), async (req,res) => {
  const password = String(req.body.password || "");
  if (password.length < 8) return res.status(400).json({ error:"Password must be at least 8 characters" });
  const hash = await bcrypt.hash(password,12);
  const result = await query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2 RETURNING id",[hash,req.params.id]);
  if (!result.rows[0]) return res.status(404).json({error:"User not found"});
  res.json({ok:true});
});

router.delete("/users/:id", authenticate, authorize("ADMIN"), async (req,res) => {
  const id=req.params.id;
  if(id===req.user.id)return res.status(400).json({error:"You cannot delete your own account"});
  try{
    const target=(await query("SELECT id,role FROM users WHERE id=$1",[id])).rows[0];
    if(!target)return res.status(404).json({error:"User not found"});
    if(target.role==='ADMIN'){
      const admins=await query("SELECT COUNT(*)::int count FROM users WHERE role='ADMIN' AND active=TRUE");
      if(Number(admins.rows[0].count)<=1)return res.status(400).json({error:"The last active Administrator cannot be deleted."});
    }
    await query("DELETE FROM users WHERE id=$1",[id]);
    res.json({ok:true});
  }catch(e){if(e.code==='23503')return res.status(409).json({error:"This user has associated records and cannot be deleted. Deactivate the account instead."});res.status(400).json({error:e.message});}
});

export default router;
