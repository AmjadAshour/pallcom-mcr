import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';

let prismaInstance = null;

export function getPrismaClient(datasourceUrl = env.DATABASE_URL) {
  if (prismaInstance && (!datasourceUrl || prismaInstance._url === datasourceUrl)) {
    return prismaInstance;
  }
  const client = new PrismaClient(
    datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : undefined
  );
  client._url = datasourceUrl;
  if (!datasourceUrl || datasourceUrl === env.DATABASE_URL) {
    prismaInstance = client;
  }
  return client;
}

export async function closePrismaClient() {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}
