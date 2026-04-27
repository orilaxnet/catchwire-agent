import type { Request, Response, NextFunction } from 'express';

const DEMO_MODE    = process.env.DEMO_MODE === 'true';
const DEMO_USER_ID = process.env.DEMO_USER_ID ?? '';

// Routes that are always writable even in demo mode
// NOTE: req.path here is relative to the /api mount point (no /api prefix)
const ALWAYS_ALLOWED = [
  '/auth/',
  '/playground/',
  '/integrations',
  '/demo/',
];

export function demoGuard(req: Request, res: Response, next: NextFunction): void {
  if (!DEMO_MODE) { next(); return; }

  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') { next(); return; }

  const path = req.path;
  if (ALWAYS_ALLOWED.some((p) => path.startsWith(p))) { next(); return; }

  res.status(403).json({
    error: 'Demo mode — changes are disabled. Fork the project to self-host your own instance.',
    demo: true,
  });
}

export function isDemoMode(): boolean {
  return DEMO_MODE;
}

export function getDemoUserId(): string {
  return DEMO_USER_ID;
}
