import { LibraryClient } from './library-client';

export default async function LibraryPage({ searchParams }: {
  searchParams: Promise<{ matterId?: string | string[]; documentId?: string | string[] }>;
}) {
  const { matterId, documentId } = await searchParams;
  return <LibraryClient initialMatterId={typeof matterId === 'string' ? matterId : ''} initialDocumentId={typeof documentId === 'string' ? documentId : ''} />;
}
