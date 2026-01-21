import { NextResponse } from 'next/server';

// Cache duration in seconds
const CACHE_DURATION = 30;

// Request timeout in milliseconds
const REQUEST_TIMEOUT = 5000;

interface PriceResponse {
  price: number;
  source: string;
  timestamp: number;
}

interface ErrorResponse {
  error: string;
}

interface PriceSource {
  name: string;
  url: string;
  parsePrice: (data: unknown) => number | null;
}

// Helper to fetch with timeout
async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Parse price from CoinGecko response
function parseCoinGecko(data: unknown): number | null {
  const d = data as { bitcoin?: { usd?: number } };
  const price = d.bitcoin?.usd;
  return typeof price === 'number' && price > 0 ? price : null;
}

// Parse price from Coinbase response
function parseCoinbase(data: unknown): number | null {
  const d = data as { data?: { amount?: string } };
  const price = Number.parseFloat(d.data?.amount ?? '');
  return !Number.isNaN(price) && price > 0 ? price : null;
}

// Parse price from Kraken response
function parseKraken(data: unknown): number | null {
  const d = data as { result?: { XXBTZUSD?: { c?: string[] } } };
  const priceStr = d.result?.XXBTZUSD?.c?.[0];
  const price = Number.parseFloat(priceStr ?? '');
  return !Number.isNaN(price) && price > 0 ? price : null;
}

// Parse price from Binance response
function parseBinance(data: unknown): number | null {
  const d = data as { price?: string };
  const price = Number.parseFloat(d.price ?? '');
  return !Number.isNaN(price) && price > 0 ? price : null;
}

// Price sources in order of preference
const PRICE_SOURCES: PriceSource[] = [
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    parsePrice: parseCoinGecko,
  },
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
    parsePrice: parseCoinbase,
  },
  {
    name: 'kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
    parsePrice: parseKraken,
  },
  {
    name: 'binance',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
    parsePrice: parseBinance,
  },
];

// Try to fetch price from a single source
async function tryFetchPrice(source: PriceSource): Promise<PriceResponse | null> {
  try {
    const response = await fetchWithTimeout(source.url, {
      next: { revalidate: CACHE_DURATION },
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const price = source.parsePrice(data);

    if (price === null) return null;

    return {
      price,
      source: source.name,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * GET /api/price
 * Fetches real-time BTC/USD price from multiple sources with fallbacks
 */
export async function GET(): Promise<NextResponse<PriceResponse | ErrorResponse>> {
  for (const source of PRICE_SOURCES) {
    const result = await tryFetchPrice(source);
    if (result) {
      return NextResponse.json(result);
    }
  }

  return NextResponse.json({ error: 'Unable to fetch BTC price from any source' }, { status: 503 });
}
