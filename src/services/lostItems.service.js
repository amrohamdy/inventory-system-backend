'use strict';

const prisma = require('../config/database');

const userBrief = (u) =>
    u
        ? {
              id: u.id,
              firstName: u.firstName,
              lastName: u.lastName,
          }
        : null;

/**
 * List ledger rows for Get Pass lost quantity (LOAN_WRITE_OFF), enriched with return + pass + item.
 */
const listLostItems = async (tenantId, query = {}) => {
    const skipN = Number.parseInt(String(query.skip ?? 0), 10) || 0;
    const takeN = Math.min(Number.parseInt(String(query.take ?? 20), 10) || 20, 100);
    const search = typeof query.search === 'string' ? query.search.trim() : '';

    const where = {
        tenantId,
        movementType: 'LOAN_WRITE_OFF',
        ...(search
            ? {
                  item: {
                      OR: [
                          { name: { contains: search, mode: 'insensitive' } },
                          { barcode: { contains: search, mode: 'insensitive' } },
                      ],
                  },
              }
            : {}),
    };

    const [ledgerRows, total] = await Promise.all([
        prisma.inventoryLedger.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: skipN,
            take: takeN,
            include: {
                item: { select: { id: true, name: true, barcode: true } },
            },
        }),
        prisma.inventoryLedger.count({ where }),
    ]);

    const returnIds = [...new Set(ledgerRows.map((r) => r.referenceId).filter(Boolean))];
    const returns =
        returnIds.length > 0
            ? await prisma.getPassReturn.findMany({
                  where: { id: { in: returnIds } },
                  include: {
                      getPassLine: {
                          include: {
                              getPass: { select: { id: true, passNo: true } },
                          },
                      },
                      registeredByUser: { select: { id: true, firstName: true, lastName: true } },
                      securityUser: { select: { id: true, firstName: true, lastName: true } },
                  },
              })
            : [];

    const byReturnId = new Map(returns.map((r) => [r.id, r]));

    const items = ledgerRows.map((L) => {
        const gpr = L.referenceId ? byReturnId.get(L.referenceId) : null;
        const passNo = gpr?.getPassLine?.getPass?.passNo ?? L.referenceNo ?? null;
        const securityOfficer = gpr?.securityUser ?? gpr?.registeredByUser ?? null;

        return {
            id: L.id,
            itemName: L.item?.name ?? '',
            itemBarcode: L.item?.barcode ?? null,
            qtyLost: Number(L.qtyOut),
            date: (gpr?.returnDate ?? L.createdAt).toISOString(),
            getPassRef: passNo,
            /** Prefer Security verifier; falls back to registrar who recorded the return. */
            lossRecordedBy: userBrief(securityOfficer),
            getPassReturnId: gpr?.id ?? L.referenceId,
        };
    });

    return { items, total };
};

module.exports = {
    listLostItems,
};
