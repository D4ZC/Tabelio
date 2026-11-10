import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { parseWebOrigins } from './config/runtime-config';
import { randomUUID } from 'node:crypto';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const origins = parseWebOrigins(config.get('WEB_ORIGIN', 'http://localhost:3000'));

  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });
  app.setGlobalPrefix('api', {
    exclude: [{ path: 'mcp', method: RequestMethod.ALL }],
  });
  app.enableCors({
    origin: origins,
    credentials: true,
  });
  app.enableShutdownHooks();
  app.use((request: { headers: Record<string, string | string[] | undefined> }, response: {
    setHeader(name: string, value: string): void;
  }, next: () => void) => {
    const requestId = randomUUID();
    request.headers['x-request-id'] = requestId;
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = config.get<number>('API_PORT', 4000);
  await app.listen(port);
  console.info(`API disponible en http://localhost:${port}/api`);
}

void bootstrap();
