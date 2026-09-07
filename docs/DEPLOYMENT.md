# Deployment plan

## VPS
1. Install Node.js LTS and PostgreSQL.
2. Create `micropay` database and user.
3. Run `psql micropay < database/schema.sql`.
4. Configure `server/.env`.
5. Run `npm install` and `npm run build` in the client.
6. Run the API under PM2.
7. Serve the Vite `client/dist` directory with Nginx or Cloudflare Pages.
8. Point a subdomain such as `app.micropay.ltd` to the web application.
9. Keep the API behind HTTPS.

## Recommended production subdomains
- `app.micropay.ltd` — application
- `api.micropay.ltd` — API

## Before going live
- Create strong JWT secret.
- Restrict PostgreSQL network access.
- Configure daily database backups.
- Add user authentication and roles.
- Add audit logging to every financial mutation.
- Add invoice cancellation and credit-note workflow.
- Confirm tax rules and numbering policy.
- Configure SMTP for document delivery.
