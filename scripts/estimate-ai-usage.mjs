#!/usr/bin/env node
// Explicit, scoped valuation of already captured usage. It never calls an AI provider.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
class UsageCliError extends Error {}
const help = 'Uso: node scripts/estimate-ai-usage.mjs --email <correo> --organization <id-o-slug> [--conversation <id>] [--limit <1-500>] [--after <cursor>] [--apply]\nSin --apply sólo muestra una vista previa. Los históricos requieren effectiveFrom explícito en AI_USAGE_PRICING_JSON.';

let prisma;
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(help); process.exit(0); }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--apply') { options.apply = true; continue; }
    if (!['--email', '--organization', '--conversation', '--limit', '--after'].includes(flag)
      || !args[index + 1] || args[index + 1].startsWith('--')) throw new UsageCliError(help);
    options[flag.slice(2)] = args[++index];
  }
  if (!options.email || !options.organization) throw new UsageCliError(help);
  const limit = Number(options.limit ?? '100');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new UsageCliError('--limit debe estar entre 1 y 500.');
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!process.env.AI_USAGE_PRICING_JSON?.trim()) throw new UsageCliError('Falta AI_USAGE_PRICING_JSON; no se modificó ningún consumo.');
  require('reflect-metadata');
  const { ConfigService } = require('@nestjs/config');
  const { PrismaClient } = require('@despacho/database');
  const { AiUsageService } = require('../apps/api/dist/ai-usage/ai-usage.service.js');
  if (typeof AiUsageService.prototype.estimatePending !== 'function') throw new UsageCliError('Compila la API antes de ejecutar la valoración de consumos.');
  prisma = new PrismaClient();
  const memberships = await prisma.membership.findMany({
    where: {
      user: { email: options.email.trim().toLowerCase(), active: true },
      organization: { OR: [{ id: options.organization }, { slug: options.organization }] },
    },
    take: 2,
    include: {
      user: { select: { id: true, email: true, displayName: true } },
      organization: { select: { id: true, name: true } },
    },
  });
  if (memberships.length !== 1) throw new UsageCliError('No se encontró una membresía única para ese usuario y organización.');
  const membership = memberships[0];
  const principal = {
    userId: membership.user.id, email: membership.user.email, displayName: membership.user.displayName,
    organizationId: membership.organization.id, organizationName: membership.organization.name,
    membershipId: membership.id, role: membership.role,
  };
  const usage = new AiUsageService(prisma, new ConfigService(process.env));
  const result = await usage.estimatePending(principal, {
    conversationId: options.conversation, limit, afterId: options.after, dryRun: !options.apply,
  });
  console.log(JSON.stringify({ dryRun: !options.apply, ...result }, null, 2));
} catch (error) {
  // Never print connection strings, raw config, provider credentials, or database errors.
  console.error(error instanceof UsageCliError ? error.message
    : 'No fue posible valorar los consumos. Revisa las migraciones, el build de API y la configuración de tarifas.');
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}
