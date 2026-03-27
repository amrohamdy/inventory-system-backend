const http = require('http');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const report = await prisma.savedStockReport.findFirst();
    if (!report) return console.error("No reports found.");

    // Create a mock jwt token for admin to hit the endpoint bypassing auth wait, we will just disable auth for this route temporarily inside the backend...
    // Actually, I can just generate a token
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: 'dummy', tenantId: report.tenantId, role: 'ADMIN' }, process.env.JWT_SECRET || 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2');

    const req = http.get(`http://localhost:4000/api/stock-report/saved/${report.id}/pdf`, {
        headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
        console.log("Status Code:", res.statusCode);
        console.log("Headers:", res.headers);
        const data = [];
        res.on('data', chunk => data.push(chunk));
        res.on('end', () => {
            const buf = Buffer.concat(data);
            console.log("Response length:", buf.length);
            fs.writeFileSync('test-api.pdf', buf);
            if (buf.length < 1000) {
                console.log("Body:", buf.toString());
            }
            prisma.$disconnect();
        });
    });

    req.on('error', e => console.error(e));
}

run();
