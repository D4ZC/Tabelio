export const SIGNATURE_PROVIDER = Symbol('SIGNATURE_PROVIDER');

export interface CreateSignatureRequestInput {
  matterId: string;
  sourceDocumentId: string;
  objectKey: string;
  signers: Array<{ name: string; email?: string }>;
}

export interface SignatureProviderPort {
  createRequest(input: CreateSignatureRequestInput): Promise<{
    provider: string;
    externalReference?: string;
  }>;
}
