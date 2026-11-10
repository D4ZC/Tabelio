export interface VersionedDocument {
  id: string;
  matterId?: string | null;
  type: string;
  version: number;
  personId?: string | null;
  propertyId?: string | null;
  invalidatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

const PERSON_SCOPED_TYPES = new Set([
  'LANDLORD_ID',
  'TENANT_ID',
  'GUARANTOR_ID',
  'TAX_ID',
  'PROOF_OF_ADDRESS',
]);

const PROPERTY_SCOPED_TYPES = new Set([
  'PROPERTY_TITLE',
  'GUARANTEE_PROPERTY_TITLE',
]);

/**
 * Builds the identity whose latest active version is operational.
 * OTHER documents are independent evidence and never supersede one another.
 */
export function documentVersionKey(document: VersionedDocument): string {
  const matterScope = `matter:${document.matterId ?? 'current'}`;
  if (document.type === 'OTHER') return `${matterScope}:document:${document.id}`;
  if (PERSON_SCOPED_TYPES.has(document.type)) {
    return `${matterScope}:person:${document.type}:${document.personId ?? 'unassigned'}`;
  }
  if (PROPERTY_SCOPED_TYPES.has(document.type)) {
    return `${matterScope}:property:${document.type}:${document.propertyId ?? 'unassigned'}`;
  }
  return `${matterScope}:type:${document.type}`;
}

/**
 * Returns only the operational version for each logical document while
 * preserving the input order. Invalidated versions are ignored, allowing the
 * previous active version to become operational again after invalidation.
 */
export function currentDocuments<T extends VersionedDocument>(documents: T[]): T[] {
  const latestByKey = new Map<string, T>();
  for (const document of documents) {
    if (document.invalidatedAt) continue;
    const key = documentVersionKey(document);
    const current = latestByKey.get(key);
    if (!current || compareDocumentVersions(document, current) > 0) {
      latestByKey.set(key, document);
    }
  }
  const currentIds = new Set([...latestByKey.values()].map((document) => document.id));
  return documents.filter((document) => currentIds.has(document.id));
}

function compareDocumentVersions(left: VersionedDocument, right: VersionedDocument): number {
  if (left.version !== right.version) return left.version - right.version;
  const createdDifference = dateValue(left.createdAt) - dateValue(right.createdAt);
  if (createdDifference !== 0) return createdDifference;
  return left.id.localeCompare(right.id);
}

function dateValue(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}
