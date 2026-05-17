import { describe, it, expect } from 'vitest';
import { bearingFromTo, degreesToCompass } from './fetchRotationSignatures';

describe('bearing math (user → storm)', () => {
  const userLat = 30;
  const userLon = -95;

  it('storm due west (lon - 0.2) returns W, not E', () => {
    const deg = bearingFromTo(userLat, userLon, userLat, userLon - 0.2);
    expect(degreesToCompass(deg)).toBe('W');
    expect(deg).toBeGreaterThan(247.5);
    expect(deg).toBeLessThan(292.5);
  });

  it('storm due east returns E', () => {
    expect(degreesToCompass(bearingFromTo(userLat, userLon, userLat, userLon + 0.2))).toBe('E');
  });

  it('storm due north returns N', () => {
    expect(degreesToCompass(bearingFromTo(userLat, userLon, userLat + 0.2, userLon))).toBe('N');
  });

  it('storm due south returns S', () => {
    expect(degreesToCompass(bearingFromTo(userLat, userLon, userLat - 0.2, userLon))).toBe('S');
  });

  it('storm to the northwest returns NW', () => {
    expect(degreesToCompass(bearingFromTo(userLat, userLon, userLat + 0.2, userLon - 0.2))).toBe('NW');
  });

  it('compass sector boundaries snap correctly', () => {
    expect(degreesToCompass(0)).toBe('N');
    expect(degreesToCompass(22.5)).toBe('NE');
    expect(degreesToCompass(90)).toBe('E');
    expect(degreesToCompass(180)).toBe('S');
    expect(degreesToCompass(270)).toBe('W');
    expect(degreesToCompass(337.4)).toBe('NW');
    expect(degreesToCompass(337.5)).toBe('N');
  });
});