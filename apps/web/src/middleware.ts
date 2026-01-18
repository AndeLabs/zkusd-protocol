import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // requests per window

// In-memory store (use Redis in production for multi-instance)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function getRateLimitKey(request: NextRequest): string {
  // Use IP address as key (X-Forwarded-For for proxied requests)
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  return `rate-limit:${ip}`;
}

function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - record.count };
}

// ============================================================================
// Security Headers
// ============================================================================

function getSecurityHeaders(): Record<string, string> {
  // Content Security Policy
  // Note: Vercel Live and preview features require additional domains
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://*.vercel.live", // Next.js requires unsafe-eval in dev
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://vercel.live",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.coingecko.com https://api.coinbase.com https://api.kraken.com https://api.binance.com https://mempool.space https://blockstream.info https://vercel.live https://*.vercel.live https://v8.charms.dev https://*.charms.dev wss: ws:",
    "frame-src 'self' https://vercel.live",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  return {
    // Content Security Policy
    'Content-Security-Policy': cspDirectives.join('; '),

    // Prevent clickjacking
    'X-Frame-Options': 'DENY',

    // Prevent MIME type sniffing
    'X-Content-Type-Options': 'nosniff',

    // Enable XSS filter
    'X-XSS-Protection': '1; mode=block',

    // Referrer Policy
    'Referrer-Policy': 'strict-origin-when-cross-origin',

    // Permissions Policy (disable unnecessary features)
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',

    // HSTS (enable after confirming HTTPS works)
    // 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

// ============================================================================
// Middleware
// ============================================================================

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.includes('.') // files with extensions
  ) {
    return NextResponse.next();
  }

  // Rate limiting for API routes
  if (pathname.startsWith('/api')) {
    const rateLimitKey = getRateLimitKey(request);
    const { allowed, remaining } = checkRateLimit(rateLimitKey);

    if (!allowed) {
      return new NextResponse(JSON.stringify({ error: 'Too many requests', retryAfter: 60 }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
          'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
          'X-RateLimit-Remaining': '0',
        },
      });
    }

    // Add rate limit headers to API responses
    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX_REQUESTS));
    response.headers.set('X-RateLimit-Remaining', String(remaining));

    return response;
  }

  // Add security headers to all responses
  const response = NextResponse.next();
  const securityHeaders = getSecurityHeaders();

  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

// ============================================================================
// Middleware Config
// ============================================================================

export const config = {
  matcher: [
    // Match all paths except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
