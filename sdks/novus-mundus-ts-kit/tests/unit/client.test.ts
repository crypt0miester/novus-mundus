/**
 * Client Unit Tests
 *
 * Tests for NovusMundusClient configuration and utility methods.
 * Note: Actual RPC calls are tested in E2E tests with a live validator.
 */

import { describe, it, expect } from 'bun:test';
import { address, createSolanaRpc, generateKeyPairSigner } from '@solana/kit';
import { NovusMundusClient } from '../../src/client';

const DEFAULT_ADDRESS = address('11111111111111111111111111111111');

describe('NovusMundusClient', () => {
  // Use a mock RPC URL (won't actually connect in these tests)
  const mockRpc = createSolanaRpc('http://localhost:8899');

  describe('constructor', () => {
    it('should create client with default options', () => {
      const client = new NovusMundusClient({
        rpc: mockRpc,
      });

      expect(client.rpc).toBe(mockRpc);
      expect(client.commitment).toBe('confirmed');
      expect(client.defaultComputeUnits).toBe(200_000);
      expect(client.defaultComputeUnitPrice).toBe(1);
    });

    it('should accept custom commitment', () => {
      const client = new NovusMundusClient({
        rpc: mockRpc,
        commitment: 'finalized',
      });

      expect(client.commitment).toBe('finalized');
    });

    it('should accept custom compute units', () => {
      const client = new NovusMundusClient({
        rpc: mockRpc,
        computeUnits: 400_000,
      });

      expect(client.defaultComputeUnits).toBe(400_000);
    });

    it('should accept custom compute unit price', () => {
      const client = new NovusMundusClient({
        rpc: mockRpc,
        computeUnitPrice: 100,
      });

      expect(client.defaultComputeUnitPrice).toBe(100);
    });

    it('should accept all options together', () => {
      const client = new NovusMundusClient({
        rpc: mockRpc,
        commitment: 'processed',
        computeUnits: 500_000,
        computeUnitPrice: 50,
      });

      expect(client.commitment).toBe('processed');
      expect(client.defaultComputeUnits).toBe(500_000);
      expect(client.defaultComputeUnitPrice).toBe(50);
    });
  });

  describe('rpc exposure', () => {
    it('should expose rpc for direct access', () => {
      const client = new NovusMundusClient({
        rpc: mockRpc,
      });

      // Should be able to access RPC methods
      expect(typeof client.rpc.getAccountInfo).toBe('function');
      expect(typeof client.rpc.getMultipleAccounts).toBe('function');
      expect(typeof client.rpc.getProgramAccounts).toBe('function');
    });
  });
});

describe('Client Type Definitions', () => {
  it('should export AccountFetchResult type', () => {
    // Import type to verify it exists
    const result: import('../../src/client').AccountFetchResult<string> = {
      pubkey: DEFAULT_ADDRESS,
      account: 'test',
      exists: true,
    };

    expect(result.exists).toBe(true);
  });

  it('should export TransactionBuildOptions type', () => {
    const options: import('../../src/client').TransactionBuildOptions = {
      computeUnits: 300_000,
      computeUnitPrice: 10,
    };

    expect(options.computeUnits).toBe(300_000);
  });

  it('should export SimulationResult type', () => {
    const result: import('../../src/client').SimulationResult = {
      success: true,
      error: null,
      logs: ['log1', 'log2'],
      unitsConsumed: 50000,
      events: [],
    };

    expect(result.success).toBe(true);
  });

  it('should export SendResult type', () => {
    const result: import('../../src/client').SendResult = {
      signature: 'abc123',
      success: true,
      error: null,
      events: [],
    };

    expect(result.signature).toBe('abc123');
  });

  it('should export BulkFetchResult type', () => {
    const result: import('../../src/client').BulkFetchResult<number> = {
      pubkey: DEFAULT_ADDRESS,
      account: 42,
    };

    expect(result.account).toBe(42);
  });

  it('should export FetchLootOptions type', () => {
    const options: import('../../src/client').FetchLootOptions = {
      unclaimedOnly: true,
    };

    expect(options.unclaimedOnly).toBe(true);
  });

  it('should export FetchEncountersOptions type', () => {
    const options: import('../../src/client').FetchEncountersOptions = {
      aliveOnly: true,
    };

    expect(options.aliveOnly).toBe(true);
  });

  it('should export FetchRalliesOptions type', async () => {
    const team = (await generateKeyPairSigner()).address;
    const options: import('../../src/client').FetchRalliesOptions = {
      team,
      activeOnly: true,
    };

    expect(options.team).toBe(team);
    expect(options.activeOnly).toBe(true);
  });

  it('should export FetchPlayersOptions type', async () => {
    const team = (await generateKeyPairSigner()).address;
    const options: import('../../src/client').FetchPlayersOptions = {
      cityId: 1,
      team,
      minLevel: 10,
    };

    expect(options.cityId).toBe(1);
    expect(options.minLevel).toBe(10);
  });
});

describe('Client Option Validation', () => {
  const mockRpc = createSolanaRpc('http://localhost:8899');

  it('should work with minimum configuration', () => {
    // This tests that the minimum required options are actually minimal
    expect(() => {
      new NovusMundusClient({
        rpc: mockRpc,
      });
    }).not.toThrow();
  });

  it('should handle different RPC URLs', () => {
    const mainnetClient = new NovusMundusClient({
      rpc: createSolanaRpc('https://api.mainnet-beta.solana.com'),
    });

    const devnetClient = new NovusMundusClient({
      rpc: createSolanaRpc('https://api.devnet.solana.com'),
    });

    // Both should be valid clients
    expect(mainnetClient.rpc).toBeDefined();
    expect(devnetClient.rpc).toBeDefined();
  });
});
