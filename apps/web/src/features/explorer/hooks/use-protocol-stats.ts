'use client';

import { usePrice } from '@/hooks/use-price';
import { TESTNET4_CONFIG } from '@zkusd/config';
import { useMemo } from 'react';
import type { ProtocolStats } from '../types';

export function useProtocolStats() {
  const { data: priceData } = usePrice();

  const stats = useMemo<ProtocolStats>(() => {
    const ps = TESTNET4_CONFIG.protocolState;
    return {
      totalSupply: ps ? BigInt(ps.tokenTotalSupply) : 0n,
      totalCollateral: ps?.totalCollateral ?? 0,
      totalDebt: ps ? BigInt(ps.totalDebt) : 0n,
      activeVaults: ps?.activeVaultCount ?? 0,
      baseRateBps: ps?.baseRate ?? 50,
      lastFeeBlock: ps?.lastFeeUpdateBlock ?? 0,
      contractsDeployed: 4,
    };
  }, []);

  const collateralValueUsd = useMemo(() => {
    if (!priceData) return 0;
    // collateral is in sats, price is in USD
    return (stats.totalCollateral / 1e8) * priceData.price;
  }, [stats.totalCollateral, priceData]);

  const systemCR = useMemo(() => {
    if (stats.totalDebt === 0n) return 0;
    // totalDebt is in 8-decimal format, convert to USD
    const debtUsd = Number(stats.totalDebt) / 1e8;
    if (debtUsd === 0) return 0;
    return (collateralValueUsd / debtUsd) * 100;
  }, [stats.totalDebt, collateralValueUsd]);

  return { stats, collateralValueUsd, systemCR };
}
