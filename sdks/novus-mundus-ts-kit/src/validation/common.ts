/**
 * Common Validation Utilities
 *
 * General-purpose validation functions for pre-flight checks.
 */

import type { Address } from '@solana/kit';
import { address, isAddress } from '@solana/kit';
import BN from 'bn.js';

// Types

/** Validation result type */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Create a successful validation result */
export function valid(): ValidationResult {
  return { valid: true, errors: [] };
}

/** Create a failed validation result */
export function invalid(...errors: string[]): ValidationResult {
  return { valid: false, errors };
}

/** Combine multiple validation results */
export function combine(...results: ValidationResult[]): ValidationResult {
  const errors: string[] = [];
  for (const result of results) {
    errors.push(...result.errors);
  }
  return errors.length === 0 ? valid() : invalid(...errors);
}

// PublicKey Validation

/** Check if a value is a valid PublicKey */
export function isValidPubkey(value: unknown): value is Address {
  if (typeof value === 'string') {
    return isAddress(value);
  }
  return false;
}

/** Validate a PublicKey is not the default (zero) key */
export function validateNotDefaultPubkey(pubkey: Address, fieldName: string): ValidationResult {
  if (pubkey === address('11111111111111111111111111111111')) {
    return invalid(`${fieldName} cannot be the default (zero) public key`);
  }
  return valid();
}

/** Validate that two pubkeys are different */
export function validateDifferentPubkeys(
  a: Address,
  b: Address,
  aName: string,
  bName: string
): ValidationResult {
  if (a === b) {
    return invalid(`${aName} and ${bName} must be different`);
  }
  return valid();
}

// Number Validation

/** Validate a number is positive */
export function validatePositive(value: number | BN, fieldName: string): ValidationResult {
  const num = BN.isBN(value) ? value.toNumber() : value;
  if (num <= 0) {
    return invalid(`${fieldName} must be positive (got ${num})`);
  }
  return valid();
}

/** Validate a number is non-negative */
export function validateNonNegative(value: number | BN, fieldName: string): ValidationResult {
  const num = BN.isBN(value) ? value.toNumber() : value;
  if (num < 0) {
    return invalid(`${fieldName} cannot be negative (got ${num})`);
  }
  return valid();
}

/** Validate a number is within range (inclusive) */
export function validateRange(
  value: number | BN,
  min: number,
  max: number,
  fieldName: string
): ValidationResult {
  const num = BN.isBN(value) ? value.toNumber() : value;
  if (num < min || num > max) {
    return invalid(`${fieldName} must be between ${min} and ${max} (got ${num})`);
  }
  return valid();
}

/** Validate a number is at least a minimum value */
export function validateMinimum(
  value: number | BN,
  min: number,
  fieldName: string
): ValidationResult {
  const num = BN.isBN(value) ? value.toNumber() : value;
  if (num < min) {
    return invalid(`${fieldName} must be at least ${min} (got ${num})`);
  }
  return valid();
}

/** Validate a number is at most a maximum value */
export function validateMaximum(
  value: number | BN,
  max: number,
  fieldName: string
): ValidationResult {
  const num = BN.isBN(value) ? value.toNumber() : value;
  if (num > max) {
    return invalid(`${fieldName} must be at most ${max} (got ${num})`);
  }
  return valid();
}

/** Validate a BN is at most a max BN value */
export function validateMaximumBN(value: BN, max: BN, fieldName: string): ValidationResult {
  if (value.gt(max)) {
    return invalid(`${fieldName} must be at most ${max.toString()} (got ${value.toString()})`);
  }
  return valid();
}

/** Validate a BN is at least a min BN value */
export function validateMinimumBN(value: BN, min: BN, fieldName: string): ValidationResult {
  if (value.lt(min)) {
    return invalid(`${fieldName} must be at least ${min.toString()} (got ${value.toString()})`);
  }
  return valid();
}

// String Validation

/** Validate a string is not empty */
export function validateNonEmpty(value: string, fieldName: string): ValidationResult {
  if (!value || value.trim().length === 0) {
    return invalid(`${fieldName} cannot be empty`);
  }
  return valid();
}

/** Validate string length is within bounds */
export function validateStringLength(
  value: string,
  minLength: number,
  maxLength: number,
  fieldName: string
): ValidationResult {
  const len = value.length;
  if (len < minLength) {
    return invalid(`${fieldName} must be at least ${minLength} characters (got ${len})`);
  }
  if (len > maxLength) {
    return invalid(`${fieldName} must be at most ${maxLength} characters (got ${len})`);
  }
  return valid();
}

/** Validate a string matches a pattern */
export function validatePattern(
  value: string,
  pattern: RegExp,
  fieldName: string,
  patternDescription?: string
): ValidationResult {
  if (!pattern.test(value)) {
    const desc = patternDescription ? ` (${patternDescription})` : '';
    return invalid(`${fieldName} has invalid format${desc}`);
  }
  return valid();
}

/** Validate a name contains only allowed characters */
export function validateName(value: string, fieldName: string): ValidationResult {
  // Names: alphanumeric, underscores, spaces, 3-32 chars
  const result = combine(
    validateStringLength(value, 3, 32, fieldName),
    validatePattern(value, /^[a-zA-Z0-9_ ]+$/, fieldName, 'alphanumeric, underscores, and spaces only')
  );
  return result;
}

// Array Validation

/** Validate an array is not empty */
export function validateNonEmptyArray<T>(arr: T[], fieldName: string): ValidationResult {
  if (!arr || arr.length === 0) {
    return invalid(`${fieldName} cannot be empty`);
  }
  return valid();
}

/** Validate an array has a specific length */
export function validateArrayLength<T>(
  arr: T[],
  minLength: number,
  maxLength: number,
  fieldName: string
): ValidationResult {
  const len = arr.length;
  if (len < minLength) {
    return invalid(`${fieldName} must have at least ${minLength} items (got ${len})`);
  }
  if (len > maxLength) {
    return invalid(`${fieldName} must have at most ${maxLength} items (got ${len})`);
  }
  return valid();
}

// Enum Validation

/** Validate a value is a valid enum member */
export function validateEnum<T extends Record<string, number>>(
  value: number,
  enumObj: T,
  fieldName: string
): ValidationResult {
  const validValues = Object.values(enumObj).filter((v) => typeof v === 'number');
  if (!validValues.includes(value)) {
    return invalid(`${fieldName} must be a valid enum value (got ${value})`);
  }
  return valid();
}

// Boolean Validation

/** Validate a condition is true */
export function validateCondition(
  condition: boolean,
  errorMessage: string
): ValidationResult {
  if (!condition) {
    return invalid(errorMessage);
  }
  return valid();
}

/** Validate a condition is false */
export function validateNot(
  condition: boolean,
  errorMessage: string
): ValidationResult {
  if (condition) {
    return invalid(errorMessage);
  }
  return valid();
}

// Timestamp Validation

/** Validate a timestamp is in the future */
export function validateFutureTimestamp(
  timestamp: number,
  nowSeconds: number,
  fieldName: string
): ValidationResult {
  if (timestamp <= nowSeconds) {
    return invalid(`${fieldName} must be in the future`);
  }
  return valid();
}

/** Validate a timestamp is in the past */
export function validatePastTimestamp(
  timestamp: number,
  nowSeconds: number,
  fieldName: string
): ValidationResult {
  if (timestamp >= nowSeconds) {
    return invalid(`${fieldName} must be in the past`);
  }
  return valid();
}

/** Validate a timestamp is not expired */
export function validateNotExpired(
  expiresAt: number,
  nowSeconds: number,
  fieldName: string
): ValidationResult {
  if (expiresAt > 0 && nowSeconds > expiresAt) {
    return invalid(`${fieldName} has expired`);
  }
  return valid();
}

// Utility Functions

/** Check if all validation results are valid */
export function allValid(...results: ValidationResult[]): boolean {
  return results.every((r) => r.valid);
}

/** Get all errors from multiple validation results */
export function getAllErrors(...results: ValidationResult[]): string[] {
  return results.flatMap((r) => r.errors);
}

/** Throw if validation fails */
export function assertValid(result: ValidationResult, prefix?: string): void {
  if (!result.valid) {
    const msg = prefix
      ? `${prefix}: ${result.errors.join(', ')}`
      : result.errors.join(', ');
    throw new Error(msg);
  }
}
