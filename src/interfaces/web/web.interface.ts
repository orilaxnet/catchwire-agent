import express, { Request, Response, NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage } from 'http';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import cors from 'cors';
import { logger } from '../../utils/logger.ts';
import { rateLimitMiddleware } from './middleware/rate-limit.middleware.ts';
import { verifyToken } from './middleware/auth.middleware.ts';
import { demoGuard } from './middleware/demo.middleware.ts';
import type { IUserInterface, InterfaceConfig, InterfaceCapabilities, Message, MessageResult, UserAction } from '../shared/interface-manager.ts';

export class WebInterface implements IUserInterface {
  readonly name:    string = 'web';
  readonly version: string = '1.0.0';

  private app    = express();
  private server = createServer(this.app);
  private wss    = new WebSocketServer({ noServer: true });
  private sockets = new Map<string, WebSocket>();
  private actionCallbacks: Array<(action: UserAction) => void> = [];
  // In-memory CSRF state store for Gmail OAuth: state → { accountId, expiresAt }
  private oauthStates = new Map<string, { accountId: string; expiresAt: number }>();

  constructor(private port: number = 3000) {}

  async initialize(config: InterfaceConfig): Promise<void> {
    if (config.credentials?.port) this.port = Number(config.credentials.port);
    await this.start();
  }

  async shutdown(): Promise<void> {
    this.server.close();
    this.wss.close();
  }

  async healthCheck(): Promise<boolean> {
    return this.server.listening;
  }

  getCapabilities(): InterfaceCapabilities {
    return {
      supportsRichText:       true,
      supportsButtons:        true,
      supportsInlineEdit:     true,
      supportsFileAttachment: true,
      supportsVoiceMessage:   false,
      maxMessageLength:       65536,
      supportsThreads:        true,
    };
  }

  onUserAction(callback: (action: UserAction) => void): void {
    this.actionCallbacks.push(callback);
  }

  async start(): Promise<void> {
    // Trust the first proxy hop so req.ip reflects the real client IP (needed
    // for rate limiting when running behind Nginx or any reverse proxy).
    this.app.set('trust proxy', 1);
    this.setupMiddleware();
    await this.setupRoutes();
    this.setupWebSocket();

    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        logger.info(`Web interface started on port ${this.port}`);
        resolve();
      });
    });
  }

  async sendMessage(userId: string, message: Message): Promise<MessageResult> {
    const ws = this.sockets.get(userId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: 'User not connected' };
    }
    ws.send(JSON.stringify({ type: 'message', ...message }));
    return { success: true };
  }

  private setupMiddleware(): void {
    // CORS — restrict to same origin in production, or explicit whitelist
    const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    this.app.use(cors({
      origin: allowedOrigins.length ? allowedOrigins : false,
      credentials: true,
    }));

    this.app.use(express.json({ limit: '512kb' }));
    this.app.use(express.static('public'));
    if (existsSync(resolve('dist/frontend'))) {
      this.app.use(express.static(resolve('dist/frontend')));
    }

    // Security headers
    this.app.use((_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "img-src 'self' data: https:; " +
        "connect-src 'self' wss: wss://*; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "frame-ancestors 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self';"
      );
      if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
      }
      next();
    });

    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      logger.debug('HTTP', { method: req.method, path: req.path });
      next();
    });
  }

  private async setupRoutes(): Promise<void> {
    this.app.get('/health', (_req, res) => res.json({ ok: true }));

    const { default: apiRouter } = await import('./routes/index.ts');
    this.app.use('/api', rateLimitMiddleware('api_calls'), demoGuard, apiRouter);

    // Gmail OAuth: generate a CSRF state token, store accountId against it
    this.app.get('/auth/gmail/start', rateLimitMiddleware('auth_attempts'), (req, res) => {
      const accountId = req.query.accountId as string;
      if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }

      const state = randomBytes(32).toString('hex');
      this.oauthStates.set(state, { accountId, expiresAt: Date.now() + 10 * 60 * 1000 });

      import('../../ingestion/gmail-webhook.ts').then(({ GmailWebhook }) => {
        const gmail = new GmailWebhook(() => Promise.resolve());
        const authUrl = gmail.getAuthUrl(state);
        res.redirect(authUrl);
      }).catch((err) => {
        logger.error('Gmail OAuth start failed', { err });
        res.status(500).send('Could not start OAuth flow');
      });
    });

    // Gmail OAuth callback — verify CSRF state and persist tokens
    this.app.get('/auth/gmail/callback', async (req, res) => {
      const code  = req.query.code  as string;
      const state = req.query.state as string;
      if (!code || !state) { res.status(400).send('Missing code or state'); return; }

      const entry = this.oauthStates.get(state);
      if (!entry || entry.expiresAt < Date.now()) {
        this.oauthStates.delete(state);
        res.status(403).send('Invalid or expired OAuth state — please try again');
        return;
      }
      this.oauthStates.delete(state);
      const { accountId } = entry;

      try {
        const { GmailWebhook } = await import('../../ingestion/gmail-webhook.ts');
        const gmail = new GmailWebhook(() => Promise.resolve());
        const tokens = await gmail.handleCallback(code);

        // Persist tokens encrypted against the account
        const { CredentialManager } = await import('../../security/credential-manager.ts');
        const { Encryption }        = await import('../../security/encryption.ts');
        const enc  = new Encryption(process.env.ENCRYPTION_KEY!);
        const cred = new CredentialManager(enc);
        await cred.storeEmailCredentials(accountId, tokens);

        logger.info('Gmail OAuth tokens stored', { accountId });
        res.send('<script>window.close()</script><p>Gmail connected! You can close this tab.</p>');
      } catch (err) {
        logger.error('Gmail OAuth callback failed', { err });
        res.status(500).send('Authentication failed');
      }
    });

    // Landing page — served directly at /
    const landingHtml = resolve('public/index.html');
    this.app.get('/', (_req, res) => {
      if (existsSync(landingHtml)) res.sendFile(landingHtml);
      else res.redirect('/agent/inbox');
    });

    // SPA fallback — all /agent/* routes go to the Preact app
    const distHtml = resolve('dist/frontend/index.html');
    const devHtml  = resolve('index.html');
    this.app.use((_req, res) => {
      res.sendFile(existsSync(distHtml) ? distHtml : devHtml);
    });
  }

  private setupWebSocket(): void {
    // Upgrade handler — validate JWT before accepting WS connection
    this.server.on('upgrade', (req: IncomingMessage, socket, head) => {
      const url    = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const token  = url.searchParams.get('token') ?? (req.headers['authorization'] as string)?.replace('Bearer ', '');

      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const payload = verifyToken(token);
      if (!payload) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket as any, head, (ws) => {
        this.wss.emit('connection', ws, req, payload.sub);
      });
    });

    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage, userId: string) => {
      this.sockets.set(userId, ws);
      logger.info('WS connected', { userId });

      ws.on('close', () => this.sockets.delete(userId));
      ws.on('error', (err) => logger.error('WS error', { userId, err }));
    });
  }
}
