# Micro Pay Business Management System — Web V1

Production-oriented web application foundation for Micro Pay Company Limited.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL
- Authentication: JWT foundation
- PDF generation: PDFKit
- API: REST

## Core workflow
Customer → Quotation → Invoice → Payment → Receipt

## Included in V1
- Dashboard
- Customers
- Quotations
- Quotation items
- One-click quotation → invoice conversion
- Invoices
- Partial/full payment recording
- Receipts
- Operational expenses
- Automatic document numbering
- PostgreSQL schema
- PDF endpoints
- Responsive web UI

## Company settings
- Micro Pay Company Limited
- Phone: +211 929 044 412
- Email: info@micropay.ltd
- Website: micropay.ltd
- Address: Platinum Building, Opposite Ritz Hotel, Juba - South Sudan
- Logo slogan is not altered by the application.

## Run
### 1. Database
Create PostgreSQL database:
`createdb micropay`

Then:
`psql micropay < database/schema.sql`

### 2. Server
`cd server`
`npm install`
Copy `.env.example` to `.env` and set DATABASE_URL and JWT_SECRET.
`npm run dev`

### 3. Client
`cd client`
`npm install`
`npm run dev`

Set `VITE_API_URL=http://localhost:4000/api` in client/.env.

## Production
Use PostgreSQL on the VPS, PM2 for Node, Nginx or Cloudflare for the frontend/API, HTTPS, backups, environment secrets, and a proper SMTP provider.

This V1 is the application foundation. Before financial production use, add role permissions, immutable audit logs, backup/restore procedures, tax configuration, approval controls, document cancellation/credit-note rules, email delivery, and accounting integration.

## GitHub TEST environment

The repository is prepared for a `develop`-branch test deployment. See `TEST_DEPLOYMENT.md` and `.github/workflows/`.
GitHub Pages hosts the React frontend; the Express API and PostgreSQL database must run in a separate TEST environment.
