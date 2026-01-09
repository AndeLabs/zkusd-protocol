// Sentry Configuration for zkUSD
// To enable, install: pnpm add @sentry/nextjs
// Then run: npx @sentry/wizard@latest -i nextjs

// NOTE: Sentry integration is optional. Install @sentry/nextjs to enable.

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const SENTRY_ENABLED = false; // Set to true after installing @sentry/nextjs

// Placeholder types when Sentry is not installed
type SentryScope = { setExtra: (key: string, value: unknown) => void };

export function initSentry() {
  if (!SENTRY_ENABLED || !SENTRY_DSN) {
    console.info('[Sentry] Not configured, error tracking disabled');
    return;
  }

  // When @sentry/nextjs is installed, uncomment and configure:
  // Sentry.init({
  //   dsn: SENTRY_DSN,
  //   environment: process.env.NODE_ENV,
  //   tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  //   replaysSessionSampleRate: 0.1,
  //   replaysOnErrorSampleRate: 1.0,
  //   enabled: process.env.NODE_ENV === 'production',
  // });
}

// Helper to capture errors with context
export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (!SENTRY_ENABLED) {
    console.error('[Error]', error, context);
    return;
  }

  // When @sentry/nextjs is installed:
  // Sentry.withScope((scope) => {
  //   if (context) {
  //     Object.entries(context).forEach(([key, value]) => {
  //       scope.setExtra(key, value);
  //     });
  //   }
  //   Sentry.captureException(error);
  // });
}

// Set user context after wallet connection
export function setUserContext(address: string | null, walletType?: string) {
  if (!SENTRY_ENABLED) return;

  // When @sentry/nextjs is installed:
  // if (address) {
  //   Sentry.setUser({
  //     id: address.slice(0, 8) + '...' + address.slice(-6),
  //     walletType,
  //   });
  // } else {
  //   Sentry.setUser(null);
  // }
}

// Add breadcrumb for important actions
export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>
) {
  if (!SENTRY_ENABLED) return;

  // When @sentry/nextjs is installed:
  // Sentry.addBreadcrumb({
  //   category,
  //   message,
  //   data,
  //   level: 'info',
  // });
}
