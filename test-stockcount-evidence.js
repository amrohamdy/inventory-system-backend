const axios = require('axios');
const fs = require('fs');
const _ = require('lodash');

const BASE_URL = 'http://localhost:4000/api';
let tokens = {};
let sessionData = {};

let passes = 0;
let fails = 0;

const log = (msg) => console.log(msg);
const pass = (msg) => { console.log(`  \x1b[32m✅\x1b[0m ${msg}`); passes++; };
const fail = (msg) => { console.log(`  \x1b[31m❌\x1b[0m ${msg}`); fails++; };

const login = async (email, password, roleLabel) => {
    try {
        const res = await axios.post(`${BASE_URL}/auth/login`, { email, password, tenantSlug: 'grand-horizon' });
        tokens[roleLabel] = res.data.data.accessToken;
        pass(`Login [${roleLabel}] — ${email}`);
    } catch (e) {
        fail(`Login [${roleLabel}] failed: ${e.message}`);
    }
};

const getReq = async (url, roleLabel) => {
    return axios.get(`${BASE_URL}${url}`, { headers: { Authorization: `Bearer ${tokens[roleLabel]}` } });
};

const postReq = async (url, data, roleLabel) => {
    return axios.post(`${BASE_URL}${url}`, data, { headers: { Authorization: `Bearer ${tokens[roleLabel]}` } });
};

const putReq = async (url, data, roleLabel) => {
    return axios.put(`${BASE_URL}${url}`, data, { headers: { Authorization: `Bearer ${tokens[roleLabel]}` } });
};

async function runTests() {
    console.log('\n\x1b[1m\x1b[34m══════════════════════════════════════════════════\n  M10 Stock Count — Test Suite\n══════════════════════════════════════════════════\x1b[0m\n');

    console.log('\x1b[1m\x1b[34m▶ Step 0: Authenticate all actors\x1b[0m');
    await login('admin@grandhorizon.com', 'Admin@123', 'ADMIN');
    await login('hk.manager@grandhorizon.com', 'Admin@123', 'DEPT_MANAGER');
    await login('cost@grandhorizon.com', 'Admin@123', 'COST_CONTROL');
    await login('finance@grandhorizon.com', 'Admin@123', 'FINANCE_MANAGER');

    console.log('\n\x1b[1m\x1b[34m▶ Step 1: Fetch location and initial stock\x1b[0m');
    let locationId, testItem;
    try {
        const locRes = await getReq('/locations', 'ADMIN');
        locationId = locRes.data.data[0].id; // Main Store or first location
        pass(`Location: ${locRes.data.data[0].name} (${locationId})`);

        const sbRes = await getReq(`/stock-balances?locationId=${locationId}`, 'ADMIN');
        testItem = sbRes.data.data[0];
        pass(`Item: ${testItem.item.name} | Book Qty: ${testItem.qtyOnHand} | WAC: ${testItem.wacUnitCost}`);
        sessionData.initialBookQty = Number(testItem.qtyOnHand);
        sessionData.wac = Number(testItem.wacUnitCost);
    } catch (e) {
        fail(`Fetch initial data failed: ${e.response?.data?.message || e.message}`);
        return;
    }

    console.log('\n\x1b[1m\x1b[34m▶ Step 2: Create Stock Count Session\x1b[0m');
    try {
        const createRes = await postReq('/stock-count', { locationId, notes: 'End of month cycle count' }, 'ADMIN');
        sessionData.id = createRes.data.data.id;
        sessionData.no = createRes.data.data.sessionNo;
        sessionData.lines = createRes.data.data.lines;
        pass(`Created Session: ${sessionData.no} (status: ${createRes.data.data.status})`);

        // Find our target line
        sessionData.targetLine = sessionData.lines.find(l => l.itemId === testItem.itemId);
        if (Number(sessionData.targetLine.bookQty) === sessionData.initialBookQty && Number(sessionData.targetLine.wacUnitCost) === sessionData.wac) {
            pass('Static snapshot successfully locked bookQty and WAC.');
        } else {
            fail('Static snapshot mismatch with live balance.');
        }
    } catch (e) {
        fail(`Create session failed: ${e.response?.data?.message || e.message}`);
    }

    console.log('\n\x1b[1m\x1b[34m▶ Step 3: Partial Count Updates\x1b[0m');
    try {
        // We will purposely count the target item with a positive variance (+2)
        const countedQty = sessionData.initialBookQty + 2;
        const updateRes = await putReq(`/stock-count/${sessionData.id}/lines`, {
            lines: [{ itemId: testItem.itemId, countedQty }]
        }, 'ADMIN');

        const updatedLine = updateRes.data.data.lines.find(l => l.itemId === testItem.itemId);
        if (Number(updatedLine.countedQty) === countedQty && Number(updatedLine.varianceQty) === 2 && updateRes.data.data.status === 'DRAFT') {
            pass(`Partial update successful. Variance correctly calculated as +2 (Value: ${2 * sessionData.wac}).`);
        } else {
            fail('Partial update failed or variance incorrect.');
        }

        // To submit, we need all items counted. We will submit the rest exactly as book.
        const allLines = updateRes.data.data.lines.map(l => ({
            itemId: l.itemId,
            countedQty: l.itemId === testItem.itemId ? countedQty : l.bookQty
        }));
        await putReq(`/stock-count/${sessionData.id}/lines`, { lines: allLines }, 'ADMIN');
        pass('All remaining partial counts filled (no variance for the rest).');
    } catch (e) {
        fail(`Update lines failed: ${e.response?.data?.message || e.message}`);
    }

    console.log('\n\x1b[1m\x1b[34m▶ Step 4: Submit for Approval\x1b[0m');
    try {
        await postReq(`/stock-count/${sessionData.id}/submit`, {}, 'ADMIN');
        pass('Submitted for approval.');
    } catch (e) {
        fail(`Submit failed: ${e.response?.data?.message || e.message}`);
    }

    console.log('\n\x1b[1m\x1b[34m▶ Step 5: Approval Chain\x1b[0m');
    try {
        await postReq(`/stock-count/${sessionData.id}/approve`, { action: 'APPROVE', comment: 'HOD Approved counted qty.' }, 'DEPT_MANAGER');
        pass('Step 1: HOD Approved');

        await postReq(`/stock-count/${sessionData.id}/approve`, { action: 'APPROVE', comment: 'Cost Control verified variances.' }, 'COST_CONTROL');
        pass('Step 2: Cost Control Approved');

        await postReq(`/stock-count/${sessionData.id}/approve`, { action: 'APPROVE', comment: 'Finance ok to post.' }, 'FINANCE_MANAGER');
        pass('Step 3: Finance Manager Approved & Session POSTED');
    } catch (e) {
        fail(`Approval failed: ${e.response?.data?.message || e.message}`);
    }

    console.log('\n\x1b[1m\x1b[34m▶ Step 6: Verify Ledger & Stock (Positive Variance)\x1b[0m');
    try {
        const ledgerRes = await getReq(`/ledger?itemId=${testItem.itemId}&locationId=${locationId}`, 'ADMIN');
        const countAdjEntries = ledgerRes.data.data.filter(l => l.movementType === 'COUNT_ADJUSTMENT' && l.referenceId === sessionData.id);
        if (countAdjEntries.length === 1 && Number(countAdjEntries[0].qtyIn) === 2 && Number(countAdjEntries[0].totalValue) === 2 * sessionData.wac) {
            pass('Ledger entry correctly recorded COUNT_ADJUSTMENT (qtyIn: 2)');
        } else {
            fail('Ledger entry missing or incorrect.');
        }

        const sbRes2 = await getReq(`/stock-balances?locationId=${locationId}`, 'ADMIN');
        const newStock = sbRes2.data.data.find(b => b.itemId === testItem.itemId);
        if (Number(newStock.qtyOnHand) === sessionData.initialBookQty + 2) {
            pass(`Stock correctly adjusted. New Balance matches count snapshot: ${newStock.qtyOnHand}`);
        } else {
            fail(`Stock adjustment incorrect. Expected ${sessionData.initialBookQty + 2}, got ${newStock.qtyOnHand}`);
        }
    } catch (e) {
        fail(`Verification failed: ${e.message}`);
    }

    console.log('\n\x1b[1m\x1b[34m▶ Step 7: Fetch Evidence Pack\x1b[0m');
    try {
        const evidenceRes = await getReq(`/stock-count/${sessionData.id}/evidence`, 'ADMIN');
        const json = evidenceRes.data.data;
        if (json.sessionInfo.status === 'POSTED' && json.approvalHistory.length === 3 && json.varianceSummary.overQty === 2) {
            pass('Evidence JSON pack structure and calculations verified correctly.');
            fs.writeFileSync('evidence-m10.json', JSON.stringify(json, null, 2));
            pass('Saved evidence-m10.json');
        } else {
            fail('Evidence JSON missing required fields or incorrect stats.');
        }

        // Note: The PDF download is binary so testing via axios requires responseType arraybuffer.
        // We will just verify it returns 200 via the API.
        const pdfRes = await axios.get(`${BASE_URL}/stock-count/${sessionData.id}/evidence/pdf`, { headers: { Authorization: `Bearer ${tokens['ADMIN']}` }, responseType: 'arraybuffer' });
        if (pdfRes.status === 200 && pdfRes.data.length > 1000) {
            fs.writeFileSync('evidence-m10.pdf', pdfRes.data);
            pass(`Evidence PDF successfully exported & saved (${Math.round(pdfRes.data.length / 1024)} KB)`);
        } else {
            fail('PDF export failed.');
        }

    } catch (e) {
        fail(`Evidence pack failed: ${e.message}`);
    }

    console.log('\n\x1b[1m\x1b[34m══════════════════════════════════════════════════\x1b[0m');
    console.log(`\x1b[1m  Results: \x1b[32m${passes} PASS\x1b[0m\x1b[1m, \x1b[31m${fails} FAIL\x1b[0m`);
    if (fails === 0) {
        console.log(`\x1b[32m\x1b[1m  🎉 M10 Logic Checks PASSED\x1b[0m`);
    }
    console.log('\x1b[1m\x1b[34m══════════════════════════════════════════════════\x1b[0m\n');
}

runTests();
