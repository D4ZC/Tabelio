import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderDocxTemplate } from './docx-template';

@Injectable()
export class DocxTemplateService {
  private readonly templateRoot: string;
  private readonly cache = new Map<string, Buffer>();

  constructor(config: ConfigService) {
    const configured = config.get<string>('TEMPLATE_ROOT');
    const candidates = configured
      ? [resolve(configured)]
      : [resolve(process.cwd(), 'apps/api/templates'), resolve(process.cwd(), 'templates')];
    const root = candidates.find((candidate) => existsSync(candidate));
    if (!root) throw new InternalServerErrorException('No se encontró el catálogo de plantillas DOCX');
    this.templateRoot = root;
  }

  async renderLeaseV1(values: Record<string, string>): Promise<Buffer> {
    return this.render('lease-v1.docx', values);
  }

  async renderAgreementV1(values: Record<string, string>): Promise<Buffer> {
    return this.render('agreement-v1.docx', values);
  }

  private async render(name: string, values: Record<string, string>): Promise<Buffer> {
    let template = this.cache.get(name);
    if (!template) {
      template = await readFile(resolve(this.templateRoot, name));
      this.cache.set(name, template);
    }
    return renderDocxTemplate(template, values);
  }
}
