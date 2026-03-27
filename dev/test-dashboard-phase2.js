/**
 * Smoke Test — SaaS Phase 2: Executive Dashboard
 *
 * Verifies GET /api/dashboard/summary returns all 4 widget groups
 * and completes in < 500ms.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:4000';
const EMAIL = 'admin@grandhorizon.com';
const PASSWORD = 'Admin@123';
const TENANT_SLUG = 'grand-horizon';

const timestamp = new Date().toISOString();
let token = '';
let allPassed = true;

function log(msg) { console.log(msg); }
function pass(msg) { console.log(`  ✅ PASS — ${msg}`); }
function fail(msg) { console.error(`  ❌ FAIL — ${msg}`); allPassed = false; }

// ── HTTP helpers ────────────────────────────────────────────────────────────────

function request(method, urlPath, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'localhost',
            port: 4000,
            path: urlPath,
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
        };
        const req = http.request(opts, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function get(urlPath, headers = {}) {
    return request('GET', urlPath, null, headers);
}

function authHeader() {
    return { Authorization: `Bearer ${token}` };
}

// ── Steps ───────────────────────────────────────────────────────────────────────

async function step1_auth() {
    log('\n── Step 1: Authenticate ─────────────────────────────────────────');
    log(`   User      : ${EMAIL}`);
    log(`   Timestamp : ${timestamp}`);

    const res = await request('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD, tenantSlug: TENANT_SLUG });
    if (res.status !== 200) {
        fail(`Login failed — HTTP ${res.status}: ${res.body.toString()}`);
        return false;
    }
    const parsed = JSON.parse(res.body);
    token = parsed.data?.accessToken || parsed.token || '';
    if (!token) { fail('No token in login response'); return false; }
    pass(`Authenticated (token starts: ${token.substring(0, 20)}...)`);
    return true;
}

async function step2_dashboardSummary() {
    log('\n── Step 2: GET /api/dashboard/summary ──────────────────────────');

    const start = Date.now();
    const res = await get('/api/dashboard/summary', authHeader());
    const elapsed = Date.now() - start;

    if (res.status !== 200) {
        fail(`HTTP ${res.status}: ${res.body.toString()}`);
        return null;
    }

    const json = JSON.parse(res.body);
    const { data, meta } = json;
    const serverTime = meta?.responseTimeMs;

    log(`   Client round-trip  : ${elapsed}ms`);
    log(`   Server query time  : ${serverTime}ms`);

    // ── Assert all 4 widget groups present ───────────────────────────────
    const groups = ['inventoryOverview', 'monthlyPerformance', 'riskIndicators', 'operationalHealth'];
    for (const g of groups) {
        if (data?.[g] !== undefined) {
            pass(`Group "${g}" present`);
        } else {
            fail(`Group "${g}" MISSING from response`);
        }
    }

    // ── Response time < 500ms ────────────────────────────────────────────
    if (serverTime !== undefined && serverTime < 500) {
        pass(`Server response time ${serverTime}ms < 500ms target`);
    } else if (serverTime !== undefined) {
        fail(`Server response time ${serverTime}ms ≥ 500ms target`);
    }

    // ── Print KPI values ─────────────────────────────────────────────────
    const ov = data?.inventoryOverview;
    const mp = data?.monthlyPerformance;
    const ri = data?.riskIndicators;
    const oh = data?.operationalHealth;

    log('\n   ── Inventory Overview ──');
    log(`   Total Value        : ${ov?.totalValue}`);
    log(`   Total Stores       : ${ov?.totalStores}`);
    log(`   Active Items       : ${ov?.totalActiveItems}`);
    log(`   Qty On Hand        : ${ov?.totalQtyOnHand}`);
    log(`   Value by Store     : ${JSON.stringify(ov?.valueByStore?.map(s => `${s.locationName}: ${s.value}`))}`);

    log('\n   ── Monthly Performance ──');
    log(`   Consumption        : ${mp?.consumptionValue} (Δ${mp?.consumptionDelta}%)`);
    log(`   Transfers          : ${mp?.transfersCount}`);
    log(`   Loss Value         : ${mp?.lossValue} (Δ${mp?.lossDelta}%)`);
    log(`   Fill Rate          : ${mp?.fillRate}% (${mp?.fulfilledRequisitions}/${mp?.totalRequisitions})`);

    log('\n   ── Risk Indicators ──');
    log(`   Aging Buckets      : ${JSON.stringify(ri?.aging)}`);
    log(`   Top Consumed       : ${ri?.topConsumed?.length || 0} items`);
    log(`   Top Slow           : ${ri?.topSlow?.length || 0} items`);
    log(`   Loss vs Consumption: ${ri?.lossVsConsumptionPct}%`);

    log('\n   ── Operational Health ──');
    log(`   Open Reqs          : ${oh?.openReqs}`);
    log(`   Pending Transfers  : ${oh?.pendingTransfers}`);
    log(`   Pending GRNs       : ${oh?.pendingGrns}`);
    log(`   Pending Loss       : ${oh?.pendingLoss}`);

    // ── Validate totalValue is non-negative ──────────────────────────────
    if (ov?.totalValue >= 0) {
        pass(`Total value (${ov.totalValue}) is non-negative`);
    } else {
        fail(`Total value (${ov?.totalValue}) is negative — unexpected`);
    }

    // ── Validate aging buckets are valid ─────────────────────────────────
    if (Array.isArray(ri?.aging)) {
        pass(`Aging data is an array with ${ri.aging.length} buckets`);
    } else {
        fail('Aging data is not an array');
    }

    // Save raw response
    fs.writeFileSync(path.join(__dirname, 'dashboard_response.json'), JSON.stringify(json, null, 2));
    pass('Saved dashboard_response.json');

    return data;
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
    log('══════════════════════════════════════════════════════════════════');
    log('  SaaS Phase 2 — Executive Dashboard — Smoke Test');
    log('══════════════════════════════════════════════════════════════════');

    const authed = await step1_auth();
    if (!authed) { process.exit(1); }

    await step2_dashboardSummary();

    log('\n══════════════════════════════════════════════════════════════════');
    if (allPassed) {
        log('  🏆  ALL STEPS PASSED — Phase 2 Dashboard smoke test COMPLETE');
        log('══════════════════════════════════════════════════════════════════');
        process.exit(0);
    } else {
        log('  💥  ONE OR MORE STEPS FAILED — see above');
        log('══════════════════════════════════════════════════════════════════');
        process.exit(1);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
