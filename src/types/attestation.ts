/**
 * Types and interfaces for XRP Payment Attestation
 */

export interface AttestationData {
  abiEncodedRequest: string;
  roundId: number | null;
}

export interface ProofData {
  response_hex: string;
  proof: unknown;
}

export interface DecodedResponse {
  transactionId: string;
  inUtxo: string;
  utxo: string;
  amount: string;
  sourceAddress: string;
  receivingAddress: string;
  blockNumber: number;
  timestamp: number;
}
