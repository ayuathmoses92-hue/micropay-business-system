import { Router } from "express";
import { query, transaction } from "../db.js";
import { nextNumber } from "../utils/sequence.js";

const router = Router();
const allowed = (req, roles) => roles.includes(req.user?.role);
const requireRole = (req, res, roles) => {
  if (!allowed(req, roles)) {
    res.status(403).json({ error: "You do not have permission for this action" });
    return false;
  }
  return true;
};
const audit = async (client, userId, action, entityType, entityId, details = {}) =>
  client.query(
    "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)",
    [userId || null, action, entityType, entityId || null, JSON.stringify(details)]
  );
const approvalAction = async (client, entityType, entityId, action, userId, comments = null) =>
  client.query(
    "INSERT INTO approval_actions(entity_type,entity_id,action,user_id,comments) VALUES($1,$2,$3,$4,$5)",
    [entityType, entityId, action, userId || null, comments]
  );

const cleanItems = (items) =>
  (Array.isArray(items) ? items : [])
    .map((x) => ({
      description: String(x.description || "").trim(),
      quantity: Number(x.quantity),
      unit: String(x.unit || "EA").trim() || "EA",
      unit_price: Number(x.unit_price ?? x.estimated_unit_price ?? 0)
    }))
    .filter((x) => x.description && x.quantity > 0 && x.unit_price >= 0);

const ensureOpenPeriod = async (client, dateValue) => {
  if (!dateValue) throw new Error("Transaction date is required");
  const r = await client.query(
    `SELECT status FROM financial_periods WHERE period_year=EXTRACT(YEAR FROM $1::date)::int AND period_month=EXTRACT(MONTH FROM $1::date)::int`,
    [dateValue]
  );
  if (r.rowCount === 0) throw new Error("No financial period is configured for the selected date");
  if (String(r.rows[0].status).toUpperCase() !== "OPEN") throw new Error("The selected date belongs to a closed financial period");
};

const ensureCurrency = async (client, code) => {
  const c = String(code || "USD").trim().toUpperCase();
  const r = await client.query(`SELECT code FROM currencies WHERE code=$1 AND active=TRUE`, [c]);
  if (!r.rowCount) throw new Error(`Currency ${c} is not configured or active`);
  return c;
};


// ---------------- Purchase Requisitions ----------------
router.get("/procurement/requisitions", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER", "FINANCE", "CLERK"])) return;
  try {
    const r = await query(`
      SELECT pr.*, u.name requested_by_name,
             COALESCE(SUM(pri.estimated_total),0) estimated_value,
             COUNT(pri.id)::int item_count
      FROM purchase_requisitions pr
      LEFT JOIN users u ON u.id = pr.requested_by
      LEFT JOIN purchase_requisition_items pri ON pri.requisition_id = pr.id
      GROUP BY pr.id, u.name
      ORDER BY pr.created_at DESC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/procurement/requisitions/:id", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER", "FINANCE", "CLERK"])) return;
  try {
    const [h, items] = await Promise.all([
      query(`SELECT pr.*, u.name requested_by_name FROM purchase_requisitions pr LEFT JOIN users u ON u.id=pr.requested_by WHERE pr.id=$1`, [req.params.id]),
      query(`SELECT * FROM purchase_requisition_items WHERE requisition_id=$1 ORDER BY id`, [req.params.id])
    ]);
    if (!h.rowCount) return res.status(404).json({ error: "Purchase requisition not found" });
    res.json({ ...h.rows[0], items: items.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/procurement/requisitions", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER", "CLERK"])) return;
  const { request_date, required_date, department = "", purpose, priority = "NORMAL", notes = "", requested_by = null, items = [] } = req.body;
  const clean = cleanItems(items).map(x => ({ ...x, estimated_total: Math.round(x.quantity * x.unit_price * 100) / 100 }));
  if (!request_date || !purpose || !clean.length) return res.status(400).json({ error: "Request date, purpose and at least one item are required" });
  try {
    const result = await transaction(async client => {
      await ensureOpenPeriod(client, request_date);
      const number = await nextNumber(client, "PR");
      const r = (await client.query(`INSERT INTO purchase_requisitions(number,request_date,required_date,requested_by,department,purpose,priority,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9) RETURNING *`, [number, request_date, required_date || null, requested_by || req.user.id, department, purpose, priority, notes, req.user.id])).rows[0];
      for (const x of clean) await client.query(`INSERT INTO purchase_requisition_items(requisition_id,description,quantity,unit,estimated_unit_price,estimated_total) VALUES($1,$2,$3,$4,$5,$6)`, [r.id, x.description, x.quantity, x.unit, x.unit_price, x.estimated_total]);
      await audit(client, req.user.id, "CREATE", "PURCHASE_REQUISITION", r.id, { number });
      return r;
    });
    res.status(201).json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.patch("/procurement/requisitions/:id", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER", "CLERK"])) return;
  const { request_date, required_date, department = "", purpose, priority = "NORMAL", notes = "", requested_by = null, items = [] } = req.body;
  const clean = cleanItems(items).map(x => ({ ...x, estimated_total: Math.round(x.quantity * x.unit_price * 100) / 100 }));
  if (!request_date || !purpose || !clean.length) return res.status(400).json({ error: "Request date, purpose and at least one item are required" });
  try {
    const result = await transaction(async client => {
      const old = (await client.query("SELECT * FROM purchase_requisitions WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!old) throw new Error("Purchase requisition not found");
      if (old.status !== "DRAFT") throw new Error("Only draft requisitions can be edited");
      const r = (await client.query(`UPDATE purchase_requisitions SET request_date=$1,required_date=$2,requested_by=$3,department=$4,purpose=$5,priority=$6,notes=$7,updated_at=NOW() WHERE id=$8 RETURNING *`, [request_date, required_date || null, requested_by || old.requested_by || req.user.id, department, purpose, priority, notes, old.id])).rows[0];
      await client.query("DELETE FROM purchase_requisition_items WHERE requisition_id=$1", [old.id]);
      for (const x of clean) await client.query(`INSERT INTO purchase_requisition_items(requisition_id,description,quantity,unit,estimated_unit_price,estimated_total) VALUES($1,$2,$3,$4,$5,$6)`, [old.id, x.description, x.quantity, x.unit, x.unit_price, x.estimated_total]);
      await audit(client, req.user.id, "EDIT", "PURCHASE_REQUISITION", old.id, { number: old.number });
      return r;
    });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/procurement/requisitions/:id/submit", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER", "CLERK"])) return;
  try {
    const r = await transaction(async client => {
      const x = (await client.query("SELECT * FROM purchase_requisitions WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!x) throw new Error("Purchase requisition not found");
      if (x.status !== "DRAFT") throw new Error("Only draft requisitions can be submitted");
      const u = (await client.query("UPDATE purchase_requisitions SET status='SUBMITTED',updated_at=NOW() WHERE id=$1 RETURNING *", [x.id])).rows[0];
      await audit(client, req.user.id, "SUBMIT", "PURCHASE_REQUISITION", x.id, { number: x.number });
      return u;
    });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/procurement/requisitions/:id/approve", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER"])) return;
  try {
    const r = await transaction(async client => {
      const x = (await client.query("SELECT * FROM purchase_requisitions WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!x) throw new Error("Purchase requisition not found");
      if (x.status !== "SUBMITTED") throw new Error("Only submitted requisitions can be approved");
      const u = (await client.query("UPDATE purchase_requisitions SET status='APPROVED',approved_by=$1,approved_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING *", [req.user.id, x.id])).rows[0];
      await audit(client, req.user.id, "APPROVE", "PURCHASE_REQUISITION", x.id, { number: x.number });
      await approvalAction(client, "PURCHASE_REQUISITION", x.id, "APPROVE", req.user.id);
      return u;
    });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/procurement/requisitions/:id/reject", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER"])) return;
  const reason = String(req.body.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "Rejection reason is required" });
  try {
    const r = await transaction(async client => {
      const x = (await client.query("SELECT * FROM purchase_requisitions WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!x) throw new Error("Purchase requisition not found");
      if (x.status !== "SUBMITTED") throw new Error("Only submitted requisitions can be rejected");
      const u = (await client.query("UPDATE purchase_requisitions SET status='REJECTED',rejection_reason=$1,updated_at=NOW() WHERE id=$2 RETURNING *", [reason, x.id])).rows[0];
      await audit(client, req.user.id, "REJECT", "PURCHASE_REQUISITION", x.id, { number: x.number, reason });
      await approvalAction(client, "PURCHASE_REQUISITION", x.id, "REJECT", req.user.id, reason);
      return u;
    });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/procurement/requisitions/:id/cancel", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER"])) return;
  try {
    const r = await transaction(async client => {
      const x = (await client.query("SELECT * FROM purchase_requisitions WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!x) throw new Error("Purchase requisition not found");
      if (["CANCELLED", "APPROVED"].includes(x.status)) throw new Error("This requisition cannot be cancelled in its current status");
      const u = (await client.query("UPDATE purchase_requisitions SET status='CANCELLED',updated_at=NOW() WHERE id=$1 RETURNING *", [x.id])).rows[0];
      await audit(client, req.user.id, "CANCEL", "PURCHASE_REQUISITION", x.id, { number: x.number });
      return u;
    });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------------- Supplier quotations / RFQ ----------------
router.get("/procurement/rfqs", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER", "FINANCE"])) return;
  try {
    const r = await query(`SELECT r.*,pr.number requisition_number,COUNT(DISTINCT rs.supplier_id)::int supplier_count,COUNT(DISTINCT sq.id)::int quote_count FROM request_for_quotations r LEFT JOIN purchase_requisitions pr ON pr.id=r.requisition_id LEFT JOIN rfq_suppliers rs ON rs.rfq_id=r.id LEFT JOIN supplier_quotations sq ON sq.rfq_id=r.id GROUP BY r.id,pr.number ORDER BY r.created_at DESC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/procurement/rfqs", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER"])) return;
  const { rfq_date, closing_date, requisition_id = null, notes = "", supplier_ids = [], items = [] } = req.body;
  const clean = (Array.isArray(items) ? items : []).map(x => ({ description: String(x.description || "").trim(), quantity: Number(x.quantity), unit: String(x.unit || "EA").trim() || "EA" })).filter(x => x.description && x.quantity > 0);
  const suppliers = [...new Set((Array.isArray(supplier_ids) ? supplier_ids : []).filter(Boolean))];
  if (!rfq_date || !clean.length || !suppliers.length) return res.status(400).json({ error: "RFQ date, items and at least one supplier are required" });
  try {
    const result = await transaction(async client => {
      await ensureOpenPeriod(client, rfq_date);
      const number = await nextNumber(client, "RFQ");
      const r = (await client.query(`INSERT INTO request_for_quotations(number,requisition_id,rfq_date,closing_date,status,notes,created_by) VALUES($1,$2,$3,$4,'DRAFT',$5,$6) RETURNING *`, [number, requisition_id || null, rfq_date, closing_date || null, notes, req.user.id])).rows[0];
      for (const x of clean) await client.query(`INSERT INTO rfq_items(rfq_id,description,quantity,unit) VALUES($1,$2,$3,$4)`, [r.id, x.description, x.quantity, x.unit]);
      for (const supplierId of suppliers) {
        const exists = (await client.query("SELECT id FROM suppliers WHERE id=$1 AND active=TRUE", [supplierId])).rowCount;
        if (!exists) throw new Error("One or more selected suppliers are invalid or inactive");
        await client.query("INSERT INTO rfq_suppliers(rfq_id,supplier_id) VALUES($1,$2)", [r.id, supplierId]);
      }
      await audit(client, req.user.id, "CREATE", "RFQ", r.id, { number });
      return r;
    });
    res.status(201).json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/procurement/rfqs/:id/issue", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER"])) return;
  try {
    const r = await transaction(async client => {
      const x = (await client.query("SELECT * FROM request_for_quotations WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!x) throw new Error("RFQ not found");
      if (x.status !== "DRAFT") throw new Error("Only draft RFQs can be issued");
      const count = (await client.query("SELECT COUNT(*)::int n FROM rfq_suppliers WHERE rfq_id=$1", [x.id])).rows[0].n;
      if (!count) throw new Error("At least one supplier must be invited");
      const u = (await client.query("UPDATE request_for_quotations SET status='ISSUED',updated_at=NOW() WHERE id=$1 RETURNING *", [x.id])).rows[0];
      await audit(client, req.user.id, "ISSUE", "RFQ", x.id, { number: x.number });
      return u;
    });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get("/procurement/supplier-quotes", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER", "FINANCE"])) return;
  try {
    const r = await query(`SELECT sq.*,r.number rfq_number,s.name supplier_name FROM supplier_quotations sq JOIN request_for_quotations r ON r.id=sq.rfq_id JOIN suppliers s ON s.id=sq.supplier_id ORDER BY sq.created_at DESC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/procurement/supplier-quotes", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER", "FINANCE"])) return;
  const { rfq_id, supplier_id, quote_number = "", quote_date, valid_until = null, currency_code = "USD", tax = 0, notes = "", items = [] } = req.body;
  const clean = cleanItems(items).map(x => ({ ...x, amount: Math.round(x.quantity * x.unit_price * 100) / 100 }));
  if (!rfq_id || !supplier_id || !quote_date || !clean.length) return res.status(400).json({ error: "RFQ, supplier, quote date and at least one item are required" });
  try {
    const result = await transaction(async client => {
      const rfq = (await client.query("SELECT * FROM request_for_quotations WHERE id=$1 FOR UPDATE", [rfq_id])).rows[0];
      if (!rfq) throw new Error("RFQ not found");
      if (!['ISSUED','CLOSED'].includes(rfq.status)) throw new Error("Supplier quotes can only be recorded against an issued or closed RFQ");
      const invited = (await client.query("SELECT id FROM rfq_suppliers WHERE rfq_id=$1 AND supplier_id=$2", [rfq_id, supplier_id])).rowCount;
      if (!invited) throw new Error("Supplier was not invited to this RFQ");
      const subtotal = clean.reduce((s, x) => s + x.amount, 0);
      const total = subtotal + Number(tax || 0);
      const c = await ensureCurrency(client, currency_code);
      await ensureOpenPeriod(client, quote_date);
      const q = (await client.query(`INSERT INTO supplier_quotations(rfq_id,supplier_id,quote_number,quote_date,valid_until,status,subtotal,tax,total,currency_code,notes,created_by) VALUES($1,$2,$3,$4,$5,'RECEIVED',$6,$7,$8,$9,$10,$11) RETURNING *`, [rfq_id, supplier_id, quote_number, quote_date, valid_until || null, subtotal, tax || 0, total, c, notes, req.user.id])).rows[0];
      for (const x of clean) await client.query(`INSERT INTO supplier_quotation_items(supplier_quotation_id,description,quantity,unit_price,amount) VALUES($1,$2,$3,$4,$5)`, [q.id, x.description, x.quantity, x.unit_price, x.amount]);
      await client.query("UPDATE rfq_suppliers SET response_status='RESPONDED' WHERE rfq_id=$1 AND supplier_id=$2", [rfq_id, supplier_id]);
      await audit(client, req.user.id, "CREATE", "SUPPLIER_QUOTATION", q.id, { rfq_id, supplier_id });
      return q;
    });
    res.status(201).json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------------- Purchase Orders ----------------
router.get("/procurement/purchase-orders", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER", "FINANCE"])) return;
  try {
    const r = await query(`SELECT po.*,s.name supplier_name,pr.number requisition_number,r.number rfq_number FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN purchase_requisitions pr ON pr.id=po.requisition_id LEFT JOIN request_for_quotations r ON r.id=po.rfq_id ORDER BY po.created_at DESC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/procurement/purchase-orders/:id", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER", "FINANCE"])) return;
  try {
    const [h, items] = await Promise.all([
      query(`SELECT po.*,s.name supplier_name FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE po.id=$1`, [req.params.id]),
      query(`SELECT * FROM purchase_order_items WHERE purchase_order_id=$1 ORDER BY id`, [req.params.id])
    ]);
    if (!h.rowCount) return res.status(404).json({ error: "Purchase order not found" });
    res.json({ ...h.rows[0], items: items.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/procurement/purchase-orders", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER"])) return;
  const { supplier_id, requisition_id = null, rfq_id = null, supplier_quotation_id = null, order_date, expected_date = null, currency_code = "USD", exchange_rate = 1, discount = 0, tax = 0, delivery_address = "", payment_terms = "", notes = "", items = [] } = req.body;
  const clean = cleanItems(items).map(x => ({ ...x, amount: Math.round(x.quantity * x.unit_price * 100) / 100 }));
  if (!supplier_id || !order_date || !clean.length) return res.status(400).json({ error: "Supplier, order date and at least one item are required" });
  try {
    const result = await transaction(async client => {
      const supplier = (await client.query("SELECT id FROM suppliers WHERE id=$1 AND active=TRUE", [supplier_id])).rowCount;
      if (!supplier) throw new Error("Supplier not found or inactive");
      await ensureOpenPeriod(client, order_date);
      const number = await nextNumber(client, "PO");
      const c = await ensureCurrency(client, currency_code);
      const rate = Number(exchange_rate || 1);
      if (!(rate > 0)) throw new Error("Exchange rate must be greater than zero");
      const subtotal = clean.reduce((s, x) => s + x.amount, 0);
      const total = subtotal - Number(discount || 0) + Number(tax || 0);
      const baseTotal = Math.round(total * rate * 100) / 100;
      const po = (await client.query(`INSERT INTO purchase_orders(number,supplier_id,requisition_id,rfq_id,supplier_quotation_id,order_date,expected_date,status,currency_code,exchange_rate,subtotal,discount,tax,total,base_total,delivery_address,payment_terms,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`, [number, supplier_id, requisition_id || null, rfq_id || null, supplier_quotation_id || null, order_date, expected_date || null, c, rate, subtotal, discount || 0, tax || 0, total, baseTotal, delivery_address, payment_terms, notes, req.user.id])).rows[0];
      for (const x of clean) await client.query(`INSERT INTO purchase_order_items(purchase_order_id,description,quantity,unit,unit_price,amount) VALUES($1,$2,$3,$4,$5,$6)`, [po.id, x.description, x.quantity, x.unit, x.unit_price, x.amount]);
      await audit(client, req.user.id, "CREATE", "PURCHASE_ORDER", po.id, { number });
      return po;
    });
    res.status(201).json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/procurement/purchase-orders/:id/submit", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER"])) return;
  try {
    const r = await transaction(async client => {
      const x = (await client.query("SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!x) throw new Error("Purchase order not found");
      if (x.status !== "DRAFT") throw new Error("Only draft purchase orders can be submitted");
      const u = (await client.query("UPDATE purchase_orders SET status='SUBMITTED',updated_at=NOW() WHERE id=$1 RETURNING *", [x.id])).rows[0];
      await audit(client, req.user.id, "SUBMIT", "PURCHASE_ORDER", x.id, { number: x.number });
      return u;
    });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/procurement/purchase-orders/:id/approve", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER"])) return;
  try {
    const r = await transaction(async client => {
      const x = (await client.query("SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!x) throw new Error("Purchase order not found");
      if (x.status !== "SUBMITTED") throw new Error("Only submitted purchase orders can be approved");
      const u = (await client.query("UPDATE purchase_orders SET status='APPROVED',approved_by=$1,approved_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING *", [req.user.id, x.id])).rows[0];
      await audit(client, req.user.id, "APPROVE", "PURCHASE_ORDER", x.id, { number: x.number });
      await approvalAction(client, "PURCHASE_ORDER", x.id, "APPROVE", req.user.id);
      return u;
    });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/procurement/purchase-orders/:id/cancel", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER"])) return;
  const reason = String(req.body.reason || "").trim();
  try {
    const r = await transaction(async client => {
      const x = (await client.query("SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!x) throw new Error("Purchase order not found");
      if (["RECEIVED", "CLOSED", "CANCELLED"].includes(x.status)) throw new Error("This purchase order cannot be cancelled");
      const u = (await client.query("UPDATE purchase_orders SET status='CANCELLED',notes=CASE WHEN $1='' THEN notes ELSE COALESCE(notes,'') || E'\\nCancellation: ' || $1 END,updated_at=NOW() WHERE id=$2 RETURNING *", [reason, x.id])).rows[0];
      await audit(client, req.user.id, "CANCEL", "PURCHASE_ORDER", x.id, { number: x.number, reason });
      return u;
    });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---------------- Goods Receipts ----------------
router.get("/procurement/goods-receipts", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER", "FINANCE"])) return;
  try {
    const r = await query(`SELECT gr.*,s.name supplier_name,po.number purchase_order_number FROM goods_receipts gr JOIN suppliers s ON s.id=gr.supplier_id JOIN purchase_orders po ON po.id=gr.purchase_order_id ORDER BY gr.created_at DESC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/procurement/goods-receipts", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER"])) return;
  const { purchase_order_id, receipt_date, location = "", notes = "", items = [] } = req.body;
  const clean = (Array.isArray(items) ? items : []).map(x => ({ po_item_id: x.po_item_id, description: String(x.description || "").trim(), quantity_received: Number(x.quantity_received), condition: String(x.condition || "GOOD"), notes: String(x.notes || "") })).filter(x => x.po_item_id && x.description && x.quantity_received > 0);
  if (!purchase_order_id || !receipt_date || !clean.length) return res.status(400).json({ error: "Purchase order, receipt date and at least one received item are required" });
  try {
    const result = await transaction(async client => {
      const po = (await client.query("SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE", [purchase_order_id])).rows[0];
      if (!po) throw new Error("Purchase order not found");
      if (!['APPROVED','PARTIALLY_RECEIVED'].includes(po.status)) throw new Error("Only approved or partially received purchase orders can receive goods");
      await ensureOpenPeriod(client, receipt_date);
      const number = await nextNumber(client, "GRN");
      const gr = (await client.query(`INSERT INTO goods_receipts(number,purchase_order_id,supplier_id,receipt_date,status,received_by,location,notes,created_by) VALUES($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8) RETURNING *`, [number, po.id, po.supplier_id, receipt_date, req.user.id, location, notes, req.user.id])).rows[0];
      for (const x of clean) {
        const item = (await client.query("SELECT * FROM purchase_order_items WHERE id=$1 AND purchase_order_id=$2 FOR UPDATE", [x.po_item_id, po.id])).rows[0];
        if (!item) throw new Error("One or more PO items are invalid");
        const remaining = Number(item.quantity) - Number(item.received_quantity || 0);
        if (x.quantity_received > remaining) throw new Error(`Received quantity for ${item.description} exceeds the remaining PO quantity`);
        await client.query(`INSERT INTO goods_receipt_items(goods_receipt_id,purchase_order_item_id,description,quantity_received,condition,notes) VALUES($1,$2,$3,$4,$5,$6)`, [gr.id, item.id, item.description, x.quantity_received, x.condition, x.notes]);
      }
      await audit(client, req.user.id, "CREATE", "GOODS_RECEIPT", gr.id, { number, purchase_order: po.number });
      return gr;
    });
    res.status(201).json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post("/procurement/goods-receipts/:id/post", async (req, res) => {
  if (!requireRole(req, res, ["ADMIN", "MANAGER"])) return;
  try {
    const result = await transaction(async client => {
      const gr = (await client.query("SELECT * FROM goods_receipts WHERE id=$1 FOR UPDATE", [req.params.id])).rows[0];
      if (!gr) throw new Error("Goods receipt not found");
      if (gr.status !== "DRAFT") throw new Error("Only draft goods receipts can be posted");
      const po = (await client.query("SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE", [gr.purchase_order_id])).rows[0];
      if (!po) throw new Error("Purchase order not found");
      const items = (await client.query("SELECT * FROM goods_receipt_items WHERE goods_receipt_id=$1", [gr.id])).rows;
      if (!items.length) throw new Error("Goods receipt has no items");
      for (const x of items) await client.query("UPDATE purchase_order_items SET received_quantity=received_quantity+$1 WHERE id=$2", [x.quantity_received, x.purchase_order_item_id]);
      const remaining = (await client.query("SELECT COUNT(*)::int n FROM purchase_order_items WHERE purchase_order_id=$1 AND received_quantity < quantity", [po.id])).rows[0].n;
      const newStatus = remaining ? "PARTIALLY_RECEIVED" : "RECEIVED";
      await client.query("UPDATE purchase_orders SET status=$1,updated_at=NOW() WHERE id=$2", [newStatus, po.id]);
      const u = (await client.query("UPDATE goods_receipts SET status='POSTED',posted_by=$1,posted_at=NOW() WHERE id=$2 RETURNING *", [req.user.id, gr.id])).rows[0];
      await audit(client, req.user.id, "POST", "GOODS_RECEIPT", gr.id, { number: gr.number, purchase_order: po.number, purchase_order_status: newStatus });
      return u;
    });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

export default router;
