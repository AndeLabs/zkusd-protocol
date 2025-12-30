'use client';

import { useMemo } from 'react';
import { calculateICR, calculateLiquidationPrice, calculateMaxMintable } from '@zkusd/utils';

interface VaultCalculationsParams {
  collateral: bigint;
  debt: bigint;
  price: bigint;
}

interface VaultCalculations {
  icr: number;
  liquidationPrice: bigint;
  maxMintable: bigint;
  collateralValue: bigint;
  isHealthy: boolean;
  isAtRisk: boolean;
  isLiquidatable: boolean;
  healthStatus: 'healthy' | 'at-risk' | 'liquidatable';
}

/**
 * Hook for calculating vault health metrics
 * Centralizes all vault calculation logic
 */
export function useVaultCalculations({
  collateral,
  debt,
  price,
}: VaultCalculationsParams): VaultCalculations {
  return useMemo(() => {
    if (price === 0n || collateral === 0n) {
      return {
        icr: 0,
        liquidationPrice: 0n,
        maxMintable: 0n,
        collateralValue: 0n,
        isHealthy: false,
        isAtRisk: false,
        isLiquidatable: false,
        healthStatus: 'liquidatable' as const,
      };
    }

    const icr = calculateICR(collateral, debt, price);
    const liquidationPrice = calculateLiquidationPrice(collateral, debt);
    const maxMintable = calculateMaxMintable(collateral, price, debt);
    const collateralValue = (collateral * price) / 100_000_000n;

    const isLiquidatable = icr < 11000;
    const isAtRisk = icr >= 11000 && icr < 15000;
    const isHealthy = icr >= 15000;

    const healthStatus = isLiquidatable
      ? 'liquidatable' as const
      : isAtRisk
        ? 'at-risk' as const
        : 'healthy' as const;

    return {
      icr,
      liquidationPrice,
      maxMintable,
      collateralValue,
      isHealthy,
      isAtRisk,
      isLiquidatable,
      healthStatus,
    };
  }, [collateral, debt, price]);
}

/**
 * Calculate collateral needed for a target ICR
 */
export function calculateCollateralForICR(
  debt: bigint,
  price: bigint,
  targetIcr: number // in basis points
): bigint {
  if (price === 0n || debt === 0n) return 0n;
  // collateral = (debt * targetIcr) / (price * 100)
  return (debt * BigInt(targetIcr)) / (price * 100n);
}

/**
 * Calculate max debt for given collateral and target ICR
 */
export function calculateMaxDebtForICR(
  collateral: bigint,
  price: bigint,
  targetIcr: number // in basis points
): bigint {
  if (price === 0n || targetIcr === 0) return 0n;
  // debt = (collateral * price * 100) / targetIcr
  return (collateral * price * 100n) / BigInt(targetIcr);
}
