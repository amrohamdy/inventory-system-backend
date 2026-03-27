/**
 * Demo Data Seeder — OS&E Cloud Inventory System
 *
 * Generates realistic hotel inventory data for demo/sales presentations.
 * Usage: node seed-demo-data.js
 *
 * Creates via API:
 *   - 4 Categories (Linen, Guest Amenities, F&B Supplies, Engineering)
 *   - 30 Items with realistic names and prices
 *   - Opening Balances across all locations (OPENING_BALANCE movements)
 *   - 5 Requisitions (creates consumption via req→issue flow)
 *   - 5 Transfers between stores
 *   - 3 Breakage documents
 */

const http = require('http');

const BASE_URL = 'http://localhost:4000';
const EMAIL = 'admin@grandhorizon.com';
const PASSWORD = 'Admin@123';
const TENANT_SLUG = 'grand-horizon';

let token = '';
let tenantId = '';

// ── HTTP helpers ────────────────────────────────────────────────────────────

function request(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'localhost', port: 4000, path, method,
            headers: { 'Content-Type': 'application/json', ...headers },
        };
        const req = http.request(opts, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString();
                let parsed;
                try { parsed = JSON.parse(raw); } catch { parsed = raw; }
                resolve({ status: res.statusCode, data: parsed });
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function authHeader() { return { Authorization: `Bearer ${token}` }; }
function post(path, body) { return request('POST', path, body, authHeader()); }
function patch(path, body) { return request('PATCH', path, body, authHeader()); }
function get(path) { return request('GET', path, null, authHeader()); }

function log(msg) { console.log(msg); }
function ok(msg) { console.log(`  ✅ ${msg}`); }

// ── Demo Data Definitions ───────────────────────────────────────────────────

const CATEGORIES = [
    { name: 'Linen & Textiles', description: 'Bed sheets, towels, uniforms' },
    { name: 'Guest Amenities', description: 'Toiletries, slippers, robes' },
    { name: 'F&B Supplies', description: 'Chinaware, cutlery, glassware' },
    { name: 'Engineering & Maintenance', description: 'Bulbs, filters, spare parts' },
];

const ITEMS = [
    // Linen & Textiles (cat 0)
    { name: 'King Bed Sheet Set', category: 0, unitPrice: 85 },
    { name: 'Queen Bed Sheet Set', category: 0, unitPrice: 65 },
    { name: 'Bath Towel (White)', category: 0, unitPrice: 22 },
    { name: 'Hand Towel (White)', category: 0, unitPrice: 12 },
    { name: 'Face Towel', category: 0, unitPrice: 8 },
    { name: 'Bath Robe (Waffle)', category: 0, unitPrice: 55 },
    { name: 'Pillow Case (Standard)', category: 0, unitPrice: 15 },
    { name: 'Duvet Cover (King)', category: 0, unitPrice: 120 },
    // Guest Amenities (cat 1)
    { name: 'Shampoo Bottle (30ml)', category: 1, unitPrice: 3.5 },
    { name: 'Conditioner Bottle (30ml)', category: 1, unitPrice: 3.5 },
    { name: 'Body Lotion (30ml)', category: 1, unitPrice: 4 },
    { name: 'Soap Bar (40g)', category: 1, unitPrice: 2.5 },
    { name: 'Dental Kit', category: 1, unitPrice: 5 },
    { name: 'Sewing Kit', category: 1, unitPrice: 3 },
    { name: 'Shower Cap', category: 1, unitPrice: 1.5 },
    { name: 'Guest Slippers (Pair)', category: 1, unitPrice: 8 },
    // F&B Supplies (cat 2)
    { name: 'Dinner Plate (Porcelain)', category: 2, unitPrice: 18 },
    { name: 'Soup Bowl (Porcelain)', category: 2, unitPrice: 14 },
    { name: 'Wine Glass (Crystal)', category: 2, unitPrice: 25 },
    { name: 'Water Glass (Tumbler)', category: 2, unitPrice: 12 },
    { name: 'Coffee Cup & Saucer', category: 2, unitPrice: 16 },
    { name: 'Steak Knife', category: 2, unitPrice: 22 },
    { name: 'Fork (Table)', category: 2, unitPrice: 8 },
    { name: 'Spoon (Table)', category: 2, unitPrice: 7 },
    // Engineering (cat 3)
    { name: 'LED Bulb (9W)', category: 3, unitPrice: 12 },
    { name: 'AC Filter (Standard)', category: 3, unitPrice: 35 },
    { name: 'Door Lock Battery Pack', category: 3, unitPrice: 28 },
    { name: 'Faucet Washer Kit', category: 3, unitPrice: 15 },
    { name: 'Smoke Detector Battery', category: 3, unitPrice: 18 },
    { name: 'Toilet Flush Valve', category: 3, unitPrice: 45 },
];

// ── Seeding Logic ───────────────────────────────────────────────────────────

async function authenticate() {
    log('\n── Authenticating ────────────────────────────────────────────────');
    const res = await request('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD, tenantSlug: TENANT_SLUG });
    if (res.status !== 200) throw new Error(`Login failed: ${JSON.stringify(res.data)}`);
    token = res.data.data?.accessToken;
    tenantId = res.data.data?.user?.tenantId;
    ok(`Logged in as ${EMAIL} (tenant: ${tenantId?.substring(0, 8)}...)`);
}

async function getLocations() {
    log('\n── Loading Locations ─────────────────────────────────────────────');
    const res = await get('/api/locations');
    const locs = (res.data?.data || []).filter(l => l.isActive);
    ok(`Found ${locs.length} active locations`);
    locs.forEach(l => ok(`  ${l.name} (${l.type})`));
    return locs;
}

async function seedCategories() {
    log('\n── Creating Categories ──────────────────────────────────────────');
    const existing = await get('/api/categories');
    const existingNames = (existing.data?.data || []).map(c => c.name);
    const ids = [];

    for (const cat of CATEGORIES) {
        if (existingNames.includes(cat.name)) {
            const found = existing.data.data.find(c => c.name === cat.name);
            ids.push(found.id);
            ok(`${cat.name} (exists)`);
        } else {
            const res = await post('/api/categories', cat);
            if (res.status === 200 || res.status === 201) {
                ids.push(res.data.data?.id);
                ok(`${cat.name} (created)`);
            } else {
                ids.push(null);
                ok(`${cat.name} (skipped — ${res.data?.message || res.status})`);
            }
        }
    }
    return ids;
}

async function seedItems(categoryIds) {
    log('\n── Creating Items ───────────────────────────────────────────────');
    const existing = await get('/api/items?limit=200');
    const allExisting = existing.data?.data?.data || existing.data?.data || [];
    const existingNames = allExisting.map(i => i.name);
    const items = [];

    for (const item of ITEMS) {
        if (existingNames.includes(item.name)) {
            const found = allExisting.find(i => i.name === item.name);
            items.push({ id: found.id, name: item.name, cost: parseFloat(found.unitPrice || item.unitPrice) });
            ok(`${item.name} (exists — SAR ${item.unitPrice})`);
        } else {
            const res = await post('/api/items', {
                name: item.name,
                categoryId: categoryIds[item.category] || undefined,
                unitPrice: item.unitPrice,
            });
            if (res.status === 200 || res.status === 201) {
                items.push({ id: res.data.data?.id, name: item.name, cost: item.unitPrice });
                ok(`${item.name} (created — SAR ${item.unitPrice})`);
            } else {
                ok(`${item.name} (skipped — ${res.data?.message || res.status})`);
            }
        }
    }
    return items;
}

async function seedOpeningBalances(items, locations) {
    log('\n── Creating Opening Balances ─────────────────────────────────────');
    if (locations.length === 0 || items.length === 0) {
        ok('Skipping — no locations or items');
        return;
    }

    let created = 0;
    for (const loc of locations) {
        // Give each location 8-12 random items
        const count = Math.min(items.length, Math.floor(Math.random() * 5) + 8);
        const shuffled = [...items].sort(() => 0.5 - Math.random()).slice(0, count);

        for (const item of shuffled) {
            if (!item.id) continue;
            const qty = Math.floor(Math.random() * 80) + 20; // 20 to 100

            const res = await post('/api/movements', {
                movementType: 'OPENING_BALANCE',
                destLocationId: loc.id,
                lines: [{ itemId: item.id, locationId: loc.id, qtyRequested: qty, unitCost: item.cost }],
            });

            if (res.status === 200 || res.status === 201) {
                const docId = res.data.data?.id;
                if (docId) {
                    const postRes = await post(`/api/movements/${docId}/post`, {});
                    if (postRes.status === 200) created++;
                }
            }
        }
        ok(`${loc.name}: ${count} OB entries`);
    }
    ok(`Total: ${created} opening balances posted`);
}

async function seedRequisitions(items, locations) {
    log('\n── Creating Requisitions ─────────────────────────────────────────');
    if (locations.length < 1 || items.length < 3) return;

    let created = 0;
    for (let i = 0; i < 5; i++) {
        const loc = locations[Math.floor(Math.random() * locations.length)];
        const selItems = [...items].sort(() => 0.5 - Math.random()).slice(0, 3);

        const res = await post('/api/requisitions', {
            locationId: loc.id,
            notes: `Demo requisition #${i + 1}`,
            lines: selItems.map(item => ({
                itemId: item.id,
                qtyRequested: Math.floor(Math.random() * 5) + 1,
            })),
        });

        if (res.status === 200 || res.status === 201) {
            created++;
            // Submit the requisition (DRAFT → SUBMITTED)
            const reqId = res.data.data?.id;
            if (reqId) {
                await post(`/api/requisitions/${reqId}/submit`, {});
            }
        }
    }
    ok(`${created} requisitions created and submitted`);
}

async function seedTransfers(items, locations) {
    log('\n── Creating Transfers ────────────────────────────────────────────');
    if (locations.length < 2 || items.length < 1) return;

    let created = 0;
    for (let i = 0; i < 5; i++) {
        const fromIdx = Math.floor(Math.random() * locations.length);
        let toIdx = Math.floor(Math.random() * locations.length);
        while (toIdx === fromIdx) toIdx = Math.floor(Math.random() * locations.length);

        const item = items[Math.floor(Math.random() * items.length)];
        if (!item.id) continue;

        const qty = Math.floor(Math.random() * 5) + 1;
        const res = await post('/api/transfers', {
            fromLocationId: locations[fromIdx].id,
            toLocationId: locations[toIdx].id,
            notes: `Demo transfer #${i + 1}`,
            lines: [{ itemId: item.id, qty }],
        });

        if (res.status === 200 || res.status === 201) {
            created++;
        }
    }
    ok(`${created} transfers created`);
}

async function seedBreakage(items, locations) {
    log('\n── Creating Breakage Documents ───────────────────────────────────');
    if (locations.length === 0 || items.length === 0) return;

    let created = 0;
    for (let i = 0; i < 3; i++) {
        const loc = locations[Math.floor(Math.random() * locations.length)];
        const selItems = [...items].sort(() => 0.5 - Math.random()).slice(0, 2);

        const res = await post('/api/breakage', {
            locationId: loc.id,
            notes: `Demo breakage #${i + 1} — handling damage`,
            lines: selItems.map(item => ({
                itemId: item.id,
                qty: Math.floor(Math.random() * 3) + 1,
                reason: 'Damaged during handling/transport',
            })),
        });

        if (res.status === 200 || res.status === 201) {
            created++;
        }
    }
    ok(`${created} breakage documents created`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    log('══════════════════════════════════════════════════════════════════');
    log('  OS&E Cloud — Demo Data Seeder');
    log('══════════════════════════════════════════════════════════════════');

    await authenticate();
    const locations = await getLocations();
    const categoryIds = await seedCategories();
    const items = await seedItems(categoryIds);
    await seedOpeningBalances(items, locations);
    await seedRequisitions(items, locations);
    await seedTransfers(items, locations);
    await seedBreakage(items, locations);

    log('\n══════════════════════════════════════════════════════════════════');
    log('  🏆  Demo data seeding COMPLETE');
    log(`  Locations: ${locations.length}`);
    log(`  Items: ${items.length}`);
    log(`  Categories: ${categoryIds.filter(Boolean).length}`);
    log('  Now check /dashboard and /reports for populated data!');
    log('══════════════════════════════════════════════════════════════════');
}

main().catch(err => { console.error('Seeder failed:', err.message); process.exit(1); });
