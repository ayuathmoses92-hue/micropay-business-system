import { Router } from "express";
import { query, transaction } from "../db.js";
import { nextNumber } from "../utils/sequence.js";
import { makeInvoicePdf, makePdf, makeQuotationPdf, makeReceiptPdf, makeExpenseVoucherPdf, makePaymentVoucherPdf } from "../utils/pdf.js";

const router = Router();
const roleAllowed = (req, roles) => roles.includes(req.user?.role);
const requireRole = (req, res, roles) => {
  if (!roleAllowed(req, roles)) { res.status(403).json({ error: "You do not have permission for this action" }); return false; }
  return true;
};
const audit = async (client, userId, action, entityType, entityId, details={}) => {
  await client.query("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)", [userId||null, action, entityType, entityId||null, JSON.stringify(details)]);
};
const cleanItems = items => (Array.isArray(items)?items:[]).map(x=>({description:String(x.description||"").trim(),quantity:Number(x.quantity),unit_price:Number(x.unit_price)})).filter(x=>x.description && x.quantity>0 && x.unit_price>=0);

router.get("/dashboard/management", async (req,res) => {
  try {
    const period=req.query.period||"month";
    const endDate=new Date();
    const startDate=new Date(endDate);
    if(period==="today") startDate.setHours(0,0,0,0);
    else if(period==="week") startDate.setDate(startDate.getDate()-6);
    else if(period==="quarter") startDate.setMonth(startDate.getMonth()-2,1);
    else if(period==="year") startDate.setMonth(0,1);
    else startDate.setMonth(startDate.getMonth(),1);
    const from=startDate.toISOString().slice(0,10), to=endDate.toISOString().slice(0,10);
    const [inv,col,exp,rec,quotes,pv,aging,top,trend,ecats]=await Promise.all([
      query("SELECT COALESCE(SUM(total),0) total FROM invoices WHERE invoice_date BETWEEN $1 AND $2 AND status <> 'CANCELLED'",[from,to]),
      query("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE payment_date BETWEEN $1 AND $2 AND status='ISSUED'",[from,to]),
      query("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE expense_date BETWEEN $1 AND $2 AND status <> 'CANCELLED'",[from,to]),
      query("SELECT COALESCE(SUM(balance),0) total FROM invoices WHERE balance>0 AND status <> 'CANCELLED'"),
      query("SELECT COUNT(*)::int count, COALESCE(SUM(total),0) amount FROM quotations WHERE quote_date BETWEEN $1 AND $2 AND status NOT IN ('CANCELLED','CONVERTED','ACCEPTED')",[from,to]),
      query("SELECT status, COUNT(*)::int count, COALESCE(SUM(amount),0) amount FROM payment_vouchers WHERE voucher_date BETWEEN $1 AND $2 GROUP BY status" ,[from,to]),
      query(`SELECT CASE WHEN CURRENT_DATE-(COALESCE(i.due_date,i.invoice_date)) <= 0 THEN 'Current' WHEN CURRENT_DATE-(COALESCE(i.due_date,i.invoice_date)) BETWEEN 1 AND 30 THEN '1-30 days' WHEN CURRENT_DATE-(COALESCE(i.due_date,i.invoice_date)) BETWEEN 31 AND 60 THEN '31-60 days' WHEN CURRENT_DATE-(COALESCE(i.due_date,i.invoice_date)) BETWEEN 61 AND 90 THEN '61-90 days' ELSE '90+ days' END bucket, COALESCE(SUM(i.balance),0) amount FROM invoices i WHERE i.balance>0 AND i.status <> 'CANCELLED' GROUP BY 1 ORDER BY CASE CASE WHEN CURRENT_DATE-(COALESCE(i.due_date,i.invoice_date)) <= 0 THEN 'Current' WHEN CURRENT_DATE-(COALESCE(i.due_date,i.invoice_date)) BETWEEN 1 AND 30 THEN '1-30 days' WHEN CURRENT_DATE-(COALESCE(i.due_date,i.invoice_date)) BETWEEN 31 AND 60 THEN '31-60 days' WHEN CURRENT_DATE-(COALESCE(i.due_date,i.invoice_date)) BETWEEN 61 AND 90 THEN '61-90 days' ELSE '90+ days' END WHEN 'Current' THEN 1 WHEN '1-30 days' THEN 2 WHEN '31-60 days' THEN 3 WHEN '61-90 days' THEN 4 ELSE 5 END`),
      query("SELECT c.id customer_id,c.name,COALESCE(SUM(i.balance),0) balance FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.balance>0 AND i.status <> 'CANCELLED' GROUP BY c.id,c.name ORDER BY balance DESC LIMIT 5"),
      query(`SELECT TO_CHAR(d,'Mon') label,COALESCE((SELECT SUM(total) FROM invoices i WHERE i.invoice_date BETWEEN date_trunc('month',d)::date AND (date_trunc('month',d)+interval '1 month - 1 day')::date AND i.status <> 'CANCELLED'),0) invoiced,COALESCE((SELECT SUM(amount) FROM payments p WHERE p.payment_date BETWEEN date_trunc('month',d)::date AND (date_trunc('month',d)+interval '1 month - 1 day')::date AND p.status='ISSUED'),0) collected FROM generate_series(date_trunc('month',CURRENT_DATE)-interval '5 months',date_trunc('month',CURRENT_DATE),interval '1 month') d ORDER BY d`),
      query("SELECT category,COALESCE(SUM(amount),0) amount FROM expenses WHERE expense_date BETWEEN $1 AND $2 AND status <> 'CANCELLED' GROUP BY category ORDER BY amount DESC LIMIT 8",[from,to])
    ]);
    const vouchers={pending_count:0,pending_amount:0,approved_count:0,approved_amount:0,paid_count:0,paid_amount:0};
    for(const r of pv.rows){ if(r.status==='DRAFT'){vouchers.pending_count=r.count;vouchers.pending_amount=r.amount} if(r.status==='APPROVED'){vouchers.approved_count=r.count;vouchers.approved_amount=r.amount} if(r.status==='PAID'){vouchers.paid_count=r.count;vouchers.paid_amount=r.amount} }
    const converted=await query("SELECT COUNT(*)::int count,COALESCE(SUM(total),0) amount FROM quotations WHERE quote_date BETWEEN $1 AND $2 AND status IN ('CONVERTED','ACCEPTED')",[from,to]);
    const eligible=await query("SELECT COUNT(*)::int count FROM quotations WHERE quote_date BETWEEN $1 AND $2 AND status <> 'CANCELLED'",[from,to]);
    const alerts=[];
    const receivables=Number(rec.rows[0].total), expenses=Number(exp.rows[0].total), collected=Number(col.rows[0].total);
    const overdue90=Number(aging.rows.find(x=>x.bucket==='90+ days')?.amount||0);
    if(overdue90>0) alerts.push({level:'high',title:'Receivables over 90 days',message:`${`$${overdue90.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`} is more than 90 days overdue.`});
    if(Number(vouchers.pending_amount)>0) alerts.push({level:'medium',title:'Payment vouchers awaiting approval',message:`${vouchers.pending_count} voucher(s) worth ${`$${Number(vouchers.pending_amount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`} require attention.`});
    if(receivables>0) alerts.push({level:'medium',title:'Outstanding receivables',message:`${`$${receivables.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`} remains outstanding across customers.`});
    if(expenses>collected && collected>0) alerts.push({level:'medium',title:'Expenses exceed collections',message:`For this period, expenses are ${`$${expenses.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`} versus collections of ${`$${collected.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}.`});
    res.json({period_label:`${from} to ${to}`,kpis:{invoiced:inv.rows[0].total,collected:col.rows[0].total,receivables:rec.rows[0].total,expenses:exp.rows[0].total,net_cash:Number(col.rows[0].total)-Number(exp.rows[0].total),quote_pipeline:quotes.rows[0].amount},aging:aging.rows,top_receivables:top.rows,trend:trend.rows,expense_categories:ecats.rows,vouchers,quotes:{open_count:quotes.rows[0].count,open_amount:quotes.rows[0].amount,converted_count:converted.rows[0].count,converted_amount:converted.rows[0].amount,conversion_rate:eligible.rows[0].count?((Number(converted.rows[0].count)/Number(eligible.rows[0].count))*100).toFixed(1):'0.0'},alerts});
  } catch(err){ console.error(err); res.status(500).json({error:"Unable to load management dashboard"}); }
});

router.get("/dashboard", async (_, res) => {
  const [c,q,i,p,e] = await Promise.all([
    query("SELECT COUNT(*)::int count FROM customers"), query("SELECT COUNT(*)::int count FROM quotations WHERE status <> 'CANCELLED'"), query("SELECT COUNT(*)::int count FROM invoices WHERE status <> 'CANCELLED'"), query("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE status='ISSUED'"), query("SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE status <> 'CANCELLED'")
  ]);
  const o = await query("SELECT COALESCE(SUM(balance),0) total FROM invoices WHERE balance>0 AND status <> 'CANCELLED'");
  res.json({customers:c.rows[0].count,quotations:q.rows[0].count,invoices:i.rows[0].count,collected:p.rows[0].total,expenses:e.rows[0].total,outstanding:o.rows[0].total});
});
router.get("/customers", async (_,res) => res.json((await query("SELECT * FROM customers ORDER BY created_at DESC")).rows));
router.post("/customers", async (req,res) => {
  const {name,contact_person="",phone="",email="",address="",tax_number="",notes=""}=req.body;
  if(!name?.trim()) return res.status(400).json({error:"Customer name is required"});
  const result=await transaction(async client=>{const number=await nextNumber(client,"CUS"); const r=await client.query(`INSERT INTO customers(customer_code,name,contact_person,phone,email,address,tax_number,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[number,name.trim(),contact_person,phone,email,address,tax_number,notes,req.user.id]); await audit(client,req.user.id,"CREATE","CUSTOMER",r.rows[0].id,{number}); return r;});
  res.status(201).json(result.rows[0]);
});

router.get("/quotations", async (_,res)=>res.json((await query(`SELECT q.*,c.name customer_name FROM quotations q JOIN customers c ON c.id=q.customer_id ORDER BY q.created_at DESC`)).rows));
router.get("/quotations/:id/items", async(req,res)=>res.json((await query("SELECT * FROM quotation_items WHERE quotation_id=$1 ORDER BY id",[req.params.id])).rows));
router.post("/quotations", async (req,res)=>{
  const {customer_id,quote_date,valid_until,discount=0,tax=0,notes="",items=[]}=req.body; const clean=cleanItems(items);
  if(!customer_id || !quote_date || !clean.length) return res.status(400).json({error:"Customer, date and at least one valid item are required"});
  const result=await transaction(async client=>{const number=await nextNumber(client,"QT"); const subtotal=clean.reduce((s,x)=>s+x.quantity*x.unit_price,0); const total=subtotal-Number(discount)+Number(tax); const q=(await client.query(`INSERT INTO quotations(number,customer_id,quote_date,valid_until,status,subtotal,discount,tax,total,notes,created_by) VALUES($1,$2,$3,$4,'SENT',$5,$6,$7,$8,$9,$10) RETURNING *`,[number,customer_id,quote_date,valid_until||null,subtotal,discount,tax,total,notes,req.user.id])).rows[0]; for(const x of clean) await client.query(`INSERT INTO quotation_items(quotation_id,description,quantity,unit_price,amount) VALUES($1,$2,$3,$4,$5)`,[q.id,x.description,x.quantity,x.unit_price,x.quantity*x.unit_price]); await audit(client,req.user.id,"CREATE","QUOTATION",q.id,{number}); return q;});
  res.status(201).json(result);
});
router.patch("/quotations/:id", async(req,res)=>{
  if(!requireRole(req,res,["ADMIN","MANAGER","CLERK"])) return;
  const {customer_id,quote_date,valid_until,discount=0,tax=0,notes="",items=[]}=req.body; const clean=cleanItems(items);
  const result=await transaction(async client=>{const q=(await client.query("SELECT * FROM quotations WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0]; if(!q) throw new Error("Quotation not found"); if(["CONVERTED","CANCELLED"].includes(q.status)) throw new Error("This quotation can no longer be edited"); if(!clean.length) throw new Error("At least one valid item is required"); const subtotal=clean.reduce((s,x)=>s+x.quantity*x.unit_price,0),total=subtotal-Number(discount)+Number(tax); const updated=(await client.query(`UPDATE quotations SET customer_id=$1,quote_date=$2,valid_until=$3,subtotal=$4,discount=$5,tax=$6,total=$7,notes=$8 WHERE id=$9 RETURNING *`,[customer_id,quote_date,valid_until||null,subtotal,discount,tax,total,notes,q.id])).rows[0]; await client.query("DELETE FROM quotation_items WHERE quotation_id=$1",[q.id]); for(const x of clean) await client.query(`INSERT INTO quotation_items(quotation_id,description,quantity,unit_price,amount) VALUES($1,$2,$3,$4,$5)`,[q.id,x.description,x.quantity,x.unit_price,x.quantity*x.unit_price]); await audit(client,req.user.id,"EDIT","QUOTATION",q.id,{number:q.number}); return updated;}); res.json(result);
});
router.post("/quotations/:id/convert", async (req,res)=>{
  const result=await transaction(async client=>{const q=(await client.query("SELECT * FROM quotations WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0]; if(!q) throw new Error("Quotation not found"); if(q.status==='CANCELLED') throw new Error("Cancelled quotation cannot be converted"); const existing=(await client.query("SELECT * FROM invoices WHERE quotation_id=$1 AND status<>'CANCELLED'",[q.id])).rows[0]; if(existing) return existing; const number=await nextNumber(client,"INV"); const inv=(await client.query(`INSERT INTO invoices(number,quotation_id,customer_id,invoice_date,due_date,status,subtotal,discount,tax,total,balance,notes,created_by) VALUES($1,$2,$3,CURRENT_DATE,$4,'ISSUED',$5,$6,$7,$8,$8,$9,$10) RETURNING *`,[number,q.id,q.customer_id,q.valid_until,q.subtotal,q.discount,q.tax,q.total,q.notes,req.user.id])).rows[0]; const items=(await client.query("SELECT * FROM quotation_items WHERE quotation_id=$1",[q.id])).rows; for(const x of items) await client.query(`INSERT INTO invoice_items(invoice_id,description,quantity,unit_price,amount) VALUES($1,$2,$3,$4,$5)`,[inv.id,x.description,x.quantity,x.unit_price,x.amount]); await client.query("UPDATE quotations SET status='CONVERTED' WHERE id=$1",[q.id]); await audit(client,req.user.id,"CONVERT","QUOTATION",q.id,{invoice_id:inv.id,invoice_number:number}); return inv;}); res.json(result);
});
router.post("/quotations/:id/cancel", async(req,res)=>{if(!requireRole(req,res,["ADMIN","MANAGER"]))return; const reason=String(req.body.reason||"").trim(); if(!reason)return res.status(400).json({error:"Cancellation reason is required"}); const result=await transaction(async client=>{const q=(await client.query("SELECT * FROM quotations WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0]; if(!q)throw new Error("Quotation not found"); if(q.status==='CONVERTED')throw new Error("Converted quotation cannot be cancelled"); if(q.status==='CANCELLED')throw new Error("Quotation is already cancelled"); const u=(await client.query("UPDATE quotations SET status='CANCELLED',cancelled_at=NOW(),cancelled_by=$1,cancellation_reason=$2 WHERE id=$3 RETURNING *",[req.user.id,reason,q.id])).rows[0]; await audit(client,req.user.id,"CANCEL","QUOTATION",q.id,{reason,previous_status:q.status}); return u;}); res.json(result);});

router.get("/invoices", async (_,res)=>res.json((await query(`SELECT i.*,c.name customer_name FROM invoices i JOIN customers c ON c.id=i.customer_id ORDER BY i.created_at DESC`)).rows));
router.get("/invoices/:id/items", async(req,res)=>res.json((await query("SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id",[req.params.id])).rows));
router.patch("/invoices/:id", async(req,res)=>{if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"]))return; const {customer_id,due_date,discount=0,tax=0,notes="",items=[]}=req.body; const clean=cleanItems(items); const result=await transaction(async client=>{const i=(await client.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0]; if(!i)throw new Error("Invoice not found"); if(i.status==='CANCELLED')throw new Error("Cancelled invoice cannot be edited"); if(Number(i.paid)>0)throw new Error("An invoice with payments cannot be edited"); if(!clean.length)throw new Error("At least one valid item is required"); const subtotal=clean.reduce((s,x)=>s+x.quantity*x.unit_price,0),total=subtotal-Number(discount)+Number(tax); const u=(await client.query(`UPDATE invoices SET customer_id=$1,due_date=$2,subtotal=$3,discount=$4,tax=$5,total=$6,balance=$6,notes=$7 WHERE id=$8 RETURNING *`,[customer_id,due_date||null,subtotal,discount,tax,total,notes,i.id])).rows[0]; await client.query("DELETE FROM invoice_items WHERE invoice_id=$1",[i.id]); for(const x of clean)await client.query(`INSERT INTO invoice_items(invoice_id,description,quantity,unit_price,amount) VALUES($1,$2,$3,$4,$5)`,[i.id,x.description,x.quantity,x.unit_price,x.quantity*x.unit_price]); await audit(client,req.user.id,"EDIT","INVOICE",i.id,{number:i.number}); return u;});res.json(result);});
router.post("/invoices/:id/cancel", async(req,res)=>{
  if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"]))return;
  const reason=String(req.body?.reason||"").trim();
  if(!reason)return res.status(400).json({error:"Cancellation reason is required"});
  try {
    const result=await transaction(async client=>{
      const i=(await client.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!i)throw new Error("Invoice not found");
      if(i.status==='CANCELLED')throw new Error("Invoice is already cancelled");
      if(Number(i.paid)>0)throw new Error("An invoice with payments cannot be cancelled; void/refund handling is required");
      const u=(await client.query("UPDATE invoices SET status='CANCELLED',cancelled_at=NOW(),cancelled_by=$1,cancellation_reason=$2 WHERE id=$3 RETURNING *",[req.user.id,reason,i.id])).rows[0];
      await audit(client,req.user.id,"CANCEL","INVOICE",i.id,{reason,previous_status:i.status});
      return u;
    });
    return res.json(result);
  } catch(err) {
    console.error("Invoice cancellation failed:",err);
    return res.status(400).json({error:err?.message||"Unable to cancel invoice"});
  }
});
router.post("/invoices/:id/payments", async(req,res)=>{
  const {payment_date,amount,method,reference="",notes="",account_id}=req.body;
  if(!account_id)return res.status(400).json({error:"Financial account is required"});
  try{
    const result=await transaction(async client=>{
      const inv=(await client.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!inv)throw new Error("Invoice not found");
      if(inv.status==='CANCELLED')throw new Error("Cannot receive payment for a cancelled invoice");
      if(Number(amount)<=0||Number(amount)>Number(inv.balance))throw new Error("Payment exceeds outstanding balance");
      const receipt=await nextNumber(client,"RCT");
      const a=(await client.query("SELECT * FROM financial_accounts WHERE id=$1 FOR UPDATE",[account_id])).rows[0];
      if(!a)throw new Error("Financial account not found");
      if(!a.active)throw new Error("Cannot receive money into an inactive account");
      const p=(await client.query(
        `INSERT INTO payments(invoice_id,receipt_number,payment_date,amount,method,reference,notes,created_by,account_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [inv.id,receipt,payment_date,amount,method,reference,notes,req.user.id,a.id])).rows[0];
      await client.query(
        `INSERT INTO account_transactions
         (account_id,transaction_date,transaction_type,direction,amount,reference,description,source_type,source_id,created_by)
         VALUES($1,$2,'RECEIPT','CREDIT',$3,$4,$5,'RECEIPT',$6,$7)`,
        [a.id,payment_date,amount,reference||receipt,`Receipt ${receipt}`,p.id,req.user.id]
      );
      const paid=Number(inv.paid)+Number(amount),balance=Number(inv.total)-paid;
      await client.query("UPDATE invoices SET paid=$1,balance=$2,status=$3 WHERE id=$4",[paid,balance,balance<=.0001?"PAID":"PARTIAL",inv.id]);
      await audit(client,req.user.id,"RECEIVE_PAYMENT","INVOICE",inv.id,{payment_id:p.id,receipt_number:receipt,amount:Number(amount),account_id:a.id});
      return p;
    });
    res.status(201).json(result);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to record payment"});}
});

router.get("/receipts", async (_,res)=>res.json((await query(`SELECT p.*,i.number invoice_number,c.name customer_name FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id ORDER BY p.created_at DESC`)).rows));
router.post("/receipts/:id/void", async(req,res)=>{if(!requireRole(req,res,["ADMIN","FINANCE"]))return;const reason=String(req.body.reason||"").trim();if(!reason)return res.status(400).json({error:"Void reason is required"});const result=await transaction(async client=>{const p=(await client.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];if(!p)throw new Error("Receipt not found");if(p.status==='VOID')throw new Error("Receipt is already void");const inv=(await client.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE",[p.invoice_id])).rows[0];if(!inv)throw new Error("Invoice not found");const u=(await client.query("UPDATE payments SET status='VOID',voided_at=NOW(),voided_by=$1,void_reason=$2 WHERE id=$3 RETURNING *",[req.user.id,reason,p.id])).rows[0];
      if(p.account_id){
        const tx=(await client.query("SELECT * FROM account_transactions WHERE source_type='RECEIPT' AND source_id=$1 AND status='POSTED' FOR UPDATE",[p.id])).rows[0];
        if(tx){
          await client.query("UPDATE account_transactions SET status='REVERSED' WHERE id=$1",[tx.id]);
          await client.query(`INSERT INTO account_transactions
            (account_id,transaction_date,transaction_type,direction,amount,reference,description,source_type,source_id,reversed_transaction_id,created_by)
            VALUES($1,$2,'RECEIPT','DEBIT',$3,$4,$5,'RECEIPT_VOID',$6,$7,$8)`,
            [tx.account_id,new Date().toISOString().slice(0,10),p.amount,p.reference||p.receipt_number,`Void receipt ${p.receipt_number}: ${reason}`,p.id,tx.id,req.user.id]);
        }
      }
      const paidRes=await client.query("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE invoice_id=$1 AND status='ISSUED'",[inv.id]);const paid=Number(paidRes.rows[0].total),balance=Number(inv.total)-paid;await client.query("UPDATE invoices SET paid=$1,balance=$2,status=$3 WHERE id=$4",[paid,balance,balance<=.0001?"PAID":paid>0?"PARTIAL":"ISSUED",inv.id]);await audit(client,req.user.id,"VOID","RECEIPT",p.id,{reason,invoice_id:inv.id,amount:Number(p.amount)});return u;});res.json(result);});

router.post("/expenses", async(req,res)=>{
  const {expense_date,category,description,supplier="",amount,payment_method="",paid_by="",reference="",notes="",account_id}=req.body;
  if(!account_id)return res.status(400).json({error:"Financial account is required"});
  try{
    const result=await transaction(async client=>{
      const a=(await client.query("SELECT * FROM financial_accounts WHERE id=$1 FOR UPDATE",[account_id])).rows[0];
      if(!a)throw new Error("Financial account not found");
      if(!a.active)throw new Error("Cannot pay from an inactive account");
      const number=await nextNumber(client,"EXP");
      const r=await client.query(`INSERT INTO expenses(expense_number,expense_date,category,description,supplier,amount,payment_method,paid_by,reference,notes,created_by,account_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [number,expense_date,category,description,supplier,amount,payment_method,paid_by,reference,notes,req.user.id,a.id]);
      await client.query(`INSERT INTO account_transactions
        (account_id,transaction_date,transaction_type,direction,amount,reference,description,source_type,source_id,created_by)
        VALUES($1,$2,'EXPENSE','DEBIT',$3,$4,$5,'EXPENSE',$6,$7)`,
        [a.id,expense_date,amount,reference||number,`Expense ${number}: ${description}`,r.rows[0].id,req.user.id]);
      await audit(client,req.user.id,"CREATE","EXPENSE",r.rows[0].id,{number,account_id:a.id});
      return r;
    });
    res.status(201).json(result.rows[0]);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to record expense"});}
});
router.get("/expenses", async(_,res)=>res.json((await query("SELECT * FROM expenses ORDER BY created_at DESC")).rows));
router.patch("/expenses/:id", async(req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"]))return;
  const {expense_date,category,description,supplier="",amount,payment_method="",paid_by="",reference="",notes="",account_id}=req.body;
  if(!account_id)return res.status(400).json({error:"Financial account is required"});
  try{
    const result=await transaction(async client=>{
      const e=(await client.query("SELECT * FROM expenses WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!e)throw new Error("Expense not found");
      if(e.status==='CANCELLED')throw new Error("Cancelled expense cannot be edited");
      const a=(await client.query("SELECT * FROM financial_accounts WHERE id=$1 FOR UPDATE",[account_id])).rows[0];
      if(!a)throw new Error("Financial account not found");
      if(!a.active)throw new Error("Cannot pay from an inactive account");
      const tx=(await client.query("SELECT * FROM account_transactions WHERE source_type='EXPENSE' AND source_id=$1 AND status='POSTED' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[e.id])).rows[0];
      if(tx){
        await client.query("UPDATE account_transactions SET status='REVERSED' WHERE id=$1",[tx.id]);
        await client.query(`INSERT INTO account_transactions
          (account_id,transaction_date,transaction_type,direction,amount,reference,description,source_type,source_id,reversed_transaction_id,created_by)
          VALUES($1,$2,'EXPENSE','CREDIT',$3,$4,$5,'EXPENSE_EDIT_REVERSAL',$6,$7,$8)`,
          [tx.account_id,new Date().toISOString().slice(0,10),tx.amount,tx.reference||e.expense_number,`Reversal of edited expense ${e.expense_number}`,e.id,tx.id,req.user.id]);
      }
      const u=(await client.query(`UPDATE expenses SET expense_date=$1,category=$2,description=$3,supplier=$4,amount=$5,payment_method=$6,paid_by=$7,reference=$8,notes=$9,account_id=$10 WHERE id=$11 RETURNING *`,
        [expense_date,category,description,supplier,amount,payment_method,paid_by,reference,notes,a.id,e.id])).rows[0];
      await client.query(`INSERT INTO account_transactions
        (account_id,transaction_date,transaction_type,direction,amount,reference,description,source_type,source_id,created_by)
        VALUES($1,$2,'EXPENSE','DEBIT',$3,$4,$5,'EXPENSE',$6,$7)`,
        [a.id,expense_date,amount,reference||u.expense_number,`Expense ${u.expense_number}: ${description}`,u.id,req.user.id]);
      await audit(client,req.user.id,"EDIT","EXPENSE",e.id,{number:e.expense_number,account_id:a.id});
      return u;
    });
    res.json(result);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to update expense"});}
});
router.post("/expenses/:id/cancel", async(req,res)=>{if(!requireRole(req,res,["ADMIN","FINANCE"]))return;const reason=String(req.body.reason||"").trim();if(!reason)return res.status(400).json({error:"Cancellation reason is required"});const result=await transaction(async client=>{const e=(await client.query("SELECT * FROM expenses WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];if(!e)throw new Error("Expense not found");if(e.status==='CANCELLED')throw new Error("Expense is already cancelled");const u=(await client.query("UPDATE expenses SET status='CANCELLED',cancelled_at=NOW(),cancelled_by=$1,cancellation_reason=$2 WHERE id=$3 RETURNING *",[req.user.id,reason,e.id])).rows[0];
      const tx=(await client.query("SELECT * FROM account_transactions WHERE source_type='EXPENSE' AND source_id=$1 AND status='POSTED' ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[e.id])).rows[0];
      if(tx){
        await client.query("UPDATE account_transactions SET status='REVERSED' WHERE id=$1",[tx.id]);
        await client.query(`INSERT INTO account_transactions
          (account_id,transaction_date,transaction_type,direction,amount,reference,description,source_type,source_id,reversed_transaction_id,created_by)
          VALUES($1,$2,'EXPENSE','CREDIT',$3,$4,$5,'EXPENSE_CANCEL',$6,$7,$8)`,
          [tx.account_id,new Date().toISOString().slice(0,10),tx.amount,e.reference||e.expense_number,`Cancelled expense ${e.expense_number}: ${reason}`,e.id,tx.id,req.user.id]);
      }
      await audit(client,req.user.id,"CANCEL","EXPENSE",e.id,{reason,previous_status:e.status});return u;});res.json(result);});

router.get("/payment-vouchers", async(_,res)=>res.json((await query("SELECT pv.*, e.expense_number FROM payment_vouchers pv LEFT JOIN expenses e ON e.id=pv.expense_id ORDER BY pv.created_at DESC")).rows));
router.post("/payment-vouchers", async(req,res)=>{
  const {voucher_date,payee,purpose,amount,payment_method,reference="",expense_id=null,notes="",prepared_by="",checked_by="",approved_by="",received_by="",account_id=null}=req.body;
  try{
    const result=await transaction(async client=>{
      if(account_id){
        const a=(await client.query("SELECT * FROM financial_accounts WHERE id=$1",[account_id])).rows[0];
        if(!a)throw new Error("Financial account not found");
        if(!a.active)throw new Error("Selected financial account is inactive");
      }
      const number=await nextNumber(client,"PV");
      const r=await client.query(`INSERT INTO payment_vouchers(voucher_number,voucher_date,payee,purpose,amount,payment_method,reference,expense_id,notes,prepared_by,checked_by,approved_by,received_by,created_by,account_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [number,voucher_date,payee,purpose,amount,payment_method,reference,expense_id,notes,prepared_by,checked_by,approved_by,received_by,req.user.id,account_id]);
      await audit(client,req.user.id,"CREATE","PAYMENT_VOUCHER",r.rows[0].id,{number,account_id});
      return r;
    });
    res.status(201).json(result.rows[0]);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to create payment voucher"});}
});
router.patch("/payment-vouchers/:id", async(req,res)=>{if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"]))return;const {voucher_date,payee,purpose,amount,payment_method,reference="",expense_id=null,notes="",prepared_by="",checked_by="",approved_by="",received_by="",account_id=null}=req.body;const result=await transaction(async client=>{const v=(await client.query("SELECT * FROM payment_vouchers WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];if(!v)throw new Error("Payment voucher not found");if(v.status!=='DRAFT')throw new Error("Only draft payment vouchers can be edited");const u=(await client.query(`UPDATE payment_vouchers SET voucher_date=$1,payee=$2,purpose=$3,amount=$4,payment_method=$5,reference=$6,expense_id=$7,notes=$8,prepared_by=$9,checked_by=$10,approved_by=$11,received_by=$12,account_id=$13 WHERE id=$14 RETURNING *`,[voucher_date,payee,purpose,amount,payment_method,reference,expense_id,notes,prepared_by,checked_by,approved_by,received_by,account_id,v.id])).rows[0];await audit(client,req.user.id,"EDIT","PAYMENT_VOUCHER",v.id,{number:v.voucher_number});return u;});res.json(result);});
router.post("/payment-vouchers/:id/approve", async(req,res)=>{if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"]))return;const result=await transaction(async client=>{const v=(await client.query("SELECT * FROM payment_vouchers WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];if(!v)throw new Error("Payment voucher not found");if(v.status!=='DRAFT')throw new Error("Only draft payment vouchers can be approved");const u=(await client.query("UPDATE payment_vouchers SET status='APPROVED',approved_at=NOW(),approved_by_user=$1 WHERE id=$2 RETURNING *",[req.user.id,v.id])).rows[0];await audit(client,req.user.id,"APPROVE","PAYMENT_VOUCHER",v.id,{number:v.voucher_number});return u;});res.json(result);});
router.post("/payment-vouchers/:id/pay", async(req,res)=>{
  if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"]))return;
  const account_id=String(req.body?.account_id||"");
  if(!account_id)return res.status(400).json({error:"Financial account is required when marking a voucher paid"});
  try{
    const result=await transaction(async client=>{
      const v=(await client.query("SELECT * FROM payment_vouchers WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!v)throw new Error("Payment voucher not found");
      if(v.status!=='APPROVED')throw new Error("Only approved payment vouchers can be marked paid");
      const a=(await client.query("SELECT * FROM financial_accounts WHERE id=$1 FOR UPDATE",[account_id])).rows[0];
      if(!a)throw new Error("Financial account not found");
      if(!a.active)throw new Error("Cannot pay from an inactive account");
      const bal=Number(a.opening_balance||0)+Number((await client.query(
        `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) balance
         FROM account_transactions WHERE account_id=$1 AND status='POSTED'`,[a.id])).rows[0].balance||0);
      if(bal<Number(v.amount))throw new Error("Insufficient account balance for this payment");
      const u=(await client.query("UPDATE payment_vouchers SET status='PAID',paid_at=NOW(),paid_by_user=$1,account_id=$2 WHERE id=$3 RETURNING *",[req.user.id,a.id,v.id])).rows[0];
      await client.query(`INSERT INTO account_transactions
        (account_id,transaction_date,transaction_type,direction,amount,reference,description,source_type,source_id,created_by)
        VALUES($1,$2,'PAYMENT_VOUCHER','DEBIT',$3,$4,$5,'PAYMENT_VOUCHER',$6,$7)`,
        [a.id,v.voucher_date,v.amount,v.reference||v.voucher_number,`Payment Voucher ${v.voucher_number}: ${v.purpose}`,v.id,req.user.id]);
      await audit(client,req.user.id,"PAY","PAYMENT_VOUCHER",v.id,{number:v.voucher_number,amount:Number(v.amount),account_id:a.id});
      return u;
    });
    res.json(result);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to mark voucher paid"});}
});
router.post("/payment-vouchers/:id/cancel", async(req,res)=>{if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"]))return;const reason=String(req.body.reason||"").trim();if(!reason)return res.status(400).json({error:"Cancellation reason is required"});const result=await transaction(async client=>{const v=(await client.query("SELECT * FROM payment_vouchers WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];if(!v)throw new Error("Payment voucher not found");if(v.status==='PAID')throw new Error("Paid payment vouchers cannot be cancelled");if(v.status==='CANCELLED')throw new Error("Payment voucher is already cancelled");const u=(await client.query("UPDATE payment_vouchers SET status='CANCELLED',cancelled_at=NOW(),cancelled_by_user=$1,cancellation_reason=$2 WHERE id=$3 RETURNING *",[req.user.id,reason,v.id])).rows[0];await audit(client,req.user.id,"CANCEL","PAYMENT_VOUCHER",v.id,{reason,previous_status:v.status});return u;});res.json(result);});


const reportDates=(req)=>{const from=req.query.from||"2000-01-01";const to=req.query.to||new Date().toISOString().slice(0,10);return [from,to]};
router.get("/reports/sales", async(req,res)=>{try{const [from,to]=reportDates(req);const status=req.query.status;const customer=req.query.customer;const where=["i.invoice_date BETWEEN $1 AND $2"];const vals=[from,to];if(status&&status!=="ALL"){vals.push(status);where.push(`i.status=$${vals.length}`)}if(customer){vals.push(customer);where.push(`i.customer_id=$${vals.length}`)}const rows=(await query(`SELECT i.id,i.number invoice_number,i.invoice_date,c.name customer_name,i.total,i.paid,i.balance,i.status FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE ${where.join(" AND ")} ORDER BY i.invoice_date DESC,i.number DESC`,vals)).rows;const summary=[{metric:"Total Invoiced",amount:rows.filter(x=>x.status!=="CANCELLED").reduce((a,x)=>a+Number(x.total||0),0)},{metric:"Total Paid",amount:rows.filter(x=>x.status!=="CANCELLED").reduce((a,x)=>a+Number(x.paid||0),0)},{metric:"Outstanding",amount:rows.filter(x=>x.status!=="CANCELLED").reduce((a,x)=>a+Number(x.balance||0),0)}];res.json({rows,summary})}catch(e){console.error(e);res.status(500).json({error:"Unable to generate sales report"})}});
router.get("/reports/aging", async(req,res)=>{try{const [from,to]=reportDates(req);const rows=(await query(`SELECT i.id,c.name customer_name,i.number invoice_number,i.invoice_date,i.due_date,i.balance,GREATEST(CURRENT_DATE-COALESCE(i.due_date,i.invoice_date),0)::int age_days,CASE WHEN CURRENT_DATE-COALESCE(i.due_date,i.invoice_date)<=0 THEN 'Current' WHEN CURRENT_DATE-COALESCE(i.due_date,i.invoice_date) BETWEEN 1 AND 30 THEN '1-30 days' WHEN CURRENT_DATE-COALESCE(i.due_date,i.invoice_date) BETWEEN 31 AND 60 THEN '31-60 days' WHEN CURRENT_DATE-COALESCE(i.due_date,i.invoice_date) BETWEEN 61 AND 90 THEN '61-90 days' ELSE '90+ days' END aging_bucket FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.balance>0 AND i.status<>'CANCELLED' AND i.invoice_date BETWEEN $1 AND $2 ORDER BY age_days DESC`,[from,to])).rows;res.json({rows,summary:[{metric:"Total Receivables",amount:rows.reduce((a,x)=>a+Number(x.balance||0),0)}]})}catch(e){console.error(e);res.status(500).json({error:"Unable to generate receivables aging report"})}});
router.get("/reports/expenses", async(req,res)=>{try{const [from,to]=reportDates(req);const status=req.query.status;const where=["expense_date BETWEEN $1 AND $2"];const vals=[from,to];if(status&&status!=="ALL"){vals.push(status);where.push(`status=$${vals.length}`)}const rows=(await query(`SELECT id,expense_number,expense_date,category,description,supplier,amount,payment_method,status FROM expenses WHERE ${where.join(" AND ")} ORDER BY expense_date DESC,created_at DESC`,vals)).rows;res.json({rows,summary:[{metric:"Total Expenses",amount:rows.filter(x=>x.status!=="CANCELLED").reduce((a,x)=>a+Number(x.amount||0),0)}]})}catch(e){console.error(e);res.status(500).json({error:"Unable to generate expense report"})}});
router.get("/reports/payments", async(req,res)=>{try{const [from,to]=reportDates(req);const status=req.query.status;const where=["p.payment_date BETWEEN $1 AND $2"];const vals=[from,to];if(status&&status!=="ALL"){vals.push(status);where.push(`p.status=$${vals.length}`)}const rows=(await query(`SELECT p.id,p.receipt_number,p.payment_date,i.number invoice_number,c.name customer_name,p.amount,p.method,p.reference,p.status FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id WHERE ${where.join(" AND ")} ORDER BY p.payment_date DESC,p.created_at DESC`,vals)).rows;res.json({rows,summary:[{metric:"Total Collections",amount:rows.filter(x=>x.status==='ISSUED').reduce((a,x)=>a+Number(x.amount||0),0)}]})}catch(e){console.error(e);res.status(500).json({error:"Unable to generate payment report"})}});
router.get("/reports/vouchers", async(req,res)=>{try{const [from,to]=reportDates(req);const status=req.query.status;const where=["voucher_date BETWEEN $1 AND $2"];const vals=[from,to];if(status&&status!=="ALL"){vals.push(status);where.push(`status=$${vals.length}`)}const rows=(await query(`SELECT id,voucher_number,voucher_date,payee,purpose,amount,payment_method,status FROM payment_vouchers WHERE ${where.join(" AND ")} ORDER BY voucher_date DESC,created_at DESC`,vals)).rows;res.json({rows,summary:[{metric:"Voucher Value",amount:rows.reduce((a,x)=>a+Number(x.amount||0),0)},{metric:"Paid Vouchers",amount:rows.filter(x=>x.status==='PAID').reduce((a,x)=>a+Number(x.amount||0),0)}]})}catch(e){console.error(e);res.status(500).json({error:"Unable to generate payment voucher report"})}});
router.get("/reports/quotes", async(req,res)=>{try{const [from,to]=reportDates(req);const status=req.query.status;const where=["q.quote_date BETWEEN $1 AND $2"];const vals=[from,to];if(status&&status!=="ALL"){vals.push(status);where.push(`q.status=$${vals.length}`)}const rows=(await query(`SELECT q.id,q.number,q.quote_date,c.name customer_name,q.total,q.status FROM quotations q JOIN customers c ON c.id=q.customer_id WHERE ${where.join(" AND ")} ORDER BY q.quote_date DESC,q.created_at DESC`,vals)).rows;const eligible=rows.filter(x=>x.status!=='CANCELLED').length;const converted=rows.filter(x=>['CONVERTED','ACCEPTED'].includes(x.status)).length;res.json({rows,summary:[{metric:"Quotation Value",amount:rows.filter(x=>x.status!=='CANCELLED').reduce((a,x)=>a+Number(x.total||0),0)},{metric:"Conversion Rate",amount:eligible?converted/eligible*100:0}]})}catch(e){console.error(e);res.status(500).json({error:"Unable to generate quotation report"})}});
router.get("/reports/summary", async(req,res)=>{try{const [from,to]=reportDates(req);const [inv,col,exp,recv]=await Promise.all([query("SELECT COALESCE(SUM(total),0) n FROM invoices WHERE invoice_date BETWEEN $1 AND $2 AND status<>'CANCELLED'",[from,to]),query("SELECT COALESCE(SUM(amount),0) n FROM payments WHERE payment_date BETWEEN $1 AND $2 AND status='ISSUED'",[from,to]),query("SELECT COALESCE(SUM(amount),0) n FROM expenses WHERE expense_date BETWEEN $1 AND $2 AND status<>'CANCELLED'",[from,to]),query("SELECT COALESCE(SUM(balance),0) n FROM invoices WHERE balance>0 AND status<>'CANCELLED'")]);res.json({rows:[],summary:[{metric:"Total Invoiced",amount:inv.rows[0].n},{metric:"Cash Collected",amount:col.rows[0].n},{metric:"Outstanding Receivables",amount:recv.rows[0].n},{metric:"Total Expenses",amount:exp.rows[0].n},{metric:"Net Cash Movement",amount:Number(col.rows[0].n)-Number(exp.rows[0].n)}]})}catch(e){console.error(e);res.status(500).json({error:"Unable to generate management financial summary"})}});





function formatReconciliationDate(value){
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return String(value);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

// Bank/Cash Reconciliation
router.get("/reconciliations", async(req,res)=>{
  if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"]))return;
  try{
    const r=await query(`SELECT r.*,a.account_name,a.account_type,u.name prepared_by_name
      FROM account_reconciliations r
      JOIN financial_accounts a ON a.id=r.account_id
      LEFT JOIN users u ON u.id=r.prepared_by
      ORDER BY r.period_end DESC,r.created_at DESC`);
    res.json(r.rows);
  }catch(e){console.error(e);res.status(500).json({error:"Unable to load reconciliations"});}
});

router.get("/reconciliations/preview", async(req,res)=>{
  if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"]))return;
  const {account_id,period_start}=req.query;
  if(!account_id||!period_start)return res.status(400).json({error:"Account and period start are required"});
  try{
    const a=(await query("SELECT * FROM financial_accounts WHERE id=$1",[account_id])).rows[0];
    if(!a)return res.status(404).json({error:"Financial account not found"});
    const prior=(await query(
      `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) balance
       FROM account_transactions
       WHERE account_id=$1 AND status='POSTED' AND transaction_date < $2`,
      [account_id,period_start])).rows[0].balance;
    const systemOpening=Number(a.opening_balance||0)+Number(prior||0);
    const previous=(await query(
      `SELECT statement_closing_balance,period_end
       FROM account_reconciliations
       WHERE account_id=$1 AND status <> 'CANCELLED' AND period_end < $2
       ORDER BY period_end DESC LIMIT 1`,
      [account_id,period_start])).rows[0];
    res.json({
      system_opening_balance:systemOpening,
      statement_opening_balance:previous ? Number(previous.statement_closing_balance||0) : Number(a.opening_balance||0),
      previous_reconciliation_end:previous?.period_end||null
    });
  }catch(e){console.error(e);res.status(500).json({error:"Unable to calculate reconciliation opening balance"});}
});

router.post("/reconciliations", async(req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"]))return;
  const {account_id,period_start,period_end,statement_closing_balance=0,notes=""}=req.body;
  if(!account_id||!period_start||!period_end)return res.status(400).json({error:"Account and reconciliation period are required"});
  if(String(period_end)<String(period_start))return res.status(400).json({error:"Period end cannot be before period start"});
  if(statement_closing_balance===undefined || statement_closing_balance===null || String(statement_closing_balance).trim()==="")return res.status(400).json({error:"Statement / Actual Closing Balance is required"});
  try{
    const result=await transaction(async client=>{
      const a=(await client.query("SELECT * FROM financial_accounts WHERE id=$1",[account_id])).rows[0];
      if(!a)throw new Error("Financial account not found");
      const existing=(await client.query(
        `SELECT id,period_start,period_end FROM account_reconciliations
         WHERE account_id=$1
           AND status <> 'CANCELLED'
           AND period_start <= $3
           AND period_end >= $2
         LIMIT 1`,
        [account_id,period_start,period_end]
      )).rows[0];
      if(existing){
        throw new Error(`An active reconciliation already exists for this account for ${formatReconciliationDate(existing.period_start)} to ${formatReconciliationDate(existing.period_end)}`);
      }
      const prior=(await client.query(
        `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) balance
         FROM account_transactions WHERE account_id=$1 AND status='POSTED' AND transaction_date < $2`,
        [account_id,period_start])).rows[0].balance;
      const sysOpening=Number(a.opening_balance||0)+Number(prior||0);
      const periodMovement=(await client.query(
        `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) balance
         FROM account_transactions WHERE account_id=$1 AND status='POSTED' AND transaction_date BETWEEN $2 AND $3`,
        [account_id,period_start,period_end])).rows[0].balance;
      const sys= sysOpening + Number(periodMovement||0);
      const previous=(await client.query(
        `SELECT statement_closing_balance FROM account_reconciliations
         WHERE account_id=$1 AND status <> 'CANCELLED' AND period_end < $2
         ORDER BY period_end DESC LIMIT 1`,
        [account_id,period_start])).rows[0];
      const statementOpening=previous ? Number(previous.statement_closing_balance||0) : Number(a.opening_balance||0);
      const diff=Number(statement_closing_balance)-sys;
      const r=(await client.query(`INSERT INTO account_reconciliations
        (account_id,period_start,period_end,statement_opening_balance,statement_closing_balance,reconciled_balance,difference,notes,prepared_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [account_id,period_start,period_end,statementOpening,Number(statement_closing_balance),sys,diff,notes,req.user.id])).rows[0];
      await client.query(`INSERT INTO reconciliation_items(reconciliation_id,transaction_id)
        SELECT $1,t.id FROM account_transactions t
        WHERE t.account_id=$2 AND t.status='POSTED' AND t.transaction_date BETWEEN $3 AND $4`,
        [r.id,account_id,period_start,period_end]);
      await audit(client,req.user.id,"CREATE","RECONCILIATION",r.id,{account_id,period_start,period_end,difference:diff});
      return r;
    });
    res.status(201).json(result);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to create reconciliation"});}
});

router.get("/reconciliations/:id", async(req,res)=>{
  if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"]))return;
  try{
    const r=(await query(`SELECT r.*,a.account_name,a.account_type
      FROM account_reconciliations r JOIN financial_accounts a ON a.id=r.account_id WHERE r.id=$1`,[req.params.id])).rows[0];
    if(!r)return res.status(404).json({error:"Reconciliation not found"});
    const items=(await query(`SELECT ri.*,t.transaction_date,t.transaction_type,t.direction,t.amount,t.reference,t.description
      FROM reconciliation_items ri JOIN account_transactions t ON t.id=ri.transaction_id
      WHERE ri.reconciliation_id=$1 ORDER BY t.transaction_date,t.created_at,t.id`,[r.id])).rows;
    res.json({...r,items});
  }catch(e){console.error(e);res.status(500).json({error:"Unable to load reconciliation"});}
});

router.patch("/reconciliations/:id/items/:itemId", async(req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"]))return;
  const cleared=Boolean(req.body.cleared);
  try{
    const r=await transaction(async client=>{
      const item=(await client.query(`SELECT ri.*,r.status reconciliation_status
        FROM reconciliation_items ri JOIN account_reconciliations r ON r.id=ri.reconciliation_id
        WHERE ri.id=$1 FOR UPDATE`,[req.params.itemId])).rows[0];
      if(!item)throw new Error("Reconciliation item not found");
      if(item.reconciliation_status!=="DRAFT")throw new Error("Only draft reconciliations can be changed");
      const dbUser=(await client.query("SELECT id FROM users WHERE id::text=$1",[String(req.user.id)])).rows[0];
      if(!dbUser)throw new Error("Authenticated user was not found");
      return (await client.query(`UPDATE reconciliation_items SET cleared=$1,cleared_at=CASE WHEN $1 THEN NOW() ELSE NULL END,cleared_by=CASE WHEN $1 THEN $2::uuid ELSE NULL END WHERE id=$3 RETURNING *`,
        [cleared,dbUser.id,item.id])).rows[0];
    });
    res.json(r);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to update reconciliation item"});}
});


router.post("/reconciliations/:id/cancel", async(req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"]))return;
  const reason=String(req.body?.reason||"").trim();
  if(!reason)return res.status(400).json({error:"Cancellation reason is required"});
  try{
    const result=await transaction(async client=>{
      const r=(await client.query("SELECT * FROM account_reconciliations WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!r)throw new Error("Reconciliation not found");
      if(r.status==="CANCELLED")throw new Error("Reconciliation is already cancelled");
      const u=(await client.query(`UPDATE account_reconciliations
        SET status='CANCELLED',cancelled_by=$1,cancelled_at=NOW(),cancellation_reason=$2,updated_at=NOW()
        WHERE id=$3 RETURNING *`,[req.user.id,reason,r.id])).rows[0];
      await audit(client,req.user.id,"CANCEL","RECONCILIATION",r.id,{reason,previous_status:r.status});
      return u;
    });
    res.json(result);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to cancel reconciliation"});}
});

router.post("/reconciliations/:id/complete", async(req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"]))return;
  try{
    const result=await transaction(async client=>{
      const r=(await client.query("SELECT * FROM account_reconciliations WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!r)throw new Error("Reconciliation not found");
      if(r.status!=="DRAFT")throw new Error("Only draft reconciliations can be completed");
      const open=await client.query(`SELECT COUNT(*)::int count FROM reconciliation_items WHERE reconciliation_id=$1 AND cleared=false`,[r.id]);
      if(Number(open.rows[0].count)>0)throw new Error("All reconciliation items must be cleared before completion");
      if(Math.abs(Number(r.difference))>0.005)throw new Error("Reconciliation difference must be zero before completion");
      const u=(await client.query(`UPDATE account_reconciliations SET status='COMPLETED',completed_by=$1,completed_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING *`,[req.user.id,r.id])).rows[0];
      await audit(client,req.user.id,"COMPLETE","RECONCILIATION",r.id,{difference:r.difference});
      return u;
    });
    res.json(result);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to complete reconciliation"});}
});


// Cash & Bank Transactions — Stage 2
router.get("/financial-accounts/:id/transactions", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"])) return;
  try{
    const r=await query(
      `SELECT t.*,u.name created_by_name
       FROM account_transactions t
       LEFT JOIN users u ON u.id=t.created_by
       WHERE t.account_id=$1
       ORDER BY t.transaction_date DESC,t.created_at DESC`,
      [req.params.id]
    );
    res.json(r.rows);
  }catch(e){console.error(e);res.status(500).json({error:"Unable to load account transactions"});}
});

router.get("/financial-accounts/:id/statement", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"])) return;
  try{
    const a=(await query(`SELECT * FROM financial_accounts WHERE id=$1`,[req.params.id])).rows[0];
    if(!a)return res.status(404).json({error:"Financial account not found"});
    const r=await query(
      `SELECT t.*,
        SUM(CASE WHEN t.direction='CREDIT' THEN t.amount ELSE -t.amount END)
          OVER (ORDER BY t.transaction_date,t.created_at,t.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        + $2 AS running_balance
       FROM account_transactions t
       WHERE t.account_id=$1 AND t.status='POSTED'
       ORDER BY t.transaction_date,t.created_at,t.id`,
      [req.params.id,Number(a.opening_balance||0)]
    );
    const balance=Number(a.opening_balance||0)+r.rows.reduce((s,x)=>s+(x.direction==="CREDIT"?Number(x.amount):-Number(x.amount)),0);
    res.json({account:a,balance,transactions:r.rows});
  }catch(e){console.error(e);res.status(500).json({error:"Unable to load account statement"});}
});

router.post("/financial-accounts/:id/adjustment", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"])) return;
  const amount=Number(req.body.amount);
  const direction=String(req.body.direction||"").toUpperCase();
  const date=req.body.transaction_date||new Date().toISOString().slice(0,10);
  const description=String(req.body.description||"").trim();
  const reference=String(req.body.reference||"").trim();
  if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"Adjustment amount must be greater than zero"});
  if(!["CREDIT","DEBIT"].includes(direction))return res.status(400).json({error:"Adjustment direction is required"});
  if(!description)return res.status(400).json({error:"Adjustment description is required"});
  try{
    const result=await transaction(async client=>{
      const a=(await client.query("SELECT * FROM financial_accounts WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!a)throw new Error("Financial account not found");
      if(!a.active)throw new Error("Cannot post to an inactive account");
      const r=await client.query(
        `INSERT INTO account_transactions
         (account_id,transaction_date,transaction_type,direction,amount,reference,description,source_type,created_by)
         VALUES($1,$2,'ADJUSTMENT',$3,$4,$5,$6,'MANUAL_ADJUSTMENT',$7) RETURNING *`,
        [a.id,date,direction,amount,reference||null,description,req.user.id]
      );
      await audit(client,req.user.id,"CREATE","ACCOUNT_TRANSACTION",r.rows[0].id,{account_id:a.id,type:"ADJUSTMENT",direction,amount});
      return r.rows[0];
    });
    res.status(201).json(result);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to post adjustment"});}
});

router.post("/financial-transfers", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"])) return;
  const from=String(req.body.from_account_id||"");
  const to=String(req.body.to_account_id||"");
  const amount=Number(req.body.amount);
  const date=req.body.transaction_date||new Date().toISOString().slice(0,10);
  const reference=String(req.body.reference||"").trim();
  const description=String(req.body.description||"").trim();
  if(!from||!to||from===to)return res.status(400).json({error:"Different source and destination accounts are required"});
  if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"Transfer amount must be greater than zero"});
  try{
    const result=await transaction(async client=>{
      const ids=[from,to].sort();
      const locked=(await client.query("SELECT * FROM financial_accounts WHERE id=ANY($1) ORDER BY id FOR UPDATE",[ids])).rows;
      const source=locked.find(x=>x.id===from), dest=locked.find(x=>x.id===to);
      if(!source||!dest)throw new Error("Financial account not found");
      if(!source.active||!dest.active)throw new Error("Both accounts must be active");
      const sourceBalance=Number(source.opening_balance||0)+(await client.query(
        `SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) balance
         FROM account_transactions WHERE account_id=$1`,[source.id])).rows[0].balance*1;
      if(sourceBalance<amount)throw new Error("Insufficient account balance for this transfer");
      const group=(await client.query("SELECT gen_random_uuid() id")).rows[0].id;
      const out=await client.query(
        `INSERT INTO account_transactions
         (account_id,transaction_date,transaction_type,direction,amount,reference,description,source_type,transfer_group_id,created_by)
         VALUES($1,$2,'TRANSFER_OUT','DEBIT',$3,$4,$5,'TRANSFER',$6,$7) RETURNING *`,
        [source.id,date,amount,reference||null,description||`Transfer to ${dest.account_name}`,group,req.user.id]);
      const inn=await client.query(
        `INSERT INTO account_transactions
         (account_id,transaction_date,transaction_type,direction,amount,reference,description,source_type,transfer_group_id,created_by)
         VALUES($1,$2,'TRANSFER_IN','CREDIT',$3,$4,$5,'TRANSFER',$6,$7) RETURNING *`,
        [dest.id,date,amount,reference||null,description||`Transfer from ${source.account_name}`,group,req.user.id]);
      await audit(client,req.user.id,"TRANSFER","FINANCIAL_ACCOUNT",source.id,{to_account_id:dest.id,amount,transfer_group_id:group});
      return {out:out.rows[0],in:inn.rows[0]};
    });
    res.status(201).json(result);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to post transfer"});}
});

// Cash & Bank Accounts — Stage 1
router.get("/financial-accounts", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"])) return;
  try{
    const rows=(await query(`SELECT a.*,u.name created_by_name,
        a.opening_balance + COALESCE(SUM(CASE WHEN t.direction='CREDIT' THEN t.amount ELSE -t.amount END),0) AS current_balance
      FROM financial_accounts a
      LEFT JOIN users u ON u.id=a.created_by
      LEFT JOIN account_transactions t ON t.account_id=a.id
      GROUP BY a.id,u.name
      ORDER BY a.active DESC,a.account_type,a.account_name`)).rows;
    res.json(rows);
  }catch(e){ console.error(e); res.status(500).json({error:"Unable to load financial accounts"}); }
});

router.post("/financial-accounts", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"])) return;
  const name=String(req.body.account_name||"").trim();
  const type=String(req.body.account_type||"").trim().toUpperCase();
  const institution=String(req.body.institution_name||"").trim();
  const reference=String(req.body.account_reference||"").trim();
  const opening=Number(req.body.opening_balance||0);
  const date=req.body.opening_balance_date||null;
  const notes=String(req.body.notes||"").trim();
  if(!name)return res.status(400).json({error:"Account name is required"});
  if(!["CASH","BANK","MOBILE_MONEY"].includes(type))return res.status(400).json({error:"Valid account type is required"});
  if(!Number.isFinite(opening)||opening<0)return res.status(400).json({error:"Opening balance must be zero or greater"});
  try{
    const result=await transaction(async client=>{
      const code=(await client.query(`SELECT 'ACC-'||LPAD((COALESCE(MAX(NULLIF(regexp_replace(account_code,'\\D','','g'),'' )::integer),0)+1)::text,4,'0') AS code FROM financial_accounts`)).rows[0].code;
      const r=await client.query(`INSERT INTO financial_accounts
        (account_code,account_name,account_type,institution_name,account_reference,opening_balance,opening_balance_date,notes,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [code,name,type,institution||null,reference||null,opening,date,notes||null,req.user.id]);
      await audit(client,req.user.id,"CREATE","FINANCIAL_ACCOUNT",r.rows[0].id,{account_code:code,account_name:name,account_type:type,opening_balance:opening});
      return r.rows[0];
    });
    res.status(201).json(result);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to create financial account"});}
});

router.patch("/financial-accounts/:id", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"])) return;
  const name=String(req.body.account_name||"").trim();
  const type=String(req.body.account_type||"").trim().toUpperCase();
  const institution=String(req.body.institution_name||"").trim();
  const reference=String(req.body.account_reference||"").trim();
  const opening=Number(req.body.opening_balance||0);
  const date=req.body.opening_balance_date||null;
  const active=req.body.active!==false;
  const notes=String(req.body.notes||"").trim();
  if(!name||!["CASH","BANK","MOBILE_MONEY"].includes(type)||!Number.isFinite(opening)||opening<0)
    return res.status(400).json({error:"Valid account details are required"});
  try{
    const result=await transaction(async client=>{
      const existing=(await client.query("SELECT * FROM financial_accounts WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!existing)throw new Error("Financial account not found");
      const r=await client.query(`UPDATE financial_accounts SET account_name=$1,account_type=$2,institution_name=$3,
        account_reference=$4,opening_balance=$5,opening_balance_date=$6,active=$7,notes=$8,updated_at=NOW()
        WHERE id=$9 RETURNING *`,
        [name,type,institution||null,reference||null,opening,date,active,notes||null,existing.id]);
      await audit(client,req.user.id,"EDIT","FINANCIAL_ACCOUNT",existing.id,{account_name:name,account_type:type,active});
      return r.rows[0];
    });
    res.json(result);
  }catch(e){console.error(e);res.status(400).json({error:e.message||"Unable to update financial account"});}
});

// Budget vs Actual
router.get("/budgets", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"])) return;
  try {
    const year=Number(req.query.year||new Date().getFullYear());
    const month=req.query.month ? Number(req.query.month) : null;
    const vals=[year];
    let where="budget_year=$1";
    if(month){ vals.push(month); where+=` AND budget_month=$${vals.length}`; }
    const rows=(await query(
      `SELECT b.*,u.name created_by_name
       FROM budgets b
       LEFT JOIN users u ON u.id=b.created_by
       WHERE ${where}
       ORDER BY b.budget_month,b.category`, vals
    )).rows;
    res.json(rows);
  } catch(e) {
    console.error(e);
    res.status(500).json({error:"Unable to load budgets"});
  }
});

router.post("/budgets", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"])) return;
  const year=Number(req.body.budget_year);
  const month=Number(req.body.budget_month);
  const category=String(req.body.category||"").trim();
  const amount=Number(req.body.amount);
  const notes=String(req.body.notes||"").trim();
  if(!Number.isInteger(year)||year<2000||year>2100) return res.status(400).json({error:"Valid budget year is required"});
  if(!Number.isInteger(month)||month<1||month>12) return res.status(400).json({error:"Valid budget month is required"});
  if(!category) return res.status(400).json({error:"Budget category is required"});
  if(!Number.isFinite(amount)||amount<0) return res.status(400).json({error:"Valid budget amount is required"});
  try {
    const result=await transaction(async client=>{
      const r=await client.query(
        `INSERT INTO budgets(budget_year,budget_month,category,amount,notes,created_by)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [year,month,category,amount,notes,req.user.id]
      );
      await audit(client,req.user.id,"CREATE","BUDGET",r.rows[0].id,{year,month,category,amount});
      return r.rows[0];
    });
    res.status(201).json(result);
  } catch(e) {
    console.error(e);
    if(e.code==="23505") return res.status(409).json({error:"A budget already exists for this year, month and category"});
    res.status(400).json({error:e.message||"Unable to save budget"});
  }
});

router.patch("/budgets/:id", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"])) return;
  const year=Number(req.body.budget_year);
  const month=Number(req.body.budget_month);
  const category=String(req.body.category||"").trim();
  const amount=Number(req.body.amount);
  const notes=String(req.body.notes||"").trim();
  if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12||!category||!Number.isFinite(amount)||amount<0)
    return res.status(400).json({error:"Valid budget details are required"});
  try {
    const result=await transaction(async client=>{
      const existing=(await client.query("SELECT * FROM budgets WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!existing) throw new Error("Budget not found");
      const r=await client.query(
        `UPDATE budgets SET budget_year=$1,budget_month=$2,category=$3,amount=$4,notes=$5
         WHERE id=$6 RETURNING *`,
        [year,month,category,amount,notes,existing.id]
      );
      await audit(client,req.user.id,"EDIT","BUDGET",existing.id,{year,month,category,amount});
      return r.rows[0];
    });
    res.json(result);
  } catch(e) {
    console.error(e);
    if(e.code==="23505") return res.status(409).json({error:"A budget already exists for this year, month and category"});
    res.status(400).json({error:e.message||"Unable to update budget"});
  }
});

router.delete("/budgets/:id", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","FINANCE"])) return;
  try {
    const result=await transaction(async client=>{
      const existing=(await client.query("SELECT * FROM budgets WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
      if(!existing) throw new Error("Budget not found");
      await client.query("DELETE FROM budgets WHERE id=$1",[existing.id]);
      await audit(client,req.user.id,"DELETE","BUDGET",existing.id,{year:existing.budget_year,month:existing.budget_month,category:existing.category});
      return existing;
    });
    res.json({ok:true,deleted:result.id});
  } catch(e) {
    console.error(e);
    res.status(400).json({error:e.message||"Unable to delete budget"});
  }
});

router.get("/reports/budget-vs-actual", async (req,res)=>{
  if(!requireRole(req,res,["ADMIN","MANAGER","FINANCE"])) return;
  try {
    const year=Number(req.query.year||new Date().getFullYear());
    const month=req.query.month ? Number(req.query.month) : null;
    const vals=[year];
    let bwhere="b.budget_year=$1";
    let ewhere="EXTRACT(YEAR FROM e.expense_date)=$1";
    if(month){
      vals.push(month);
      bwhere+=` AND b.budget_month=$${vals.length}`;
      ewhere+=` AND EXTRACT(MONTH FROM e.expense_date)=$${vals.length}`;
    }

    const budgetRows=(await query(
      `SELECT b.budget_month,b.category,b.amount budget_amount
       FROM budgets b WHERE ${bwhere}
       ORDER BY b.budget_month,b.category`, vals
    )).rows;

    const actualRows=(await query(
      `SELECT EXTRACT(MONTH FROM e.expense_date)::int budget_month,
              e.category,
              COALESCE(SUM(e.amount),0) actual_amount
       FROM expenses e
       WHERE ${ewhere} AND e.status<>'CANCELLED'
       GROUP BY EXTRACT(MONTH FROM e.expense_date),e.category
       ORDER BY budget_month,e.category`, vals
    )).rows;

    const map=new Map();
    for(const r of budgetRows){
      const key=`${r.budget_month}|${r.category}`;
      map.set(key,{budget_month:r.budget_month,category:r.category,budget_amount:Number(r.budget_amount||0),actual_amount:0});
    }
    for(const r of actualRows){
      const key=`${r.budget_month}|${r.category}`;
      if(!map.has(key)) map.set(key,{budget_month:r.budget_month,category:r.category,budget_amount:0,actual_amount:Number(r.actual_amount||0)});
      else map.get(key).actual_amount=Number(r.actual_amount||0);
    }

    const rows=[...map.values()].sort((a,b)=>a.budget_month-b.budget_month||a.category.localeCompare(b.category))
      .map(r=>{
        const variance=r.actual_amount-r.budget_amount;
        const variance_pct=r.budget_amount ? variance/r.budget_amount*100 : (r.actual_amount ? 100 : 0);
        return {...r,variance,variance_pct,status:variance>0.005?"OVER":Math.abs(variance)<=0.005?"ON":"UNDER"};
      });

    const totalBudget=rows.reduce((a,r)=>a+r.budget_amount,0);
    const totalActual=rows.reduce((a,r)=>a+r.actual_amount,0);
    const totalVariance=totalActual-totalBudget;
    res.json({
      year,month,
      rows,
      summary:[
        {metric:"Total Budget",amount:totalBudget},
        {metric:"Actual Expenses",amount:totalActual},
        {metric:"Variance",amount:totalVariance},
        {metric:"Budget Utilization %",amount:totalBudget?totalActual/totalBudget*100:0}
      ]
    });
  } catch(e) {
    console.error(e);
    res.status(500).json({error:"Unable to generate budget vs actual report"});
  }
});

router.get("/audit-logs", async(req,res)=>{if(!requireRole(req,res,["ADMIN","MANAGER"]))return;res.json((await query(`SELECT a.*,u.name user_name,u.email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 500`)).rows);});

router.get("/documents/payment-voucher/:id.pdf", async(req,res)=>{const voucher=(await query("SELECT * FROM payment_vouchers WHERE id=$1",[req.params.id])).rows[0];if(!voucher)return res.status(404).send("Not found");const pdf=await makePaymentVoucherPdf({voucher});res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`inline; filename="${voucher.voucher_number}.pdf"`);res.send(pdf);});
router.get("/documents/expense/:id.pdf", async(req,res)=>{const expense=(await query("SELECT * FROM expenses WHERE id=$1",[req.params.id])).rows[0];if(!expense)return res.status(404).send("Not found");const pdf=await makeExpenseVoucherPdf({expense});res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`inline; filename="${expense.expense_number}.pdf"`);res.send(pdf);});
router.get("/documents/quotation/:id.pdf", async(req,res)=>{const q=(await query("SELECT q.* FROM quotations q WHERE q.id=$1",[req.params.id])).rows[0];if(!q)return res.status(404).send("Not found");const customer=(await query("SELECT * FROM customers WHERE id=$1",[q.customer_id])).rows[0];const items=(await query("SELECT * FROM quotation_items WHERE quotation_id=$1 ORDER BY id",[req.params.id])).rows;const pdf=await makeQuotationPdf({quotation:q,customer,items});res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`inline; filename="${q.number}.pdf"`);res.send(pdf);});
router.get("/documents/invoice/:id.pdf", async(req,res)=>{const i=(await query("SELECT i.*,c.name customer_name,c.contact_person,c.phone,c.email,c.address FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=$1",[req.params.id])).rows[0];if(!i)return res.status(404).send("Not found");const items=(await query("SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id",[req.params.id])).rows;const customer={name:i.customer_name,contact_person:i.contact_person,phone:i.phone,email:i.email,address:i.address};const pdf=await makeInvoicePdf({invoice:i,customer,items});res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`inline; filename="${i.number}.pdf"`);res.send(pdf);});
router.get("/documents/receipt/:id.pdf", async(req,res)=>{const r=(await query(`SELECT p.*,i.number invoice_number,i.total invoice_total,i.paid invoice_paid,i.balance invoice_balance,c.* FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id WHERE p.id=$1`,[req.params.id])).rows[0];if(!r)return res.status(404).send("Not found");const invoice={number:r.invoice_number,total:r.invoice_total,paid:r.invoice_paid,balance:r.invoice_balance};const pdf=await makeReceiptPdf({payment:r,invoice,customer:r});res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`inline; filename="${r.receipt_number}.pdf"`);res.send(pdf);});

export default router;
