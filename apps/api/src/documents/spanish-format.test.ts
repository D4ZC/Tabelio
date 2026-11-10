import { describe, expect, it } from 'vitest';
import { numberToSpanish, numberWithWords, spanishDateParts, spanishTime } from './spanish-format';

describe('formato jurídico en español', () => {
  it('convierte números usados por la plantilla', () => {
    expect(numberToSpanish(31)).toBe('treinta y uno');
    expect(numberToSpanish(100)).toBe('cien');
    expect(numberToSpanish(244)).toBe('doscientos cuarenta y cuatro');
    expect(numberToSpanish(2026)).toBe('dos mil veintiséis');
    expect(numberWithWords('IJA-244')).toBe('IJA-244');
  });

  it('genera fecha y hora deterministas en UTC', () => {
    const value = new Date('2026-12-01T16:05:00.000Z');
    expect(spanishDateParts(value)).toEqual({
      day: '1 uno',
      month: 'diciembre',
      year: '2026 dos mil veintiséis',
      full: '1 uno de diciembre de 2026 dos mil veintiséis',
    });
    expect(spanishTime(value)).toBe('16:05 horas');
  });
});
