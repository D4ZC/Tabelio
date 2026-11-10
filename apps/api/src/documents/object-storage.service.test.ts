import { ConfigService } from '@nestjs/config';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ObjectStorageService } from './object-storage.service';

describe('eliminación de archivos del almacenamiento local', () => {
  let directory: string;
  let storage: ObjectStorageService;

  beforeEach(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'despacho-storage-test-'));
    storage = new ObjectStorageService(new ConfigService({ STORAGE_DRIVER: 'local', LOCAL_STORAGE_PATH: directory }));
  });

  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('borra el archivo físico y admite repetir la limpieza de uno ya ausente', async () => {
    const key = 'organizacion/expediente/prueba.png';
    await storage.putBuffer(key, Buffer.from('contenido ficticio'), 'image/png', 'prueba.png');
    await storage.delete(key);
    await expect(access(resolve(directory, key))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it('no oculta errores de borrado distintos de archivo inexistente', async () => {
    const key = 'organizacion/expediente/directorio';
    await mkdir(resolve(directory, key), { recursive: true });
    await expect(storage.delete(key)).rejects.toThrow();
    await expect(access(resolve(directory, key))).resolves.toBeUndefined();
  });

  it('no permite borrar rutas fuera del almacenamiento configurado', async () => {
    await expect(storage.delete('../fuera-del-almacenamiento')).rejects.toThrow();
  });
});
