/**
 * Validation Unit Tests
 *
 * Tests for client-side validation utilities.
 */

import { describe, it, expect } from 'bun:test';
import { PublicKey, Keypair } from '@solana/web3.js';
import {
  valid,
  invalid,
  combine,
  isValidPubkey,
  validateNotDefaultPubkey,
  validateDifferentPubkeys,
  validatePositive,
  validateNonNegative,
  validateRange,
  validateMinimum,
  validateMaximum,
  validateMinimumBN,
  validateMaximumBN,
  validateNonEmpty,
  validateStringLength,
  validatePattern,
  validateName,
  validateNonEmptyArray,
  validateArrayLength,
  validateEnum,
  validateCondition,
  validateNot,
  validateFutureTimestamp,
  validatePastTimestamp,
  validateNotExpired,
  allValid,
  getAllErrors,
  assertValid,
} from '../../src/validation/common';

describe('ValidationResult helpers', () => {
  describe('valid', () => {
    it('should create a valid result', () => {
      const result = valid();
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('invalid', () => {
    it('should create an invalid result with errors', () => {
      const result = invalid('Error 1', 'Error 2');
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['Error 1', 'Error 2']);
    });

    it('should create an invalid result with single error', () => {
      const result = invalid('Only error');
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['Only error']);
    });
  });

  describe('combine', () => {
    it('should combine valid results', () => {
      const result = combine(valid(), valid(), valid());
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should combine invalid results', () => {
      const result = combine(
        invalid('Error 1'),
        valid(),
        invalid('Error 2', 'Error 3')
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['Error 1', 'Error 2', 'Error 3']);
    });
  });

  describe('allValid', () => {
    it('should return true if all valid', () => {
      expect(allValid(valid(), valid())).toBe(true);
    });

    it('should return false if any invalid', () => {
      expect(allValid(valid(), invalid('error'), valid())).toBe(false);
    });
  });

  describe('getAllErrors', () => {
    it('should collect all errors', () => {
      const errors = getAllErrors(
        invalid('A'),
        valid(),
        invalid('B', 'C')
      );
      expect(errors).toEqual(['A', 'B', 'C']);
    });
  });

  describe('assertValid', () => {
    it('should not throw for valid result', () => {
      expect(() => assertValid(valid())).not.toThrow();
    });

    it('should throw for invalid result', () => {
      expect(() => assertValid(invalid('Error'))).toThrow('Error');
    });

    it('should include prefix in error message', () => {
      expect(() => assertValid(invalid('Error'), 'Validation'))
        .toThrow('Validation: Error');
    });
  });
});

describe('PublicKey validation', () => {
  describe('isValidPubkey', () => {
    it('should return true for PublicKey instance', async () => {
      const keypair = await Keypair.generate();
      expect(isValidPubkey(keypair.publicKey)).toBe(true);
    });

    it('should return true for valid base58 string', async () => {
      const keypair = await Keypair.generate();
      expect(isValidPubkey(keypair.publicKey.toBase58())).toBe(true);
    });

    it('should return false for invalid string', () => {
      expect(isValidPubkey('invalid')).toBe(false);
    });

    it('should return false for non-string non-pubkey', () => {
      expect(isValidPubkey(123)).toBe(false);
      expect(isValidPubkey(null)).toBe(false);
      expect(isValidPubkey(undefined)).toBe(false);
    });
  });

  describe('validateNotDefaultPubkey', () => {
    it('should pass for non-default pubkey', async () => {
      const keypair = await Keypair.generate();
      const result = validateNotDefaultPubkey(keypair.publicKey, 'owner');
      expect(result.valid).toBe(true);
    });

    it('should fail for default pubkey', () => {
      const result = validateNotDefaultPubkey(PublicKey.default, 'owner');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('owner');
      expect(result.errors[0]).toContain('default');
    });
  });

  describe('validateDifferentPubkeys', () => {
    it('should pass for different pubkeys', async () => {
      const k1 = (await Keypair.generate()).publicKey;
      const k2 = (await Keypair.generate()).publicKey;
      const result = validateDifferentPubkeys(k1, k2, 'sender', 'receiver');
      expect(result.valid).toBe(true);
    });

    it('should fail for same pubkeys', async () => {
      const k = (await Keypair.generate()).publicKey;
      const result = validateDifferentPubkeys(k, k, 'sender', 'receiver');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('sender');
      expect(result.errors[0]).toContain('receiver');
    });
  });
});

describe('Number validation', () => {
  describe('validatePositive', () => {
    it('should pass for positive number', () => {
      expect(validatePositive(1, 'amount').valid).toBe(true);
      expect(validatePositive(100, 'amount').valid).toBe(true);
    });

    it('should fail for zero', () => {
      expect(validatePositive(0, 'amount').valid).toBe(false);
    });

    it('should fail for negative', () => {
      expect(validatePositive(-1, 'amount').valid).toBe(false);
    });

    it('should work with bigint', () => {
      expect(validatePositive(100n, 'amount').valid).toBe(true);
      expect(validatePositive(0n, 'amount').valid).toBe(false);
    });
  });

  describe('validateNonNegative', () => {
    it('should pass for non-negative number', () => {
      expect(validateNonNegative(0, 'amount').valid).toBe(true);
      expect(validateNonNegative(100, 'amount').valid).toBe(true);
    });

    it('should fail for negative', () => {
      expect(validateNonNegative(-1, 'amount').valid).toBe(false);
    });
  });

  describe('validateRange', () => {
    it('should pass for value in range', () => {
      expect(validateRange(5, 1, 10, 'level').valid).toBe(true);
      expect(validateRange(1, 1, 10, 'level').valid).toBe(true);
      expect(validateRange(10, 1, 10, 'level').valid).toBe(true);
    });

    it('should fail for value out of range', () => {
      expect(validateRange(0, 1, 10, 'level').valid).toBe(false);
      expect(validateRange(11, 1, 10, 'level').valid).toBe(false);
    });
  });

  describe('validateMinimum', () => {
    it('should pass for value >= minimum', () => {
      expect(validateMinimum(10, 10, 'amount').valid).toBe(true);
      expect(validateMinimum(100, 10, 'amount').valid).toBe(true);
    });

    it('should fail for value < minimum', () => {
      expect(validateMinimum(9, 10, 'amount').valid).toBe(false);
    });
  });

  describe('validateMaximum', () => {
    it('should pass for value <= maximum', () => {
      expect(validateMaximum(10, 10, 'amount').valid).toBe(true);
      expect(validateMaximum(5, 10, 'amount').valid).toBe(true);
    });

    it('should fail for value > maximum', () => {
      expect(validateMaximum(11, 10, 'amount').valid).toBe(false);
    });
  });

  describe('validateMinimumBN', () => {
    it('should pass for bigint >= minimum', () => {
      expect(validateMinimumBN(100n, 100n, 'amount').valid).toBe(true);
      expect(validateMinimumBN(200n, 100n, 'amount').valid).toBe(true);
    });

    it('should fail for bigint < minimum', () => {
      expect(validateMinimumBN(50n, 100n, 'amount').valid).toBe(false);
    });
  });

  describe('validateMaximumBN', () => {
    it('should pass for bigint <= maximum', () => {
      expect(validateMaximumBN(100n, 100n, 'amount').valid).toBe(true);
      expect(validateMaximumBN(50n, 100n, 'amount').valid).toBe(true);
    });

    it('should fail for bigint > maximum', () => {
      expect(validateMaximumBN(150n, 100n, 'amount').valid).toBe(false);
    });
  });
});

describe('String validation', () => {
  describe('validateNonEmpty', () => {
    it('should pass for non-empty string', () => {
      expect(validateNonEmpty('hello', 'name').valid).toBe(true);
    });

    it('should fail for empty string', () => {
      expect(validateNonEmpty('', 'name').valid).toBe(false);
    });

    it('should fail for whitespace-only string', () => {
      expect(validateNonEmpty('   ', 'name').valid).toBe(false);
    });
  });

  describe('validateStringLength', () => {
    it('should pass for string in length range', () => {
      expect(validateStringLength('hello', 1, 10, 'name').valid).toBe(true);
      expect(validateStringLength('h', 1, 10, 'name').valid).toBe(true);
      expect(validateStringLength('helloworld', 1, 10, 'name').valid).toBe(true);
    });

    it('should fail for string too short', () => {
      expect(validateStringLength('', 1, 10, 'name').valid).toBe(false);
    });

    it('should fail for string too long', () => {
      expect(validateStringLength('hello world!', 1, 10, 'name').valid).toBe(false);
    });
  });

  describe('validatePattern', () => {
    it('should pass for matching pattern', () => {
      expect(validatePattern('hello123', /^[a-z0-9]+$/, 'code').valid).toBe(true);
    });

    it('should fail for non-matching pattern', () => {
      expect(validatePattern('hello!', /^[a-z0-9]+$/, 'code').valid).toBe(false);
    });

    it('should include pattern description in error', () => {
      const result = validatePattern('hello!', /^[a-z0-9]+$/, 'code', 'lowercase alphanumeric');
      expect(result.errors[0]).toContain('lowercase alphanumeric');
    });
  });

  describe('validateName', () => {
    it('should pass for valid name', () => {
      expect(validateName('Player123', 'name').valid).toBe(true);
      expect(validateName('My_Player', 'name').valid).toBe(true);
      expect(validateName('Player Name', 'name').valid).toBe(true);
    });

    it('should fail for name too short', () => {
      expect(validateName('AB', 'name').valid).toBe(false);
    });

    it('should fail for name too long', () => {
      expect(validateName('A'.repeat(33), 'name').valid).toBe(false);
    });

    it('should fail for invalid characters', () => {
      expect(validateName('Player!@#', 'name').valid).toBe(false);
    });
  });
});

describe('Array validation', () => {
  describe('validateNonEmptyArray', () => {
    it('should pass for non-empty array', () => {
      expect(validateNonEmptyArray([1, 2, 3], 'items').valid).toBe(true);
    });

    it('should fail for empty array', () => {
      expect(validateNonEmptyArray([], 'items').valid).toBe(false);
    });
  });

  describe('validateArrayLength', () => {
    it('should pass for array in length range', () => {
      expect(validateArrayLength([1, 2, 3], 1, 5, 'items').valid).toBe(true);
    });

    it('should fail for array too short', () => {
      expect(validateArrayLength([], 1, 5, 'items').valid).toBe(false);
    });

    it('should fail for array too long', () => {
      expect(validateArrayLength([1, 2, 3, 4, 5, 6], 1, 5, 'items').valid).toBe(false);
    });
  });
});

describe('Enum validation', () => {
  // Use a plain object instead of TypeScript enum to avoid reverse mapping issues
  const TestEnum = {
    A: 0,
    B: 1,
    C: 2,
  } as const;

  describe('validateEnum', () => {
    it('should pass for valid enum value', () => {
      expect(validateEnum(0, TestEnum as Record<string, number>, 'type').valid).toBe(true);
      expect(validateEnum(1, TestEnum as Record<string, number>, 'type').valid).toBe(true);
      expect(validateEnum(2, TestEnum as Record<string, number>, 'type').valid).toBe(true);
    });

    it('should fail for invalid enum value', () => {
      expect(validateEnum(3, TestEnum as Record<string, number>, 'type').valid).toBe(false);
      expect(validateEnum(-1, TestEnum as Record<string, number>, 'type').valid).toBe(false);
    });
  });
});

describe('Boolean validation', () => {
  describe('validateCondition', () => {
    it('should pass for true condition', () => {
      expect(validateCondition(true, 'Must be true').valid).toBe(true);
    });

    it('should fail for false condition', () => {
      const result = validateCondition(false, 'Must be true');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toBe('Must be true');
    });
  });

  describe('validateNot', () => {
    it('should pass for false condition', () => {
      expect(validateNot(false, 'Must not be true').valid).toBe(true);
    });

    it('should fail for true condition', () => {
      const result = validateNot(true, 'Must not be true');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toBe('Must not be true');
    });
  });
});

describe('Timestamp validation', () => {
  const now = Math.floor(Date.now() / 1000);

  describe('validateFutureTimestamp', () => {
    it('should pass for future timestamp', () => {
      expect(validateFutureTimestamp(now + 3600, now, 'deadline').valid).toBe(true);
    });

    it('should fail for past timestamp', () => {
      expect(validateFutureTimestamp(now - 3600, now, 'deadline').valid).toBe(false);
    });

    it('should fail for current timestamp', () => {
      expect(validateFutureTimestamp(now, now, 'deadline').valid).toBe(false);
    });
  });

  describe('validatePastTimestamp', () => {
    it('should pass for past timestamp', () => {
      expect(validatePastTimestamp(now - 3600, now, 'created').valid).toBe(true);
    });

    it('should fail for future timestamp', () => {
      expect(validatePastTimestamp(now + 3600, now, 'created').valid).toBe(false);
    });

    it('should fail for current timestamp', () => {
      expect(validatePastTimestamp(now, now, 'created').valid).toBe(false);
    });
  });

  describe('validateNotExpired', () => {
    it('should pass for future expiry', () => {
      expect(validateNotExpired(now + 3600, now, 'offer').valid).toBe(true);
    });

    it('should pass for zero expiry (no expiration)', () => {
      expect(validateNotExpired(0, now, 'offer').valid).toBe(true);
    });

    it('should fail for past expiry', () => {
      expect(validateNotExpired(now - 3600, now, 'offer').valid).toBe(false);
    });
  });
});
