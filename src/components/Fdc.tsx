'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  XCircle,
} from 'lucide-react';

import { createPublicClient, http } from 'viem';
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { flareTestnet } from 'wagmi/chains';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  iFdcRequestFeeConfigurationsAbi,
  useWriteIFdcHubRequestAttestation,
} from '@/generated';
import { useFdcContracts } from '@/hooks/useFdcContracts';
import { copyToClipboardWithTimeout } from '@/lib/clipboard';
import {
  calculateRoundId,
  FDC_CONSTANTS,
  retrievePaymentDataAndProofWithRetry,
  verifyPayment,
} from '@/lib/fdcUtils';

// Form data types
const FdcFormDataSchema = z.object({
  transactionId: z
    .string()
    .min(1, 'Transaction ID is required')
    .refine(
      val => /^[A-F0-9]{64}$/i.test(val.trim()),
      'Transaction ID must be a valid 64-character hexadecimal XRPL transaction ID'
    ),
});

type FdcFormData = z.infer<typeof FdcFormDataSchema>;

interface FdcStep {
  id: string;
  title: string;
  description: string | React.ReactNode;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  data?: Record<string, unknown>;
  error?: string;
  details?: {
    whatHappens: string;
    technicalDetails: string;
    apiEndpoint?: string | React.ReactNode;
    requestBody?: Record<string, unknown>;
    responseBody?: Record<string, unknown>;
    curlCommand?: string;
  };
}

export default function Fdc() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FdcFormData>({
    resolver: zodResolver(FdcFormDataSchema),
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [currentAttestationData, setCurrentAttestationData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [currentAttestationStep, setCurrentAttestationStep] =
    useState<string>('');
  const [proofData, setProofData] = useState<Record<string, unknown> | null>(
    null
  );
  const [verificationResult, setVerificationResult] = useState<Record<
    string,
    unknown
  > | null>(null);

  // Wallet and FDC contracts
  const { isConnected, address } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const wagmiPublicClient = usePublicClient();

  // Handle hydration mismatch
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Create a fallback public client using wagmi
  const fallbackPublicClient = createPublicClient({
    chain: flareTestnet,
    transport: http(),
  });
  const {
    addresses: fdcAddresses,
    isLoading: isLoadingAddresses,
    error: addressError,
  } = useFdcContracts();

  // Write contract with requestAttestation function
  const {
    writeContract: requestAttestation,
    writeContractAsync: requestAttestationAsync,
    data: attestationHash,
    error: writeError,
  } = useWriteIFdcHubRequestAttestation();

  // Wait for transaction receipt
  const { data: receipt, isSuccess: isAttestationSuccess } =
    useWaitForTransactionReceipt({ hash: attestationHash });

  const updateStepStatus = useCallback(
    (
      stepId: string,
      status: FdcStep['status'],
      data?: Record<string, unknown>,
      error?: string
    ) => {
      setSteps(prev =>
        prev.map(step =>
          step.id === stepId ? { ...step, status, data, error } : step
        )
      );
    },
    []
  );

  const continueWorkflowAfterSubmission = useCallback(
    async (transactionReceipt: any) => {
      try {
        // Step 3: Wait for Finalization (calculate round ID)
        updateStepStatus('wait-finalization', 'in_progress');
        setCurrentAttestationStep('Calculating round ID from transaction...');

        if (!fdcAddresses || !transactionReceipt || !currentAttestationData) {
          throw new Error('Missing required data for round ID calculation');
        }

        // Calculate the round ID from the transaction
        const roundId = await calculateRoundId(
          { receipt: { blockNumber: transactionReceipt.blockNumber } },
          fdcAddresses
        );

        console.log('Calculated round ID:', roundId);

        // Update step to show we're waiting for finalization
        updateStepStatus('wait-finalization', 'in_progress', {
          message: `Waiting for voting round ${roundId} to be finalized...`,
          roundId: roundId,
        });

        // Wait for the voting round to be finalized
        setCurrentAttestationStep(
          `Waiting for voting round ${roundId} to be finalized...`
        );

        // Wait for finalization (simplified - in implementation this would poll the Systems Manager)
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds for finalization

        console.log('Voting round finalized!');
        setCurrentAttestationStep('');

        updateStepStatus('wait-finalization', 'completed', {
          message: 'Voting round finalized',
          roundId: roundId,
        });

        // Step 4: Prepare Proof Request (retrieve from DAL)
        updateStepStatus('prepare-proof', 'in_progress');
        setCurrentAttestationStep(
          'Retrieving proof from Data Availability Layer...'
        );

        const proof = await retrievePaymentDataAndProofWithRetry(
          FDC_CONSTANTS.DA_LAYER_API_URL,
          currentAttestationData.abiEncodedRequest as string,
          roundId,
          FDC_CONSTANTS.DA_LAYER_API_KEY
        );

        setProofData(proof);

        console.log('=== Proof data retrieved ===');
        console.log('Proof data:', proof);
        console.log('Proof response:', proof.response);
        console.log('Proof responseBody:', proof.response?.responseBody);

        updateStepStatus('prepare-proof', 'completed', {
          message: 'Proof retrieved from Data Availability Layer',
          proof: proof.proof,
        });

        // Step 5: Verify Data (verify with FDC contract)
        updateStepStatus('verify-data', 'in_progress');
        setCurrentAttestationStep(
          'Verifying payment attestation with FDC Verification contract...'
        );

        if (!fdcAddresses) {
          throw new Error('FDC contract addresses not loaded');
        }

        // Validate proof data before verification
        if (!proof || !proof.response || !proof.proof) {
          throw new Error('Proof data is incomplete');
        }

        console.log('=== Validating proof data before verification ===');
        console.log('Proof response fields:', Object.keys(proof.response));
        console.log(
          'Proof responseBody fields:',
          Object.keys(proof.response.responseBody || {})
        );

        // Check for undefined values that would cause BigInt conversion errors
        const responseBody = proof.response.responseBody;
        const requiredFields: (keyof typeof responseBody)[] = [
          'blockNumber',
          'blockTimestamp',
          'spentAmount',
          'intendedSpentAmount',
          'receivedAmount',
          'intendedReceivedAmount',
        ];

        for (const field of requiredFields) {
          if (
            responseBody[field] === undefined ||
            responseBody[field] === null
          ) {
            console.error(
              `Missing or undefined field: ${field}`,
              responseBody[field]
            );
            throw new Error(`Proof data is missing required field: ${field}`);
          }
        }

        const verificationResult = await verifyPayment(proof, fdcAddresses);

        console.log('=== Payment verification result ===');
        console.log('Verification result:', verificationResult);
        console.log('Verification result type:', typeof verificationResult);

        setVerificationResult({ verified: verificationResult });

        updateStepStatus('verify-data', 'completed', {
          message: 'Payment attestation verified successfully',
          verificationResult: verificationResult,
          verified: verificationResult,
        });

        setCurrentAttestationStep('');
        setSuccess(
          'FDC workflow completed successfully! All steps have been executed.'
        );
      } catch (error) {
        console.error('Error in workflow continuation:', error);
        setCurrentAttestationStep('');
        setError(
          error instanceof Error ? error.message : 'Unknown error occurred'
        );
      }
    },
    [
      fdcAddresses,
      currentAttestationData,
      updateStepStatus,
      setCurrentAttestationStep,
      setProofData,
      setVerificationResult,
    ]
  );

  // Handle transaction success
  useEffect(() => {
    if (isAttestationSuccess && receipt && currentAttestationData) {
      updateStepStatus('submit-request', 'completed', {
        message:
          'Attestation request submitted successfully to FdcHub contract',
        transactionHash: attestationHash,
        blockNumber: receipt.blockNumber,
        abiEncodedRequest: currentAttestationData.abiEncodedRequest,
      });

      // Auto-expand the second step when it completes
      setExpandedSteps(prev => new Set([...prev, 'submit-request']));

      // Continue with the rest of the workflow
      continueWorkflowAfterSubmission(receipt);
    }
  }, [
    isAttestationSuccess,
    receipt,
    currentAttestationData,
    attestationHash,
    continueWorkflowAfterSubmission,
  ]);

  // Handle write contract errors
  useEffect(() => {
    if (writeError) {
      console.error('Write contract error:', writeError);
      updateStepStatus(
        'submit-request',
        'error',
        undefined,
        writeError.message
      );
      setError(`Transaction failed: ${writeError.message}`);
    }
  }, [writeError]);
  const [steps, setSteps] = useState<FdcStep[]>([
    {
      id: 'prepare-request',
      title: '1. Prepare Request',
      description: 'Prepare the attestation request using the verifier API',
      status: 'pending',
      details: {
        whatHappens:
          'We send your transaction ID to the Flare verifier server to create an ABI-encoded request that the FDC can understand.',
        technicalDetails:
          'The verifier validates the transaction ID format and creates a standardized request payload. This includes the attestation type (Payment), source ID (testXRP), and the transaction details.',
        apiEndpoint:
          'https://fdc-verifiers-testnet.flare.network/verifier/xrp/Payment/prepareResponse',
        curlCommand: `curl -X 'POST' \\
  'https://fdc-verifiers-testnet.flare.network/verifier/xrp/Payment/prepareResponse' \\
  -H 'accept: */*' \\
  -H 'X-API-KEY: 00000000-0000-0000-0000-000000000000' \\
  -H 'Content-Type: application/json' \\
  -d '{
  "attestationType": "0x5061796d656e7400000000000000000000000000000000000000000000000000",
  "sourceId": "0x7465737458525000000000000000000000000000000000000000000000000000",
  "requestBody": {
    "transactionId": "YOUR_TRANSACTION_ID",
    "inUtxo": "0",
    "utxo": "0"
  }
}'`,
      },
    },
    {
      id: 'submit-request',
      title: '2. Submit Request',
      description: (
        <>
          Submit the attestation request to the{' '}
          <a
            href='https://dev.flare.network/fdc/reference/IFdcHub#requestattestation'
            target='_blank'
            rel='noopener noreferrer'
            className='hover:opacity-80 underline inline-flex items-center gap-1'
            style={{ color: '#E62058' }}
          >
            FdcHub contract
            <ExternalLink className='h-3 w-3' />
          </a>
        </>
      ),
      status: 'pending',
      details: {
        whatHappens:
          'The ABI-encoded request is submitted to the FdcHub smart contract on the Flare blockchain, along with the required fee.',
        technicalDetails:
          'This creates a transaction on the blockchain that requests the FDC to verify your XRP transaction. The contract stores the request and waits for the next voting round.',
        apiEndpoint: (
          <a
            href='https://dev.flare.network/fdc/reference/IFdcHub#requestattestation'
            target='_blank'
            rel='noopener noreferrer'
            className='hover:opacity-80 underline inline-flex items-center gap-1'
            style={{ color: '#E62058' }}
          >
            FdcHub.requestAttestation() - Smart Contract Call
            <ExternalLink className='h-3 w-3' />
          </a>
        ),
      },
    },
    {
      id: 'wait-finalization',
      title: '3. Wait for Finalization',
      description: 'Wait for the voting round to be finalized',
      status: 'pending',
      details: {
        whatHappens:
          'The FDC validators vote on your request during the voting round. We wait for the round to be finalized before proceeding.',
        technicalDetails:
          'Voting rounds occur every 90 seconds. Validators check the XRPL for your transaction and vote on its validity. We wait for the round to be finalized before retrieving the proof.',
        apiEndpoint:
          'https://coston2-systems-explorer.flare.rocks/voting-round/{roundId}?tab=fdc',
      },
    },
    {
      id: 'prepare-proof',
      title: '4. Prepare Proof Request',
      description:
        'Prepare the proof request using the Data Availability Client',
      status: 'pending',
      details: {
        whatHappens:
          'We retrieve the proof and attestation data from the Data Availability Layer using the finalized voting round ID.',
        technicalDetails:
          'The Data Availability Client provides cryptographic proof that your transaction was verified by the FDC validators. This includes Merkle tree proofs and the attestation response.',
        apiEndpoint:
          'https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round',
        curlCommand: `curl -X 'POST' \\
  'https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round' \\
  -H 'accept: application/json' \\
  -H 'x-api-key: 00000000-0000-0000-0000-000000000000' \\
  -H 'Content-Type: application/json' \\
  -d '{
  "votingRoundId": ROUND_ID,
  "requestBytes": "ABI_ENCODED_REQUEST"
}'`,
      },
    },
    {
      id: 'verify-data',
      title: '5. Verify Data',
      description: (
        <>
          Verify the proof using the{' '}
          <a
            href='https://dev.flare.network/fdc/reference/IFdcVerification#verifypayment'
            target='_blank'
            rel='noopener noreferrer'
            className='hover:opacity-80 underline inline-flex items-center gap-1'
            style={{ color: '#E62058' }}
          >
            FdcVerification contract
            <ExternalLink className='h-3 w-3' />
          </a>
        </>
      ),
      status: 'pending',
      details: {
        whatHappens:
          "The cryptographic proof is verified on-chain using the FdcVerification contract to ensure the payment attestation is valid and hasn't been tampered with.",
        technicalDetails:
          'This final step uses the FdcVerification contract to cryptographically verify that the payment proof is valid and the attestation data is authentic.',
        apiEndpoint: (
          <a
            href='https://dev.flare.network/fdc/reference/IFdcVerification#verifypayment'
            target='_blank'
            rel='noopener noreferrer'
            className='hover:opacity-80 underline inline-flex items-center gap-1'
            style={{ color: '#E62058' }}
          >
            FdcVerification.verifyPayment() - Smart Contract Call
            <ExternalLink className='h-3 w-3' />
          </a>
        ),
      },
    },
  ]);

  const prepareRequest = async (transactionId: string) => {
    try {
      updateStepStatus('prepare-request', 'in_progress');

      const requestBody = {
        attestationType:
          '0x5061796d656e7400000000000000000000000000000000000000000000000000',
        sourceId:
          '0x7465737458525000000000000000000000000000000000000000000000000000',
        requestBody: {
          transactionId: transactionId,
          inUtxo: '0',
          utxo: '0',
        },
      };

      // Try the prepareRequest endpoint first (as per the guide)
      let response = await fetch(
        'https://fdc-verifiers-testnet.flare.network/verifier/xrp/Payment/prepareRequest',
        {
          method: 'POST',
          headers: {
            accept: '*/*',
            'X-API-KEY': '00000000-0000-0000-0000-000000000000',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      // If prepareRequest fails, try prepareResponse as fallback
      if (!response.ok) {
        console.log('prepareRequest failed, trying prepareResponse...');
        response = await fetch(
          'https://fdc-verifiers-testnet.flare.network/verifier/xrp/Payment/prepareResponse',
          {
            method: 'POST',
            headers: {
              accept: '*/*',
              'X-API-KEY': '00000000-0000-0000-0000-000000000000',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }
        );
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Check if the response has the expected structure
      if (!data.abiEncodedRequest) {
        console.error('API response does not contain abiEncodedRequest:', data);
        throw new Error(
          `API response missing abiEncodedRequest. Response: ${JSON.stringify(data)}`
        );
      }

      // Update step with detailed information
      updateStepStatus('prepare-request', 'completed', {
        ...data,
        requestDetails: {
          requestBody,
          responseBody: data,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        },
      });

      return data;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      updateStepStatus('prepare-request', 'error', undefined, errorMessage);
      throw error;
    }
  };

  const executeFdcWorkflow = async (data: FdcFormData) => {
    const transactionId = data.transactionId.trim();

    if (!fdcAddresses) {
      setError('FDC contract addresses not loaded. Please wait and try again.');
      return;
    }

    if (addressError) {
      setError(`Error loading contract addresses: ${addressError}`);
      return;
    }

    if (!isConnected) {
      setError(
        'Please connect your wallet to submit attestation requests to the blockchain.'
      );
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    // Reset all steps to pending
    setSteps(prev =>
      prev.map(step => ({ ...step, status: 'pending' as const }))
    );

    try {
      // Step 1: Prepare Request
      const attestationResponse = await prepareRequest(transactionId);

      console.log('=== executeFdcWorkflow after prepareRequest ===');
      console.log('attestationResponse:', attestationResponse);
      console.log(
        'attestationResponse.abiEncodedRequest:',
        attestationResponse.abiEncodedRequest
      );

      // Store the attestation data for use in the transaction effect
      setCurrentAttestationData(attestationResponse);

      // Step 2: Submit Request (executes FdcHub.requestAttestation)
      updateStepStatus('submit-request', 'in_progress');

      // Submit the attestation request to the blockchain
      await submitAttestationRequestWithWagmi(
        attestationResponse.abiEncodedRequest,
        fdcAddresses,
        requestAttestationAsync
      );

      // The rest of the workflow will continue automatically when the transaction is confirmed
      // via the useEffect that watches for isAttestationSuccess
    } catch (error) {
      console.error('FDC workflow error:', error);
      setError(
        error instanceof Error ? error.message : 'An unexpected error occurred'
      );
      setIsLoading(false);
    }
  };

  const getStepIcon = (status: FdcStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className='h-5 w-5 text-green-600' />;
      case 'in_progress':
        return (
          <Loader2
            className='h-5 w-5 animate-spin'
            style={{ color: '#E62058' }}
          />
        );
      case 'error':
        return <XCircle className='h-5 w-5 text-red-600' />;
      default:
        return (
          <div className='h-5 w-5 rounded-full border-2 border-gray-300' />
        );
    }
  };

  const getStepStatusColor = (status: FdcStep['status']) => {
    switch (status) {
      case 'completed':
        return 'bg-green-50 border-green-200';
      case 'in_progress':
        return 'border-2';
      case 'error':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const toggleStepExpansion = (stepId: string) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stepId)) {
        newSet.delete(stepId);
      } else {
        newSet.add(stepId);
      }
      return newSet;
    });
  };

  // Custom submitAttestationRequest function with fallback publicClient
  const submitAttestationRequestWithWagmi = async (
    abiEncodedRequest: string,
    fdcAddresses: { fdcHub: string; fdcRequestFeeConfigurations: string },
    requestAttestationAsync: any
  ): Promise<void> => {
    if (!abiEncodedRequest) {
      throw new Error('ABI encoded request is undefined or empty');
    }

    if (!fdcAddresses?.fdcHub) {
      throw new Error('FDC Hub address not loaded');
    }

    let requestFee;

    // Try to use wagmi publicClient first, then fallback to wagmi created client
    const clientToUse = wagmiPublicClient || fallbackPublicClient;

    if (clientToUse) {
      try {
        // Get the request fee using the available publicClient
        requestFee = await clientToUse.readContract({
          address: fdcAddresses.fdcRequestFeeConfigurations as `0x${string}`,
          abi: iFdcRequestFeeConfigurationsAbi,
          functionName: 'getRequestFee',
          args: [abiEncodedRequest as `0x${string}`],
        });
        console.log('Request fee from contract:', requestFee);
      } catch (error) {
        console.error('Error getting request fee from contract:', error);
        // Fallback to a default fee if contract call fails
        requestFee = BigInt('1000000000000000000'); // 1 FLR in wei
        console.log('Using fallback request fee:', requestFee);
      }
    } else {
      // Fallback to a default fee if no public client available
      requestFee = BigInt('1000000000000000000'); // 1 FLR in wei
      console.log(
        'No public client available, using fallback request fee:',
        requestFee
      );
    }

    // Submit the attestation request
    await requestAttestationAsync({
      address: fdcAddresses.fdcHub as `0x${string}`,
      args: [abiEncodedRequest as `0x${string}`],
      value: requestFee,
    });
  };

  return (
    <div className='w-full max-w-6xl mx-auto p-6 space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle
            className='flex items-center gap-2'
            style={{ color: '#E62058' }}
          >
            <CheckCircle className='h-5 w-5' style={{ color: '#E62058' }} />
            <a
              href='https://dev.flare.network/fdc/overview'
              target='_blank'
              rel='noopener noreferrer'
              className='underline inline-flex items-center gap-1'
              style={{ color: '#E62058' }}
            >
              Flare Data Connector (FDC)
              <ExternalLink className='h-4 w-4' />
            </a>
            Workflow
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className='mb-6' style={{ color: '#E62058' }}>
            Execute the complete FDC workflow as described in the{' '}
            <a
              href='https://dev.flare.network/fdc/guides/fdc-by-hand/'
              target='_blank'
              rel='noopener noreferrer'
              className='underline inline-flex items-center gap-1'
              style={{ color: '#E62058' }}
            >
              FDC by hand guide
              <ExternalLink className='h-3 w-3' />
            </a>
            . This demonstrates the step-by-step process of preparing requests,
            submitting to the blockchain, and verifying data.
          </p>

          <div
            className='rounded-lg p-4 mb-6'
            style={{
              backgroundColor: '#fef7f0',
              borderColor: '#E62058',
              borderWidth: '1px',
              borderStyle: 'solid',
            }}
          >
            <h4 className='font-medium mb-2' style={{ color: '#E62058' }}>
              💡 How to use this tutorial:
            </h4>
            <ul className='text-sm space-y-1' style={{ color: '#E62058' }}>
              <li>
                • Enter a valid XRPL transaction ID (64-character hex string)
              </li>
              <li>
                • Click &quot;Execute FDC Workflow&quot; to start the tutorial
              </li>
              <li>
                • Click &quot;Show Details&quot; on any step to see technical
                explanations and cURL commands
              </li>
              <li>
                • Use the copy buttons to copy important data like ABI encoded
                requests and proofs
              </li>
            </ul>
          </div>

          {/* Wallet Connection Section */}
          <div
            className='space-y-4 p-4 border rounded-lg mb-6'
            style={{ backgroundColor: '#fef7f0', borderColor: '#E62058' }}
          >
            <h3 className='text-lg font-semibold' style={{ color: '#E62058' }}>
              🔗 Wallet Connection
            </h3>

            {!isHydrated ? (
              <div className='space-y-3'>
                <p className='text-sm' style={{ color: '#E62058' }}>
                  Loading wallet connection...
                </p>
              </div>
            ) : !isConnected ? (
              <div className='space-y-3'>
                <p className='text-sm' style={{ color: '#E62058' }}>
                  Connect your MetaMask wallet to interact with the Flare Data
                  Connector.
                </p>
                <div className='flex flex-wrap gap-2'>
                  {connectors.map(connector => (
                    <Button
                      key={connector.uid}
                      onClick={() => connect({ connector })}
                      disabled={isPending}
                      className='flex items-center gap-2'
                      style={{ backgroundColor: '#E62058', color: 'white' }}
                    >
                      {isPending ? (
                        <Loader2 className='h-4 w-4 animate-spin' />
                      ) : (
                        <span>🔗</span>
                      )}
                      Connect {connector.name}
                    </Button>
                  ))}
                </div>
                <p className='text-xs text-gray-600'>
                  Make sure you&apos;re connected to Flare Coston2 testnet in
                  MetaMask
                </p>
              </div>
            ) : (
              <div className='space-y-3'>
                <div className='flex items-center gap-2'>
                  <span
                    className='text-sm font-medium'
                    style={{ color: '#E62058' }}
                  >
                    ✅ Connected
                  </span>
                </div>
                <div className='text-sm text-gray-700'>
                  <p>
                    <strong>Address:</strong> {address}
                  </p>
                  <p>
                    <strong>Network:</strong> Flare Coston2 Testnet
                  </p>
                </div>
                <Button
                  onClick={() => disconnect()}
                  variant='outline'
                  size='sm'
                  style={{ borderColor: '#E62058', color: '#E62058' }}
                >
                  Disconnect
                </Button>
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit(executeFdcWorkflow)}
            className='space-y-6'
          >
            <div className='space-y-2'>
              <Label htmlFor='transactionId' style={{ color: '#E62058' }}>
                XRPL Transaction ID
              </Label>
              <Input
                {...register('transactionId')}
                id='transactionId'
                placeholder='4545d31710bd3d66772ee6bdefca44c0c029b167d60ec5fe032fea9bbd886cde'
                defaultValue=''
                className={`border-gray-300 focus:ring-2 focus:ring-opacity-50 ${
                  errors.transactionId
                    ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                    : ''
                }`}
                style={
                  {
                    borderColor: errors.transactionId ? undefined : '#E62058',
                    '--tw-ring-color': '#E62058',
                  } as React.CSSProperties
                }
              />
              {errors.transactionId && (
                <p className='text-sm text-red-600'>
                  {errors.transactionId.message}
                </p>
              )}
            </div>

            {isLoadingAddresses && (
              <Alert
                className='border'
                style={{
                  backgroundColor: '#fef7f0',
                  borderColor: '#E62058',
                  color: '#E62058',
                }}
              >
                <AlertDescription>
                  <div className='flex items-center gap-2'>
                    <Loader2 className='h-4 w-4 animate-spin' />
                    Loading FDC contract addresses...
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {addressError && (
              <Alert variant='destructive'>
                <XCircle className='h-4 w-4' />
                <AlertDescription>
                  Error loading contract addresses: {addressError}
                </AlertDescription>
              </Alert>
            )}

            {!isConnected && !isLoadingAddresses && (
              <Alert className='bg-yellow-50 border-yellow-200 text-yellow-800'>
                <AlertDescription>
                  Please connect your wallet to submit attestation requests to
                  the blockchain.
                </AlertDescription>
              </Alert>
            )}

            <Button
              type='submit'
              disabled={
                isLoading ||
                !isHydrated ||
                !isConnected ||
                isLoadingAddresses ||
                !!addressError
              }
              className='w-full disabled:bg-gray-400'
              style={{ backgroundColor: '#E62058' }}
            >
              {isLoading ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Executing FDC Workflow...
                </>
              ) : !isHydrated ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Loading...
                </>
              ) : !isConnected ? (
                <>
                  <XCircle className='mr-2 h-4 w-4' />
                  Connect Wallet to Execute
                </>
              ) : (
                <>
                  <CheckCircle className='mr-2 h-4 w-4' />
                  Execute FDC Workflow
                </>
              )}
            </Button>

            {error && (
              <Alert variant='destructive'>
                <XCircle className='h-4 w-4' />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success && (
              <Alert className='bg-green-50 border-green-200 text-green-800'>
                <CheckCircle className='h-4 w-4' />
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            {currentAttestationStep && (
              <Alert
                style={{
                  backgroundColor: '#fef7f0',
                  borderColor: '#E62058',
                  color: '#E62058',
                }}
              >
                <div
                  className='animate-spin rounded-full h-4 w-4 border-b-2'
                  style={{ borderColor: '#E62058' }}
                ></div>
                <AlertDescription>{currentAttestationStep}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Workflow Steps */}
      <div className='space-y-4'>
        <h2 className='text-xl font-semibold' style={{ color: '#E62058' }}>
          FDC Workflow Steps
        </h2>
        {steps.map(step => (
          <Card key={step.id} className={`${getStepStatusColor(step.status)}`}>
            <CardContent className='p-4'>
              <div className='flex items-start gap-3'>
                {getStepIcon(step.status)}
                <div className='flex-1'>
                  <div className='flex items-center justify-between'>
                    <div>
                      <h3 className='font-semibold text-gray-900'>
                        {step.title}
                      </h3>
                      <p className='text-sm text-gray-600 mb-2'>
                        {step.description}
                      </p>
                    </div>
                    <button
                      type='button'
                      onClick={() => toggleStepExpansion(step.id)}
                      className='flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800'
                    >
                      {expandedSteps.has(step.id) ? (
                        <>
                          <ChevronDown className='h-4 w-4' />
                          Hide Details
                        </>
                      ) : (
                        <>
                          <ChevronRight className='h-4 w-4' />
                          Show Details
                        </>
                      )}
                    </button>
                  </div>

                  {/* Step Details - Always show for completed steps, expandable for others */}
                  {(expandedSteps.has(step.id) ||
                    step.status === 'completed') &&
                    step.details && (
                      <div className='mt-4 space-y-4 border-t pt-4'>
                        <div className='space-y-3'>
                          <div>
                            <h4 className='font-medium text-gray-900 mb-1'>
                              What happens:
                            </h4>
                            <p className='text-sm text-gray-700'>
                              {step.details.whatHappens}
                            </p>
                          </div>

                          <div>
                            <h4 className='font-medium text-gray-900 mb-1'>
                              Technical details:
                            </h4>
                            <p className='text-sm text-gray-700'>
                              {step.details.technicalDetails}
                            </p>
                          </div>

                          {step.details.apiEndpoint && (
                            <div>
                              <h4 className='font-medium text-gray-900 mb-1'>
                                API Endpoint:
                              </h4>
                              <code className='text-sm bg-gray-100 px-2 py-1 rounded font-mono block break-all'>
                                {step.details.apiEndpoint}
                              </code>
                            </div>
                          )}

                          {step.details.curlCommand && (
                            <div>
                              <h4 className='font-medium text-gray-900 mb-1'>
                                cURL Command:
                              </h4>
                              <div className='bg-gray-900 text-gray-100 p-3 rounded text-xs font-mono overflow-x-auto'>
                                <pre className='whitespace-pre-wrap'>
                                  {step.details.curlCommand}
                                </pre>
                              </div>
                              <button
                                type='button'
                                onClick={() =>
                                  copyToClipboardWithTimeout(
                                    step.details!.curlCommand!,
                                    setCopiedText
                                  )
                                }
                                className='mt-2 text-xs hover:opacity-80 flex items-center gap-1'
                              >
                                {copiedText === step.details!.curlCommand ? (
                                  <>
                                    <Check className='h-3 w-3' />
                                    Copied!
                                  </>
                                ) : (
                                  <>
                                    <Copy className='h-3 w-3' />
                                    Copy cURL
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  {/* Step Data - Show actual results */}
                  {step.data && (
                    <div className='mt-4 space-y-2 border-t pt-4'>
                      <h4 className='font-medium text-gray-900'>Results:</h4>

                      {step.data?.abiEncodedRequest && (
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>
                            ABI Encoded Request:
                          </span>
                          <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono flex-1'>
                            {String(step.data.abiEncodedRequest).length > 20
                              ? `${String(step.data.abiEncodedRequest).slice(0, 10)}...${String(step.data.abiEncodedRequest).slice(-10)}`
                              : String(step.data.abiEncodedRequest)}
                          </code>
                          <button
                            type='button'
                            onClick={() =>
                              copyToClipboardWithTimeout(
                                String(step.data.abiEncodedRequest),
                                setCopiedText
                              )
                            }
                            className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                          >
                            {copiedText === step.data.abiEncodedRequest ? (
                              <Check className='h-3 w-3 text-green-600' />
                            ) : (
                              <Copy className='h-3 w-3 text-gray-500' />
                            )}
                          </button>
                        </div>
                      )}

                      {step.data.roundId && (
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>Round ID:</span>
                          <div className='flex items-center gap-2'>
                            <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono'>
                              {String(step.data.roundId)}
                            </code>
                            <a
                              href={`https://coston2-systems-explorer.flare.rocks/voting-round/${String(step.data.roundId)}?tab=fdc`}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='hover:opacity-80 text-xs underline inline-flex items-center gap-1'
                            >
                              View Voting Round
                              <ExternalLink className='h-3 w-3' />
                            </a>
                            <button
                              type='button'
                              onClick={() =>
                                copyToClipboardWithTimeout(
                                  step.data.roundId.toString(),
                                  setCopiedText
                                )
                              }
                              className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                            >
                              {copiedText === step.data.roundId.toString() ? (
                                <Check className='h-3 w-3 text-green-600' />
                              ) : (
                                <Copy className='h-3 w-3 text-gray-500' />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {step.data.proof && (
                        <div className='space-y-1'>
                          <span className='text-sm font-medium'>
                            Proof Array:
                          </span>
                          <div className='space-y-1'>
                            {Array.isArray(step.data.proof) &&
                              step.data.proof.map(
                                (proofItem: string, proofIndex: number) => (
                                  <div
                                    key={proofIndex}
                                    className='flex items-center gap-2'
                                  >
                                    <span className='text-xs text-gray-600 w-6'>
                                      [{proofIndex}]:
                                    </span>
                                    <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono flex-1'>
                                      {proofItem}
                                    </code>
                                    <button
                                      type='button'
                                      onClick={() =>
                                        copyToClipboardWithTimeout(
                                          proofItem,
                                          setCopiedText
                                        )
                                      }
                                      className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                                    >
                                      {copiedText === proofItem ? (
                                        <Check className='h-3 w-3 text-green-600' />
                                      ) : (
                                        <Copy className='h-3 w-3 text-gray-500' />
                                      )}
                                    </button>
                                  </div>
                                )
                              )}
                          </div>
                        </div>
                      )}

                      {step.data.message && (
                        <p className='text-sm text-gray-700 bg-white/50 rounded p-2'>
                          {String(step.data.message)}
                        </p>
                      )}

                      {step.data.verificationResult !== undefined && (
                        <div className='space-y-2'>
                          <div className='flex items-center gap-2'>
                            <span className='text-sm font-medium'>
                              Verification Result:
                            </span>
                            <div className='flex items-center gap-2'>
                              <code
                                className={`px-2 py-1 rounded text-xs font-mono ${
                                  step.data.verificationResult
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {step.data.verificationResult
                                  ? 'Verified'
                                  : 'Failed'}
                              </code>
                              {step.data.verificationResult && (
                                <CheckCircle className='h-4 w-4 text-green-600' />
                              )}
                              {!step.data.verificationResult && (
                                <XCircle className='h-4 w-4 text-red-600' />
                              )}
                            </div>
                          </div>
                          <div className='flex items-center gap-2'>
                            <span className='text-sm font-medium'>
                              Raw Value:
                            </span>
                            <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono'>
                              {JSON.stringify(step.data.verificationResult)}
                            </code>
                            <button
                              type='button'
                              onClick={() =>
                                copyToClipboardWithTimeout(
                                  JSON.stringify(step.data.verificationResult),
                                  setCopiedText
                                )
                              }
                              className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                            >
                              {copiedText ===
                              JSON.stringify(step.data.verificationResult) ? (
                                <Check className='h-3 w-3 text-green-600' />
                              ) : (
                                <Copy className='h-3 w-3 text-gray-500' />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {step.data.transactionHash && (
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>
                            Transaction Hash:
                          </span>
                          <div className='flex items-center gap-2 flex-1'>
                            <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono flex-1'>
                              {String(step.data.transactionHash).length > 20
                                ? `${String(step.data.transactionHash).slice(0, 10)}...${String(step.data.transactionHash).slice(-10)}`
                                : String(step.data.transactionHash)}
                            </code>
                            <a
                              href={`https://coston2-explorer.flare.network/tx/${String(step.data.transactionHash)}`}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='hover:opacity-80 text-xs underline inline-flex items-center gap-1'
                            >
                              View on Explorer
                              <ExternalLink className='h-3 w-3' />
                            </a>
                            <button
                              type='button'
                              onClick={() =>
                                copyToClipboardWithTimeout(
                                  String(step.data.transactionHash),
                                  setCopiedText
                                )
                              }
                              className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                            >
                              {copiedText === step.data.transactionHash ? (
                                <Check className='h-3 w-3 text-green-600' />
                              ) : (
                                <Copy className='h-3 w-3 text-gray-500' />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {step.data.blockNumber && (
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium'>
                            Block Number:
                          </span>
                          <div className='flex items-center gap-2'>
                            <code className='px-2 py-1 bg-gray-100 rounded text-xs font-mono'>
                              {String(step.data.blockNumber)}
                            </code>
                            <a
                              href={`https://coston2-explorer.flare.network/block/${String(step.data.blockNumber)}`}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='hover:opacity-80 text-xs underline inline-flex items-center gap-1'
                            >
                              View Block
                              <ExternalLink className='h-3 w-3' />
                            </a>
                            <button
                              type='button'
                              onClick={() =>
                                copyToClipboardWithTimeout(
                                  step.data.blockNumber.toString(),
                                  setCopiedText
                                )
                              }
                              className='h-6 w-6 p-0 hover:bg-gray-200 rounded'
                            >
                              {copiedText ===
                              step.data.blockNumber.toString() ? (
                                <Check className='h-3 w-3 text-green-600' />
                              ) : (
                                <Copy className='h-3 w-3 text-gray-500' />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Show request/response details for the first step */}
                      {step.data.requestDetails && (
                        <div className='space-y-3'>
                          <div>
                            <h5 className='font-medium text-gray-900 mb-1'>
                              Request Body:
                            </h5>
                            <div className='bg-gray-100 p-3 rounded text-xs font-mono overflow-x-auto'>
                              <pre className='whitespace-pre-wrap'>
                                {JSON.stringify(
                                  (step.data.requestDetails as any)
                                    ?.requestBody,
                                  null,
                                  2
                                )}
                              </pre>
                            </div>
                          </div>
                          <div>
                            <h5 className='font-medium text-gray-900 mb-1'>
                              Response Body:
                            </h5>
                            <div className='bg-gray-100 p-3 rounded text-xs font-mono overflow-x-auto'>
                              <pre className='whitespace-pre-wrap'>
                                {JSON.stringify(
                                  (step.data.requestDetails as any)
                                    ?.responseBody,
                                  null,
                                  2
                                )}
                              </pre>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {step.error && (
                    <div className='mt-3 p-2 bg-red-100 border border-red-200 rounded text-sm text-red-700'>
                      Error: {step.error}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tutorial Information */}
      <Card style={{ backgroundColor: '#fef7f0', borderColor: '#E62058' }}>
        <CardContent className='p-4'>
          <h3 className='font-semibold mb-3' style={{ color: '#E62058' }}>
            📚 FDC Tutorial Guide
          </h3>
          <div className='space-y-3 text-sm' style={{ color: '#E62058' }}>
            <p>
              This interactive tutorial demonstrates the complete Flare Data
              Connector (FDC) workflow as described in the official
              documentation. Each step shows you exactly what happens behind the
              scenes.
            </p>
            <div>
              <h4 className='font-medium mb-1'>What you&apos;ll learn:</h4>
              <ul className='list-disc list-inside space-y-1 ml-2'>
                <li>
                  How to prepare attestation requests using the verifier API
                </li>
                <li>The structure of ABI-encoded requests</li>
                <li>How voting rounds work in the FDC system</li>
                <li>How to retrieve proofs from the Data Availability Layer</li>
                <li>How cryptographic verification works</li>
              </ul>
            </div>
            <div>
              <h4 className='font-medium mb-1'>Interactive Features:</h4>
              <ul className='list-disc list-inside space-y-1 ml-2'>
                <li>
                  <strong>Step 1</strong> makes an API call to the Flare
                  verifier server
                </li>
                <li>
                  <strong>Step 2</strong> executes a blockchain transaction to{' '}
                  <a
                    href='https://dev.flare.network/fdc/reference/IFdcHub#requestattestation'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='hover:opacity-80 underline inline-flex items-center gap-1'
                  >
                    FdcHub contract
                    <ExternalLink className='h-3 w-3' />
                  </a>
                </li>
                <li>
                  <strong>Step 3</strong> calculates and waits for voting round
                  finalization
                </li>
                <li>
                  <strong>Step 4</strong> retrieves proof from Data Availability
                  Layer
                </li>
                <li>
                  <strong>Step 5</strong> verifies payment attestation using{' '}
                  <a
                    href='https://dev.flare.network/fdc/reference/IFdcVerification#verifypayment'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='hover:opacity-80 underline inline-flex items-center gap-1'
                  >
                    FdcVerification contract
                    <ExternalLink className='h-3 w-3' />
                  </a>
                </li>
                <li>
                  <strong>Expandable details</strong> show technical
                  explanations and cURL commands for each step
                </li>
                <li>
                  <strong>Copy functionality</strong> for all important data
                  (requests, proofs, transaction hashes, etc.)
                </li>
                <li>
                  <strong>Real request/response data</strong> from actual API
                  calls and blockchain transactions
                </li>
                <li>
                  <strong>Transaction tracking</strong> with real transaction
                  hashes and block numbers
                </li>
                <li>
                  <strong>Voting round links</strong> to view rounds in the
                  Systems Explorer
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
