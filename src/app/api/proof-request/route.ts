import { NextRequest, NextResponse } from 'next/server';

// This is a proxy for the DA Layer API
// It is used to retrieve the proof for a given request
// Avoids browser CORS issues when calling external APIs
export async function POST(request: NextRequest) {
  try {
    console.log('API route called');

    const body = await request.json();
    console.log('Received request body:', body);

    // Validate the request body
    if (!body.votingRoundId || !body.requestBytes) {
      throw new Error(
        'Missing required fields: votingRoundId and requestBytes'
      );
    }

    const daLayerUrl =
      'https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round';
    console.log('Making request to:', daLayerUrl);
    console.log('Request body:', JSON.stringify(body));

    const response = await fetch(daLayerUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'x-api-key': '00000000-0000-0000-0000-000000000000',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    console.log('Response status:', response.status);
    console.log(
      'Response headers:',
      Object.fromEntries(response.headers.entries())
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response body:', errorText);
      throw new Error(
        `DA Layer request failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();
    console.log('Success response:', data);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
