/** On-chain UTXO verification result */
export interface UtxoVerification {
  utxoId: string;
  isLive: boolean;
  value: number;
  spentBy?: string;
  checkedAt: number;
}

/** Deployed contract with on-chain verification */
export interface VerifiedContract {
  name: string;
  version: string;
  description: string;
  appId: string;
  vk: string;
  stateUtxo: string;
  deployTxId: string;
  verification: UtxoVerification | null;
  deployConfirmed: boolean;
  deployBlock?: number;
  deployTime?: number;
}

/** Protocol transaction with on-chain data */
export interface ProtocolTransaction {
  txid: string;
  type: 'deploy' | 'set-minter' | 'mint';
  label: string;
  confirmed: boolean;
  blockHeight?: number;
  blockTime?: number;
  confirmations: number;
  fee: number;
  collateralSats?: number;
  zkusdMinted?: bigint;
  vaultId?: string;
  source: 'protocol' | 'user';
}

/** Protocol-level statistics */
export interface ProtocolStats {
  totalSupply: bigint;
  totalCollateral: number;
  totalDebt: bigint;
  activeVaults: number;
  baseRateBps: number;
  lastFeeBlock: number;
  contractsDeployed: number;
}

/** Static contract metadata for explorer display */
export interface ExplorerContract {
  name: string;
  key: string;
  appId: string;
  vk: string;
  version: string;
  stateUtxo: string;
  deployTxId: string;
  description: string;
}

/** Static transaction metadata */
export interface ExplorerTx {
  txid: string;
  type: 'deploy' | 'set-minter' | 'mint';
  label: string;
}
