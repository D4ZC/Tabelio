import { describe, expect, it } from 'vitest';
import { formatVoiceTranscript, voiceRecognitionTranscript, type VoiceRecognitionResult } from './voice-dictation';

const provisional = (transcript: string): VoiceRecognitionResult => ({ isFinal: false, 0: { transcript } });
const final = (transcript: string): VoiceRecognitionResult => ({ isFinal: true, 0: { transcript } });

describe('voiceRecognitionTranscript', () => {
  it('ignora hipótesis móviles acumuladas y conserva la frase confirmada una sola vez', () => {
    const hypotheses = ['cuales', 'cuales son', 'cuales son mis', 'cuales son mis pendientes'];
    for (let length = 1; length <= hypotheses.length; length += 1) {
      expect(voiceRecognitionTranscript(hypotheses.slice(0, length).map(provisional), false)).toBe('');
    }
    expect(voiceRecognitionTranscript([
      ...hypotheses.map(provisional), final('cuales son mis pendientes'),
    ], false)).toBe('cuales son mis pendientes');
  });

  it('mantiene repeticiones intencionales y segmentos finales con el mismo contenido', () => {
    expect(voiceRecognitionTranscript([final('muy muy importante')], false)).toBe('muy muy importante');
    expect(voiceRecognitionTranscript([final('no'), final('no')], false)).toBe('no no');
  });

  it('reemplaza el borrador del escritorio sin volver a añadir segmentos finales', () => {
    expect(voiceRecognitionTranscript([final('Busca contratos'), provisional('en')], true)).toBe('Busca contratos en');
    expect(voiceRecognitionTranscript([final('Busca contratos'), provisional('en revisión')], true)).toBe('Busca contratos en revisión');
    expect(voiceRecognitionTranscript([final('Busca contratos'), final('en revisión')], true)).toBe('Busca contratos en revisión');
  });

  it('retira borradores descartados sin perder el texto confirmado', () => {
    expect(voiceRecognitionTranscript([final('Busca contratos'), provisional('de compra')], true)).toBe('Busca contratos de compra');
    expect(voiceRecognitionTranscript([final('Busca contratos')], true)).toBe('Busca contratos');
    expect(voiceRecognitionTranscript([], true)).toBe('');
  });

  it('conserva los segmentos provisionales independientes del escritorio', () => {
    expect(voiceRecognitionTranscript([final('Busca'), provisional('contratos'), provisional('vigentes')], true)).toBe('Busca contratos vigentes');
  });
});

describe('formatVoiceTranscript', () => {
  it('forma correos y dominios con caracteres dictados', () => {
    expect(formatVoiceTranscript('david punto zepeda arroba ejemplo punto com'))
      .toBe('david.zepeda@ejemplo.com');
  });

  it('forma rutas, identificadores y signos comunes', () => {
    expect(formatVoiceTranscript('usuario guion bajo uno arroba servidor punto mx diagonal api diagonal v1'))
      .toBe('usuario_uno@servidor.mx/api/v1');
  });

  it('convierte puntuación, agrupadores y saltos de línea', () => {
    expect(formatVoiceTranscript('abre paréntesis prueba cierra paréntesis coma nueva línea listo punto'))
      .toBe('(prueba),\nlisto.');
  });

  it('convierte símbolos matemáticos y especiales', () => {
    expect(formatVoiceTranscript('x mayor o igual que diez punto cinco por ciento y comercial y'))
      .toBe('x ≥ diez. cinco% & y');
  });

  it('no cambia palabras que sólo contienen el nombre de un símbolo', () => {
    expect(formatVoiceTranscript('Busca por nombre e indica si es igual al anterior'))
      .toBe('Busca por nombre e indica si es igual al anterior');
  });
});
