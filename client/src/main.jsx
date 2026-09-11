import React,{useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import "./style.css";
import logo from "./assets/micropay-logo.png";

const API=import.meta.env.VITE_API_URL||"http://localhost:4000/api";
async function openPdf(path){
  const token=localStorage.getItem("micropay_token");
  const r=await fetch(API+path,{headers: token ? {Authorization:`Bearer ${token}`} : {}});
  if(!r.ok){const text=await r.text(); let msg=text; try{msg=JSON.parse(text).error||text}catch{} throw new Error(msg)}
  const blob=await r.blob();
  const url=URL.createObjectURL(blob);
  window.open(url,"_blank","noopener,noreferrer");
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
async function api(path,options={}){const token=localStorage.getItem("micropay_token");const headers={"Content-Type":"application/json",...(options.headers||{})};if(token)headers.Authorization=`Bearer ${token}`;const r=await fetch(API+path,{...options,headers});if(!r.ok){const text=await r.text();try{const j=JSON.parse(text);throw new Error(j.error||text)}catch(e){if(e instanceof Error && e.message!==text)throw e;throw new Error(text)}}return r.headers.get("content-type")?.includes("application/json")?r.json():r.blob()}

const ROLE_LABELS={ADMIN:"Administrator",MANAGER:"Manager",FINANCE:"Finance",CLERK:"Clerk"};
function Login({onLogin}){const [setup,setSetup]=useState(false);const [f,setF]=useState({});const [error,setError]=useState("");const submit=async e=>{e.preventDefault();setError("");try{const data=await api(setup?"/auth/register":"/auth/login",{method:"POST",body:JSON.stringify(setup?{name:f.name,email:f.email,password:f.password,role:"ADMIN"}:{email:f.email,password:f.password})});localStorage.setItem("micropay_token",data.token);onLogin(data.user)}catch(err){setError(err.message)}};return <div className="panel login-panel" style={{maxWidth:480,margin:"80px auto"}}><div style={{textAlign:"center",marginBottom:24}}><img src={logo} alt="Micro Pay Company Limited" className="login-logo" style={{width:"180px",maxWidth:"80%",height:"auto",objectFit:"contain",display:"block",margin:"0 auto 14px"}}/><div style={{fontSize:13,color:"#666"}}>Business Management System</div></div><h2 style={{textAlign:"center"}}>{setup?"Initial Administrator Setup":"Sign In"}</h2>{error&&<p style={{color:"crimson"}}>{error}</p>}<form onSubmit={submit}>{setup&&<input placeholder="Full name" required value={f.name||""} onChange={e=>setF({...f,name:e.target.value})}/>}<input type="email" placeholder="Email" required value={f.email||""} onChange={e=>setF({...f,email:e.target.value})}/><input type="password" placeholder="Password" required minLength="8" value={f.password||""} onChange={e=>setF({...f,password:e.target.value})}/><button>{setup?"Create Administrator":"Sign In"}</button></form><p>{setup?"Already configured?":"First installation?"} <button onClick={()=>{setSetup(!setup);setError("")}}>{setup?"Sign in":"Initial setup"}</button></p></div>}


class PageErrorBoundary extends React.Component{constructor(props){super(props);this.state={error:null}}static getDerivedStateFromError(error){return {error}}componentDidCatch(error,info){console.error("Page render error",error,info)}render(){if(this.state.error)return <div className="panel"><h2>Unable to display this module</h2><p className="muted">The page encountered an application error. The error is shown below so it can be corrected without a blank screen.</p><pre style={{whiteSpace:"pre-wrap",color:"crimson"}}>{this.state.error?.message||String(this.state.error)}</pre></div>;return this.props.children}}

function Layout({page,setPage,user,onLogout}){
  const [profileOpen,setProfileOpen]=useState(false);
  const roleNav={
    ADMIN:["Dashboard","Customers","Quotations","Invoices","Receipts","Expenses","Payment Vouchers","Reports","Budget vs Actual","Cash & Bank","Reconciliation","Currencies & Rates","Suppliers","Bills","Customer Statements","Financial Periods","Profitability","Users"],
    MANAGER:["Dashboard","Customers","Quotations","Invoices","Receipts","Expenses","Payment Vouchers","Reports","Budget vs Actual","Cash & Bank","Reconciliation","Currencies & Rates","Suppliers","Bills","Customer Statements","Financial Periods","Profitability"],
    FINANCE:["Dashboard","Customers","Invoices","Receipts","Expenses","Payment Vouchers","Reports","Budget vs Actual","Cash & Bank","Reconciliation","Currencies & Rates","Suppliers","Bills","Customer Statements","Financial Periods","Profitability"],
    CLERK:["Customers","Quotations"]
  };
  const nav=roleNav[user.role]||["Dashboard"];
  useEffect(()=>{if(!nav.includes(page))setPage(nav[0])},[user.role,page]);
  const pageTitle=page;
  const go=n=>{setPage(n);setProfileOpen(false)};
  return <div className="app-shell">
    <header className="app-header">
      <div className="header-brand">
        <img src={logo} alt="Micro Pay" className="header-logo"/>
        <div className="brand-copy">
          <strong>Micro Pay</strong>
          <span>Business Management System</span>
        </div>
      </div>
      <div className="header-page-title">{pageTitle}</div>
      <div className="profile-area">
        <button className="profile-trigger" onClick={()=>setProfileOpen(v=>!v)} aria-expanded={profileOpen}>
          <span className="avatar">{(user.name||"U").trim().charAt(0).toUpperCase()}</span>
          <span className="profile-summary"><strong>{user.name}</strong><small>{ROLE_LABELS[user.role]}</small></span>
          <span className="profile-chevron">⌄</span>
        </button>
        {profileOpen&&<>
          <button className="profile-backdrop" aria-label="Close profile menu" onClick={()=>setProfileOpen(false)}></button>
          <div className="profile-menu">
            <div className="profile-menu-head"><strong>{user.name}</strong><span>{user.email}</span><small>{ROLE_LABELS[user.role]}</small></div>
            <div className="profile-divider"></div>
            <button className="profile-menu-item" onClick={()=>alert("Profile settings will be available in the next release.")}>My Profile</button>
            <button className="profile-menu-item" onClick={()=>alert("Password change will be available in the next release.")}>Change Password</button>
            <div className="profile-divider"></div>
            <button className="profile-menu-item logout-item" onClick={onLogout}>Logout</button>
          </div>
        </>}
      </div>
    </header>
    <div className="app-body">
      <aside className="sidebar">
        <div className="sidebar-label">MAIN MENU</div>
        {nav.map(n=><button key={n} className={`sidebar-link ${page===n?"active":""}`} onClick={()=>go(n)}><span>{n}</span></button>)}
        {user.role==="ADMIN"&&<div className="sidebar-label admin-label">ADMINISTRATION</div>}
        {user.role==="ADMIN"&&<button className={`sidebar-link ${page==="Users"?"active":""}`} onClick={()=>go("Users")}>Users & Roles</button>}
      </aside>
      <main className="content-area"><PageErrorBoundary>{page==="Dashboard"?<Dashboard/>:page==="Customers"?<Customers user={user}/>:page==="Quotations"?<Quotations user={user}/>:page==="Invoices"?<Invoices user={user}/>:page==="Receipts"?<Receipts user={user}/>:page==="Expenses"?<Expenses user={user}/>:page==="Payment Vouchers"?<PaymentVouchers user={user}/>:page==="Reports"?<Reports user={user}/>:page==="Budget vs Actual"?<BudgetVsActual user={user}/>:page==="Cash & Bank"?<CashBankAccounts user={user}/>:page==="Reconciliation"?<Reconciliation user={user}/>:page==="Currencies & Rates"?<CurrenciesRates user={user}/>:page==="Suppliers"?<Suppliers user={user}/>:page==="Bills"?<Bills user={user}/>:page==="Customer Statements"?<CustomerStatements user={user}/>:page==="Financial Periods"?<FinancialPeriods user={user}/>:page==="Profitability"?<Profitability user={user}/>:<Users/>}</PageErrorBoundary></main>
    </div>
  </div>
}
function Dashboard(){
  const [period,setPeriod]=useState('month');
  const [d,setD]=useState(null);
  const load=()=>api(`/dashboard/management?period=${period}`).then(setD).catch(e=>alert(e.message));
  useEffect(()=>{load()},[period]);
  if(!d)return <p>Loading dashboard...</p>;
  const money=v=>`$${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const maxTrend=Math.max(...d.trend.map(x=>Math.max(Number(x.invoiced),Number(x.collected))),1);
  const maxExp=Math.max(...d.expense_categories.map(x=>Number(x.amount)),1);
  return <>
    <div className="dashboard-heading"><div><h1>Management Dashboard</h1><p className="muted">Financial and operational overview</p></div><select value={period} onChange={e=>setPeriod(e.target.value)}><option value="today">Today</option><option value="week">This Week</option><option value="month">This Month</option><option value="quarter">This Quarter</option><option value="year">This Year</option></select></div>
    <div className="cards dashboard-kpis">
      <div className="card"><small>INVOICED</small><strong>{money(d.kpis.invoiced)}</strong><span>Non-cancelled invoices</span></div>
      <div className="card"><small>CASH COLLECTED</small><strong>{money(d.kpis.collected)}</strong><span>Issued receipts/payments</span></div>
      <div className="card"><small>RECEIVABLES</small><strong>{money(d.kpis.receivables)}</strong><span>Outstanding customer balances</span></div>
      <div className="card"><small>EXPENSES</small><strong>{money(d.kpis.expenses)}</strong><span>Non-cancelled expenses</span></div>
      <div className="card"><small>NET CASH MOVEMENT</small><strong>{money(d.kpis.net_cash)}</strong><span>Collections less expenses</span></div>
      <div className="card"><small>QUOTATION PIPELINE</small><strong>{money(d.kpis.quote_pipeline)}</strong><span>Open quotation value</span></div>
    </div>
    <div className="dashboard-grid">
      <section className="panel dashboard-wide"><div className="section-title"><h2>Revenue & Collection Trend</h2><span>{d.period_label}</span></div><div className="trend-chart">{d.trend.map(x=><div className="trend-col" key={x.label}><div className="trend-bars"><div className="trend-bar invoiced" style={{height:`${Math.max(4,Number(x.invoiced)/maxTrend*150)}px`}} title={`Invoiced ${money(x.invoiced)}`}></div><div className="trend-bar collected" style={{height:`${Math.max(4,Number(x.collected)/maxTrend*150)}px`}} title={`Collected ${money(x.collected)}`}></div></div><small>{x.label}</small></div>)}</div><div className="legend"><span><i className="legend-box invoiced"></i> Invoiced</span><span><i className="legend-box collected"></i> Collected</span></div></section>
      <section className="panel"><div className="section-title"><h2>Receivables Aging</h2></div><div className="aging-list">{d.aging.map(x=><div className="aging-row" key={x.bucket}><span>{x.bucket}</span><strong>{money(x.amount)}</strong></div>)}<div className="aging-total"><span>Total</span><strong>{money(d.kpis.receivables)}</strong></div></div></section>
      <section className="panel"><div className="section-title"><h2>Expenses by Category</h2></div><div className="expense-list">{d.expense_categories.length?d.expense_categories.map(x=><div className="expense-row" key={x.category}><div><span>{x.category}</span><div className="mini-bar"><i style={{width:`${Math.max(3,Number(x.amount)/maxExp*100)}%`}}></i></div></div><strong>{money(x.amount)}</strong></div>):<p className="muted">No expenses for this period.</p>}</div></section>
      <section className="panel"><div className="section-title"><h2>Top Outstanding Customers</h2></div>{d.top_receivables.length?<table className="compact-table"><thead><tr><th>Customer</th><th>Balance</th></tr></thead><tbody>{d.top_receivables.map(x=><tr key={x.customer_id}><td>{x.name}</td><td>{money(x.balance)}</td></tr>)}</tbody></table>:<p className="muted">No outstanding customer balances.</p>}</section>
      <section className="panel"><div className="section-title"><h2>Payment Vouchers</h2><span>Workflow</span></div><div className="workflow-kpis"><div><small>Pending Approval</small><strong>{d.vouchers.pending_count}</strong><span>{money(d.vouchers.pending_amount)}</span></div><div><small>Approved</small><strong>{d.vouchers.approved_count}</strong><span>{money(d.vouchers.approved_amount)}</span></div><div><small>Paid</small><strong>{d.vouchers.paid_count}</strong><span>{money(d.vouchers.paid_amount)}</span></div></div></section>
      <section className="panel"><div className="section-title"><h2>Quotation Pipeline</h2></div><div className="workflow-kpis"><div><small>Open</small><strong>{d.quotes.open_count}</strong><span>{money(d.quotes.open_amount)}</span></div><div><small>Accepted / Converted</small><strong>{d.quotes.converted_count}</strong><span>{money(d.quotes.converted_amount)}</span></div><div><small>Conversion Rate</small><strong>{d.quotes.conversion_rate}%</strong><span>By quotation count</span></div></div></section>
    </div>
    <section className="panel alerts-panel"><div className="section-title"><h2>Requires Attention</h2></div>{d.alerts.length?<div className="alerts-list">{d.alerts.map((a,i)=><div className={`alert-item alert-${a.level}`} key={i}><span>{a.level==='high'?'●':a.level==='medium'?'▲':'●'}</span><div><strong>{a.title}</strong><p>{a.message}</p></div></div>)}</div>:<p className="success-text">No urgent financial items for this period.</p>}</section>
  </>
}
function Customers({user}){const [rows,setRows]=useState([]);const [open,setOpen]=useState(false);const [editing,setEditing]=useState(null);const [f,setF]=useState({});const load=()=>api("/customers").then(setRows).catch(e=>alert(e.message));useEffect(()=>{load()},[]);const save=async e=>{e.preventDefault();try{await api(editing?`/customers/${editing.id}`:"/customers",{method:editing?"PATCH":"POST",body:JSON.stringify(f)});setOpen(false);setEditing(null);setF({});load()}catch(err){alert(err.message)}};const edit=r=>{setEditing(r);setF({name:r.name||"",contact_person:r.contact_person||"",phone:r.phone||"",email:r.email||"",address:r.address||"",tax_number:r.tax_number||"",notes:r.notes||""});setOpen(true)};const remove=async r=>{if(!window.confirm(`Delete customer ${r.name}? This can only be done if the customer has no quotations, invoices, or credit notes.`))return;try{await api(`/customers/${r.id}`,{method:"DELETE"});load()}catch(err){alert(err.message)}};return <><div className="toolbar"><h1>Customers</h1><button onClick={()=>{setEditing(null);setF({});setOpen(true)}}>+ New Customer</button></div>{open&&<div className="panel customer-form-panel"><h2>{editing?`Edit ${editing.customer_code}`:"New Customer"}</h2><form className="customer-form" onSubmit={save}><div className="form-grid">{["name","contact_person","phone","email","address","tax_number","notes"].map(k=><div className={`form-field ${k==="address"||k==="notes"?"form-field-full":""}`} key={k}><label>{k.replaceAll("_"," ")}{k==="name"?" *":""}</label>{k==="notes"||k==="address"?<textarea value={f[k]||""} onChange={e=>setF({...f,[k]:e.target.value})}/>:<input type={k==="email"?"email":"text"} required={k==="name"} value={f[k]||""} onChange={e=>setF({...f,[k]:e.target.value})}/>}</div>)}</div><div className="form-actions"><button>{editing?"Save Changes":"Save Customer"}</button><button type="button" onClick={()=>{setOpen(false);setEditing(null);setF({})}}>Cancel</button></div></form></div>}<Table cols={["customer_code","name","contact_person","phone","email"]} rows={rows} actions={r=><><button type="button" onClick={()=>edit(r)}>Edit</button>{user?.role==="ADMIN"&&<button type="button" onClick={()=>remove(r)}>Delete</button>}</>}/></>}
function Quotations({user}){
  const [rows,setRows]=useState([]),[customers,setCustomers]=useState([]),[open,setOpen]=useState(false),[editing,setEditing]=useState(null),[f,setF]=useState({currency_code:"USD",exchange_rate:"",items:[{description:"",quantity:1,unit_price:0}]});
  const load=()=>api("/quotations").then(setRows);
  useEffect(()=>{load();api("/customers").then(setCustomers)},[]);
  const reset=()=>{setOpen(false);setEditing(null);setF({currency_code:"USD",exchange_rate:"",items:[{description:"",quantity:1,unit_price:0}]})};
  const save=async e=>{e.preventDefault();try{await api(editing?`/quotations/${editing.id}`:"/quotations",{method:editing?"PATCH":"POST",body:JSON.stringify({...f,quote_date:f.quote_date||new Date().toISOString().slice(0,10)})});reset();load()}catch(err){alert(err.message)}};
  const edit=async r=>{try{const items=await api(`/quotations/${r.id}/items`);setEditing(r);setF({customer_id:r.customer_id,quote_date:r.quote_date?.slice(0,10)||"",valid_until:r.valid_until?.slice(0,10)||"",discount:r.discount||0,tax:r.tax||0,notes:r.notes||"",currency_code:r.currency_code||"USD",exchange_rate:r.exchange_rate||"",items:items.map(x=>({description:x.description,quantity:x.quantity,unit_price:x.unit_price}))});setOpen(true)}catch(err){alert(err.message)}};
  const action=async(path,body,msg)=>{if(!confirm(msg))return;try{await api(path,{method:"POST",body:JSON.stringify(body||{})});load()}catch(err){alert(err.message)}};
  const addItem=()=>setF({...f,items:[...f.items,{description:"",quantity:1,unit_price:0}]});
  const updateItem=(i,key,value)=>{const items=[...f.items];items[i]={...items[i],[key]:value};setF({...f,items})};
  const subtotal=f.items.reduce((sum,x)=>sum+(Number(x.quantity)||0)*(Number(x.unit_price)||0),0);
  const total=subtotal-(Number(f.discount)||0)+(Number(f.tax)||0);
  return <><div className="toolbar"><h1>Quotations</h1><button onClick={()=>{reset();setOpen(true)}}>+ New Quotation</button></div>
  {open&&<div className="panel quotation-panel"><h2>{editing?`Edit ${editing.number}`:"New Quotation"}</h2><form className="quotation-form" onSubmit={save}>
    <div className="quote-top-grid">
      <div className="quote-field"><label>Currency *</label><select required value={f.currency_code||"USD"} onChange={e=>setF({...f,currency_code:e.target.value})}><option>USD</option><option>SSP</option></select></div>
      <div className="quote-field"><label>Customer *</label><select required value={f.customer_id||""} onChange={e=>setF({...f,customer_id:e.target.value})}><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="quote-field"><label>Quote Date *</label><input type="date" required value={f.quote_date||new Date().toISOString().slice(0,10)} onChange={e=>setF({...f,quote_date:e.target.value})}/></div>
      <div className="quote-field"><label>Valid Until</label><input type="date" value={f.valid_until||""} onChange={e=>setF({...f,valid_until:e.target.value})}/></div>
    </div>
    <div className="quote-items"><div className="quote-item-head"><span>Description</span><span>Qty</span><span>Unit Price ({f.currency_code||"USD"})</span><span></span></div>{f.items.map((x,i)=><div className="quote-item-row" key={i}><input placeholder="Description" required value={x.description} onChange={e=>updateItem(i,"description",e.target.value)}/><input type="number" min="0.001" step="0.001" placeholder="Qty" required value={x.quantity} onChange={e=>updateItem(i,"quantity",e.target.value)}/><input type="number" min="0" step="0.01" placeholder="Unit price" required value={x.unit_price} onChange={e=>updateItem(i,"unit_price",e.target.value)}/><button type="button" className="danger-button" disabled={f.items.length===1} onClick={()=>setF({...f,items:f.items.filter((_,idx)=>idx!==i)})}>Remove</button></div>)}</div>
    <button type="button" onClick={addItem}>+ Add Item</button>
    <div className="quote-summary"><div className="quote-summary-grid"><div>Sub Total ({f.currency_code||"USD"})</div><div>{subtotal.toFixed(2)}</div><div>Discount ({f.currency_code||"USD"})</div><div><input type="number" min="0" step="0.01" value={f.discount||0} onChange={e=>setF({...f,discount:e.target.value})}/></div><div>Tax ({f.currency_code||"USD"})</div><div><input type="number" min="0" step="0.01" value={f.tax||0} onChange={e=>setF({...f,tax:e.target.value})}/></div><div className="total-label">Total ({f.currency_code||"USD"})</div><div className="total-value">{total.toFixed(2)}</div></div></div>
    <div className="quote-field"><label>Notes / Terms</label><textarea className="quote-notes" placeholder="Notes / Terms" value={f.notes||""} onChange={e=>setF({...f,notes:e.target.value})}></textarea></div>
    <div className="quote-actions"><button>{editing?"Save Changes":"Save Quotation"}</button><button type="button" onClick={reset}>Cancel</button></div>
  </form></div>}
  <Table cols={["number","customer_name","quote_date","total","status"]} rows={rows} actions={r=><><button type="button" onClick={()=>openPdf(`/documents/quotation/${r.id}.pdf`)}>PDF</button>{!['CONVERTED','CANCELLED'].includes(r.status)&&<>{<button onClick={()=>edit(r)}>Edit</button>}<button onClick={()=>action(`/quotations/${r.id}/convert`,{},`Convert ${r.number} to invoice?`)}>Convert</button>{user?.role!=="CLERK"&&<button onClick={()=>{const reason=prompt("Cancellation reason:");if(reason)action(`/quotations/${r.id}/cancel`,{reason},`Cancel ${r.number}?`)}}>Cancel</button>}</>}</>}/></>
}
function Invoices({user}){
 const [rows,setRows]=useState([]),[pay,setPay]=useState(null),[editing,setEditing]=useState(null),[customers,setCustomers]=useState([]),[accounts,setAccounts]=useState([]),[f,setF]=useState({items:[]}); const load=()=>api("/invoices").then(setRows); useEffect(()=>{load();api("/customers").then(setCustomers);api("/financial-accounts").then(setAccounts)},[]);
 const edit=async r=>{try{const items=await api(`/invoices/${r.id}/items`);setEditing(r);setF({customer_id:r.customer_id,due_date:r.due_date?.slice(0,10)||"",discount:r.discount,tax:r.tax,notes:r.notes||"",currency_code:r.currency_code||"USD",exchange_rate:r.exchange_rate||"",items:items.map(x=>({description:x.description,quantity:x.quantity,unit_price:x.unit_price}))})}catch(err){alert(err.message)}};
 const save=async e=>{e.preventDefault();try{await api(`/invoices/${editing.id}`,{method:"PATCH",body:JSON.stringify(f)});setEditing(null);load()}catch(err){alert(err.message)}};
 const payment=async e=>{e.preventDefault();const fd=new FormData(e.target);try{await api(`/invoices/${pay.id}/payments`,{method:"POST",body:JSON.stringify({payment_date:fd.get("date"),amount:fd.get("amount"),method:fd.get("method"),account_id:fd.get("account_id"),currency_code:pay.currency_code||"USD",reference:fd.get("reference"),notes:fd.get("notes")})});setPay(null);load()}catch(err){alert(err.message)}};
 const cancel=async r=>{const reason=prompt("Cancellation reason:");if(!reason)return;try{await api(`/invoices/${r.id}/cancel`,{method:"POST",body:JSON.stringify({reason})});load()}catch(err){alert(err.message)}};
 return <><div className="toolbar"><h1>Invoices</h1></div>{editing&&<div className="panel"><h2>Edit {editing.number}</h2><form onSubmit={save}><select value={f.currency_code||"USD"} onChange={e=>setF({...f,currency_code:e.target.value})}><option>USD</option><option>SSP</option></select><select value={f.customer_id||""} onChange={e=>setF({...f,customer_id:e.target.value})}>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><input type="date" value={f.due_date||""} onChange={e=>setF({...f,due_date:e.target.value})}/>{f.items.map((x,i)=><div className="item" key={i}><input required value={x.description} onChange={e=>{const a=[...f.items];a[i]={...a[i],description:e.target.value};setF({...f,items:a})}}/><input type="number" min="0.001" step="0.001" required value={x.quantity} onChange={e=>{const a=[...f.items];a[i]={...a[i],quantity:e.target.value};setF({...f,items:a})}}/><input type="number" min="0" step="0.01" required value={x.unit_price} onChange={e=>{const a=[...f.items];a[i]={...a[i],unit_price:e.target.value};setF({...f,items:a})}}/></div>)}<input type="number" step="0.01" placeholder="Discount" value={f.discount||0} onChange={e=>setF({...f,discount:e.target.value})}/><input type="number" step="0.01" placeholder="Tax" value={f.tax||0} onChange={e=>setF({...f,tax:e.target.value})}/><textarea value={f.notes||""} onChange={e=>setF({...f,notes:e.target.value})}/><button>Save Changes</button><button type="button" onClick={()=>setEditing(null)}>Cancel</button></form></div>}{pay&&<div className="panel"><h2>Payment — {pay.number}</h2><p>Balance: {pay.currency_code||"USD"} {Number(pay.balance).toFixed(2)}</p><form onSubmit={payment}><input name="date" type="date" defaultValue={new Date().toISOString().slice(0,10)}/><input name="amount" type="number" step="0.01" max={pay.balance} required/><select name="method"><option>Cash</option><option>Bank Transfer</option><option>Mobile Money</option><option>Cheque</option></select><select name="account_id" required><option value="">Select receiving account</option>{accounts.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.account_name} — ${Number(a.current_balance||0).toFixed(2)}</option>)}</select><input name="reference" placeholder="Reference"/><textarea name="notes" placeholder="Notes"></textarea><button>Record Payment</button><button type="button" onClick={()=>setPay(null)}>Cancel</button></form></div>}<Table cols={["number","customer_name","invoice_date","total","paid","balance","status"]} rows={rows} actions={r=><><button type="button" onClick={()=>openPdf(`/documents/invoice/${r.id}.pdf`)}>PDF</button>{r.status!=="CANCELLED"&&Number(r.paid)===0&&<button onClick={()=>edit(r)}>Edit</button>}{r.status!=="CANCELLED"&&Number(r.balance)>0&&<button onClick={()=>setPay(r)}>Payment</button>}{!['CANCELLED','PAID'].includes(r.status)&&user?.role!=="CLERK"&&<button onClick={()=>cancel(r)}>Cancel</button>}</>}/></>
}
function Receipts({user}){const [rows,setRows]=useState([]);const load=()=>api("/receipts").then(setRows);useEffect(()=>{load()},[]);const voidReceipt=async r=>{const reason=prompt("Void reason:");if(!reason)return;try{await api(`/receipts/${r.id}/void`,{method:"POST",body:JSON.stringify({reason})});load()}catch(err){alert(err.message)}};return <><h1>Receipts</h1><Table cols={["receipt_number","customer_name","invoice_number","payment_date","amount","method","status"]} rows={rows} actions={r=><><button type="button" onClick={()=>openPdf(`/documents/receipt/${r.id}.pdf`)}>PDF</button>{r.status!=="VOID"&&user?.role!=="MANAGER"&&user?.role!=="CLERK"&&<button onClick={()=>voidReceipt(r)}>Void</button>}</>}/></>}
function PaymentVouchers({user}){
 const [rows,setRows]=useState([]),[accounts,setAccounts]=useState([]),[open,setOpen]=useState(false),[payOpen,setPayOpen]=useState(false),[payVoucher,setPayVoucher]=useState(null),[editing,setEditing]=useState(null),[f,setF]=useState({});
 const load=()=>api("/payment-vouchers").then(setRows);
 useEffect(()=>{load();api("/financial-accounts").then(setAccounts)},[]);
 const save=async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e.target));try{await api(editing?`/payment-vouchers/${editing.id}`:"/payment-vouchers",{method:editing?"PATCH":"POST",body:JSON.stringify(o)});setOpen(false);setEditing(null);load()}catch(err){alert(err.message)}};
 const act=async(r,path,body,msg)=>{if(!confirm(msg))return;try{await api(path,{method:"POST",body:JSON.stringify(body||{})});load()}catch(err){alert(err.message)}};
 const edit=r=>{setEditing(r);setF(r);setOpen(true)};
 const cancel=async r=>{const reason=prompt("Cancellation reason:");if(reason)act(r,`/payment-vouchers/${r.id}/cancel`,{reason},`Cancel ${r.voucher_number}?`)};
 const markPaid=async e=>{e.preventDefault();const fd=new FormData(e.target);try{await api(`/payment-vouchers/${payVoucher.id}/pay`,{method:"POST",body:JSON.stringify({account_id:fd.get("account_id")})});setPayOpen(false);setPayVoucher(null);load()}catch(err){alert(err.message)}};
 return <><div className="toolbar"><h1>Payment Vouchers</h1><button onClick={()=>{setEditing(null);setF({});setOpen(true)}}>+ New Payment Voucher</button></div>
 {open&&<div className="panel"><h2>{editing?`Edit ${editing.voucher_number}`:"New Payment Voucher"}</h2><form onSubmit={save}>
 <input name="voucher_date" type="date" defaultValue={f.voucher_date?.slice(0,10)||new Date().toISOString().slice(0,10)} required/><input name="payee" placeholder="Payee" defaultValue={f.payee||""} required/><textarea name="purpose" placeholder="Purpose / Description" defaultValue={f.purpose||""} required/><select name="currency_code" defaultValue={f.currency_code||"USD"}><option>USD</option><option>SSP</option></select><input name="exchange_rate" type="number" step="0.00000001" min="0.00000001" placeholder="Exchange rate (optional)" defaultValue={f.exchange_rate||""}/><input name="amount" type="number" step="0.01" placeholder="Amount" defaultValue={f.amount||""} required/><select name="payment_method" defaultValue={f.payment_method||"Cash"}><option>Cash</option><option>Bank Transfer</option><option>Mobile Money</option><option>Cheque</option></select><input name="reference" placeholder="Reference" defaultValue={f.reference||""}/><input name="prepared_by" placeholder="Prepared by" defaultValue={f.prepared_by||""}/><input name="checked_by" placeholder="Checked by" defaultValue={f.checked_by||""}/><input name="approved_by" placeholder="Approved by" defaultValue={f.approved_by||""}/><input name="received_by" placeholder="Received by" defaultValue={f.received_by||""}/><select name="account_id" defaultValue={f.account_id||""}><option value="">Account selected at payment</option>{accounts.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.account_name}</option>)}</select><textarea name="notes" placeholder="Notes" defaultValue={f.notes||""}></textarea><button>{editing?"Save Changes":"Save Payment Voucher"}</button><button type="button" onClick={()=>setOpen(false)}>Cancel</button></form></div>}
 {payOpen&&<div className="panel"><h2>Mark Paid — {payVoucher?.voucher_number}</h2><p className="muted">Amount: ${Number(payVoucher?.amount||0).toFixed(2)}</p><form onSubmit={markPaid}><label>Pay From<select name="account_id" required><option value="">Select financial account</option>{accounts.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.account_name} — ${Number(a.current_balance||0).toFixed(2)}</option>)}</select></label><button>Confirm Payment</button><button type="button" onClick={()=>{setPayOpen(false);setPayVoucher(null)}}>Cancel</button></form></div>}
 <Table cols={["voucher_number","voucher_date","payee","purpose","amount","payment_method","status"]} rows={rows} actions={r=><><button type="button" onClick={()=>openPdf(`/documents/payment-voucher/${r.id}.pdf`)}>PDF</button>{r.status==="DRAFT"&&<button onClick={()=>edit(r)}>Edit</button>}{r.status==="DRAFT"&&user?.role!=="CLERK"&&<button onClick={()=>act(r,`/payment-vouchers/${r.id}/approve`,{},`Approve ${r.voucher_number}?`)}>Approve</button>}{r.status==="APPROVED"&&user?.role!=="CLERK"&&<button onClick={()=>{setPayVoucher(r);setPayOpen(true)}}>Mark Paid</button>}{!['CANCELLED','PAID'].includes(r.status)&&user?.role!=="CLERK"&&<button onClick={()=>cancel(r)}>Cancel</button>}</>}/></>}

function Expenses({user}){const [rows,setRows]=useState([]),[accounts,setAccounts]=useState([]),[open,setOpen]=useState(false),[editing,setEditing]=useState(null),[f,setF]=useState({});const load=()=>api("/expenses").then(setRows);useEffect(()=>{load();api("/financial-accounts").then(setAccounts)},[]);const save=async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e.target));try{await api(editing?`/expenses/${editing.id}`:"/expenses",{method:editing?"PATCH":"POST",body:JSON.stringify(o)});setOpen(false);setEditing(null);load()}catch(err){alert(err.message)}};const cancel=async r=>{const reason=prompt("Cancellation reason:");if(!reason)return;try{await api(`/expenses/${r.id}/cancel`,{method:"POST",body:JSON.stringify({reason})});load()}catch(err){alert(err.message)}};const edit=r=>{setEditing(r);setF(r);setOpen(true)};return <><div className="toolbar"><h1>Operational Expenses</h1><button onClick={()=>{setEditing(null);setF({});setOpen(true)}}>+ Record Expense</button></div>{open&&<div className="panel"><h2>{editing?`Edit ${editing.expense_number}`:"Record Expense"}</h2><form onSubmit={save}><input name="expense_date" type="date" defaultValue={f.expense_date?.slice(0,10)||new Date().toISOString().slice(0,10)}/><select name="category" defaultValue={f.category||"Fuel"}><option>Fuel</option><option>Water</option><option>Transport</option><option>Office Supplies</option><option>Repairs & Maintenance</option><option>Casual Labour</option><option>Communication</option><option>Other</option></select><input name="description" placeholder="Description" defaultValue={f.description||""} required/><input name="supplier" placeholder="Supplier" defaultValue={f.supplier||""}/><select name="currency_code" defaultValue={f.currency_code||"USD"}><option>USD</option><option>SSP</option></select><input name="exchange_rate" type="number" step="0.00000001" min="0.00000001" placeholder="Exchange rate (optional)" defaultValue={f.exchange_rate||""}/><input name="amount" type="number" step="0.01" placeholder="Amount" defaultValue={f.amount||""} required/><input name="payment_method" placeholder="Payment method" defaultValue={f.payment_method||""}/><select name="account_id" defaultValue={f.account_id||""} required><option value="">Paid From — select account</option>{accounts.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.account_name} — ${Number(a.current_balance||0).toFixed(2)}</option>)}</select><input name="paid_by" placeholder="Paid by" defaultValue={f.paid_by||""}/><input name="reference" placeholder="Reference" defaultValue={f.reference||""}/><textarea name="notes" placeholder="Notes" defaultValue={f.notes||""}/><button>{editing?"Save Changes":"Record Expense"}</button><button type="button" onClick={()=>setOpen(false)}>Cancel</button></form></div>}<Table cols={["expense_number","expense_date","category","description","amount","status"]} rows={rows} actions={r=><><button type="button" onClick={()=>openPdf(`/documents/expense/${r.id}.pdf`)}>PDF</button>{r.status!=="CANCELLED"&&user?.role!=="CLERK"&&<><button onClick={()=>edit(r)}>Edit</button><button onClick={()=>cancel(r)}>Cancel</button></>}</>}/></>}

function Reports({user}){
  const REPORTS={
    sales:{label:"Sales & Invoice Report",endpoint:"sales",columns:["invoice_number","invoice_date","customer_name","total","paid","balance","status"]},
    aging:{label:"Receivables Aging",endpoint:"aging",columns:["customer_name","invoice_number","invoice_date","due_date","balance","age_days","aging_bucket"]},
    expenses:{label:"Expense Report",endpoint:"expenses",columns:["expense_number","expense_date","category","description","supplier","amount","payment_method","status"]},
    payments:{label:"Collections / Payment Report",endpoint:"payments",columns:["receipt_number","payment_date","invoice_number","customer_name","amount","method","reference","status"]},
    vouchers:{label:"Payment Voucher Report",endpoint:"vouchers",columns:["voucher_number","voucher_date","payee","purpose","amount","payment_method","status"]},
    quotes:{label:"Quotation & Sales Pipeline",endpoint:"quotes",columns:["number","quote_date","customer_name","total","status"]},
    summary:{label:"Management Financial Summary",endpoint:"summary",columns:["metric","amount"]}
  };
  const [type,setType]=useState("summary"),[from,setFrom]=useState(""),[to,setTo]=useState(""),[status,setStatus]=useState("ALL"),[customer,setCustomer]=useState(""),[rows,setRows]=useState([]),[summary,setSummary]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const r=REPORTS[type];
  const load=async()=>{setLoading(true);setError("");try{const qs=new URLSearchParams();if(from)qs.set("from",from);if(to)qs.set("to",to);if(status!=="ALL")qs.set("status",status);if(customer)qs.set("customer",customer);const d=await api(`/reports/${r.endpoint}?${qs}`);setRows(d.rows||[]);setSummary(d.summary||null)}catch(e){setError(e.message)}finally{setLoading(false)}};
  useEffect(()=>{load()},[type]);
  const exportCsv=()=>{if(!rows.length)return;const cols=r.columns;const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;const csv=[cols.join(","),...rows.map(x=>cols.map(c=>esc(x[c])).join(","))].join("\n");const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`micropay-${type}-report.csv`;a.click();URL.revokeObjectURL(url)};
  const printReport=()=>window.print();
  const money=v=>`$${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  return <div className="reports-page"><div className="toolbar reports-toolbar"><div><h1>Reports</h1><p className="muted">Financial and management reporting</p></div><div className="report-actions"><button onClick={exportCsv} disabled={!rows.length}>Export CSV</button><button onClick={printReport}>Print / PDF</button></div></div>
    <div className="panel report-controls"><select value={type} onChange={e=>setType(e.target.value)}>{Object.entries(REPORTS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select><label>From <input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To <input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>{type!=="summary"&&type!=="aging"&&<label>Status <select value={status} onChange={e=>setStatus(e.target.value)}><option>ALL</option><option>ISSUED</option><option>PARTIAL</option><option>PAID</option><option>CANCELLED</option><option>VOID</option><option>DRAFT</option><option>APPROVED</option></select></label>}<button onClick={load}>Generate Report</button></div>
    {error&&<div className="panel error-panel">{error}</div>}
    {summary&&<div className="cards report-summary">{summary.map(x=><div className="card" key={x.metric}><small>{x.metric}</small><strong>{money(x.amount)}</strong></div>)}</div>}
    <section className="panel report-panel"><div className="section-title"><h2>{r.label}</h2><span>{from||"All dates"} {to?`to ${to}`:""}</span></div>{loading?<p>Generating report...</p>:rows.length?<div className="tablewrap"><table><thead><tr>{r.columns.map(c=><th key={c}>{c.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.map((x,i)=><tr key={x.id||i}>{r.columns.map(c=><td key={c}>{c.includes("amount")||["total","paid","balance"].includes(c)?money(x[c]):c==="status"?<span className={`status status-${String(x[c]||"").toLowerCase()}`}>{x[c]}</span>:x[c]}</td>)}</tr>)}</tbody></table></div>:<p className="muted">No records found for the selected criteria.</p>}</section>
  </div>
}


function BudgetVsActual({user}){
  const now=new Date();
  const [year,setYear]=useState(now.getFullYear());
  const [month,setMonth]=useState("");
  const [rows,setRows]=useState([]);
  const [summary,setSummary]=useState([]);
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState(null);
  const [f,setF]=useState({budget_year:now.getFullYear(),budget_month:now.getMonth()+1,category:"Fuel",amount:"",notes:"",currency_code:"USD"});
  const [loading,setLoading]=useState(false);

  const categories=["Fuel","Water","Transport","Office Supplies","Repairs & Maintenance","Casual Labour","Communication","Other"];

  const load=async()=>{
    setLoading(true);
    try{
      const qs=new URLSearchParams({year:String(year)});
      if(month) qs.set("month",month);
      const d=await api(`/reports/budget-vs-actual?${qs}`);
      setRows(d.rows||[]);
      setSummary(d.summary||[]);
    }catch(e){alert(e.message)}
    finally{setLoading(false)}
  };
  useEffect(()=>{load()},[year,month]);

  const save=async e=>{
    e.preventDefault();
    try{
      await api(editing?`/budgets/${editing.id}`:"/budgets",{
        method:editing?"PATCH":"POST",
        body:JSON.stringify(f)
      });
      setOpen(false); setEditing(null); setF({budget_year:year,budget_month:month||now.getMonth()+1,category:"Fuel",amount:"",notes:""});
      load();
    }catch(e){alert(e.message)}
  };
  const edit=r=>{
    setEditing(r);
    setF({budget_year:r.budget_year,budget_month:r.budget_month,category:r.category,amount:r.amount,notes:r.notes||""});
    setOpen(true);
  };
  const remove=async r=>{
    if(!confirm(`Delete budget for ${r.category}?`)) return;
    try{await api(`/budgets/${r.id}`,{method:"DELETE"});load()}catch(e){alert(e.message)}
  };
  const money=v=>`$${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  return <div>
    <div className="toolbar">
      <div><h1>Budget vs Actual</h1><p className="muted">Compare approved budgets with actual non-cancelled expenses.</p></div>
      {user?.role!=="MANAGER"&&<button onClick={()=>{setEditing(null);setF({budget_year:year,budget_month:month||now.getMonth()+1,category:"Fuel",amount:"",notes:""});setOpen(true)}}>+ Add Budget</button>}
    </div>

    <div className="panel report-controls">
      <label>Year <input type="number" min="2000" max="2100" value={year} onChange={e=>setYear(e.target.value)}/></label>
      <label>Month <select value={month} onChange={e=>setMonth(e.target.value)}>
        <option value="">All Months</option>
        {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m,i)=><option key={i} value={i+1}>{m}</option>)}
      </select></label>
      <button onClick={load}>Generate Report</button>
    </div>

    {open&&<div className="panel">
      <h2>{editing?"Edit Budget":"Add Budget"}</h2>
      <form onSubmit={save}>
        <input name="budget_year" type="number" min="2000" max="2100" value={f.budget_year} onChange={e=>setF({...f,budget_year:e.target.value})} required/>
        <select name="budget_month" value={f.budget_month} onChange={e=>setF({...f,budget_month:e.target.value})} required>
          {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m,i)=><option key={i} value={i+1}>{m}</option>)}
        </select>
        <select name="category" value={f.category} onChange={e=>setF({...f,category:e.target.value})}>{categories.map(c=><option key={c}>{c}</option>)}</select>
        <input name="amount" type="number" min="0" step="0.01" placeholder="Budget amount" value={f.amount} onChange={e=>setF({...f,amount:e.target.value})} required/>
        <textarea name="notes" placeholder="Notes" value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/>
        <button>{editing?"Save Changes":"Save Budget"}</button>
        <button type="button" onClick={()=>setOpen(false)}>Cancel</button>
      </form>
    </div>}

    <div className="cards report-summary">
      {summary.map(x=><div className="card" key={x.metric}><small>{x.metric}</small><strong>{x.metric.includes("%")?`${Number(x.amount||0).toFixed(1)}%`:money(x.amount)}</strong></div>)}
    </div>

    <section className="panel report-panel">
      <div className="section-title"><h2>Budget vs Actual</h2><span>{year}{month?` — Month ${month}`:" — Full Year"}</span></div>
      {loading?<p>Generating report...</p>:rows.length?<div className="tablewrap"><table>
        <thead><tr><th>Month</th><th>Category</th><th>Budget</th><th>Actual</th><th>Variance</th><th>Variance %</th><th>Status</th>{user?.role!=="MANAGER"&&<th>Actions</th>}</tr></thead>
        <tbody>{rows.map((r,i)=><tr key={`${r.budget_month}-${r.category}-${i}`}>
          <td>{r.budget_month}</td><td>{r.category}</td><td>{money(r.budget_amount)}</td><td>{money(r.actual_amount)}</td>
          <td>{money(r.variance)}</td><td>{Number(r.variance_pct||0).toFixed(1)}%</td>
          <td><span className={`status status-${String(r.status).toLowerCase()}`}>{r.status}</span></td>
          {user?.role!=="MANAGER"&&<td className="actions"><button onClick={()=>edit(r)}>Edit</button><button onClick={()=>remove(r)}>Delete</button></td>}
        </tr>)}</tbody>
      </table></div>:<p className="muted">No budget or expense records found for the selected period.</p>}
    </section>
  </div>
}


function CashBankAccounts({user}){
  const [accounts,setAccounts]=useState([]),[selected,setSelected]=useState(null),[statement,setStatement]=useState(null);
  const [open,setOpen]=useState(false),[transferOpen,setTransferOpen]=useState(false),[adjustOpen,setAdjustOpen]=useState(false);
  const [editing,setEditing]=useState(null),[loading,setLoading]=useState(false);
  const [f,setF]=useState({account_name:"",account_type:"CASH",institution_name:"",account_reference:"",opening_balance:"",opening_balance_date:"",active:true,notes:"",currency_code:"USD"});
  const [tf,setTf]=useState({from_account_id:"",to_account_id:"",amount:"",transaction_date:new Date().toISOString().slice(0,10),reference:"",description:""});
  const [af,setAf]=useState({amount:"",direction:"DEBIT",transaction_date:new Date().toISOString().slice(0,10),reference:"",description:""});

  const load=async()=>{
    setLoading(true);try{setAccounts(await api("/financial-accounts"))}catch(e){alert(e.message)}finally{setLoading(false)}
  };
  useEffect(()=>{load()},[]);
  const loadStatement=async id=>{try{setSelected(id);setStatement(await api(`/financial-accounts/${id}/statement`))}catch(e){alert(e.message)}};
  const reset=()=>setF({account_name:"",account_type:"CASH",institution_name:"",account_reference:"",opening_balance:"",opening_balance_date:"",active:true,notes:""});
  const save=async e=>{e.preventDefault();try{await api(editing?`/financial-accounts/${editing.id}`:"/financial-accounts",{method:editing?"PATCH":"POST",body:JSON.stringify({...f,opening_balance:Number(f.opening_balance||0)})});setOpen(false);setEditing(null);reset();load()}catch(e){alert(e.message)}};
  const edit=a=>{setEditing(a);setF({account_name:a.account_name||"",account_type:a.account_type||"CASH",institution_name:a.institution_name||"",account_reference:a.account_reference||"",opening_balance:a.opening_balance||0,opening_balance_date:a.opening_balance_date||"",active:a.active!==false,notes:a.notes||"",currency_code:a.currency_code||"USD"});setOpen(true)};
  const transfer=async e=>{e.preventDefault();try{await api("/financial-transfers",{method:"POST",body:JSON.stringify({...tf,amount:Number(tf.amount)})});setTransferOpen(false);setTf({...tf,amount:"",reference:"",description:""});load();if(selected)loadStatement(selected)}catch(e){alert(e.message)}};
  const adjustment=async e=>{e.preventDefault();try{await api(`/financial-accounts/${selected}/adjustment`,{method:"POST",body:JSON.stringify({...af,amount:Number(af.amount)})});setAdjustOpen(false);setAf({...af,amount:"",reference:"",description:""});load();loadStatement(selected)}catch(e){alert(e.message)}};
  const money=v=>`$${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  return <div>
    <div className="toolbar"><div><h1>Cash & Bank</h1><p className="muted">Manage accounts, transfers and financial transaction balances.</p></div>
      {user?.role!=="MANAGER"&&<><button onClick={()=>{setEditing(null);reset();setOpen(true)}}>+ Add Account</button><button onClick={()=>setTransferOpen(true)}>+ Transfer</button></>}
    </div>
    <div className="cards report-summary">
      {["CASH","BANK","MOBILE_MONEY"].map(type=><div className="card" key={type}><small>{type==="MOBILE_MONEY"?"Mobile Money":type}</small><strong>{money(accounts.filter(a=>a.active&&a.account_type===type).reduce((s,a)=>s+Number(a.current_balance||0),0))}</strong><span className="muted">Current balance</span></div>)}
      <div className="card"><small>Total Active Balance</small><strong>{money(accounts.filter(a=>a.active).reduce((s,a)=>s+Number(a.current_balance||0),0))}</strong></div>
    </div>

    {open&&<div className="panel"><h2>{editing?"Edit Account":"Add Financial Account"}</h2><form onSubmit={save}>
      <label>Account Name<input value={f.account_name} onChange={e=>setF({...f,account_name:e.target.value})} required/></label>
      <label>Currency<select value={f.currency_code} onChange={e=>setF({...f,currency_code:e.target.value})}><option>USD</option><option>SSP</option></select></label><label>Account Type<select value={f.account_type} onChange={e=>setF({...f,account_type:e.target.value})}><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="MOBILE_MONEY">Mobile Money</option></select></label>
      <label>Institution / Provider<input value={f.institution_name} onChange={e=>setF({...f,institution_name:e.target.value})}/></label>
      <label>Account / Reference<input value={f.account_reference} onChange={e=>setF({...f,account_reference:e.target.value})}/></label>
      <label>Opening Balance<input type="number" min="0" step="0.01" value={f.opening_balance} onChange={e=>setF({...f,opening_balance:e.target.value})} required/></label>
      <label>Opening Balance Date<input type="date" value={f.opening_balance_date||""} onChange={e=>setF({...f,opening_balance_date:e.target.value})}/></label>
      <label>Notes<textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></label>
      {editing&&<label><input type="checkbox" checked={f.active} onChange={e=>setF({...f,active:e.target.checked})}/> Active</label>}
      <button>{editing?"Save Changes":"Create Account"}</button><button type="button" onClick={()=>setOpen(false)}>Cancel</button>
    </form></div>}

    {transferOpen&&<div className="panel"><h2>Transfer Between Accounts</h2><form className="account-transaction-form" onSubmit={transfer}>
      <label>From<select value={tf.from_account_id} onChange={e=>setTf({...tf,from_account_id:e.target.value})} required><option value="">Select account</option>{accounts.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.account_name} — {money(a.current_balance)}</option>)}</select></label>
      <label>To<select value={tf.to_account_id} onChange={e=>setTf({...tf,to_account_id:e.target.value})} required><option value="">Select account</option>{accounts.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.account_name}</option>)}</select></label>
      <label>Amount<input type="number" min="0.01" step="0.01" value={tf.amount} onChange={e=>setTf({...tf,amount:e.target.value})} required/></label>
      <label>Date<input type="date" value={tf.transaction_date} onChange={e=>setTf({...tf,transaction_date:e.target.value})}/></label>
      <label>Reference<input value={tf.reference} onChange={e=>setTf({...tf,reference:e.target.value})}/></label>
      <label>Description<textarea value={tf.description} onChange={e=>setTf({...tf,description:e.target.value})}/></label>
      <button>Post Transfer</button><button type="button" onClick={()=>setTransferOpen(false)}>Cancel</button>
    </form></div>}

    {adjustOpen&&<div className="panel"><h2>Account Adjustment</h2><form className="account-transaction-form" onSubmit={adjustment}>
      <label>Direction<select value={af.direction} onChange={e=>setAf({...af,direction:e.target.value})}><option value="DEBIT">Debit / Reduce Balance</option><option value="CREDIT">Credit / Increase Balance</option></select></label>
      <label>Amount<input type="number" min="0.01" step="0.01" value={af.amount} onChange={e=>setAf({...af,amount:e.target.value})} required/></label>
      <label>Date<input type="date" value={af.transaction_date} onChange={e=>setAf({...af,transaction_date:e.target.value})}/></label>
      <label>Reference<input value={af.reference} onChange={e=>setAf({...af,reference:e.target.value})}/></label>
      <label>Description<textarea value={af.description} onChange={e=>setAf({...af,description:e.target.value})} required/></label>
      <button>Post Adjustment</button><button type="button" onClick={()=>setAdjustOpen(false)}>Cancel</button>
    </form></div>}

    <section className="panel report-panel"><div className="section-title"><h2>Financial Accounts</h2><span>{accounts.length} account(s)</span></div>
      {loading?<p>Loading accounts...</p>:accounts.length?<div className="tablewrap"><table><thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Institution</th><th>Currency</th><th>Current Balance</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{accounts.map(a=><tr key={a.id}><td>{a.account_code}</td><td>{a.account_name}</td><td>{a.account_type==="MOBILE_MONEY"?"Mobile Money":a.account_type}</td><td>{a.institution_name||"—"}</td><td>{a.currency_code||"USD"}</td><td>{money(a.current_balance)}</td><td>{a.active?"ACTIVE":"INACTIVE"}</td>
        <td className="actions"><button onClick={()=>loadStatement(a.id)}>Statement</button>{user?.role!=="MANAGER"&&<button onClick={()=>edit(a)}>Edit</button>}</td></tr>)}</tbody></table></div>:<p className="muted">No financial accounts have been created yet.</p>}
    </section>

    {statement&&<section className="panel report-panel"><div className="section-title"><h2>{statement.account.account_name} — Statement</h2><strong>Balance: {money(statement.balance)}</strong></div>
      {user?.role!=="MANAGER"&&<button onClick={()=>setAdjustOpen(true)}>+ Adjustment</button>}
      {statement.transactions.length?<div className="tablewrap"><table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th>Debit</th><th>Credit</th><th>Running Balance</th></tr></thead>
      <tbody>{statement.transactions.map(t=><tr key={t.id}><td>{t.transaction_date}</td><td>{t.transaction_type}</td><td>{t.reference||"—"}</td><td>{t.description||"—"}</td><td>{t.direction==="DEBIT"?money(t.amount):"—"}</td><td>{t.direction==="CREDIT"?money(t.amount):"—"}</td><td>{money(t.running_balance)}</td></tr>)}</tbody></table></div>:<p className="muted">No transactions posted yet.</p>}
    </section>}
  </div>
}


function Reconciliation({user}){
 const [accounts,setAccounts]=useState([]),[recs,setRecs]=useState([]),[selected,setSelected]=useState(null),[detail,setDetail]=useState(null),[open,setOpen]=useState(false),[preview,setPreview]=useState(null);
 const today=new Date().toISOString().slice(0,10);
 const [f,setF]=useState({account_id:"",period_start:today.slice(0,8)+"01",period_end:today,statement_closing_balance:"",notes:""});
 const money=v=>`$${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
 const load=async()=>{try{setAccounts(await api("/financial-accounts"));setRecs(await api("/reconciliations"))}catch(e){alert(e.message)}};
 useEffect(()=>{load()},[]);
 useEffect(()=>{ if(!open||!f.account_id||!f.period_start){setPreview(null);return;} let alive=true; api(`/reconciliations/preview?account_id=${encodeURIComponent(f.account_id)}&period_start=${encodeURIComponent(f.period_start)}`).then(x=>{if(alive)setPreview(x)}).catch(e=>{if(alive){setPreview(null);alert(e.message)}}); return()=>{alive=false}},[open,f.account_id,f.period_start]);
 const create=async e=>{e.preventDefault();try{const r=await api("/reconciliations",{method:"POST",body:JSON.stringify(f)});setOpen(false);await load();openDetail(r.id)}catch(e){alert(e.message)}};
 const openDetail=async id=>{try{setSelected(id);setDetail(await api(`/reconciliations/${id}`))}catch(e){alert(e.message)}};
 const toggle=async item=>{try{await api(`/reconciliations/${selected}/items/${item.id}`,{method:"PATCH",body:JSON.stringify({cleared:!item.cleared})});openDetail(selected)}catch(e){alert(e.message)}};
 const cancelReconciliation=async()=>{const reason=prompt("Enter the reason for cancelling this reconciliation:");if(!reason?.trim())return;try{await api(`/reconciliations/${selected}/cancel`,{method:"POST",body:JSON.stringify({reason:reason.trim()})});openDetail(selected);load()}catch(e){alert(e.message)}};
 const complete=async()=>{if(!confirm("Complete this reconciliation?"))return;try{await api(`/reconciliations/${selected}/complete`,{method:"POST"});openDetail(selected);load()}catch(e){alert(e.message)}};
 return <div>
  <div className="toolbar"><div><h1>Bank/Cash Reconciliation</h1><p className="muted">Compare the Micro Pay ledger with the actual bank statement or physical cash count.</p></div>{user?.role!=="MANAGER"&&<button onClick={()=>{setOpen(true);setPreview(null)}}>+ New Reconciliation</button>}</div>
  {open&&<div className="panel reconciliation-create-panel"><h2>New Reconciliation</h2>
   <form className="reconciliation-form" onSubmit={create}>
    <label>Account
      <select value={f.account_id} onChange={e=>setF({...f,account_id:e.target.value})} required><option value="">Select account</option>{accounts.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.account_name}</option>)}</select>
    </label>
    <label>Period Start
      <input type="date" value={f.period_start} onChange={e=>setF({...f,period_start:e.target.value})} required/>
    </label>
    <label>Period End
      <input type="date" value={f.period_end} onChange={e=>setF({...f,period_end:e.target.value})} required/>
    </label>
    <div className="recon-readonly"><span>System Opening Balance</span><strong>{preview?money(preview.system_opening_balance):"Select account and period"}</strong><small>Calculated automatically from the account opening balance and posted ledger transactions.</small></div>
    <div className="recon-readonly"><span>Statement Opening Balance</span><strong>{preview?money(preview.statement_opening_balance):"Select account and period"}</strong><small>{preview?.previous_reconciliation_end?`Carried forward from reconciliation ending ${preview.previous_reconciliation_end}.`:"Uses the account opening balance because there is no previous active reconciliation."}</small></div>
    <label>Statement / Actual Closing Balance
      <input type="number" step="0.01" value={f.statement_closing_balance} onChange={e=>setF({...f,statement_closing_balance:e.target.value})} required/>
      <small>Enter the balance shown on the bank/mobile-money statement or physical cash count.</small>
    </label>
    <div className="recon-readonly"><span>System Closing Balance</span><strong>Calculated when reconciliation is created</strong><small>Based on the system ledger through the period end.</small></div>
    <label className="recon-notes">Notes
      <textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/>
    </label>
    <div className="reconciliation-form-actions"><button type="submit">Create Reconciliation</button><button type="button" onClick={()=>setOpen(false)}>Cancel</button></div>
   </form>
  </div>}
  <section className="panel report-panel"><div className="section-title"><h2>Reconciliation History</h2><span>{recs.length} record(s)</span></div>
   {recs.length?<div className="tablewrap"><table><thead><tr><th>Account</th><th>Period</th><th>Statement Closing</th><th>System Balance</th><th>Difference</th><th>Status</th><th>Actions</th></tr></thead><tbody>
   {recs.map(r=><tr key={r.id}><td>{r.account_name}</td><td>{r.period_start} → {r.period_end}</td><td>{money(r.statement_closing_balance)}</td><td>{money(r.reconciled_balance)}</td><td>{money(r.difference)}</td><td>{r.status}</td><td><button onClick={()=>openDetail(r.id)}>Open</button></td></tr>)}</tbody></table></div>:<p className="muted">No reconciliations have been created yet.</p>}
  </section>
  {detail&&<section className="panel report-panel"><div className="section-title"><h2>{detail.account_name} — Reconciliation</h2><span>Status: {detail.status}</span></div>
   <div className="cards report-summary"><div className="card"><small>Statement Closing</small><strong>{money(detail.statement_closing_balance)}</strong></div><div className="card"><small>System Balance</small><strong>{money(detail.reconciled_balance)}</strong></div><div className="card"><small>Difference</small><strong>{money(detail.difference)}</strong></div><div className="card"><small>Uncleared Items</small><strong>{detail.items.filter(x=>!x.cleared).length}</strong></div></div>
   <div className="tablewrap"><table><thead><tr><th>Cleared</th><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead><tbody>
   {detail.items.map(x=><tr key={x.id}><td><input type="checkbox" checked={x.cleared} disabled={detail.status!=="DRAFT"||user?.role==="MANAGER"} onChange={()=>toggle(x)}/></td><td>{x.transaction_date}</td><td>{x.transaction_type}</td><td>{x.reference||"—"}</td><td>{x.description||"—"}</td><td>{x.direction==="DEBIT"?money(x.amount):"—"}</td><td>{x.direction==="CREDIT"?money(x.amount):"—"}</td></tr>)}</tbody></table></div>
   {detail.status==="DRAFT"&&user?.role!=="MANAGER"&&<><button onClick={complete}>Complete Reconciliation</button><button className="danger" onClick={cancelReconciliation}>Cancel Reconciliation</button></>}
   {detail.status==="CANCELLED"&&<div className="alert warning">Cancelled: {detail.cancellation_reason||"No reason recorded"}</div>}
  </section>}
 </div>
}


function CurrenciesRates({user}){
 const [currencies,setCurrencies]=useState([]),[rates,setRates]=useState([]),[editing,setEditing]=useState(null),[rateEditing,setRateEditing]=useState(null),[adding,setAdding]=useState(false),[newCurrency,setNewCurrency]=useState({code:"",name:"",symbol:"",decimals:2}),[f,setF]=useState({rate_date:new Date().toISOString().slice(0,10),from_currency:"USD",to_currency:"SSP"});
 const load=async()=>{try{const [c,r]=await Promise.all([api("/phase4/currencies"),api("/phase4/exchange-rates")]);setCurrencies(Array.isArray(c)?c:[]);setRates(Array.isArray(r)?r:[])}catch(e){alert(e.message)}};
 useEffect(()=>{load()},[]);
 const saveRate=async e=>{e.preventDefault();try{if(rateEditing){await api(`/phase4/exchange-rates/${rateEditing.id}`,{method:"PATCH",body:JSON.stringify({rate:f.rate,source:f.source||""})});setRateEditing(null)}else{await api("/phase4/exchange-rates",{method:"POST",body:JSON.stringify(f)})}setF({...f,rate:"",source:""});load()}catch(e){alert(e.message)}};
 const editCurrency=c=>setEditing({code:c.code,name:c.name,symbol:c.symbol,active:c.active});
 const saveCurrency=async e=>{e.preventDefault();try{await api(`/phase4/currencies/${editing.code}`,{method:"PATCH",body:JSON.stringify(editing)});setEditing(null);load()}catch(e){alert(e.message)}};
 const toggleCurrency=async c=>{if(c.code==="USD"&&!c.active)return;const action=c.active?"deactivate":"activate";if(!confirm(`${action.charAt(0).toUpperCase()+action.slice(1)} currency ${c.code}?`))return;try{await api(`/phase4/currencies/${c.code}`,{method:"PATCH",body:JSON.stringify({active:!c.active})});load()}catch(e){alert(e.message)}};
 const addCurrency=async e=>{e.preventDefault();try{await api("/phase4/currencies",{method:"POST",body:JSON.stringify(newCurrency)});setNewCurrency({code:"",name:"",symbol:"",decimals:2});setAdding(false);load()}catch(e){alert(e.message)}};
 const deleteRate=async r=>{if(!confirm(`Delete exchange rate ${r.from_currency}/${r.to_currency} dated ${r.rate_date}?`))return;try{await api(`/phase4/exchange-rates/${r.id}`,{method:"DELETE"});load()}catch(e){alert(e.message)}};
 return <><div className="toolbar"><div><h1>Currencies & Rates</h1><p className="muted">USD is the base/reporting currency. SSP is enabled for local transactions.</p></div><button onClick={()=>setAdding(!adding)}>+ Add Currency</button></div>
 {adding&&<div className="panel"><h2>Add Currency</h2><form onSubmit={addCurrency}><input maxLength="3" placeholder="Code e.g. EUR" required value={newCurrency.code} onChange={e=>setNewCurrency({...newCurrency,code:e.target.value.toUpperCase()})}/><input placeholder="Currency name" required value={newCurrency.name} onChange={e=>setNewCurrency({...newCurrency,name:e.target.value})}/><input placeholder="Symbol" required value={newCurrency.symbol} onChange={e=>setNewCurrency({...newCurrency,symbol:e.target.value})}/><input type="number" min="0" max="6" step="1" placeholder="Decimals" required value={newCurrency.decimals} onChange={e=>setNewCurrency({...newCurrency,decimals:Number(e.target.value)})}/><button>Add Currency</button><button type="button" onClick={()=>setAdding(false)}>Cancel</button></form></div>}
 {editing&&<div className="panel"><h2>Edit Currency — {editing.code}</h2><form onSubmit={saveCurrency}><input value={editing.name||""} placeholder="Currency name" required onChange={e=>setEditing({...editing,name:e.target.value})}/><input value={editing.symbol||""} placeholder="Symbol" onChange={e=>setEditing({...editing,symbol:e.target.value})}/><label><input type="checkbox" checked={editing.active!==false} disabled={editing.code==="USD"} onChange={e=>setEditing({...editing,active:e.target.checked})}/> Active</label><button>Save Changes</button><button type="button" onClick={()=>setEditing(null)}>Cancel</button></form></div>}
 <div className="panel"><h2>{rateEditing?"Edit Exchange Rate":"Exchange Rate"}</h2><form onSubmit={saveRate}>{!rateEditing&&<input type="date" required value={f.rate_date} onChange={e=>setF({...f,rate_date:e.target.value})}/>}<select disabled={!!rateEditing} value={f.from_currency} onChange={e=>setF({...f,from_currency:e.target.value})}>{currencies.map(c=><option key={c.code}>{c.code}</option>)}</select><span>→</span><select disabled={!!rateEditing} value={f.to_currency} onChange={e=>setF({...f,to_currency:e.target.value})}>{currencies.map(c=><option key={c.code}>{c.code}</option>)}</select><input type="number" step="0.00000001" min="0.00000001" placeholder="Rate" required value={f.rate||""} onChange={e=>setF({...f,rate:e.target.value})}/><input placeholder="Source / note" value={f.source||""} onChange={e=>setF({...f,source:e.target.value})}/><button>{rateEditing?"Update Rate":"Save Rate"}</button>{rateEditing&&<button type="button" onClick={()=>setRateEditing(null)}>Cancel</button>}</form></div>
 <div className="panel"><h2>Currencies</h2><Table cols={["code","name","symbol","is_base","active"]} rows={currencies} actions={c=><><button onClick={()=>editCurrency(c)}>Edit</button>{c.code!=="USD"&&<button onClick={()=>toggleCurrency(c)}>{c.active?"Deactivate":"Activate"}</button>}</>}/></div>
 <div className="panel"><h2>Recent Exchange Rates</h2><Table cols={["rate_date","from_currency","to_currency","rate","source"]} rows={rates} actions={r=><><button onClick={()=>{setRateEditing(r);setF({rate:r.rate,source:r.source||"",from_currency:r.from_currency,to_currency:r.to_currency,rate_date:r.rate_date})}}>Edit</button><button className="danger" onClick={()=>deleteRate(r)}>Delete</button></>}/></div></>}
function Suppliers({user}){const [rows,setRows]=useState([]),[open,setOpen]=useState(false);const load=()=>api("/phase4/suppliers").then(x=>setRows(Array.isArray(x)?x:[])).catch(e=>alert(e.message));useEffect(()=>{load()},[]);const save=async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e.target));try{await api("/phase4/suppliers",{method:"POST",body:JSON.stringify(o)});setOpen(false);load()}catch(e){alert(e.message)}};return <><div className="toolbar"><h1>Suppliers</h1><button onClick={()=>setOpen(true)}>+ New Supplier</button></div>{open&&<div className="panel"><form onSubmit={save}><input name="name" placeholder="Supplier name" required/><input name="contact_person" placeholder="Contact person"/><input name="phone" placeholder="Phone"/><input name="email" type="email" placeholder="Email"/><input name="address" placeholder="Address"/><input name="tax_number" placeholder="Tax number"/><select name="default_currency"><option>USD</option><option>SSP</option></select><textarea name="notes" placeholder="Notes"/><button>Save Supplier</button><button type="button" onClick={()=>setOpen(false)}>Cancel</button></form></div>}<Table cols={["supplier_code","name","contact_person","phone","default_currency","active"]} rows={rows}/></>}
function Bills({user}){
  const [rows,setRows]=useState([]),[suppliers,setSuppliers]=useState([]),[accounts,setAccounts]=useState([]),[open,setOpen]=useState(false),[paymentOpen,setPaymentOpen]=useState(false),[selectedBill,setSelectedBill]=useState(null),[savingPayment,setSavingPayment]=useState(false);
  const [payment,setPayment]=useState({payment_date:new Date().toISOString().slice(0,10),amount:"",account_id:"",reference:"",notes:"",exchange_rate:""});
  const load=()=>api("/phase4/bills").then(x=>setRows(Array.isArray(x)?x:[])).catch(e=>alert(e.message));
  useEffect(()=>{
    load();
    api("/phase4/suppliers").then(x=>setSuppliers(Array.isArray(x)?x:[])).catch(e=>alert(e.message));
    if(user?.role!=="MANAGER") api("/financial-accounts").then(x=>setAccounts(Array.isArray(x)?x:[])).catch(e=>alert(e.message));
  },[]);
  const save=async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(e.target));try{await api("/phase4/bills",{method:"POST",body:JSON.stringify(o)});setOpen(false);load()}catch(e){alert(e.message)}};
  const startPayment=b=>{
    setSelectedBill(b);
    setPayment({payment_date:new Date().toISOString().slice(0,10),amount:String(Number(b.balance||0)),account_id:"",reference:"",notes:"",exchange_rate:""});
    setPaymentOpen(true);
  };
  const recordPayment=async e=>{
    e.preventDefault();
    if(!selectedBill)return;
    setSavingPayment(true);
    try{
      await api(`/phase4/bills/${selectedBill.id}/payments`,{method:"POST",body:JSON.stringify({
        ...payment,
        amount:Number(payment.amount||0)
      })});
      setPaymentOpen(false);setSelectedBill(null);load();
      alert("Supplier bill payment recorded successfully.");
    }catch(e){alert(e.message)}finally{setSavingPayment(false)}
  };
  const availableAccounts=accounts.filter(a=>a.active && String(a.currency_code||"USD").toUpperCase()===String(selectedBill?.currency_code||"USD").toUpperCase());
  return <>
    <div className="toolbar"><h1>Supplier Bills</h1><button onClick={()=>setOpen(true)}>+ New Bill</button></div>
    {open&&<div className="panel"><form onSubmit={save}><select name="supplier_id" required><option value="">Select supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><input name="supplier_reference" placeholder="Supplier invoice/reference"/><input name="bill_date" type="date" defaultValue={new Date().toISOString().slice(0,10)} required/><input name="due_date" type="date"/><select name="currency_code"><option>USD</option><option>SSP</option></select><input name="exchange_rate" type="number" step="0.00000001" min="0.00000001" placeholder="Exchange rate (optional)"/><input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount" required/><input name="description" placeholder="Description"/><textarea name="notes" placeholder="Notes"/><button>Save Bill</button><button type="button" onClick={()=>setOpen(false)}>Cancel</button></form></div>}
    {paymentOpen&&selectedBill&&<div className="panel"><h2>Record Bill Payment</h2><p className="muted"><strong>{selectedBill.bill_number}</strong> — {selectedBill.supplier_name} — Outstanding: {selectedBill.currency_code} {Number(selectedBill.balance||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p><form className="bill-payment-form" onSubmit={recordPayment}>
      <label>Payment Date<input type="date" value={payment.payment_date} onChange={e=>setPayment({...payment,payment_date:e.target.value})} required/></label>
      <label>Payment Amount<input type="number" min="0.01" max={Number(selectedBill.balance||0)} step="0.01" value={payment.amount} onChange={e=>setPayment({...payment,amount:e.target.value})} required/></label>
      <label>Cash / Bank / Mobile Money Account<select value={payment.account_id} onChange={e=>setPayment({...payment,account_id:e.target.value})} required><option value="">Select account</option>{availableAccounts.map(a=><option key={a.id} value={a.id}>{a.account_name} — {a.account_type} — {a.currency_code||"USD"} — {Number(a.current_balance||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</option>)}</select></label>
      {availableAccounts.length===0&&<p className="muted">No active financial account is available in {selectedBill.currency_code}. Create or activate a matching account under Cash &amp; Bank.</p>}
      <label>Reference<input value={payment.reference} onChange={e=>setPayment({...payment,reference:e.target.value})} placeholder="Payment reference (optional)"/></label>
      <label>Notes<textarea value={payment.notes} onChange={e=>setPayment({...payment,notes:e.target.value})} placeholder="Notes (optional)"/></label>
      <label>Exchange Rate<input type="number" min="0.00000001" step="0.00000001" value={payment.exchange_rate} onChange={e=>setPayment({...payment,exchange_rate:e.target.value})} placeholder="Optional — use current rate if blank"/></label>
      <button disabled={savingPayment||availableAccounts.length===0}>{savingPayment?"Recording...":"Record Payment"}</button><button type="button" onClick={()=>{setPaymentOpen(false);setSelectedBill(null)}}>Cancel</button>
    </form></div>}
    <div className="table-wrap"><table><thead><tr>{["bill number","supplier name","bill date","due date","currency code","amount","paid","balance","status","actions"].map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{rows.length?rows.map(b=><tr key={b.id}><td>{b.bill_number}</td><td>{b.supplier_name}</td><td>{b.bill_date}</td><td>{b.due_date||"—"}</td><td>{b.currency_code}</td><td>{Number(b.amount||0).toFixed(2)}</td><td>{Number(b.paid||0).toFixed(2)}</td><td>{Number(b.balance||0).toFixed(2)}</td><td>{b.status}</td><td>{user?.role!=="MANAGER"&&b.status!=="PAID"&&b.status!=="CANCELLED"?<button onClick={()=>startPayment(b)}>Record Payment</button>:"—"}</td></tr>):<tr><td colSpan="10">No supplier bills found.</td></tr>}</tbody></table></div>
  </>;
}

function Users(){
  const [rows,setRows]=useState([]);
  const [open,setOpen]=useState(false);
  const [mode,setMode]=useState(null);
  const [selected,setSelected]=useState(null);
  const [f,setF]=useState({role:"CLERK"});
  const load=()=>api("/auth/users").then(setRows).catch(e=>alert(e.message));
  useEffect(()=>{load()},[]);

  const close=()=>{setOpen(false);setMode(null);setSelected(null);setF({role:"CLERK"})};

  const create=()=>{setSelected(null);setMode("create");setF({role:"CLERK"});setOpen(true)};
  const edit=r=>{setSelected(r);setMode("edit");setF({name:r.name||"",email:r.email||"",role:r.role||"CLERK"});setOpen(true)};
  const reset=r=>{setSelected(r);setMode("reset");setF({password:""});setOpen(true)};

  const save=async e=>{
    e.preventDefault();
    try{
      if(mode==="create"){
        await api("/auth/users",{method:"POST",body:JSON.stringify(f)});
      }else if(mode==="edit"){
        await api(`/auth/users/${selected.id}`,{method:"PATCH",body:JSON.stringify({name:f.name,email:f.email,role:f.role})});
      }else if(mode==="reset"){
        await api(`/auth/users/${selected.id}/reset-password`,{method:"POST",body:JSON.stringify({password:f.password})});
        alert("Password reset successfully.");
      }
      close();
      load();
    }catch(err){alert(err.message)}
  };

  const toggle=async r=>{
    try{
      await api(`/auth/users/${r.id}`,{method:"PATCH",body:JSON.stringify({active:!r.active})});
      load();
    }catch(err){alert(err.message)}
  };

  const remove=async r=>{
    if(!window.confirm(`Delete user ${r.name}? This action cannot be undone. Users with associated records cannot be deleted.`))return;
    try{
      await api(`/auth/users/${r.id}`,{method:"DELETE"});
      load();
    }catch(err){alert(err.message)}
  };

  return <>
    <div className="toolbar"><h1>Users & Roles</h1><button onClick={create}>+ New User</button></div>
    {open&&<div className="panel">
      <h2>{mode==="create"?"New User":mode==="edit"?`Edit ${selected?.name||"User"}`:`Reset Password — ${selected?.name||"User"}`}</h2>
      <form onSubmit={save}>
        {mode!=="reset"&&<>
          <input placeholder="Full name" required value={f.name||""} onChange={e=>setF({...f,name:e.target.value})}/>
          <input type="email" placeholder="Email" required value={f.email||""} onChange={e=>setF({...f,email:e.target.value})}/>
          {mode==="create"&&<input type="password" placeholder="Temporary password (8+ characters)" minLength="8" required value={f.password||""} onChange={e=>setF({...f,password:e.target.value})}/>} 
          <select value={f.role||"CLERK"} onChange={e=>setF({...f,role:e.target.value})}>{Object.entries(ROLE_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
        </>}
        {mode==="reset"&&<input type="password" placeholder="New password (8+ characters)" minLength="8" required value={f.password||""} onChange={e=>setF({...f,password:e.target.value})}/>} 
        <button>{mode==="create"?"Create User":mode==="edit"?"Save Changes":"Reset Password"}</button>
        <button type="button" onClick={close}>Cancel</button>
      </form>
    </div>}
    <Table cols={["name","email","role","active"]} rows={rows} actions={r=><>
      <button type="button" onClick={()=>edit(r)}>Edit</button>
      <button type="button" onClick={()=>reset(r)}>Reset Password</button>
      <button type="button" onClick={()=>toggle(r)}>{r.active?"Deactivate":"Activate"}</button>
      <button type="button" className="danger" onClick={()=>remove(r)}>Delete</button>
    </>}/>
  </>
}
function Form({fields,values,setValues,onSubmit}){return <div className="panel"><form onSubmit={onSubmit}>{fields.map(k=><input placeholder={k.replace("_"," ")} required={k==="name"} value={values[k]||""} onChange={e=>setValues({...values,[k]:e.target.value})}/>) }<button>Save</button></form></div>}
function Table({cols,rows,actions}){return <div className="tablewrap"><table><thead><tr>{cols.map(c=><th key={c}>{c.replaceAll("_"," ")}</th>)}{actions&&<th>Actions</th>}</tr></thead><tbody>{rows.map(r=><tr key={r.id}>{cols.map(c=><td key={c}>{c==="status"?<span className={`status status-${String(r[c]||"").toLowerCase()}`}>{r[c]}</span>:typeof r[c]==="number"||["total","paid","balance","amount"].includes(c)?Number(r[c]||0).toFixed(2):r[c]}</td>)}{actions&&<td className="actions">{actions(r)}</td>}</tr>)}</tbody></table></div>}

function App(){const [user,setUser]=useState(null);const [page,setPage]=useState("Dashboard");const [loading,setLoading]=useState(true);useEffect(()=>{if(!localStorage.getItem("micropay_token")){setLoading(false);return}api("/auth/me").then(x=>setUser(x.user)).catch(()=>localStorage.removeItem("micropay_token")).finally(()=>setLoading(false))},[]);if(loading)return <p>Loading...</p>;if(!user)return <Login onLogin={setUser}/>;const logout=()=>{localStorage.removeItem("micropay_token");setUser(null)};return <Layout page={page} setPage={setPage} user={user} onLogout={logout}/>};createRoot(document.getElementById("root")).render(<App/>);
