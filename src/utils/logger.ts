import { createLogger, format, transports } from 'winston';

const { combine, timestamp, errors, json, colorize, simple } = format;

const isDev = process.env.NODE_ENV !== 'production';

export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',

  format: combine(
    timestamp(),
    errors({ stack: true }),
    json()
  ),

  // Never log API keys or credentials
  transports: [
    new transports.Console({
      format: isDev
        ? combine(colorize(), simple())
        : combine(timestamp(), json())
    }),

    ...(process.env.LOG_FILE ? [
      new transports.File({
        filename: process.env.LOG_FILE,
        maxsize: 10 * 1024 * 1024,   // 10 MB
        maxFiles: 5,
        tailable: true
      })
    ] : [])
  ]
});

// Sanitize log entries — strip sensitive fields before logging
const SENSITIVE_KEYS = ['apiKey', 'api_key', 'password', 'token', 'secret', 'credential'];

export function sanitizeForLog(obj: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLog(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
