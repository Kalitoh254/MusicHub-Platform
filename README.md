# MusicHub Platform

MusicHub is the current web music platform project under MegaFlow Music. It combines a Vite frontend, an Express API and Neon PostgreSQL.

## Stack
- Frontend: Vite, JavaScript and CSS
- Backend: Node.js and Express
- Database: Neon PostgreSQL
- Authentication: scrypt password hashing and server-managed sessions
- Deployment target: Render Web Service

## Current implementation
- Web application and production static-file serving
- Versioned API and health endpoint
- Account registration, login, logout and current-session routes
- HTTP-only session cookies and hashed session tokens
- Authentication rate limiting and origin checks
- PostgreSQL migrations and connection pooling

Email verification, password recovery and full production authentication validation remain outstanding.

## Local setup
1. Install Node.js and npm.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and configure the required values.
4. Run `npm run dev`.
5. Run `npm run build` to build the production frontend.

Never commit `.env` or publish database credentials.

## Render deployment
Build command: `npm install && npm run build`

Start command: `npm start`

Configure `DATABASE_URL`, `NODE_ENV=production` and `APP_ORIGIN` in Render's environment settings. Set `APP_ORIGIN` to the exact deployed HTTPS origin. Use the Neon application-role connection string, not the database owner credentials.

## API
- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

Confirm current route implementations before relying on these endpoints in production.
