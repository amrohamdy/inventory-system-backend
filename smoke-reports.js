const fs = require('fs');
const path = require('path');

const API_URL = 'http://127.0.0.1:4000/api';

async function runSmokeTests() {
    console.log('--- M13 Report Smoke Tests (Enhanced) ---');
    console.log(`Test Date: ${new Date().toLocaleString()}`);
    console.log('Admin User: admin@grandhorizon.com');

    try {
        // 1. Login
        console.log('\n--- 1. AUTHENTICATION ---');
        const loginRes = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'admin@grandhorizon.com',
                password: 'Admin@123',
                tenantSlug: 'grand-horizon'
            })
        });

        const loginData = await loginRes.json();
        if (!loginRes.ok) {
            throw new Error(`Login failed: ${loginData.message}`);
        }

        const token = loginData.data.accessToken;
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        console.log('Login Status: 200 OK');

        // Get Location ID for "Engineering Store"
        const locationsRes = await fetch(`${API_URL}/locations`, { headers });
        const locationsData = await locationsRes.json();
        const engineeringStore = locationsData.data.find(l => l.name === 'Engineering Store') || locationsData.data[0];
        const locationId = engineeringStore.id;
        const locationName = engineeringStore.name;

        // Set Date Range (Last 30 days)
        const dateTo = new Date();
        const dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - 30);

        const filters = {
            locationId,
            dateFrom: dateFrom.toISOString().split('T')[0],
            dateTo: dateTo.toISOString().split('T')[0]
        };

        console.log(`\n--- FIXED FILTERS ---`);
        console.log(`Store: ${locationName} (${locationId})`);
        console.log(`Date Range: ${filters.dateFrom} to ${filters.dateTo}`);

        // 2. Fetch Stock Valuation
        console.log('\n--- 2. STOCK VALUATION (JSON) ---');
        const valuationRes = await fetch(`${API_URL}/reports/valuation?locationId=${locationId}`, { headers });
        console.log('API Status:', valuationRes.status);
        const valuationData = await valuationRes.json();

        if (valuationRes.ok) {
            const rows = valuationData.data || [];
            const totals = valuationData.summary || {};
            console.log(`Row count: ${rows.length}`);
            console.log(`Total Quantity: ${totals.totalQty || 0}`);
            console.log(`Total Value: ${totals.totalValue || 0} SAR`);
            fs.writeFileSync('valuation_response.json', JSON.stringify(valuationData, null, 2));
            console.log('Raw JSON saved to valuation_response.json');
        } else {
            console.error('Valuation failed:', valuationData.message);
        }

        // 3. Test Stock Valuation Export
        console.log('\n--- 3. STOCK VALUATION EXPORT (Excel) ---');
        const valExportRes = await fetch(`${API_URL}/reports/valuation/export?locationId=${locationId}`, { headers });
        console.log('Export Status:', valExportRes.status);
        const valBuffer = await valExportRes.arrayBuffer();
        console.log(`File size: ${valBuffer.byteLength} bytes (${(valBuffer.byteLength / 1024).toFixed(2)} KB)`);
        if (valExportRes.ok && valBuffer.byteLength > 0) {
            fs.writeFileSync('valuation.xlsx', Buffer.from(valBuffer));
            console.log('Saved to valuation.xlsx');
        }

        // 4. Fetch Movement History
        console.log('\n--- 4. MOVEMENT HISTORY (JSON) ---');
        const movementRes = await fetch(`${API_URL}/reports/movement?locationId=${locationId}&dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}`, { headers });
        console.log('API Status:', movementRes.status);
        const movementData = await movementRes.json();

        if (movementRes.ok) {
            const rows = movementData.data || [];
            const totals = movementData.summary || {};
            console.log(`Row count: ${rows.length}`);
            console.log(`Total IN: ${totals.totalQtyIn || 0}`);
            console.log(`Total OUT: ${totals.totalQtyOut || 0}`);
            console.log(`Net Movement: ${(totals.totalQtyIn || 0) - (totals.totalQtyOut || 0)}`);
            fs.writeFileSync('movement_response.json', JSON.stringify(movementData, null, 2));
            console.log('Raw JSON saved to movement_response.json');
        } else {
            console.error('Movement failed:', movementData.message);
        }

        // 5. Test Movement History Export
        console.log('\n--- 5. MOVEMENT HISTORY EXPORT (Excel) ---');
        const movExportRes = await fetch(`${API_URL}/reports/movement/export?locationId=${locationId}&dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}`, { headers });
        console.log('Export Status:', movExportRes.status);
        const movBuffer = await movExportRes.arrayBuffer();
        console.log(`File size: ${movBuffer.byteLength} bytes (${(movBuffer.byteLength / 1024).toFixed(2)} KB)`);
        if (movExportRes.ok && movBuffer.byteLength > 0) {
            fs.writeFileSync('movement.xlsx', Buffer.from(movBuffer));
            console.log('Saved to movement.xlsx');
        }

        console.log('\n--- Smoke Tests Completed Successfully ---');

    } catch (error) {
        console.error('\n!!! Smoke tests failed !!!');
        console.error(error.message);
        process.exit(1);
    }
}

runSmokeTests();
