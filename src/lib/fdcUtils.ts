// FDC (Flare Data Connector) utility functions
// Taken from the this guide https://dev.flare.network/fdc/guides/fdc-by-hand

import {
  iFdcRequestFeeConfigurationsAbi,
  iFlareSystemsManagerAbi,
  iPaymentVerificationAbi,
  iReferencedPaymentNonexistenceVerificationAbi,
} from '@/generated';
import { publicClient } from '@/lib/publicClient';
import { toHex } from '@/lib/utils';

// Type definitions based on generated ABI structures
export type PaymentRequestBody = {
  transactionId: string;
  inUtxo: string;
  utxo: string;
};

export type ReferencedPaymentNonexistenceRequestBody = {
  minimalBlockNumber: string;
  deadlineBlockNumber: string;
  deadlineTimestamp: string;
  destinationAddressHash: string;
  amount: string;
  standardPaymentReference: string;
  checkSourceAddresses: boolean;
  sourceAddressesRoot: string;
};

// Proof data types for each attestation type
export type PaymentProofData = {
  response: {
    attestationType: `0x${string}`;
    sourceId: `0x${string}`;
    votingRound: string;
    lowestUsedTimestamp: string;
    requestBody: {
      transactionId: `0x${string}`;
      inUtxo: string;
      utxo: string;
    };
    responseBody: {
      blockNumber: string;
      blockTimestamp: string;
      sourceAddressHash: `0x${string}`;
      sourceAddressesRoot: `0x${string}`;
      receivingAddressHash: `0x${string}`;
      intendedReceivingAddressHash: `0x${string}`;
      spentAmount: string;
      intendedSpentAmount: string;
      receivedAmount: string;
      intendedReceivedAmount: string;
      standardPaymentReference: `0x${string}`;
      oneToOne: boolean;
      status: number;
    };
  };
  proof: `0x${string}`[];
};

export type ReferencedPaymentNonexistenceProofData = {
  response: {
    attestationType: `0x${string}`;
    sourceId: `0x${string}`;
    votingRound: string;
    lowestUsedTimestamp: string;
    requestBody: {
      minimalBlockNumber: string;
      deadlineBlockNumber: string;
      deadlineTimestamp: string;
      destinationAddressHash: `0x${string}`;
      amount: string;
      standardPaymentReference: `0x${string}`;
      checkSourceAddresses: boolean;
      sourceAddressesRoot: `0x${string}`;
    };
    responseBody: {
      minimalBlockTimestamp: string;
      firstOverflowBlockNumber: string;
      firstOverflowBlockTimestamp: string;
    };
  };
  proof: `0x${string}`[];
};

// Sleep utility function
export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

// Post request to DA Layer
export const postRequestToDALayer = async (
  url: string,
  request: Record<string, unknown>,
  apiKey: string
) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(
      `DA Layer request failed: ${response.status} ${response.statusText}`
    );
  }

  return await response.json();
};

// Generic function to retrieve data and proof for any attestation type
export const retrieveDataAndProof = async <
  T extends PaymentProofData | ReferencedPaymentNonexistenceProofData,
>(
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string
): Promise<T> => {
  console.log('Waiting for the round to finalize...');

  // Wait for round finalization (simplified - just wait a bit)
  await sleep(30000);
  console.log('Round finalized!\n');

  const request = {
    votingRoundId: roundId,
    requestBytes: abiEncodedRequest,
  };
  console.log('Prepared request:\n', request, '\n');

  await sleep(10000);
  let proof = await postRequestToDALayer(url, request, apiKey);
  console.log('Waiting for the DA Layer to generate the proof...');

  // If we get a successful response with proof data, return immediately
  if (proof.response && proof.proof && Array.isArray(proof.proof)) {
    console.log('Proof generated on first attempt!\n');
    console.log('Proof:', proof, '\n');
    return proof as T;
  }

  // Only retry if we don't have the proof data yet
  while (!proof.response || !proof.proof || !Array.isArray(proof.proof)) {
    await sleep(10000);
    proof = await postRequestToDALayer(url, request, apiKey);

    // If we get a successful response with proof data, break out of the loop
    if (proof.response && proof.proof && Array.isArray(proof.proof)) {
      break;
    }
  }
  console.log('Proof generated!\n');

  console.log('Proof:', proof, '\n');
  return proof as T;
};

// Type-safe wrapper functions for specific attestation types
export const retrievePaymentDataAndProof = async (
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string
): Promise<PaymentProofData> => {
  return retrieveDataAndProof<PaymentProofData>(
    url,
    abiEncodedRequest,
    roundId,
    apiKey
  );
};

export const retrieveReferencedPaymentNonexistenceDataAndProof = async (
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string
): Promise<ReferencedPaymentNonexistenceProofData> => {
  return retrieveDataAndProof<ReferencedPaymentNonexistenceProofData>(
    url,
    abiEncodedRequest,
    roundId,
    apiKey
  );
};

// Generic retry wrapper function
export const retrieveDataAndProofWithRetry = async <
  T extends PaymentProofData | ReferencedPaymentNonexistenceProofData,
>(
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string,
  attempts: number = 10
): Promise<T> => {
  for (let i = 0; i < attempts; i++) {
    try {
      return await retrieveDataAndProof<T>(
        url,
        abiEncodedRequest,
        roundId,
        apiKey
      );
    } catch (error) {
      console.log(error, '\n', 'Remaining attempts:', attempts - i, '\n');
      await sleep(20000);
    }
  }
  throw new Error(
    `Failed to retrieve data and proofs after ${attempts} attempts`
  );
};

// Type-safe retry wrapper functions for specific attestation types
export const retrievePaymentDataAndProofWithRetry = async (
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  apiKey: string,
  attempts: number = 10
): Promise<PaymentProofData> => {
  return retrieveDataAndProofWithRetry<PaymentProofData>(
    url,
    abiEncodedRequest,
    roundId,
    apiKey,
    attempts
  );
};

export const retrieveReferencedPaymentNonexistenceDataAndProofWithRetry =
  async (
    url: string,
    abiEncodedRequest: string,
    roundId: number,
    apiKey: string,
    attempts: number = 10
  ): Promise<ReferencedPaymentNonexistenceProofData> => {
    return retrieveDataAndProofWithRetry<ReferencedPaymentNonexistenceProofData>(
      url,
      abiEncodedRequest,
      roundId,
      apiKey,
      attempts
    );
  };

// Calculate round ID from transaction
export const calculateRoundId = async (
  transaction: { receipt: { blockNumber: bigint } },
  fdcAddresses: { flareSystemsManager: string }
) => {
  if (!fdcAddresses?.flareSystemsManager) {
    throw new Error('Flare Systems Manager address not loaded');
  }

  const blockNumber = transaction.receipt.blockNumber;
  const block = await publicClient.getBlock({ blockNumber });
  const blockTimestamp = BigInt(block.timestamp);

  const firsVotingRoundStartTs = BigInt(
    await publicClient.readContract({
      address: fdcAddresses.flareSystemsManager as `0x${string}`,
      abi: iFlareSystemsManagerAbi,
      functionName: 'firstVotingRoundStartTs',
    })
  );

  const votingEpochDurationSeconds = BigInt(
    await publicClient.readContract({
      address: fdcAddresses.flareSystemsManager as `0x${string}`,
      abi: iFlareSystemsManagerAbi,
      functionName: 'votingEpochDurationSeconds',
    })
  );

  console.log('Block timestamp:', blockTimestamp, '\n');
  console.log('First voting round start ts:', firsVotingRoundStartTs, '\n');
  console.log(
    'Voting epoch duration seconds:',
    votingEpochDurationSeconds,
    '\n'
  );

  const roundId = Number(
    (blockTimestamp - firsVotingRoundStartTs) / votingEpochDurationSeconds
  );
  console.log('Calculated round id:', roundId, '\n');

  const currentVotingEpochId = Number(
    await publicClient.readContract({
      address: fdcAddresses.flareSystemsManager as `0x${string}`,
      abi: iFlareSystemsManagerAbi,
      functionName: 'getCurrentVotingEpochId',
    })
  );
  console.log('Received round id:', currentVotingEpochId, '\n');

  return roundId;
};

// Get FDC request fee
export const getFdcRequestFee = async (
  abiEncodedRequest: string,
  fdcAddresses: { fdcRequestFeeConfigurations: string }
) => {
  if (!fdcAddresses?.fdcRequestFeeConfigurations) {
    throw new Error('FDC Request Fee Configurations address not loaded');
  }

  return await publicClient.readContract({
    address: fdcAddresses.fdcRequestFeeConfigurations as `0x${string}`,
    abi: iFdcRequestFeeConfigurationsAbi,
    functionName: 'getRequestFee',
    args: [abiEncodedRequest as `0x${string}`],
  });
};

// FDC constants
export const FDC_CONSTANTS = {
  VERIFIER_URL_TESTNET: 'https://fdc-verifiers-testnet.flare.network/',
  VERIFIER_API_KEY_TESTNET: '00000000-0000-0000-0000-000000000000',
  DA_LAYER_API_KEY: '00000000-0000-0000-0000-000000000000',
  DA_LAYER_API_URL: `/api/proof-request`,
  URL_TYPE_BASE: 'xrp',
  SOURCE_ID_BASE: 'testXRP',
} as const;

// Base function to prepare attestation request
export const prepareAttestationRequestBase = async (
  url: string,
  apiKey: string,
  attestationTypeBase: string,
  sourceIdBase: string,
  requestBody: PaymentRequestBody | ReferencedPaymentNonexistenceRequestBody
) => {
  console.log('Url:', url, '\n');
  const attestationType = toHex(attestationTypeBase);
  const sourceId = toHex(sourceIdBase);

  const request = {
    attestationType: attestationType,
    sourceId: sourceId,
    requestBody: requestBody,
  };
  console.log('Prepared request:\n', request, '\n');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (response.status != 200) {
    throw new Error(
      `Response status is not OK, status ${response.status} ${response.statusText}\n`
    );
  }
  console.log('Response status is OK\n');

  return await response.json();
};

// Prepare Payment attestation request
export const preparePaymentAttestationRequest = async (
  transactionId: string,
  inUtxo: string = '0',
  utxo: string = '0'
) => {
  const requestBody: PaymentRequestBody = {
    transactionId: transactionId,
    inUtxo: inUtxo,
    utxo: utxo,
  };

  const url = `${FDC_CONSTANTS.VERIFIER_URL_TESTNET}verifier/${FDC_CONSTANTS.URL_TYPE_BASE}/Payment/prepareRequest`;
  const apiKey = FDC_CONSTANTS.VERIFIER_API_KEY_TESTNET ?? '';

  return await prepareAttestationRequestBase(
    url,
    apiKey,
    'Payment',
    FDC_CONSTANTS.SOURCE_ID_BASE,
    requestBody
  );
};

// Prepare ReferencedPaymentNonexistence attestation request
export const prepareReferencedPaymentNonexistenceAttestationRequest = async (
  data: ReferencedPaymentNonexistenceRequestBody
) => {
  const requestBody: ReferencedPaymentNonexistenceRequestBody = {
    minimalBlockNumber: data.minimalBlockNumber,
    deadlineBlockNumber: data.deadlineBlockNumber,
    deadlineTimestamp: data.deadlineTimestamp,
    destinationAddressHash: data.destinationAddressHash,
    amount: data.amount,
    standardPaymentReference: data.standardPaymentReference,
    checkSourceAddresses: data.checkSourceAddresses,
    sourceAddressesRoot: data.sourceAddressesRoot,
  };

  const url = `${FDC_CONSTANTS.VERIFIER_URL_TESTNET}verifier/${FDC_CONSTANTS.URL_TYPE_BASE}/ReferencedPaymentNonexistence/prepareRequest`;
  const apiKey = FDC_CONSTANTS.VERIFIER_API_KEY_TESTNET ?? '';

  return await prepareAttestationRequestBase(
    url,
    apiKey,
    'ReferencedPaymentNonexistence',
    FDC_CONSTANTS.SOURCE_ID_BASE,
    requestBody
  );
};

// Verify Payment using FDC Verification contract
export const verifyPayment = async (
  proofData: PaymentProofData,
  fdcAddresses: { fdcVerification: string }
) => {
  if (!fdcAddresses?.fdcVerification) {
    throw new Error('FDC Verification address not loaded');
  }

  if (!proofData.response || !proofData.proof) {
    throw new Error('Proof data is incomplete');
  }

  // Extract data from proof response
  const response = proofData.response;
  const proof = proofData.proof;

  // Call verifyPayment function
  const result = await publicClient.readContract({
    address: fdcAddresses.fdcVerification as `0x${string}`,
    abi: iPaymentVerificationAbi,
    functionName: 'verifyPayment',
    args: [
      {
        merkleProof: proof,
        data: {
          attestationType: response.attestationType,
          sourceId: response.sourceId,
          votingRound: BigInt(response.votingRound),
          lowestUsedTimestamp: BigInt(response.lowestUsedTimestamp),
          requestBody: {
            transactionId: response.requestBody.transactionId,
            inUtxo: BigInt(response.requestBody.inUtxo),
            utxo: BigInt(response.requestBody.utxo),
          },
          responseBody: {
            blockNumber: BigInt(response.responseBody.blockNumber),
            blockTimestamp: BigInt(response.responseBody.blockTimestamp),
            sourceAddressHash: response.responseBody.sourceAddressHash,
            sourceAddressesRoot: response.responseBody.sourceAddressesRoot,
            receivingAddressHash: response.responseBody.receivingAddressHash,
            intendedReceivingAddressHash:
              response.responseBody.intendedReceivingAddressHash,
            spentAmount: BigInt(response.responseBody.spentAmount),
            intendedSpentAmount: BigInt(
              response.responseBody.intendedSpentAmount
            ),
            receivedAmount: BigInt(response.responseBody.receivedAmount),
            intendedReceivedAmount: BigInt(
              response.responseBody.intendedReceivedAmount
            ),
            standardPaymentReference:
              response.responseBody.standardPaymentReference,
            oneToOne: response.responseBody.oneToOne,
            status: response.responseBody.status,
          },
        },
      },
    ],
  });

  console.log('Payment verification result:', result);
  return result;
};

// Verify ReferencedPaymentNonexistence using FDC Verification contract
export const verifyReferencedPaymentNonexistence = async (
  proofData: ReferencedPaymentNonexistenceProofData,
  fdcAddresses: { fdcVerification: string }
) => {
  if (!fdcAddresses?.fdcVerification) {
    throw new Error('FDC Verification address not loaded');
  }

  if (!proofData.response || !proofData.proof) {
    throw new Error('Proof data is incomplete');
  }

  // Extract data from proof response
  const response = proofData.response;
  const proof = proofData.proof;

  // Call verifyReferencedPaymentNonexistence function
  const result = await publicClient.readContract({
    address: fdcAddresses.fdcVerification as `0x${string}`,
    abi: iReferencedPaymentNonexistenceVerificationAbi,
    functionName: 'verifyReferencedPaymentNonexistence',
    args: [
      {
        merkleProof: proof,
        data: {
          attestationType: response.attestationType,
          sourceId: response.sourceId,
          votingRound: BigInt(response.votingRound),
          lowestUsedTimestamp: BigInt(response.lowestUsedTimestamp),
          requestBody: {
            minimalBlockNumber: BigInt(response.requestBody.minimalBlockNumber),
            deadlineBlockNumber: BigInt(
              response.requestBody.deadlineBlockNumber
            ),
            deadlineTimestamp: BigInt(response.requestBody.deadlineTimestamp),
            destinationAddressHash: response.requestBody.destinationAddressHash,
            amount: BigInt(response.requestBody.amount),
            standardPaymentReference:
              response.requestBody.standardPaymentReference,
            checkSourceAddresses: response.requestBody.checkSourceAddresses,
            sourceAddressesRoot: response.requestBody.sourceAddressesRoot,
          },
          responseBody: {
            minimalBlockTimestamp: BigInt(
              response.responseBody.minimalBlockTimestamp
            ),
            firstOverflowBlockNumber: BigInt(
              response.responseBody.firstOverflowBlockNumber
            ),
            firstOverflowBlockTimestamp: BigInt(
              response.responseBody.firstOverflowBlockTimestamp
            ),
          },
        },
      },
    ],
  });

  console.log('ReferencedPaymentNonexistence verification result:', result);
  return result;
};

// Submit attestation request to FDC Hub
export const submitAttestationRequest = async (
  abiEncodedRequest: string,
  fdcAddresses: { fdcHub: string; fdcRequestFeeConfigurations: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestAttestation: any
): Promise<void> => {
  if (!fdcAddresses?.fdcHub) {
    throw new Error('FDC Hub address not loaded');
  }

  console.log('Submitting attestation request:', abiEncodedRequest);

  // Get the request fee
  const requestFee = await getFdcRequestFee(abiEncodedRequest, fdcAddresses);
  console.log('Request fee:', requestFee);

  // Submit the attestation request
  requestAttestation({
    address: fdcAddresses.fdcHub as `0x${string}`,
    args: [abiEncodedRequest as `0x${string}`],
    value: requestFee,
  });
};
