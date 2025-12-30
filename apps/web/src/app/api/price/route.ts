import { NextResponse } from 'next/server';

// Cache duration in seconds
const CACHE_DURATION = 30;

interface PriceResponse {
  price: number;
  source: string;
  timestamp: number;
}

interface ErrorResponse {
  error: string;
}

/**
 * GET /api/price
 * Fetches real-time BTC/USD price from multiple sources with fallbacks
 */
export async function GET(): Promise<NextResponse<PriceResponse | ErrorResponse>> {
  // Try CoinGecko first
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      {
        next: { revalidate: CACHE_DURATION },
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      const priceUsd = data.bitcoin?.usd;

      if (typeof priceUsd === 'number' && priceUsd > 0) {
        return NextResponse.json({
          price: priceUsd,
          source: 'coingecko',
          timestamp: Date.now(),
        });
      }
    }
  } catch (err) {
    console.warn('CoinGecko API failed:', err);
  }

  // Fallback: Coinbase
  try {
    const response = await fetch(
      'https://api.coinbase.com/v2/prices/BTC-USD/spot',
      {
        next: { revalidate: CACHE_DURATION },
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      const priceUsd = parseFloat(data.data?.amount);

      if (!isNaN(priceUsd) && priceUsd > 0) {
        return NextResponse.json({
          price: priceUsd,
          source: 'coinbase',
          timestamp: Date.now(),
        });
      }
    }
  } catch (err) {
    console.warn('Coinbase API failed:', err);
  }

  // Second fallback: Kraken
  try {
    const response = await fetch(
      'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
      {
        next: { revalidate: CACHE_DURATION },
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      const priceStr = data.result?.XXBTZUSD?.c?.[0];
      const priceUsd = parseFloat(priceStr);

      if (!isNaN(priceUsd) && priceUsd > 0) {
        return NextResponse.json({
          price: priceUsd,
          source: 'kraken',
          timestamp: Date.now(),
        });
      }
    }
  } catch (err) {
    console.warn('Kraken API failed:', err);
  }

  // Third fallback: Binance
  try {
    const response = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
      {
        next: { revalidate: CACHE_DURATION },
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      const priceUsd = parseFloat(data.price);

      if (!isNaN(priceUsd) && priceUsd > 0) {
        return NextResponse.json({
          price: priceUsd,
          source: 'binance',
          timestamp: Date.now(),
        });
      }
    }
  } catch (err) {
    console.warn('Binance API failed:', err);
  }

  // All APIs failed
  return NextResponse.json(
    { error: 'Unable to fetch BTC price from any source' },
    { status: 503 }
  );
}
