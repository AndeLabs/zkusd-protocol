'use client';

import { getUtxoService } from '@/lib/services';
import { useWallet } from '@/stores/wallet';
import { useEffect, useState, useCallback } from 'react';

interface UtxoStatusInfo {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
  available: boolean;
  availableAt?: number;
}

// Cache TTL is 1 hour (matching prover cache)
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Format remaining time until cache expiry
 */
function formatTimeRemaining(availableAt: number): string {
  const remaining = availableAt - Date.now();

  if (remaining <= 0) return 'Available now';

  const minutes = Math.ceil(remaining / 60000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  return `${minutes}m`;
}

/**
 * Component showing UTXO availability status for vault operations
 * with cache expiry timers
 */
export function UtxoStatus() {
  const { address, isConnected } = useWallet();
  const [availableUtxos, setAvailableUtxos] = useState<UtxoStatusInfo[]>([]);
  const [reservedUtxos, setReservedUtxos] = useState<UtxoStatusInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const refresh = useCallback(async () => {
    if (!isConnected || !address) return;

    setLoading(true);
    try {
      const utxoService = getUtxoService();
      const { available, reserved } = await utxoService.getCategorizedUtxos(address);

      setAvailableUtxos(
        available.map((u) => ({
          txid: u.txid,
          vout: u.vout,
          value: u.value,
          confirmed: u.confirmed,
          available: true,
        }))
      );

      setReservedUtxos(
        reserved.map((u) => ({
          txid: u.txid,
          vout: u.vout,
          value: u.value,
          confirmed: u.confirmed,
          available: false,
          availableAt: u.availableAt,
        }))
      );
    } catch (e) {
      console.error('[UtxoStatus] Failed to fetch UTXOs:', e);
    } finally {
      setLoading(false);
    }
  }, [address, isConnected]);

  useEffect(() => {
    refresh();
    // Auto-refresh every 30 seconds to update expiry timers
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (!isConnected) return null;

  const totalAvailable = availableUtxos.reduce((sum, u) => sum + u.value, 0);
  const allUtxosBurned = availableUtxos.length === 0 && reservedUtxos.length > 0;

  // Calculate earliest expiry time
  const earliestExpiry = reservedUtxos
    .filter((u) => u.availableAt)
    .reduce((earliest, u) => {
      const expiry = u.availableAt || 0;
      return earliest === 0 || expiry < earliest ? expiry : earliest;
    }, 0);

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-sm">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium">UTXO Status</h4>
        <button
          onClick={refresh}
          disabled={loading}
          className="px-2 py-1 text-xs hover:bg-muted rounded"
          title="Refresh"
        >
          {loading ? '...' : 'Refresh'}
        </button>
      </div>

      <div className="space-y-2">
        {/* Available UTXOs */}
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-green-500">●</span>
          <span>
            {availableUtxos.length} available ({(totalAvailable / 1e8).toFixed(6)} BTC)
          </span>
        </div>

        {/* Reserved UTXOs with expiry timer */}
        {reservedUtxos.length > 0 && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="text-yellow-500">●</span>
              <span>{reservedUtxos.length} reserved</span>
            </div>
            {earliestExpiry > 0 && (
              <div className="flex items-center gap-1 text-xs text-yellow-600">
                <span>Available in ~{formatTimeRemaining(earliestExpiry)}</span>
              </div>
            )}
          </div>
        )}

        {/* Toggle details */}
        {reservedUtxos.length > 0 && (
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-primary hover:underline"
          >
            {showDetails ? 'Hide details' : 'Show expiry times'}
          </button>
        )}

        {/* Detailed view with expiry timers */}
        {showDetails && reservedUtxos.length > 0 && (
          <div className="mt-2 p-2 bg-muted/50 rounded text-xs space-y-2">
            <p className="text-muted-foreground">
              Reserved UTXOs will become available automatically:
            </p>
            {reservedUtxos.map((u) => (
              <div
                key={`${u.txid}:${u.vout}`}
                className="flex items-center justify-between p-2 bg-background/50 rounded"
              >
                <div className="flex items-center gap-2">
                  <span className="text-yellow-500">●</span>
                  <code className="text-xs">
                    {u.txid.slice(0, 8)}...:{u.vout}
                  </code>
                  <span className="text-muted-foreground">({(u.value / 1e8).toFixed(6)} BTC)</span>
                </div>
                {u.availableAt && (
                  <div className="flex items-center gap-1 text-yellow-600">
                    <span>{formatTimeRemaining(u.availableAt)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ALL UTXOs BURNED - Show countdown */}
      {allUtxosBurned && (
        <div className="mt-3 p-3 bg-yellow-500/10 rounded">
          <div className="flex items-start gap-2">
            <span className="text-yellow-500 mt-0.5 flex-shrink-0">⏱</span>
            <div className="text-xs">
              <p className="font-medium text-yellow-600">Waiting for cache expiry</p>
              <p className="text-muted-foreground mt-1">
                {earliestExpiry > 0 ? (
                  <>
                    Your UTXOs will be available in approximately{' '}
                    <span className="font-medium text-yellow-600">
                      {formatTimeRemaining(earliestExpiry)}
                    </span>
                  </>
                ) : (
                  'Please wait a moment for UTXOs to become available'
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
