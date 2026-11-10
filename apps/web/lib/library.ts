export interface LibraryFacet {
  value: string;
  label: string;
  count: number;
}

export interface LibraryReview {
  notes: string[];
  blockers: string[];
  fields: string[];
  subdocuments: string[];
  confidence: string;
}

export interface LibraryDocument {
  id: string;
  externalId: string;
  title: string;
  source: string;
  originalPath: string;
  documentType: string;
  documentTypeLabel: string;
  legalFamily: string;
  variant: string;
  usage: string;
  packageId: string;
  packageLabel: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  duplicateOf?: string | null;
  textEquivalentTo?: string | null;
  review: LibraryReview;
  readyForGeneration: false;
}

export interface LibraryDetail extends LibraryDocument {
  text: string;
  relatedDocuments: LibraryDocument[];
}

export interface LibraryResponse {
  summary: { total: number; uniqueFiles: number; packages: number; bySource: Record<string, number> };
  facets: { sources: LibraryFacet[]; documentTypes: LibraryFacet[]; legalFamilies: LibraryFacet[]; variants: LibraryFacet[]; usages: LibraryFacet[]; packages: LibraryFacet[] };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  documents: LibraryDocument[];
}

export interface LibraryAttachResponse {
  matterId: string;
  results: Array<{ id: string; sourceDocumentId: string; fileName: string; status: 'attached' | 'existing' | 'failed'; documentId?: string; error?: string }>;
}

export const libraryUsageLabels: Record<string, string> = {
  plantilla_base: 'Modelo base',
  modelo_personalizado: 'Modelo personalizado',
  caso_referencia: 'Caso de referencia',
  recurso_institucional: 'Recurso institucional',
};

export function libraryLabel(value: string) {
  const label = libraryUsageLabels[value] ?? value.replace(/([a-záéíóúñ])([A-Z])/g, '$1 $2').replace(/[_.]+/g, ' ').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function summarizeLibraryAttachment(results: LibraryAttachResponse['results']) {
  return results.reduce((summary, result) => {
    summary[result.status] += 1;
    return summary;
  }, { attached: 0, existing: 0, failed: 0 });
}
