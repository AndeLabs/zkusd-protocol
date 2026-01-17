'use client';

import { useMemo } from 'react';
import { usePrice } from '@/hooks/use-price';
import { PROTOCOL } from '@/lib/constants';
import { calculateICR } from '@/lib/utils';

interface VaultMetrics {
  icr: number;
  icrDisplay: string;
  healthStatus: 'safe' | 'warning' | 'danger';
  liquidationPrice: number;
  maxDebt: bigint;
  fee: bigint;
  totalDebt: bigint;
  isValid: boolean;
  validationError: string | null;
}

/**
 * Calculate vault metrics for given collateral and debt
 */
export function useVaultMetrics(
  collateralSats: bigint,
  debtRaw: bigint
): VaultMetrics & { isLoading: boolean } {
  const { data: priceData, isLoading: priceLoading } = usePrice();

  const metrics = useMemo((): VaultMetrics => {
    if (!priceData || collateralSats === 0n) {
      return {
        icr: 0,
        icrDisplay: '--',
        healthStatus: 'safe',
        liquidationPrice: 0,
        maxDebt: 0n,
        fee: 0n,
        totalDebt: 0n,
        isValid: false,
        validationError: null,
      };
    }

    const btcPrice = priceData.price;

    // Calculate fee (0.5% base + 0.5% floor = 1% total for MVP)
    const feeRateBps = BigInt(PROTOCOL.REDEMPTION_FEE_FLOOR_BPS + 50); // 100 bps = 1%
    const fee = (debtRaw * feeRateBps) / 10000n;
    const totalDebt = debtRaw + fee;

    // Calculate ICR: (collateral * price) / debt * 10000
    // collateral is in sats (1e8), price is in USD, debt is in zkUSD (1e8)
    const icr =
      totalDebt > 0n
        ? calculateICR(collateralSats, totalDebt, btcPrice)
        : 0;

    // Determine health status
    let healthStatus: 'safe' | 'warning' | 'danger' = 'safe';
    if (icr > 0 && icr < PROTOCOL.MCR) {
      healthStatus = 'danger';
    } else if (icr > 0 && icr < PROTOCOL.CCR) {
      healthStatus = 'warning';
    }

    // Calculate liquidation price (BTC price at which ICR = MCR)
    // Formula: liquidationPrice = (debt * MCR) / (collateral * 10000)
    // MCR is in basis points (11000 = 110%), so we divide by 10000
    const liquidationPrice =
      collateralSats > 0n && totalDebt > 0n
        ? (Number(totalDebt) * PROTOCOL.MCR) / (Number(collateralSats) * 10000)
        : 0;

    // Calculate max debt at MCR (how much zkUSD can be minted)
    // Formula: maxDebt = (collateral * price * 10000) / MCR
    // This gives the debt in raw units (1e8 scale)
    const maxDebt =
      collateralSats > 0n
        ? BigInt(
            Math.floor(
              (Number(collateralSats) * btcPrice * 10000) / PROTOCOL.MCR
            )
          )
        : 0n;

    // Validation
    let validationError: string | null = null;
    let isValid = true;

    if (debtRaw > 0n && debtRaw < PROTOCOL.MIN_DEBT) {
      validationError = `Minimum debt is ${Number(PROTOCOL.MIN_DEBT) / 1e8} zkUSD`;
      isValid = false;
    } else if (totalDebt > 0n && icr < PROTOCOL.MCR) {
      validationError = `ICR must be at least ${PROTOCOL.MCR / 100}%`;
      isValid = false;
    } else if (collateralSats > 0n && debtRaw === 0n) {
      validationError = 'Enter debt amount';
      isValid = false;
    }

    return {
      icr,
      icrDisplay: icr > 0 ? `${(icr / 100).toFixed(1)}%` : '--',
      healthStatus,
      liquidationPrice,
      maxDebt,
      fee,
      totalDebt,
      isValid: isValid && debtRaw > 0n && collateralSats > 0n,
      validationError,
    };
  }, [priceData, collateralSats, debtRaw]);

  return { ...metrics, isLoading: priceLoading };
}
