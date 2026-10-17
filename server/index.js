import 'dotenv/config';
import express from 'express';
import authRoutes from './routes/auth.js';
import { requireSameOrigin } from './auth/origin.js';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const app = express();
const port = Number(process.env.PORT) || 5000;
const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const projectRoot = path.resolve(dirname, '..');
const distPath = path.join(projectRoot, 'dist');
const isProduction = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: isProduction ? undefined : false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({
  origin: process.env.APP_ORIGIN
    ? process.env.APP_ORIGIN.split(',').map(value => value.trim())
    : isProduction ? false : true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '100kb' }));
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));

app.use('/api/v1/auth', requireSameOrigin, authRoutes);

app.get('/api/v1/health/database', async (_req, res) => { try { const { pool } = await import('./db/pool.js'); await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); } catch { res.status(503).json({ status: 'error', database: 'unavailable' }); } });

app.get('/api/v1/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'musichub-api',
    timestamp: new Date().toISOString()
  });
});

if (existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath, {
    index: false,
    maxAge: isProduction ? '1d' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    }
  }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'An unexpected server error occurred' });
});


app.listen(port, '0.0.0.0', () => {
  console.log(`MusicHub API listening on port ${port}`);
});
