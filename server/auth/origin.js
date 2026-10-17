export function requireSameOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const supplied = req.get('origin');
  if (!supplied) return res.status(403).json({ error: 'Request origin could not be verified.' });
  let origin;
  try { origin = new URL(supplied).origin; } catch {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }
  const allowed = new Set();
  if (process.env.APP_ORIGIN) {
    try { allowed.add(new URL(process.env.APP_ORIGIN).origin); } catch {}
  }
  if (process.env.NODE_ENV !== 'production') {
    allowed.add('http://localhost:5173');
    allowed.add('http://127.0.0.1:5173');
    if (/^http:\/\/(?:\d{1,3}\.){3}\d{1,3}:5173$/.test(origin)) allowed.add(origin);
  }
  if (!allowed.has(origin)) return res.status(403).json({ error: 'Request origin is not allowed.' });
  next();
}
