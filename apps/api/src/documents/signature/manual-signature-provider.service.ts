import { Injectable } from '@nestjs/common';
import type {
  CreateSignatureRequestInput,
  SignatureProviderPort,
} from './signature-provider.port';

@Injectable()
export class ManualSignatureProviderService implements SignatureProviderPort {
  async createRequest(_input: CreateSignatureRequestInput) {
    return { provider: 'MANUAL' };
  }
}
