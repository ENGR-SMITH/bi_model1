import { describe, expect, it } from 'vitest';
import {
  REVIEWER_COLORS,
  geometryKey,
  hashString,
  parseGeometry,
  reviewerColor,
  reviewerLabel,
} from './annotations';

describe('reviewer identity', () => {
  it('is deterministic per author id', () => {
    expect(reviewerColor('user-1')).toBe(reviewerColor('user-1'));
    expect(reviewerLabel('user-1')).toBe(reviewerLabel('user-1'));
  });

  it('picks a real color from the palette', () => {
    for (const id of ['user-1', 'user-2', 'user-3', 'user-99']) {
      expect(REVIEWER_COLORS).toContain(reviewerColor(id));
    }
  });

  it('produces a single-letter A–Z label', () => {
    for (const id of ['user-1', 'user-2', 'user-3']) {
      const label = reviewerLabel(id);
      expect(label).toMatch(/^[A-Z]$/);
    }
  });

  it('is a plain 32-bit hash', () => {
    expect(hashString('x')).toBeGreaterThanOrEqual(0);
    expect(hashString('x') >>> 0).toBe(hashString('x'));
  });
});

describe('parseGeometry', () => {
  it('parses a valid normalized pair', () => {
    expect(parseGeometry({ x: 0.5, y: 0.25 })).toEqual({ x: 0.5, y: 0.25 });
    expect(parseGeometry({ x: 0.5, y: 0.25, w: 0.2, h: 0.1 })).toEqual({ x: 0.5, y: 0.25, w: 0.2, h: 0.1 });
  });

  it('clamps out-of-range values to 0..1', () => {
    expect(parseGeometry({ x: 1.5, y: -0.2 })).toEqual({ x: 1, y: 0 });
  });

  it('rejects junk values', () => {
    expect(parseGeometry(null)).toBeNull();
    expect(parseGeometry(undefined)).toBeNull();
    expect(parseGeometry('nope')).toBeNull();
    expect(parseGeometry({ x: 'a', y: 0.5 })).toBeNull();
    expect(parseGeometry({ x: 0.5 })).toBeNull();
  });
});

describe('geometryKey', () => {
  it('groups near-identical pin points', () => {
    expect(geometryKey({ x: 0.5001, y: 0.2501 })).toBe(geometryKey({ x: 0.5, y: 0.25 }));
  });
});
