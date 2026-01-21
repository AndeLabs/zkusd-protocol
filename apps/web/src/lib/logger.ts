/**
 * Production Logger
 *
 * Structured logging for production debugging.
 * Integrates with Sentry when configured.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
  timestamp: string;
  environment: string;
}

// Check if we're in production
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LOG_LEVEL = (process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel) || (IS_PRODUCTION ? 'warn' : 'debug');

// Log level priority
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Check if a log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL];
}

/**
 * Format log entry for output
 */
function formatLogEntry(entry: LogEntry): string {
  const { level, message, context, timestamp } = entry;
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}`;
}

/**
 * Send error to Sentry if configured
 */
async function sendToSentry(error: Error | string, context?: LogContext): Promise<void> {
  // Only in production and if Sentry DSN is configured
  if (!IS_PRODUCTION) return;

  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!sentryDsn) return;

  try {
    // Dynamic import to avoid loading Sentry in development
    const Sentry = await import('@sentry/nextjs').catch(() => null);
    if (!Sentry) return;

    if (error instanceof Error) {
      Sentry.captureException(error, { extra: context });
    } else {
      Sentry.captureMessage(error, { extra: context, level: 'error' });
    }
  } catch {
    // Sentry not available, ignore
  }
}

/**
 * Main logger class
 */
class Logger {
  private module: string;

  constructor(module: string) {
    this.module = module;
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message: `[${this.module}] ${message}`,
      context,
      timestamp: new Date().toISOString(),
      environment: IS_PRODUCTION ? 'production' : 'development',
    };

    const formatted = formatLogEntry(entry);

    switch (level) {
      case 'debug':
        console.debug(formatted);
        break;
      case 'info':
        console.info(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
        console.error(formatted);
        break;
    }

    // Send errors to Sentry
    if (level === 'error') {
      sendToSentry(message, { module: this.module, ...context });
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext: LogContext = { ...context };

    if (error instanceof Error) {
      errorContext.errorName = error.name;
      errorContext.errorMessage = error.message;
      errorContext.stack = error.stack;

      // Send actual error to Sentry
      sendToSentry(error, { module: this.module, ...context });
    } else if (error !== undefined) {
      errorContext.error = String(error);
    }

    this.log('error', message, errorContext);
  }

  /**
   * Time an async operation
   */
  async time<T>(label: string, operation: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await operation();
      const duration = Math.round(performance.now() - start);
      this.debug(`${label} completed`, { duration: `${duration}ms` });
      return result;
    } catch (error) {
      const duration = Math.round(performance.now() - start);
      this.error(`${label} failed`, error, { duration: `${duration}ms` });
      throw error;
    }
  }
}

/**
 * Create a logger instance for a module
 */
export function createLogger(module: string): Logger {
  return new Logger(module);
}

// Pre-configured loggers for common modules
export const vaultLogger = createLogger('Vault');
export const walletLogger = createLogger('Wallet');
export const proverLogger = createLogger('Prover');
export const apiLogger = createLogger('API');

export type { LogLevel, LogContext, LogEntry };
