/**
 * Seed default Units for a target tenant.
 *
 * Usage examples:
 *   node seed-units.js --tenantSlug=platform
 *   node seed-units.js --tenantId=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *
 * Notes:
 * - Requires DATABASE_URL in environment (same as Prisma).
 * - Idempotent: uses upsert on (tenantId, abbreviation).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_UNITS = [
  { name: 'Piece', abbreviation: 'pcs' },
  { name: 'Unit', abbreviation: 'unit' },
  { name: 'Dozen', abbreviation: 'dz' },
  { name: 'Set', abbreviation: 'set' },
  { name: 'Pair', abbreviation: 'pair' },
  { name: 'Kilogram', abbreviation: 'kg' },
  { name: 'Gram', abbreviation: 'g' },
  { name: 'Liter', abbreviation: 'ltr' },
  { name: 'Milliliter', abbreviation: 'ml' },
  { name: 'Bottle', abbreviation: 'btl' },
  { name: 'Can', abbreviation: 'can' },
  { name: 'Carton', abbreviation: 'ctn' },
  { name: 'Box', abbreviation: 'box' },
  { name: 'Pack', abbreviation: 'pk' },
  { name: 'Tray', abbreviation: 'try' },
  { name: 'Bag', abbreviation: 'bag' },
  { name: 'Gallon', abbreviation: 'gal' },
  { name: 'Roll', abbreviation: 'roll' },
  { name: 'Bucket', abbreviation: 'bkt' },
  { name: 'Jerrycan', abbreviation: 'jcn' },
  { name: 'Meter', abbreviation: 'm' },
  { name: 'Square Meter', abbreviation: 'm2' },
  { name: 'Sheet', abbreviation: 'sht' },
  { name: 'Box 100pcs', abbreviation: 'bx100' },
  { name: 'Person/Pax', abbreviation: 'pax' },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};

  for (const arg of args) {
    if (arg.startsWith('--tenantId=')) out.tenantId = arg.split('=')[1];
    if (arg.startsWith('--tenantSlug=')) out.tenantSlug = arg.split('=')[1];
  }

  if (!out.tenantId && !out.tenantSlug) {
    out.tenantSlug = process.env.TENANT_SLUG || 'platform';
  }

  return out;
}

async function resolveTenantId({ tenantId, tenantSlug }) {
  if (tenantId) return tenantId;

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, slug: true, name: true },
  });

  if (!tenant) {
    throw new Error(`Tenant not found for slug: ${tenantSlug}`);
  }

  console.log(`ℹ Target tenant: ${tenant.name} (${tenant.slug})`);
  return tenant.id;
}

async function seedUnitsForTenant(targetTenantId) {
  console.log(`\n── Seeding ${DEFAULT_UNITS.length} unit(s) for tenant: ${targetTenantId} ──`);

  let created = 0;
  let updated = 0;

  for (const unit of DEFAULT_UNITS) {
    const normalized = {
      name: unit.name.trim(),
      abbreviation: unit.abbreviation.trim().toLowerCase(),
      tenantId: targetTenantId,
      isActive: true,
      description: null,
    };

    const existing = await prisma.unit.findUnique({
      where: {
        tenantId_abbreviation: {
          tenantId: targetTenantId,
          abbreviation: normalized.abbreviation,
        },
      },
      select: { id: true },
    });

    await prisma.unit.upsert({
      where: {
        tenantId_abbreviation: {
          tenantId: targetTenantId,
          abbreviation: normalized.abbreviation,
        },
      },
      create: normalized,
      update: {
        name: normalized.name,
        isActive: true,
      },
    });

    if (existing) {
      updated += 1;
      console.log(`  ♻ Updated: ${normalized.name} (${normalized.abbreviation})`);
    } else {
      created += 1;
      console.log(`  ✅ Created: ${normalized.name} (${normalized.abbreviation})`);
    }
  }

  console.log('\n── Done ──');
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Total processed: ${DEFAULT_UNITS.length}`);
}

async function main() {
  const input = parseArgs();
  const targetTenantId = await resolveTenantId(input);
  await seedUnitsForTenant(targetTenantId);
}

main()
  .catch((error) => {
    console.error('❌ Seed failed:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

