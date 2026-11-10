import { describe, expect, it } from 'vitest';
import { assistantAiAttachmentIds, assistantConversationContext, editableExtractionData, extractedDocumentText, prepareAssistantTurn } from './assistant-documents';

describe('lectura de documentos sin IA', () => {
  it('procesa archivos locales sin solicitar chat, incluso si tienen instrucciones escritas', () => {
    expect(prepareAssistantTurn('Extrae mi dirección', 1, 'local')).toEqual({
      content: 'Extrae mi dirección', localOnly: true, requestAssistant: false,
    });
    expect(prepareAssistantTurn('', 2, 'local').requestAssistant).toBe(false);
  });

  it('permite conversaciones normales y documentos enviados explícitamente a IA', () => {
    expect(prepareAssistantTurn('Busca un expediente', 0, 'local').requestAssistant).toBe(true);
    expect(prepareAssistantTurn('', 1, 'ai').requestAssistant).toBe(true);
    expect(prepareAssistantTurn('', 1, 'ai').localOnly).toBe(false);
  });

  it('excluye lecturas locales e instrucciones asociadas del contexto futuro', () => {
    expect(assistantConversationContext([
      { id: 'welcome', role: 'assistant', content: 'Inicio' },
      { role: 'user', content: 'Consulta autorizada' },
      { role: 'user', content: 'Datos privados del archivo', localOnly: true },
      { role: 'assistant', content: 'Texto local leído', localOnly: true },
      { role: 'assistant', content: 'Respuesta IA' },
    ])).toEqual([
      { role: 'user', content: 'Consulta autorizada' },
      { role: 'assistant', content: 'Respuesta IA' },
    ]);
  });

  it('conserva sólo referencias de adjuntos IA y elimina referencias locales conocidas', () => {
    expect(assistantAiAttachmentIds(['ai-previo'], [{ id: 'local', extractionMode: 'local' }], 'local')).toEqual(['ai-previo']);
    expect(assistantAiAttachmentIds(['local', 'ai-previo'], [
      { id: 'local', extractionMode: 'local' }, { id: 'ai-nuevo', extractionMode: 'ai' },
    ], 'ai')).toEqual(['ai-previo', 'ai-nuevo']);
    expect(assistantAiAttachmentIds([], [{ id: 'desconocido' }], 'local')).toEqual([]);
  });

  it('separa el texto original de los campos que se pueden corregir', () => {
    const data = { extractedText: 'Texto del documento', legalName: 'Ana' };
    expect(extractedDocumentText(data)).toBe('Texto del documento');
    expect(editableExtractionData(data)).toEqual({ legalName: 'Ana' });
    expect(extractedDocumentText({ extractedText: 3 })).toBe('');
  });
});
