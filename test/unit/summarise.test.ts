import { describe, it, expect } from 'vitest';
import { summarise } from '../../src/core/summarise.js';

describe('summarise', () => {
  it('returns empty string for undefined input', () => {
    expect(summarise(undefined)).toBe('');
  });

  it('returns original string if under max chars', () => {
    const short = 'This is a short description';
    expect(summarise(short, 100)).toBe(short);
  });

  it('cleans up whitespace', () => {
    const messy = '  This   has\n\nmultiple   spaces\t\tand\ttabs  ';
    expect(summarise(messy)).toBe('This has multiple spaces and tabs');
  });

  it('truncates long strings and adds ellipsis', () => {
    const long = 'a'.repeat(200);
    const result = summarise(long, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith('…')).toBe(true);
  });

  it('breaks at word boundary when possible', () => {
    const text = 'This is a long sentence that needs to be truncated at a sensible word boundary';
    const result = summarise(text, 40);
    expect(result).toBe('This is a long sentence that needs to…');
  });

  it('respects custom max characters', () => {
    const text = 'This is a test string that will be truncated';
    const result = summarise(text, 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.endsWith('…')).toBe(true);
  });
});
