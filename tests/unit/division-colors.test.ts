import { describe, it, expect } from 'vitest';
import { buildDivisionColorMap, DIVISION_COLOR_PALETTE } from '@/lib/division-colors';

describe('buildDivisionColorMap', () => {
  const divisions = [
    { id: 'd-midgets', name: 'Sharpsville Midgets' },
    { id: 'd-peewees', name: 'Sharpsville Pee Wees' },
    { id: 'd-weewees', name: 'Sharpsville Wee Wees' },
  ];

  it('assigns distinct palette colors per division', () => {
    const map = buildDivisionColorMap(divisions);
    const colors = Object.values(map);
    expect(new Set(colors).size).toBe(divisions.length);
    colors.forEach(c => expect(DIVISION_COLOR_PALETTE).toContain(c));
  });

  it('is order-independent — query order cannot shift colors between pages', () => {
    const shuffled = [divisions[2], divisions[0], divisions[1]];
    expect(buildDivisionColorMap(shuffled)).toEqual(buildDivisionColorMap(divisions));
  });

  it('handles empty and null input', () => {
    expect(buildDivisionColorMap([])).toEqual({});
    expect(buildDivisionColorMap(null)).toEqual({});
    expect(buildDivisionColorMap(undefined)).toEqual({});
  });

  it('wraps the palette when there are more divisions than colors', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, name: `Div ${String(i).padStart(2, '0')}` }));
    const map = buildDivisionColorMap(many);
    expect(Object.keys(map)).toHaveLength(10);
    expect(map['d8']).toBe(DIVISION_COLOR_PALETTE[0]);
  });
});
