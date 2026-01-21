/**
 * Sentry Client-Side Configuration
 *
 * This file configures the initialization of Sentry on the client.
 * The config you add here will be used whenever a user loads a page.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Only initialize if DSN is configured
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Environment
    environment: process.env.NODE_ENV,

    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Session Replay (optional)
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Debug mode in development
    debug: process.env.NODE_ENV === 'development',

    // Filter out noisy errors
    ignoreErrors: [
      // Browser extensions
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
      // Network errors
      'Network request failed',
      'Failed to fetch',
      'Load failed',
      // User cancellations
      'User rejected',
      'User denied',
      'cancelled',
    ],

    // Before sending, clean up sensitive data
    beforeSend(event) {
      // Remove any wallet addresses or transaction data from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((crumb) => {
          if (crumb.data) {
            // Redact potential sensitive fields
            const sensitiveKeys = ['address', 'privateKey', 'mnemonic', 'seed'];
            for (const key of sensitiveKeys) {
              if (key in crumb.data) {
                crumb.data[key] = '[REDACTED]';
              }
            }
          }
          return crumb;
        });
      }
      return event;
    },
  });
}

export {};
