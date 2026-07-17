/**
 * Types and interfaces for XRPPayment attestation
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
  proofOwner: string;
  amount: string;
  sourceAddress: string;
  receivingAddressHash: string;
  hasMemoData: boolean;
  firstMemoData: string;
  hasDestinationTag: boolean;
  destinationTag: string;
  blockNumber: number;
  blockTimestamp: number;
  status: number;
}
