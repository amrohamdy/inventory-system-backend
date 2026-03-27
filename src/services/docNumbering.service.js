const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Document Prefix constants
 */
const DocPrefix = {
    OPENING_BALANCE: 'OB',
    RECEIVE:         'GRN',
    ISSUE:           'ISS',
    TRANSFER:        'TRF',
    BREAKAGE:        'BRK',
    ADJUSTMENT:      'ADJ',
    COUNT_ADJUSTMENT:'ADJ',
    STOCK_COUNT:     'CNT',
    PERIOD_CLOSE:    'CLS',
    GET_PASS_OUT:    'GP',
    GET_PASS_RETURN: 'GPR'
};

/**
 * Generates the next document reference number for a given tenant + prefix + year.
 * Uses a "last writer wins" pattern with $queryRawUnsafe for atomic increment.
 *
 * Format: {PREFIX}-{YEAR}-{NNNNN}  e.g. GRN-2026-00001
 *
 * @param {string}  tenantId
 * @param {string}  prefix     — one of DocPrefix values, e.g. 'GRN'
 * @param {Date}    [date]     — reference date (defaults to now)
 * @param {object}  [tx]       — optional Prisma transaction client
 * @returns {Promise<string>}  — e.g. "GRN-2026-00042"
 */
const generateDocNumber = async (tenantId, prefix, date = new Date(), tx = null) => {
    const year = new Date(date).getFullYear();

    // Atomic upsert + increment using raw SQL to avoid race conditions
    // Works on PostgreSQL — increments lastSeq and returns new value in one query
    const result = await prisma.$queryRawUnsafe(
        `INSERT INTO doc_sequence ("id","tenantId","prefix","year","lastSeq")
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, 1)
         ON CONFLICT ("tenantId","prefix","year")
         DO UPDATE SET "lastSeq" = doc_sequence."lastSeq" + 1
         RETURNING "lastSeq"`,
        tenantId,
        prefix,
        year
    );

    const seq = Number(result[0]?.lastSeq ?? 1);
    const padded = String(seq).padStart(5, '0');
    return `${prefix}-${year}-${padded}`;
};

/**
 * Map from MovementType to DocPrefix
 */
const prefixFromMovementType = (movementType) => {
    return DocPrefix[movementType] || 'DOC';
};

module.exports = { generateDocNumber, DocPrefix, prefixFromMovementType };
