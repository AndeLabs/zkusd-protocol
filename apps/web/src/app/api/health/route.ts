import { NextResponse } from 'next/server';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  version: string;
  checks: {
    name: string;
    status: 'pass' | 'fail' | 'warn';
    responseTime?: number;
    message?: string;
  }[];
}

// Check Bitcoin API (mempool.space)
async function checkBitcoinApi(): Promise<{ status: 'pass' | 'fail' | 'warn'; responseTime: number; message?: string }> {
  const start = Date.now();
  try {
    const response = await fetch('https://mempool.space/testnet4/api/blocks/tip/height', {
      signal: AbortSignal.timeout(5000),
    });

    const responseTime = Date.now() - start;

    if (response.ok) {
      const height = await response.text();
      return {
        status: 'pass',
        responseTime,
        message: `Block height: ${height}`,
      };
    }

    return {
      status: 'fail',
      responseTime,
      message: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: 'fail',
      responseTime: Date.now() - start,
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

// Check Charms Prover
async function checkCharmsProver(): Promise<{ status: 'pass' | 'fail' | 'warn'; responseTime: number; message?: string }> {
  const start = Date.now();
  try {
    // Just check if the endpoint is reachable (OPTIONS request)
    const response = await fetch('https://v8.charms.dev/spells/prove', {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(5000),
    });

    const responseTime = Date.now() - start;

    // Any response (even 405) means the service is up
    return {
      status: response.ok || response.status === 405 ? 'pass' : 'warn',
      responseTime,
      message: `Prover reachable (${response.status})`,
    };
  } catch (error) {
    return {
      status: 'fail',
      responseTime: Date.now() - start,
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

// Check Price API
async function checkPriceApi(): Promise<{ status: 'pass' | 'fail' | 'warn'; responseTime: number; message?: string }> {
  const start = Date.now();
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', {
      signal: AbortSignal.timeout(5000),
    });

    const responseTime = Date.now() - start;

    if (response.ok) {
      const data = (await response.json()) as { bitcoin?: { usd?: number } };
      const price = data.bitcoin?.usd;
      return {
        status: 'pass',
        responseTime,
        message: price ? `BTC: $${price.toLocaleString()}` : 'Price unavailable',
      };
    }

    return {
      status: 'warn',
      responseTime,
      message: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: 'warn', // Price API is not critical
      responseTime: Date.now() - start,
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

/**
 * GET /api/health
 * Returns system health status
 */
export async function GET(): Promise<NextResponse<HealthStatus>> {
  const [bitcoinApi, charmsProver, priceApi] = await Promise.all([
    checkBitcoinApi(),
    checkCharmsProver(),
    checkPriceApi(),
  ]);

  const checks = [
    { name: 'bitcoin_api', ...bitcoinApi },
    { name: 'charms_prover', ...charmsProver },
    { name: 'price_api', ...priceApi },
  ];

  // Determine overall status
  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');

  let status: HealthStatus['status'] = 'healthy';
  if (hasFail) {
    status = 'unhealthy';
  } else if (hasWarn) {
    status = 'degraded';
  }

  const healthStatus: HealthStatus = {
    status,
    timestamp: Date.now(),
    version: process.env.npm_package_version || '0.1.0',
    checks,
  };

  // Return appropriate HTTP status code
  const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;

  return NextResponse.json(healthStatus, { status: httpStatus });
}
