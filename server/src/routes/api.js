import { Router } from "express";
import { query, transaction } from "../db.js";
import { nextNumber } from "../utils/sequence.js";
import { makePdf } from "../utils/pdf.js";

const router = Router();

router.get("/dashboard", async (_, res) => {
  const [c,q,i,p,e] = await Promise.all([
    query("SELECT COUNT(*)::int count FROM customers"),
    query("SELECT COUNT(*)::int count FROM quotations"),
    query("SELECT COUNT(*)::int count FROM invoices"),
    query("SELECT COALESCE(SUM(amount),0) total FROM payments"),
    query("SELECT COALESCE(SUM(amount),0) total FROM expenses")
  ]);
  const o = await query("SELECT COALESCE(SUM(balance),0) total FROM invoices WHERE balance>0");
  res.json({customers:c.rows[0].count,quotations:q.rows[0].count,invoices:i.rows[0].count,collected:p.rows[0].total,expenses:e.rows[0].total,outstanding:o.rows[0].total});
});

router.get("/customers", async (_,res) => res.json((await query("SELECT * FROM customers ORDER BY created_at DESC")).rows));

router.post("/customers", async (req,res) => {
  const {name,contact_person="",phone="",email="",address="",tax_number="",notes=""}=req.body;
  const result=await transaction(async client=>{
    const number=await nextNumber(client,"CUS");
    return client.query(`INSERT INTO customers(customer_code,name,contact_person,phone,email,address,tax_number,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[number,name,contact_person,phone,email,address,tax_number,notes]);
  });
  res.status(201).json(result.rows[0]);
});

router.get("/quotations", async (_,res)=>res.json((await query(`SELECT q.*,c.name customer_name FROM quotations q JOIN customers c ON c.id=q.customer_id ORDER BY q.created_at DESC`)).rows));

router.post("/quotations", async (req,res)=>{
  const {customer_id,quote_date,valid_until,discount=0,tax=0,notes="",items=[]}=req.body;
  const result=await transaction(async client=>{
    const number=await nextNumber(client,"QT");
    const subtotal=items.reduce((s,x)=>s+Number(x.quantity)*Number(x.unit_price),0);
    const total=subtotal-Number(discount)+Number(tax);
    const q=await client.query(`INSERT INTO quotations(number,customer_id,quote_date,valid_until,status,subtotal,discount,tax,total,notes)
      VALUES($1,$2,$3,$4,'SENT',$5,$6,$7,$8,$9) RETURNING *`,
      [number,customer_id,quote_date,valid_until||null,subtotal,discount,tax,total,notes]);
    for(const x of items) await client.query(`INSERT INTO quotation_items(quotation_id,description,quantity,unit_price,amount) VALUES($1,$2,$3,$4,$5)`,
      [q.rows[0].id,x.description,x.quantity,x.unit_price,Number(x.quantity)*Number(x.unit_price)]);
    return q.rows[0];
  });
  res.status(201).json(result);
});

router.post("/quotations/:id/convert", async (req,res)=>{
  const result=await transaction(async client=>{
    const q=(await client.query("SELECT * FROM quotations WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
    if(!q) throw new Error("Quotation not found");
    const existing=(await client.query("SELECT * FROM invoices WHERE quotation_id=$1",[q.id])).rows[0];
    if(existing) return existing;
    const number=await nextNumber(client,"INV");
    const inv=(await client.query(`INSERT INTO invoices(number,quotation_id,customer_id,invoice_date,due_date,status,subtotal,discount,tax,total,balance,notes)
      VALUES($1,$2,$3,CURRENT_DATE,$4,'ISSUED',$5,$6,$7,$8,$8,$9) RETURNING *`,
      [number,q.id,q.customer_id,q.valid_until,q.subtotal,q.discount,q.tax,q.total,q.notes])).rows[0];
    const items=(await client.query("SELECT * FROM quotation_items WHERE quotation_id=$1",[q.id])).rows;
    for(const x of items) await client.query(`INSERT INTO invoice_items(invoice_id,description,quantity,unit_price,amount) VALUES($1,$2,$3,$4,$5)`,
      [inv.id,x.description,x.quantity,x.unit_price,x.amount]);
    await client.query("UPDATE quotations SET status='CONVERTED' WHERE id=$1",[q.id]);
    return inv;
  });
  res.json(result);
});

router.get("/invoices", async (_,res)=>res.json((await query(`SELECT i.*,c.name customer_name FROM invoices i JOIN customers c ON c.id=i.customer_id ORDER BY i.created_at DESC`)).rows));

router.post("/invoices/:id/payments", async(req,res)=>{
  const {payment_date,amount,method,reference="",notes=""}=req.body;
  const result=await transaction(async client=>{
    const inv=(await client.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE",[req.params.id])).rows[0];
    if(!inv) throw new Error("Invoice not found");
    if(Number(amount)<=0 || Number(amount)>Number(inv.balance)) throw new Error("Payment exceeds outstanding balance");
    const receipt=await nextNumber(client,"RCT");
    const p=(await client.query(`INSERT INTO payments(invoice_id,receipt_number,payment_date,amount,method,reference,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[inv.id,receipt,payment_date,amount,method,reference,notes])).rows[0];
    const paid=Number(inv.paid)+Number(amount), balance=Number(inv.total)-paid;
    await client.query("UPDATE invoices SET paid=$1,balance=$2,status=$3 WHERE id=$4",[paid,balance,balance<=0.0001?"PAID":"PARTIAL",inv.id]);
    return p;
  });
  res.status(201).json(result);
});

router.get("/receipts", async (_,res)=>res.json((await query(`SELECT p.*,i.number invoice_number,c.name customer_name FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id ORDER BY p.created_at DESC`)).rows));

router.post("/expenses", async(req,res)=>{
  const {expense_date,category,description,supplier="",amount,payment_method="",paid_by="",reference="",notes=""}=req.body;
  const result=await transaction(async client=>{
    const number=await nextNumber(client,"EXP");
    return client.query(`INSERT INTO expenses(expense_number,expense_date,category,description,supplier,amount,payment_method,paid_by,reference,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [number,expense_date,category,description,supplier,amount,payment_method,paid_by,reference,notes]);
  });
  res.status(201).json(result.rows[0]);
});

router.get("/expenses", async(_,res)=>res.json((await query("SELECT * FROM expenses ORDER BY created_at DESC")).rows));

router.get("/documents/quotation/:id.pdf", async(req,res)=>{
  const q=(await query("SELECT q.*,c.name FROM quotations q JOIN customers c ON c.id=q.customer_id WHERE q.id=$1",[req.params.id])).rows[0];
  const items=(await query("SELECT * FROM quotation_items WHERE quotation_id=$1",[req.params.id])).rows;
  if(!q) return res.status(404).send("Not found");
  const pdf=await makePdf("QUOTATION",[`Quotation No: ${q.number}`,`Date: ${q.quote_date}`,`Customer: ${q.name}`],items,[["Subtotal",q.subtotal],["Discount",q.discount],["Tax",q.tax],["TOTAL",q.total]]);
  res.type("application/pdf").send(pdf);
});

router.get("/documents/invoice/:id.pdf", async(req,res)=>{
  const i=(await query("SELECT i.*,c.name FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=$1",[req.params.id])).rows[0];
  const items=(await query("SELECT * FROM invoice_items WHERE invoice_id=$1",[req.params.id])).rows;
  if(!i) return res.status(404).send("Not found");
  const pdf=await makePdf("INVOICE",[ `Invoice No: ${i.number}`,`Date: ${i.invoice_date}`,`Customer: ${i.name}` ],items,[["Subtotal",i.subtotal],["Discount",i.discount],["Tax",i.tax],["TOTAL",i.total],["PAID",i.paid],["BALANCE",i.balance]]);
  res.type("application/pdf").send(pdf);
});

router.get("/documents/receipt/:id.pdf", async(req,res)=>{
  const r=(await query(`SELECT p.*,i.number invoice_number,c.name FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id WHERE p.id=$1`,[req.params.id])).rows[0];
  if(!r) return res.status(404).send("Not found");
  const pdf=await makePdf("OFFICIAL RECEIPT",[ `Receipt No: ${r.receipt_number}`,`Date: ${r.payment_date}`,`Customer: ${r.name}`,`Invoice: ${r.invoice_number}`,`Payment Method: ${r.method}` ],[],[["AMOUNT RECEIVED",r.amount]]);
  res.type("application/pdf").send(pdf);
});

export default router;
