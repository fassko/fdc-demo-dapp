# TypeScript Types Generation from OpenZeppelin Contracts

This project includes utilities for generating TypeScript types from OpenZeppelin contracts.

## Setup

### 1. Install Dependencies

```bash
npm install --save-dev typechain @typechain/ethers-v6 tsx
npm install @openzeppelin/contracts
```

### 2. Generate Types

```bash
npm run generate-types
```

This will generate TypeScript types from OpenZeppelin contracts in `src/types/contracts/`.

## Usage

### Manual Type Definition (Current Approach)

We've created a manual type definition in `src/utils/erc20Types.ts`:

```typescript
export interface IERC20 {
  // View functions
  balanceOf(account: string): Promise<bigint>;
  decimals(): Promise<number>;
  symbol(): Promise<string>;
  name(): Promise<string>;
  totalSupply(): Promise<bigint>;
  allowance(owner: string, spender: string): Promise<bigint>;

  // State-changing functions
  transfer(to: string, amount: bigint): Promise<boolean>;
  approve(spender: string, amount: bigint): Promise<boolean>;
  transferFrom(from: string, to: string, amount: bigint): Promise<boolean>;
}
```

### Using Generated Types

Once types are generated, you can import them:

```typescript
import { IERC20__factory } from '../types/contracts';

// Create contract instance with full type safety
const contract = IERC20__factory.connect(address, signer);
```

## Benefits

1. **Type Safety**: Full TypeScript support for contract interactions
2. **IntelliSense**: IDE autocomplete for contract methods
3. **Compile-time Checks**: Catch errors before runtime
4. **Standard Compliance**: Uses official OpenZeppelin interfaces

## Alternative Approaches

### 1. Direct Import (if available)

```typescript
import { IERC20__factory } from '@openzeppelin/contracts';
```

### 2. TypeChain Generation

```bash
npx typechain --target ethers-v6 --out-dir src/types/contracts node_modules/@openzeppelin/contracts/build/contracts/*.json
```

### 3. Manual Interface Definition

Define interfaces manually based on OpenZeppelin's IERC20 interface.

## Current Implementation

The project currently uses a manual type definition approach in `src/utils/erc20Types.ts` which provides:

- ✅ Full TypeScript support
- ✅ Standard ERC20 interface compliance
- ✅ Easy to maintain and extend
- ✅ No external dependencies on generated files

This approach gives us the benefits of typed contracts without the complexity of automated type generation.
