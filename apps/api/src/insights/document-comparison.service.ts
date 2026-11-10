import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DocumentsService } from '../documents/documents.service';
import { InsightAiService, type InsightAiResult, type InsightSource } from './insight-ai.service';
import type { InsightOptions, InsightResult } from './insight.types';

@Injectable()
export class DocumentComparisonService {
  constructor(private readonly documents: DocumentsService, private readonly ai: InsightAiService) {}

  async analyze(user: AuthenticatedUser, id: string, options: InsightOptions = {}): Promise<InsightResult> {
    const mode = options.mode ?? 'local';
    if (!['local', 'ai'].includes(mode)) throw new BadRequestException('Selecciona comparación local o con IA.');
    const comparison = await this.documents.comparePrevious(user, id);
    const limitations = ['La comparación corresponde al texto de párrafos de borradores DOCX; no evalúa formato, firmas ni autenticidad.'];
    const changes = comparison.changes.slice(0, 19);
    if (changes.length !== comparison.changes.length) limitations.push(`Se explican los primeros ${changes.length} de ${comparison.changes.length} párrafos modificados; la comparación exacta conserva todos los cambios.`);
    const sourceId = `versions:${id}`;
    const sources: InsightSource[] = [{ id: sourceId, label: 'Versiones comparadas y total de cambios', text: JSON.stringify({ current: comparison.currentDocument, previous: comparison.previousDocument, changedParagraphs: comparison.changes.length }) }];
    const excerpts = new Map<number, { before: string; after: string }>();
    for (const change of changes) {
      let before = change.before.slice(0, 450);
      let after = change.after.slice(0, 450);
      let text = JSON.stringify({ paragraph: change.paragraph, before, after });
      while (text.length > 1500) {
        before = before.slice(0, Math.floor(before.length * 0.75));
        after = after.slice(0, Math.floor(after.length * 0.75));
        text = JSON.stringify({ paragraph: change.paragraph, before, after });
      }
      if (before !== change.before || after !== change.after) {
        limitations.push(`El texto del párrafo ${change.paragraph} se ha limitado; revisa el cambio completo en la comparación exacta.`);
      }
      excerpts.set(change.paragraph, { before, after });
      sources.push({ id: `paragraph:${id}:${change.paragraph}`, label: `Párrafo ${change.paragraph} · antes y después`, text });
    }
    const local: InsightAiResult = {
      title: `Comparación v${comparison.previousDocument.version} → v${comparison.currentDocument.version}`,
      summary: comparison.changes.length ? `${comparison.changes.length} párrafos tienen diferencias de texto. ${changes.filter((c) => !c.before).length} incorporados y ${changes.filter((c) => !c.after).length} eliminados entre los ${changes.length} mostrados.` : 'No se detectaron diferencias en el texto de los párrafos.',
      items: changes.map((change) => ({
        title: `Párrafo ${change.paragraph}: ${!change.before ? 'incorporado' : !change.after ? 'eliminado' : 'modificado'}`,
        detail: `${change.before ? `Antes: ${excerpts.get(change.paragraph)!.before}` : 'Antes: sin texto.'}\n${change.after ? `Después: ${excerpts.get(change.paragraph)!.after}` : 'Después: sin texto.'}`,
        severity: 'info', sourceIds: [`paragraph:${id}:${change.paragraph}`],
      })),
    };
    const result = mode === 'ai' ? await this.ai.generate(user, {
      kind: 'comparison', sources, localResult: local, conversationId: options.conversationId, documentId: id,
    }) : local;
    return {
      ...result, kind: 'comparison', mode, generatedAt: new Date().toISOString(),
      sources: sources.map(({ id: source, label }) => ({ id: source, label })),
      limitations: [...limitations, mode === 'ai' ? 'La explicación con IA no sustituye las diferencias exactas ni la revisión jurídica.' : 'Comparación calculada localmente, sin llamadas al proveedor de IA.'],
      facts: { currentDocument: comparison.currentDocument, previousDocument: comparison.previousDocument, changedParagraphs: comparison.changes.length },
    };
  }
}
