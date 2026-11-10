const SMALL_NUMBERS = [
  'cero',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];

const TENS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS: Record<number, string> = {
  100: 'cien',
  200: 'doscientos',
  300: 'trescientos',
  400: 'cuatrocientos',
  500: 'quinientos',
  600: 'seiscientos',
  700: 'setecientos',
  800: 'ochocientos',
  900: 'novecientos',
};

export function numberToSpanish(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 999_999) {
    throw new RangeError('Sólo se admiten enteros entre 0 y 999999');
  }
  if (value < 30) return SMALL_NUMBERS[value];
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const units = value % 10;
    return units === 0 ? TENS[tens] : `${TENS[tens]} y ${SMALL_NUMBERS[units]}`;
  }
  if (value < 1_000) {
    if (value === 100) return HUNDREDS[100];
    const hundreds = Math.floor(value / 100) * 100;
    const remainder = value % 100;
    const prefix = hundreds === 100 ? 'ciento' : HUNDREDS[hundreds];
    return remainder === 0 ? prefix : `${prefix} ${numberToSpanish(remainder)}`;
  }
  const thousands = Math.floor(value / 1_000);
  const remainder = value % 1_000;
  const prefix = thousands === 1 ? 'mil' : `${numberToSpanish(thousands)} mil`;
  return remainder === 0 ? prefix : `${prefix} ${numberToSpanish(remainder)}`;
}

export function numberWithWords(value: string | number): string {
  const text = String(value).trim();
  if (!/^\d{1,6}$/.test(text)) return text;
  const numeric = Number(text);
  return `${text} ${numberToSpanish(numeric)}`;
}

export interface SpanishDateParts {
  day: string;
  month: string;
  year: string;
  full: string;
}

export function spanishDateParts(value: Date): SpanishDateParts {
  if (Number.isNaN(value.getTime())) throw new RangeError('Fecha inválida');
  const dayNumber = value.getUTCDate();
  const yearNumber = value.getUTCFullYear();
  const month = new Intl.DateTimeFormat('es-MX', { month: 'long', timeZone: 'UTC' }).format(value);
  const day = `${dayNumber} ${numberToSpanish(dayNumber)}`;
  const year = `${yearNumber} ${numberToSpanish(yearNumber)}`;
  return { day, month, year, full: `${day} de ${month} de ${year}` };
}

export function spanishTime(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new RangeError('Fecha inválida');
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes} horas`;
}
