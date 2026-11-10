interface SpokenSymbol {
  phrase: string;
  symbol: string;
}

export interface VoiceRecognitionResult {
  isFinal: boolean;
  0?: { transcript?: string };
}

/** Each event contains a replacement snapshot, rather than text to append. */
export function voiceRecognitionTranscript(results: ArrayLike<VoiceRecognitionResult>, includeInterim: boolean) {
  return Array.from(results)
    .filter((result) => result.isFinal || includeInterim)
    .map((result) => result[0]?.transcript?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
}

const spokenSymbols: SpokenSymbol[] = [
  { phrase: 'signo de interrogaci[oó]n de apertura|abrir signo de interrogaci[oó]n|abre interrogaci[oó]n|abrir interrogaci[oó]n', symbol: '¿' },
  { phrase: 'signo de interrogaci[oó]n de cierre|cerrar signo de interrogaci[oó]n|cierra interrogaci[oó]n|cerrar interrogaci[oó]n', symbol: '?' },
  { phrase: 'signo de admiraci[oó]n de apertura|signo de exclamaci[oó]n de apertura|abrir admiraci[oó]n|abre admiraci[oó]n|abrir exclamaci[oó]n|abre exclamaci[oó]n', symbol: '¡' },
  { phrase: 'signo de admiraci[oó]n de cierre|signo de exclamaci[oó]n de cierre|cerrar admiraci[oó]n|cierra admiraci[oó]n|cerrar exclamaci[oó]n|cierra exclamaci[oó]n', symbol: '!' },
  { phrase: 'abrir par[eé]ntesis|abre par[eé]ntesis|par[eé]ntesis de apertura', symbol: '(' },
  { phrase: 'cerrar par[eé]ntesis|cierra par[eé]ntesis|par[eé]ntesis de cierre', symbol: ')' },
  { phrase: 'abrir corchete|abre corchete|corchete de apertura', symbol: '[' },
  { phrase: 'cerrar corchete|cierra corchete|corchete de cierre', symbol: ']' },
  { phrase: 'abrir llave|abre llave|llave de apertura', symbol: '{' },
  { phrase: 'cerrar llave|cierra llave|llave de cierre', symbol: '}' },
  { phrase: 'abrir comillas dobles|abre comillas dobles|comillas dobles de apertura', symbol: '“' },
  { phrase: 'cerrar comillas dobles|cierra comillas dobles|comillas dobles de cierre', symbol: '”' },
  { phrase: 'abrir comillas simples|abre comillas simples|comillas simples de apertura', symbol: '‘' },
  { phrase: 'cerrar comillas simples|cierra comillas simples|comillas simples de cierre', symbol: '’' },
  { phrase: 'salto de l[ií]nea|nueva l[ií]nea', symbol: '\n' },
  { phrase: 'puntos suspensivos', symbol: '…' },
  { phrase: 'punto y coma', symbol: ';' },
  { phrase: 'dos puntos', symbol: ':' },
  { phrase: 'guion bajo|gui[oó]n bajo', symbol: '_' },
  { phrase: 'guion medio|gui[oó]n medio', symbol: '-' },
  { phrase: 'barra diagonal invertida|diagonal invertida|barra invertida|backslash', symbol: '\\' },
  { phrase: 'barra vertical|pleca|pipe', symbol: '|' },
  { phrase: 'barra diagonal|diagonal|slash', symbol: '/' },
  { phrase: 'signo de n[uú]mero|almohadilla|numeral|hashtag|hash', symbol: '#' },
  { phrase: 'signo de d[oó]lar', symbol: '$' },
  { phrase: 'signo de porcentaje|porcentaje|por ciento', symbol: '%' },
  { phrase: 'y comercial|ampersand', symbol: '&' },
  { phrase: 'signo de multiplicaci[oó]n', symbol: '×' },
  { phrase: 'signo de divisi[oó]n|dividido entre', symbol: '÷' },
  { phrase: 'signo de m[aá]s|signo m[aá]s', symbol: '+' },
  { phrase: 'signo de menos|signo menos', symbol: '−' },
  { phrase: 'menor o igual que', symbol: '≤' },
  { phrase: 'mayor o igual que', symbol: '≥' },
  { phrase: 'diferente de|distinto de', symbol: '≠' },
  { phrase: 'menor que', symbol: '<' },
  { phrase: 'mayor que', symbol: '>' },
  { phrase: 'signo igual|signo de igual', symbol: '=' },
  { phrase: 'comillas dobles|comillas', symbol: '"' },
  { phrase: 'comillas simples|ap[oó]strofe', symbol: "'" },
  { phrase: 'acento grave|backtick', symbol: '`' },
  { phrase: 'asterisco', symbol: '*' },
  { phrase: 'virgulilla|tilde', symbol: '~' },
  { phrase: 'circunflejo|caret', symbol: '^' },
  { phrase: 'signo de euro|euro', symbol: '€' },
  { phrase: 'libra esterlina', symbol: '£' },
  { phrase: 'signo de yen|yen', symbol: '¥' },
  { phrase: 'signo de grado|grados|grado', symbol: '°' },
  { phrase: 'marca registrada', symbol: '®' },
  { phrase: 'marca comercial', symbol: '™' },
  { phrase: 'derechos de autor|copyright', symbol: '©' },
  { phrase: 'signo de secci[oó]n', symbol: '§' },
  { phrase: 'vi[nñ]eta', symbol: '•' },
  { phrase: 'tabulador|tabulaci[oó]n', symbol: '\t' },
  { phrase: 'arroba', symbol: '@' },
  { phrase: 'punto medio', symbol: '·' },
  { phrase: 'punto', symbol: '.' },
  { phrase: 'coma', symbol: ',' },
  { phrase: 'gui[oó]n|raya', symbol: '-' },
  { phrase: 'espacio', symbol: ' ' },
];

export function formatVoiceTranscript(transcript: string) {
  let formatted = transcript;
  const tokens = spokenSymbols.map((command, index) => ({
    ...command,
    token: `\uE000${index}\uE001`,
  }));

  for (const { phrase, token } of tokens) {
    const expression = new RegExp(
      `(^|[^\\p{L}\\p{N}])(?:${phrase})(?=$|[^\\p{L}\\p{N}])`,
      'giu',
    );
    formatted = formatted.replace(expression, (_match, prefix: string) => `${prefix}${token}`);
  }
  for (const { symbol, token } of tokens) formatted = formatted.replaceAll(token, symbol);

  formatted = formatted
    .replace(/[ \t]+([,.;:!?…%)\]}])/g, '$1')
    .replace(/([¿¡([{])[ \t]+/g, '$1')
    .replace(/[ \t]*([@_\/\\|])[ \t]*/g, '$1')
    .replace(/([#$€£¥])\s+(?=[\p{L}\p{N}])/gu, '$1')
    .replace(/\s+([%°])/g, '$1')
    .replace(/#\s+(?=[\p{L}\p{N}])/gu, '#')
    .replace(/([“‘"'])\s+/g, '$1')
    .replace(/\s+([”’"'])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  // Conserva unidos los puntos dictados dentro de correos, dominios,
  // extensiones y números, sin quitar el espacio normal después de una frase.
  let previous: string;
  do {
    previous = formatted;
    formatted = formatted
      .replace(/\b([\p{L}\p{N}_-]+)\.\s+(?=[\p{L}\p{N}_-]+@)/gu, '$1.')
      .replace(/(@[^\s.]+(?:\.[^\s.]+)*)\.\s+(?=[\p{L}\p{N}])/gu, '$1.')
      .replace(/\b(\d+)\.\s+(?=\d)/g, '$1.')
      .replace(/\b([\p{L}\p{N}_-]+)\.\s+(com|mx|org|net|edu|gob|gov|io|co|es|dev|app|ai|pdf|docx?|xlsx?|csv|txt|json|xml|html?|js|tsx?|zip)\b/giu, '$1.$2');
  } while (formatted !== previous);

  return formatted;
}
