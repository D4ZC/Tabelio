import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

@Injectable()
export class ObjectStorageService {
  readonly bucket: string;
  readonly driver: 'local' | 's3';
  private readonly client?: S3Client;
  private readonly localRoot: string;
  private lastHealthCheck?: { checkedAt: number; result: { driver: 'local' | 's3'; bucket: string } };

  constructor(config: ConfigService) {
    this.driver = config.get('STORAGE_DRIVER', 'local') === 's3' ? 's3' : 'local';
    this.bucket = config.get('S3_BUCKET', 'expedientes');
    this.localRoot = resolve(config.get('LOCAL_STORAGE_PATH', './storage'));
    if (this.driver === 's3') {
      this.client = new S3Client({
        endpoint: config.get('S3_ENDPOINT'),
        region: config.get('S3_REGION', 'us-east-1'),
        forcePathStyle: config.get('S3_FORCE_PATH_STYLE', 'true') === 'true',
        credentials: {
          accessKeyId: config.getOrThrow('S3_ACCESS_KEY'),
          secretAccessKey: config.getOrThrow('S3_SECRET_KEY'),
        },
      });
    }
  }

  async put(key: string, file: Express.Multer.File) {
    return this.putBuffer(key, file.buffer, file.mimetype, file.originalname);
  }

  async putBuffer(key: string, buffer: Buffer, contentType: string, originalName: string) {
    if (this.driver === 'local') {
      const path = this.localPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buffer, { flag: 'wx' });
      return;
    }

    await this.client!.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        Metadata: { originalName: encodeURIComponent(originalName) },
      }),
    );
  }

  async open(key: string): Promise<Readable> {
    if (this.driver === 'local') return createReadStream(this.localPath(key));

    const result = await this.client!.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new InternalServerErrorException('El proveedor no devolvió el archivo');
    if (result.Body instanceof Readable) return result.Body;
    return Readable.from(await result.Body.transformToByteArray());
  }

  async delete(key: string) {
    if (this.driver === 'local') {
      await unlink(this.localPath(key)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      return;
    }
    await this.client!.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async healthCheck() {
    const now = Date.now();
    if (this.lastHealthCheck && now - this.lastHealthCheck.checkedAt < 10_000) {
      return this.lastHealthCheck.result;
    }
    const key = `_health/${randomUUID()}.txt`;
    const expected = Buffer.from(`storage-health-${now}`);
    try {
      await this.putBuffer(key, expected, 'text/plain', 'health.txt');
      const stream = await this.open(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (!Buffer.concat(chunks).equals(expected)) throw new Error('El proveedor devolvió contenido distinto al escrito');
      const result = { driver: this.driver, bucket: this.bucket };
      this.lastHealthCheck = { checkedAt: now, result };
      return result;
    } finally {
      await this.delete(key).catch(() => undefined);
    }
  }

  private localPath(key: string) {
    const path = resolve(this.localRoot, key);
    if (!path.startsWith(`${this.localRoot}${sep}`)) {
      throw new InternalServerErrorException('Llave de almacenamiento inválida');
    }
    return path;
  }
}
