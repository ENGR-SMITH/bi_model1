import { describe, expect, it } from 'vitest';
import {
  belowMedianPct,
  formatCurrency,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatWatchTime,
  isBelowMedian,
  pickThumbnailUrl,
} from './analytics-format';

describe('formatNumber', () => {
  it('compacts thousands, millions, and billions', () => {
    expect(formatNumber(12)).toBe('12');
    expect(formatNumber(1_250)).toBe('1.2K');
    expect(formatNumber(3_400_000)).toBe('3.4M');
    expect(formatNumber(1_250_000_000)).toBe('1.2B');
  });

  it('treats missing values as the em dash', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
  });
});

describe('formatWatchTime', () => {
  it('formats minutes into human durations', () => {
    expect(formatWatchTime(40)).toBe('40m');
    expect(formatWatchTime(750)).toBe('12h 30m');
    expect(formatWatchTime(60)).toBe('1h');
    expect(formatWatchTime(60_000)).toBe('1K h');
    expect(formatWatchTime(null)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('keeps one decimal and handles missing values', () => {
    expect(formatPercent(4.53)).toBe('4.5%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatCurrency', () => {
  it('formats USD and compacts large amounts', () => {
    expect(formatCurrency(1.2)).toBe('$1.20');
    expect(formatCurrency(12_500)).toBe('$12.5K');
    expect(formatCurrency(2_000_000)).toBe('$2M');
    expect(formatCurrency(null)).toBe('—');
  });
});

describe('formatDate', () => {
  it('renders a readable date and a dash for missing input', () => {
    expect(formatDate('2026-08-20T10:00:00Z')).toBe('Aug 20, 2026');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('formatDuration', () => {
  it('renders m:ss and h:mm:ss', () => {
    expect(formatDuration(45)).toBe('0:45');
    expect(formatDuration(252)).toBe('4:12');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(null)).toBe('—');
  });
});

describe('pickThumbnailUrl', () => {
  it('prefers high over default and tolerates garbage input', () => {
    expect(pickThumbnailUrl({ default: { url: 'https://img/d.jpg' }, high: { url: 'https://img/h.jpg' } })).toBe('https://img/h.jpg');
    expect(pickThumbnailUrl({ default: { url: 'https://img/d.jpg' } })).toBe('https://img/d.jpg');
    expect(pickThumbnailUrl(null)).toBeNull();
    expect(pickThumbnailUrl('nope')).toBeNull();
  });
});

describe('anomaly comparisons', () => {
  it('measures how far a value sits below the channel median', () => {
    expect(belowMedianPct(3, 5)).toBe(40); // 3 is 40% below 5
    expect(belowMedianPct(6, 5)).toBeNull();
    expect(belowMedianPct(null, 5)).toBeNull();
    expect(belowMedianPct(3, 0)).toBeNull();
  });

  it('flags values at least 40% below the median by default', () => {
    expect(isBelowMedian(3, 5)).toBe(true); // 40% below → threshold 0.6 → 3 <= 3 → true
    expect(isBelowMedian(3.5, 5)).toBe(false); // 30% below
    expect(isBelowMedian(null, 5)).toBe(false);
  });
});