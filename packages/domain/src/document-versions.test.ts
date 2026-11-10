import { describe, expect, it } from 'vitest';
import { currentDocuments, documentVersionKey, type VersionedDocument } from './document-versions';

function document(overrides: Partial<VersionedDocument> & Pick<VersionedDocument, 'id' | 'type'>): VersionedDocument {
  return { version: 1, ...overrides };
}

describe('versiones documentales operativas', () => {
  it('conserva sólo la versión más reciente de una persona y reactiva la anterior al invalidarla', () => {
    const previous = document({ id: 'previous', type: 'LANDLORD_ID', personId: 'person-1', version: 1 });
    const latest = document({ id: 'latest', type: 'LANDLORD_ID', personId: 'person-1', version: 2 });
    expect(currentDocuments([previous, latest]).map(({ id }) => id)).toEqual(['latest']);
    expect(currentDocuments([previous, { ...latest, invalidatedAt: '2026-10-09' }]).map(({ id }) => id))
      .toEqual(['previous']);
  });

  it('mantiene documentos del mismo tipo cuando pertenecen a personas o inmuebles distintos', () => {
    const documents = [
      document({ id: 'address-1', type: 'PROOF_OF_ADDRESS', personId: 'person-1', version: 1 }),
      document({ id: 'address-2', type: 'PROOF_OF_ADDRESS', personId: 'person-2', version: 2 }),
      document({ id: 'title-1', type: 'PROPERTY_TITLE', propertyId: 'property-1', version: 1 }),
      document({ id: 'title-2', type: 'PROPERTY_TITLE', propertyId: 'property-2', version: 2 }),
    ];
    expect(currentDocuments(documents).map(({ id }) => id)).toEqual(documents.map(({ id }) => id));
  });

  it('mantiene separadas las versiones de expedientes distintos aunque compartan persona', () => {
    const firstMatter = document({
      id: 'matter-1-id', matterId: 'matter-1', type: 'LANDLORD_ID', personId: 'person-1', version: 1,
    });
    const secondMatter = document({
      id: 'matter-2-id', matterId: 'matter-2', type: 'LANDLORD_ID', personId: 'person-1', version: 2,
    });
    expect(currentDocuments([firstMatter, secondMatter])).toEqual([firstMatter, secondMatter]);
  });

  it('trata cada archivo OTHER como evidencia independiente', () => {
    const first = document({ id: 'other-1', type: 'OTHER', version: 1 });
    const second = document({ id: 'other-2', type: 'OTHER', version: 2 });
    expect(documentVersionKey(first)).not.toBe(documentVersionKey(second));
    expect(currentDocuments([first, second])).toEqual([first, second]);
  });

  it('elige de forma determinista cuando dos registros comparten versión', () => {
    const first = document({ id: 'a', type: 'LEASE_ANNEX', version: 1, createdAt: '2026-10-08' });
    const second = document({ id: 'b', type: 'LEASE_ANNEX', version: 1, createdAt: '2026-10-09' });
    expect(currentDocuments([first, second])).toEqual([second]);
  });
});
