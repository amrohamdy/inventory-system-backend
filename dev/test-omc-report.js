const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:4000/api';
const EMAIL = 'admin@grandhorizon.com';
const PASSWORD = 'Admin@123';
const TENANT_SLUG = 'grand-horizon';
const LOCATION_ID = 'cbe28a1b-1875-46c3-87c2-4b4af829b199'; // Valid DB UUID for a location

let token = null;

const log = (msg) => console.log(msg);
const pass = (msg) => console.log(`  ✅ PASS — ${msg}`);
const fail = (msg) => {
    console.error(`  ❌ FAIL — ${msg}`);
    process.exit(1);
};

async function run() {
    log('\n══════════════════════════════════════════════════════════════════');
    log('  M13 Phase 3 — Opening-Movement-Closing (OMC) — Smoke Test');
    log('══════════════════════════════════════════════════════════════════\n');

    try {
        // ── 1. Authenticate ──────────────────────────────────────────────────
        log('── Step 1: Authenticate ─────────────────────────────────────────');
        const loginRes = await axios.post(`${API_URL}/auth/login`, {
            email: EMAIL,
            password: PASSWORD,
            tenantSlug: TENANT_SLUG,
        });

        token = loginRes.data?.data?.accessToken;
        if (!token) fail('No access token received');

        const dateFrom = '2024-01-01';
        const dateTo = '2027-12-31';

        log(`   User      : ${EMAIL}`);
        log(`   Timestamp : ${new Date().toISOString()}`);
        log(`   dateFrom  : ${dateFrom}`);
        log(`   dateTo    : ${dateTo}`);
        pass(`Authenticated (token starts: ${token.substring(0, 20)}...)`);

        const axiosConfig = {
            headers: { Authorization: `Bearer ${token}` },
            params: { dateFrom, dateTo, locationId: LOCATION_ID }
        };

        // ── 2. GET JSON API ──────────────────────────────────────────────────
        log('\n── Step 2: GET /api/reports/omc ───────────────────────────────');
        const res = await axios.get(`${API_URL}/reports/omc`, axiosConfig);

        const { data, totals, filters } = res.data;
        if (!data) fail('Response missing data array');
        if (!totals) fail('Response missing totals object');

        log(`   Row count          : ${data.length}`);

        fs.writeFileSync(path.join(__dirname, 'omc_response.json'), JSON.stringify(res.data, null, 2));

        // 2a. Validate logic on every row: OB + In - Out = CB
        log('\n   [Validating Row Logic]');
        for (const row of data) {
            // Quantity check (allow tiny float rounding diffs)
            const expectedCbQty = row.obQty + row.inQty - row.outQty;
            if (Math.abs(expectedCbQty - row.cbQty) > 0.001) {
                fail(`Row logic gap QTY [${row.itemCode}]: OB(${row.obQty}) + In(${row.inQty}) - Out(${row.outQty}) != CB(${row.cbQty}) | Expected CB: ${expectedCbQty}`);
            }

            // Value check
            const expectedCbVal = row.obVal + row.inVal - row.outVal;
            if (Math.abs(expectedCbVal - row.cbVal) > 0.001) {
                fail(`Row logic gap VAL [${row.itemCode}]: OB(${row.obVal}) + In(${row.inVal}) - Out(${row.outVal}) != CB(${row.cbVal}) | Expected CB: ${expectedCbVal}`);
            }
        }
        pass(`Row logic confirmed: OB + In - Out = CB for all ${data.length} rows (Qty and Value)`);

        // 2b. Validate Totals match the sum of the rows
        log('\n   [Validating Totals sum]');
        if (data.length > 0) {
            const checkTotal = (field, totalField) => {
                const rowSum = data.reduce((s, r) => s + r[field], 0);
                if (Math.abs(rowSum - totals[totalField]) > 0.01) {
                    fail(`Total mismatch [${totalField}]: UI Total=${totals[totalField]}, Row Sum=${rowSum}`);
                }
                pass(`${totalField} reconciles with rows (${rowSum})`);
            };

            checkTotal('obQty', 'totalObQty');
            checkTotal('obVal', 'totalObVal');
            checkTotal('inQty', 'totalInQty');
            checkTotal('inVal', 'totalInVal');
            checkTotal('outQty', 'totalOutQty');
            checkTotal('outVal', 'totalOutVal');
            checkTotal('cbQty', 'totalCbQty');
            checkTotal('cbVal', 'totalCbVal');
        }

        pass(`Received ${data.length} rows — omc_response.json saved`);

        // ── 3. GET EXCEL EXPORT ────────────────────────────────────────────
        log('\n── Step 3: GET /api/reports/omc/export ────────────────────────');
        const exportRes = await axios.get(`${API_URL}/reports/omc/export`, {
            ...axiosConfig,
            responseType: 'arraybuffer'
        });

        const contentType = exportRes.headers['content-type'];
        log(`   Content-Type   : ${contentType}`);
        log(`   Content-Length : ${exportRes.data.byteLength} bytes`);

        if (!contentType.includes('spreadsheetml.sheet')) {
            fail('Response is not an xlsx file');
        }
        pass('Content-Type is xlsx');

        if (exportRes.data.byteLength < 1000) {
            fail('File size is suspiciously small');
        }
        pass(`Content-Length = ${exportRes.data.byteLength} bytes (non-empty)`);

        fs.writeFileSync(path.join(__dirname, 'omc.xlsx'), exportRes.data);
        pass(`Saved omc.xlsx (${exportRes.data.byteLength} bytes)`);

        log('\n══════════════════════════════════════════════════════════════════');
        log('  🏆  ALL STEPS PASSED — Phase 3 smoke test COMPLETE');
        log('══════════════════════════════════════════════════════════════════\n');

    } catch (error) {
        if (error.response) {
            fail(`API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else {
            fail(`Request Error: ${error.message}`);
        }
    }
}

run();
