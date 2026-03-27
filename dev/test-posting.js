/**
 * Manual Test Script: Posting Verification
 * Scenarios: OB +10 → Issue -3 → Ledger check → Transfer 2
 */
const http = require('http');

const BASE = 'http://localhost:4000/api';

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const url = new URL(BASE + path);
        const data = body ? JSON.stringify(body) : null;
        const options = {
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: {
                'Content-Type': 'application/json',
                ...(token && { Authorization: `Bearer ${token}` }),
                ...(data && { 'Content-Length': Buffer.byteLength(data) })
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (c) => body += c);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(body) });
                } catch {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

async function run() {
    console.log('='.repeat(60));
    console.log('  MANUAL TEST SCRIPT: POSTING VERIFICATION');
    console.log('='.repeat(60));

    // ─── Login ─────────────────────────────────────────────────
    console.log('\n📋 Step 0: Login as Admin...');
    const loginRes = await request('POST', '/auth/login', {
        email: 'admin@grandhorizon.com',
        password: 'Admin@123',
        tenantSlug: 'grand-horizon'
    });

    if (loginRes.status !== 200) {
        console.error('❌ Login failed:', loginRes.data);
        process.exit(1);
    }
    const token = loginRes.data.data.accessToken;
    console.log('✅ Logged in as:', loginRes.data.data.user.email);

    // ─── Get Items & Locations ──────────────────────────────────
    console.log('\n📋 Step 0b: Fetching Items & Locations...');
    const itemsRes = await request('GET', '/items', null, token);
    const locsRes = await request('GET', '/locations', null, token);

    // API response: { success, data: [...array...] }
    const itemsList = Array.isArray(itemsRes.data.data) ? itemsRes.data.data : [];
    const locsList = Array.isArray(locsRes.data.data) ? locsRes.data.data : [];

    const testItem = itemsList.find(i => i.name === 'King Bed Sheet Set');
    const mainStore = locsList.find(l => l.name === 'Main Store');
    const fbStore = locsList.find(l => l.name === 'F&B Store');

    if (!testItem || !mainStore) {
        console.error('❌ Could not find test item or main store');
        console.log('Items:', JSON.stringify(itemsRes.data).substring(0, 300));
        console.log('Locations:', JSON.stringify(locsRes.data).substring(0, 300));
        process.exit(1);
    }
    console.log(`   Item: ${testItem.name} (${testItem.id})`);
    console.log(`   Location: ${mainStore.name} (${mainStore.id})`);
    console.log(`   Transfer Location: ${fbStore?.name} (${fbStore?.id})`);

    // ═══════════════════════════════════════════════════════════
    // SCENARIO 1: OB +10 → Post → Stock Balance = 10
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(60));
    console.log('  SCENARIO 1: OB +10 → Stock Balance = 10');
    console.log('═'.repeat(60));

    console.log('\n📝 Creating OB Draft (qty=10, unitCost=25)...');
    const obRes = await request('POST', '/movements', {
        movementType: 'OPENING_BALANCE',
        documentDate: new Date().toISOString(),
        destLocationId: mainStore.id,
        notes: 'Test OB: +10 Bath Towels',
        lines: [{
            itemId: testItem.id,
            locationId: mainStore.id,
            qtyRequested: 10,
            unitCost: 25.00,
            totalValue: 250.00
        }]
    }, token);

    if (obRes.status !== 201) {
        console.error('❌ OB creation failed:', JSON.stringify(obRes.data));
        process.exit(1);
    }
    const obDoc = obRes.data.data;
    console.log(`✅ OB Draft created: ${obDoc.documentNo} (ID: ${obDoc.id})`);

    // Post OB
    console.log('\n📮 Posting OB document...');
    const postObRes = await request('POST', `/movements/${obDoc.id}/post`, {}, token);
    if (postObRes.status !== 200) {
        console.error('❌ OB posting failed:', JSON.stringify(postObRes.data));
        process.exit(1);
    }
    console.log(`✅ OB Posted! Status: ${postObRes.data.data.status}`);

    // Check Stock Balance — API: success(res, result.balances, ...) → data = [...balances]
    console.log('\n📊 Checking Stock Balance...');
    const stockRes1 = await request('GET', `/stock-balances?locationId=${mainStore.id}`, null, token);
    const balances1 = Array.isArray(stockRes1.data.data) ? stockRes1.data.data : [];
    const testBalance1 = balances1.find(b => b.itemId === testItem.id);
    const qty1 = Number(testBalance1?.qtyOnHand || 0);

    console.log(`\n┌──────────────────────────────────────────────────┐`);
    console.log(`│  SCENARIO 1 RESULT                               │`);
    console.log(`├──────────────────────────────────────────────────┤`);
    console.log(`│  Item:     ${testItem.name.padEnd(35)}  │`);
    console.log(`│  Location: ${mainStore.name.padEnd(35)}  │`);
    console.log(`│  Qty:      ${String(qty1).padEnd(35)}  │`);
    console.log(`│  WAC:      ${String(testBalance1?.wacUnitCost || 0).padEnd(35)}  │`);
    console.log(`│  Expected: 10                                    │`);
    console.log(`│  Status:   ${qty1 === 10 ? '✅ PASS' : '❌ FAIL (got ' + qty1 + ')'}                                 │`);
    console.log(`└──────────────────────────────────────────────────┘`);

    // ═══════════════════════════════════════════════════════════
    // SCENARIO 2: Issue -3 → Post → Stock Balance = 7
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(60));
    console.log('  SCENARIO 2: Issue -3 → Stock Balance = 7');
    console.log('═'.repeat(60));

    console.log('\n📝 Creating Issue Draft (qty=3)...');
    const issRes = await request('POST', '/movements', {
        movementType: 'ISSUE',
        documentDate: new Date().toISOString(),
        sourceLocationId: mainStore.id,
        department: 'Housekeeping',
        notes: 'Test Issue: -3 Bath Towels to Housekeeping',
        lines: [{
            itemId: testItem.id,
            locationId: mainStore.id,
            qtyRequested: 3,
            unitCost: 0,
            totalValue: 0
        }]
    }, token);

    if (issRes.status !== 201) {
        console.error('❌ Issue creation failed:', JSON.stringify(issRes.data));
        process.exit(1);
    }
    const issDoc = issRes.data.data;
    console.log(`✅ Issue Draft created: ${issDoc.documentNo} (ID: ${issDoc.id})`);

    // Post Issue
    console.log('\n📮 Posting Issue document...');
    const postIssRes = await request('POST', `/movements/${issDoc.id}/post`, {}, token);
    if (postIssRes.status !== 200) {
        console.error('❌ Issue posting failed:', JSON.stringify(postIssRes.data));
        process.exit(1);
    }
    console.log(`✅ Issue Posted! Status: ${postIssRes.data.data.status}`);

    // Check Stock Balance
    console.log('\n📊 Checking Stock Balance...');
    const stockRes2 = await request('GET', `/stock-balances?locationId=${mainStore.id}`, null, token);
    const balances2 = Array.isArray(stockRes2.data.data) ? stockRes2.data.data : [];
    const testBalance2 = balances2.find(b => b.itemId === testItem.id);
    const qty2 = Number(testBalance2?.qtyOnHand || 0);

    console.log(`\n┌──────────────────────────────────────────────────┐`);
    console.log(`│  SCENARIO 2 RESULT                               │`);
    console.log(`├──────────────────────────────────────────────────┤`);
    console.log(`│  Item:     ${testItem.name.padEnd(35)}  │`);
    console.log(`│  Location: ${mainStore.name.padEnd(35)}  │`);
    console.log(`│  Qty:      ${String(qty2).padEnd(35)}  │`);
    console.log(`│  WAC:      ${String(testBalance2?.wacUnitCost || 0).padEnd(35)}  │`);
    console.log(`│  Expected: 7                                     │`);
    console.log(`│  Status:   ${qty2 === 7 ? '✅ PASS' : '❌ FAIL (got ' + qty2 + ')'}                                 │`);
    console.log(`└──────────────────────────────────────────────────┘`);

    // ═══════════════════════════════════════════════════════════
    // SCENARIO 3: Ledger Viewer → 2 entries, running balance = 7
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(60));
    console.log('  SCENARIO 3: Ledger Viewer → 2 entries, balance = 7');
    console.log('═'.repeat(60));

    console.log('\n📊 Fetching Ledger Entries...');
    const ledgerRes = await request('GET', `/ledger?itemId=${testItem.id}&locationId=${mainStore.id}`, null, token);
    // Ledger API: success(res, result.entries, ...) → data = [entries array]
    const ledgerEntries = Array.isArray(ledgerRes.data.data) ? ledgerRes.data.data : (ledgerRes.data.data?.entries || []);

    console.log(`\n┌───────────────┬──────────────────────┬────────┬─────────┬────────────┬──────────────────┐`);
    console.log(`│ Ref No        │ Type                 │ Qty In │ Qty Out │ Unit Cost  │ Running Balance  │`);
    console.log(`├───────────────┼──────────────────────┼────────┼─────────┼────────────┼──────────────────┤`);
    for (const entry of ledgerEntries) {
        const refNo = (entry.referenceNo || '').padEnd(13);
        const type = entry.movementType.padEnd(20);
        const qIn = String(entry.qtyIn).padEnd(6);
        const qOut = String(entry.qtyOut).padEnd(7);
        const uCost = String(entry.unitCost).padEnd(10);
        const runBal = String(entry.runningBalance).padEnd(16);
        console.log(`│ ${refNo} │ ${type} │ ${qIn} │ ${qOut} │ ${uCost} │ ${runBal} │`);
    }
    console.log(`└───────────────┴──────────────────────┴────────┴─────────┴────────────┴──────────────────┘`);

    const lastBalance = ledgerEntries.length > 0 ? Number(ledgerEntries[ledgerEntries.length - 1].runningBalance) : 0;
    console.log(`\n   Total entries: ${ledgerEntries.length} (expected: 2)`);
    console.log(`   Final running balance: ${lastBalance} (expected: 7)`);
    console.log(`   Status: ${ledgerEntries.length >= 2 && lastBalance === 7 ? '✅ PASS' : '❌ FAIL'}`);

    // ═══════════════════════════════════════════════════════════
    // SCENARIO 4 (Optional): Transfer 2 → balance split
    // ═══════════════════════════════════════════════════════════
    if (fbStore) {
        console.log('\n' + '═'.repeat(60));
        console.log('  SCENARIO 4: Transfer 2 → Balance split');
        console.log('═'.repeat(60));

        console.log('\n📝 Creating Transfer Draft (qty=2, Main → F&B)...');
        const trfRes = await request('POST', '/movements', {
            movementType: 'TRANSFER',
            documentDate: new Date().toISOString(),
            sourceLocationId: mainStore.id,
            destLocationId: fbStore.id,
            notes: 'Test Transfer: 2 Bath Towels Main → F&B',
            lines: [{
                itemId: testItem.id,
                locationId: mainStore.id,
                qtyRequested: 2,
                unitCost: 0,
                totalValue: 0
            }]
        }, token);

        if (trfRes.status !== 201) {
            console.error('❌ Transfer creation failed:', JSON.stringify(trfRes.data));
        } else {
            const trfDoc = trfRes.data.data;
            console.log(`✅ Transfer Draft created: ${trfDoc.documentNo} (ID: ${trfDoc.id})`);

            console.log('\n📮 Posting Transfer document...');
            const postTrfRes = await request('POST', `/movements/${trfDoc.id}/post`, {}, token);
            if (postTrfRes.status !== 200) {
                console.error('❌ Transfer posting failed:', JSON.stringify(postTrfRes.data));
            } else {
                console.log(`✅ Transfer Posted! Status: ${postTrfRes.data.data.status}`);

                console.log('\n📊 Checking Stock Balances at both locations...');
                const stockMain = await request('GET', `/stock-balances?locationId=${mainStore.id}`, null, token);
                const stockFB = await request('GET', `/stock-balances?locationId=${fbStore.id}`, null, token);

                const mainBalArr = Array.isArray(stockMain.data.data) ? stockMain.data.data : [];
                const fbBalArr = Array.isArray(stockFB.data.data) ? stockFB.data.data : [];
                const mainBal = mainBalArr.find(b => b.itemId === testItem.id);
                const fbBal = fbBalArr.find(b => b.itemId === testItem.id);

                const mainQty = Number(mainBal?.qtyOnHand || 0);
                const fbQty = Number(fbBal?.qtyOnHand || 0);

                console.log(`\n┌──────────────────────────────────────────────────┐`);
                console.log(`│  SCENARIO 4 RESULT                               │`);
                console.log(`├──────────────────────────────────────────────────┤`);
                console.log(`│  Main Store Qty:  ${String(mainQty).padEnd(28)}  │`);
                console.log(`│  Expected:        5                              │`);
                console.log(`│  F&B Store Qty:   ${String(fbQty).padEnd(28)}  │`);
                console.log(`│  Expected:        2                              │`);
                console.log(`│  Total:           ${String(mainQty + fbQty).padEnd(28)}  │`);
                console.log(`│  Expected Total:  7                              │`);
                const pass4 = mainQty === 5 && fbQty === 2;
                console.log(`│  Status:          ${pass4 ? '✅ PASS' : '❌ FAIL'}                           │`);
                console.log(`└──────────────────────────────────────────────────┘`);

                // Ledger after transfer
                console.log('\n📊 Ledger entries after transfer...');
                const ledgerMain = await request('GET', `/ledger?itemId=${testItem.id}&locationId=${mainStore.id}`, null, token);
                const mainEntries = Array.isArray(ledgerMain.data.data) ? ledgerMain.data.data : (ledgerMain.data.data?.entries || []);
                console.log(`   Main Store Ledger: ${mainEntries.length} entries, Final Balance: ${mainEntries.length > 0 ? mainEntries[mainEntries.length - 1].runningBalance : 'N/A'}`);

                const ledgerFB = await request('GET', `/ledger?itemId=${testItem.id}&locationId=${fbStore.id}`, null, token);
                const fbEntries = Array.isArray(ledgerFB.data.data) ? ledgerFB.data.data : (ledgerFB.data.data?.entries || []);
                console.log(`   F&B Store Ledger: ${fbEntries.length} entries, Final Balance: ${fbEntries.length > 0 ? fbEntries[fbEntries.length - 1].runningBalance : 'N/A'}`);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(60));
    console.log('  TEST SUMMARY');
    console.log('═'.repeat(60));
    console.log(`  Scenario 1 (OB +10):      ${qty1 === 10 ? '✅ PASS' : '❌ FAIL'} (Balance: ${qty1})`);
    console.log(`  Scenario 2 (Issue -3):     ${qty2 === 7 ? '✅ PASS' : '❌ FAIL'} (Balance: ${qty2})`);
    console.log(`  Scenario 3 (Ledger):       ${ledgerEntries.length >= 2 && lastBalance === 7 ? '✅ PASS' : '❌ FAIL'} (${ledgerEntries.length} entries, final: ${lastBalance})`);
    console.log('═'.repeat(60));
}

run().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
