/**
 * Phase 5 — Store Requisition & Issue Smoke Test
 *
 * T1.  Manual OUT without requisitionId → 403
 * T2.  Issue against DRAFT requisition → 403
 * T3.  Issue qty exceeds remaining qty → 422
 * T4.  Insufficient stock → 422
 * T5.  Partial issue → requisition status = PARTIALLY_ISSUED
 * T6.  Final issue → requisition status = CLOSED (auto after FULLY_ISSUED)
 * T7.  PATCH/DELETE on POSTED issue → 423
 * T8.  Atomic rollback: if any line fails, no ledger entries created
 * T9.  Ledger OUT entries have referenceType = REQ_ISSUE
 * T10. RequisitionLine.totalIssuedQty correctly accumulates across partial issues
 *
 * Usage: node test-requisition-phase5.js
 */

'use strict';

const http = require('http');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = 'http://localhost:4000/api';
const TENANT_SLUG = 'grand-horizon';
const EMAIL = 'admin@grandhorizon.com';
const PASSWORD = 'Admin@123';

let token = '';
let tenantId, userId, locationId, itemId, uomId;

// ─── HTTP Helper ─────────────────────────────────────────────────────────────

const req = (method, path, body) => new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
        hostname: url.hostname, port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
    };
    const r = http.request(options, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
            try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
            catch { resolve({ status: res.statusCode, body: data }); }
        });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
});

// ─── Output ───────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const sep = () => console.log('─'.repeat(68));
const assert = (label, cond, actual) => {
    if (cond) { console.log(`  ✅ PASS — ${label}`); passed++; }
    else { console.log(`  ❌ FAIL — ${label}`); if (actual !== undefined) console.log(`         Got: ${JSON.stringify(actual)}`); failed++; }
};

// ─── Seed ─────────────────────────────────────────────────────────────────────

const seed = async () => {
    const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
    if (!tenant) throw new Error(`Tenant '${TENANT_SLUG}' not found`);
    tenantId = tenant.id;

    const user = await prisma.user.findFirst({ where: { tenantId, email: EMAIL } });
    if (!user) throw new Error(`User not found`);
    userId = user.id;

    const loc = await prisma.location.findFirst({ where: { tenantId } });
    if (!loc) throw new Error('No locations');
    locationId = loc.id;

    const item = await prisma.item.findFirst({ where: { tenantId } });
    if (!item) throw new Error('No items');
    itemId = item.id;

    const unit = await prisma.unit.findFirst({ where: { tenantId } });
    if (!unit) throw new Error('No units');
    uomId = unit.id;
};

/** Seed a stock balance of given quantity for test item */
const setStock = async (qty) => {
    await prisma.stockBalance.upsert({
        where: { tenantId_itemId_locationId: { tenantId, itemId, locationId } },
        create: { tenantId, itemId, locationId, qtyOnHand: qty, wacUnitCost: 50 },
        update: { qtyOnHand: qty, wacUnitCost: 50, lastUpdated: new Date() },
    });
};

/** Create a requisition via API */
const createReq = async (status = 'DRAFT', requestedQty = 10) => {
    const createRes = await req('POST', '/requisitions', {
        departmentName: 'Kitchen',
        locationId,
        lines: [{ itemId, uomId, requestedQty }],
    });
    const id = createRes.body.data?.id;
    if (!id) throw new Error(`Failed to create requisition: ${JSON.stringify(createRes.body)}`);

    if (status === 'SUBMITTED' || status === 'APPROVED') {
        await req('POST', `/requisitions/${id}/submit`, {});
    }
    if (status === 'APPROVED') {
        await req('POST', `/requisitions/${id}/approve`, { comment: 'Approved for test' });
    }
    return id;
};

/** Cleanup test requisitions */
const cleanup = async (ids = []) => {
    for (const id of ids) {
        try {
            // Cascade deletes issues + lines
            await prisma.storeIssue.deleteMany({ where: { requisitionId: id } });
            await prisma.storeRequisition.delete({ where: { id } }).catch(() => { });
        } catch { }
    }
};

// ─── Tests ────────────────────────────────────────────────────────────────────

async function run() {
    sep();
    console.log(`  Phase 5 — Store Requisition & Issue Smoke Test`);
    console.log(`  ${new Date().toISOString()}`);
    sep();

    // Auth
    console.log('\n── Step 0: Authenticate ─────────────────────────────────────────');
    const authRes = await req('POST', '/auth/login', { email: EMAIL, password: PASSWORD, tenantSlug: TENANT_SLUG });
    if (authRes.status !== 200 || !authRes.body.data?.accessToken) {
        console.error('FATAL: Auth failed:', authRes.body);
        process.exit(1);
    }
    token = authRes.body.data.accessToken;
    console.log(`  ✅ Authenticated`);

    await seed();
    const testIds = [];

    // ── T1: Manual OUT via movement API without requisitionId → 403 ──────────
    console.log('\n══ T1: Manual OUT blocked without requisitionId ══════════════════');
    const t1Res = await req('POST', '/movements', {
        movementType: 'ISSUE',
        sourceLocationId: locationId,
        lines: [{ itemId, locationId, qtyRequested: 5 }],
    });
    console.log(`  POST /movements (ISSUE, no reqId) → HTTP ${t1Res.status}`);
    assert('T1: Manual ISSUE without requisitionId → 403', t1Res.status === 403);

    // ── T2: Issue against DRAFT requisition → 403 ────────────────────────────
    console.log('\n══ T2: Issue against DRAFT requisition ══════════════════════════');
    const t2ReqId = await createReq('DRAFT', 10);
    testIds.push(t2ReqId);

    const t2 = await req('POST', '/issues', {
        requisitionId: t2ReqId,
        lines: [{ requisitionLineId: 'dummy', issuedQty: 5 }],
    });
    console.log(`  POST /issues (DRAFT req) → HTTP ${t2.status}: "${t2.body?.message}"`);
    assert('T2: Issue against DRAFT req → 403', t2.status === 403);

    // ── T3: Issue qty exceeds remaining → 422 ────────────────────────────────
    console.log('\n══ T3: Issue exceeds remaining qty ══════════════════════════════');
    await setStock(100);
    const t3ReqId = await createReq('APPROVED', 5); // Request 5
    testIds.push(t3ReqId);
    const t3Detail = await req('GET', `/requisitions/${t3ReqId}`, null);
    const t3LineId = t3Detail.body.data?.lines?.[0]?.id;

    const t3 = await req('POST', '/issues', {
        requisitionId: t3ReqId,
        lines: [{ requisitionLineId: t3LineId, issuedQty: 10 }], // Request 10 but only 5 remaining
    });
    console.log(`  POST /issues (over-issue) → HTTP ${t3.status}: "${t3.body?.message}"`);
    assert('T3: Over-issue → 422', t3.status === 422);

    // ── T4: Insufficient stock → 422 ─────────────────────────────────────────
    console.log('\n══ T4: Insufficient stock ════════════════════════════════════════');
    await setStock(0); // Empty the store
    const t4ReqId = await createReq('APPROVED', 10);
    testIds.push(t4ReqId);
    const t4Detail = await req('GET', `/requisitions/${t4ReqId}`, null);
    const t4LineId = t4Detail.body.data?.lines?.[0]?.id;

    const t4 = await req('POST', '/issues', {
        requisitionId: t4ReqId,
        lines: [{ requisitionLineId: t4LineId, issuedQty: 5 }],
    });
    console.log(`  POST /issues (no stock) → HTTP ${t4.status}: "${t4.body?.message}"`);
    assert('T4: Insufficient stock → 422', t4.status === 422);

    // ── T5: Partial issue → PARTIALLY_ISSUED ─────────────────────────────────
    console.log('\n══ T5: Partial Issue → PARTIALLY_ISSUED ═════════════════════════');
    await setStock(100);
    const t5ReqId = await createReq('APPROVED', 10);
    testIds.push(t5ReqId);
    const t5Detail = await req('GET', `/requisitions/${t5ReqId}`, null);
    const t5LineId = t5Detail.body.data?.lines?.[0]?.id;

    // Create and post a partial issue (5 of 10)
    const t5IssueRes = await req('POST', '/issues', {
        requisitionId: t5ReqId,
        lines: [{ requisitionLineId: t5LineId, issuedQty: 5 }],
    });
    const t5IssueId = t5IssueRes.body.data?.id;
    assert('T5: Partial issue created', t5IssueRes.status === 201);

    const t5PostRes = await req('POST', `/issues/${t5IssueId}/post`, {});
    console.log(`  POST /issues/:id/post → HTTP ${t5PostRes.status}`);
    assert('T5: Partial issue posted', t5PostRes.status === 200);

    const t5Req = await req('GET', `/requisitions/${t5ReqId}`, null);
    console.log(`  Requisition status after partial issue: ${t5Req.body.data?.status}`);
    assert('T5: Requisition status = PARTIALLY_ISSUED', t5Req.body.data?.status === 'PARTIALLY_ISSUED');

    // ── T6: Final issue → FULLY_ISSUED → CLOSED ──────────────────────────────
    console.log('\n══ T6: Final Issue → CLOSED ══════════════════════════════════════');
    const t6LineId = t5LineId; // same req/line — 5 remaining
    const t6IssueRes = await req('POST', '/issues', {
        requisitionId: t5ReqId,   // same req
        lines: [{ requisitionLineId: t6LineId, issuedQty: 5 }], // remaining 5
    });
    const t6IssueId = t6IssueRes.body.data?.id;
    assert('T6: Second (final) issue created', t6IssueRes.status === 201);

    await req('POST', `/issues/${t6IssueId}/post`, {});

    const t6Req = await req('GET', `/requisitions/${t5ReqId}`, null);
    console.log(`  Requisition status after final issue: ${t6Req.body.data?.status}`);
    assert('T6: Requisition status = CLOSED (auto)', t6Req.body.data?.status === 'CLOSED');

    // ── T7: PATCH/DELETE on POSTED issue → 423 ───────────────────────────────
    console.log('\n══ T7: POSTED Issue is Immutable ═════════════════════════════════');
    const t7PatchRes = await req('PATCH', `/issues/${t5IssueId}`, { notes: 'Tampering attempt' });
    console.log(`  PATCH posted issue → HTTP ${t7PatchRes.status}`);
    assert('T7: PATCH POSTED issue → 423', t7PatchRes.status === 423);

    const t7DelRes = await req('DELETE', `/issues/${t5IssueId}`, null);
    console.log(`  DELETE posted issue → HTTP ${t7DelRes.status}`);
    assert('T7: DELETE POSTED issue → 423', t7DelRes.status === 423);

    // ── T8: Atomic posting — if stock fails mid-transaction, no partial ledger ─
    console.log('\n══ T8: Atomic Rollback on Stock Failure ══════════════════════════');
    // Set stock to exactly 3, try to issue 5 to trigger failure inside postIssue
    await setStock(3);
    const t8ReqId = await createReq('APPROVED', 5);
    testIds.push(t8ReqId);
    const t8Detail = await req('GET', `/requisitions/${t8ReqId}`, null);
    const t8LineId = t8Detail.body.data?.lines?.[0]?.id;

    // Create draft issue (passes qty check of 5 <= remaining 5)
    // But stock is only 3 — so postIssue should fail atomically
    // First set stock to enough for createIssueDraft to pass
    await setStock(10);
    const t8IssueRes = await req('POST', '/issues', {
        requisitionId: t8ReqId,
        lines: [{ requisitionLineId: t8LineId, issuedQty: 5 }],
    });
    const t8IssueId = t8IssueRes.body.data?.id;

    // Now reduce stock to less than needed — simulates concurrent depletion
    await setStock(2);
    const ledgerCountBefore = await prisma.inventoryLedger.count({ where: { tenantId, referenceType: 'REQ_ISSUE' } });

    const t8PostRes = await req('POST', `/issues/${t8IssueId}/post`, {});
    console.log(`  POST /issues/:id/post (stock=2, needed=5) → HTTP ${t8PostRes.status}`);
    assert('T8: Post fails on insufficient stock at tx time (not 200)', t8PostRes.status !== 200);

    const ledgerCountAfter = await prisma.inventoryLedger.count({ where: { tenantId, referenceType: 'REQ_ISSUE' } });
    assert('T8: No ledger entries created (atomic rollback)', ledgerCountAfter === ledgerCountBefore);

    // ── T9: Ledger OUT entries have referenceType = REQ_ISSUE ─────────────────
    console.log('\n══ T9: Ledger referenceType = REQ_ISSUE ══════════════════════════');
    const ledgerEntries = await prisma.inventoryLedger.findMany({
        where: { tenantId, referenceType: 'REQ_ISSUE' },
        orderBy: { createdAt: 'desc' },
        take: 1,
    });
    assert('T9: Ledger has REQ_ISSUE entries', ledgerEntries.length > 0);
    if (ledgerEntries.length > 0) {
        assert('T9: movementType = ISSUE', ledgerEntries[0].movementType === 'ISSUE');
        assert('T9: qtyOut > 0', Number(ledgerEntries[0].qtyOut) > 0);
        assert('T9: qtyIn = 0', Number(ledgerEntries[0].qtyIn) === 0);
    }

    // ── T10: totalIssuedQty accumulates correctly ─────────────────────────────
    console.log('\n══ T10: RequisitionLine.totalIssuedQty accumulates ══════════════');
    const t10Lines = await prisma.storeRequisitionLine.findMany({
        where: { requisitionId: t5ReqId },
    });
    const t10Line = t10Lines[0];
    console.log(`  requestedQty=${Number(t10Line.requestedQty)}, totalIssuedQty=${Number(t10Line.totalIssuedQty)}`);
    assert('T10: totalIssuedQty = 10 (5+5)', Number(t10Line.totalIssuedQty) === 10);
    assert('T10: totalIssuedQty >= requestedQty (fully issued)', Number(t10Line.totalIssuedQty) >= Number(t10Line.requestedQty));

    // Cleanup
    await cleanup(testIds);

    // Summary
    sep();
    const total = passed + failed;
    console.log(`\n  Results: ${passed}/${total} passed`);
    if (failed === 0) {
        console.log('\n  🏆  ALL PHASE 5 TESTS PASSED');
        console.log('  Phase 5 is confirmed production-ready.\n');
    } else {
        console.log(`\n  ⚠  ${failed} test(s) FAILED\n`);
    }
    sep();

    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(async err => {
    console.error('Unexpected error:', err);
    await prisma.$disconnect();
    process.exit(1);
});
