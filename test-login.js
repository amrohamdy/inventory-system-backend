const http = require('http');

const data = JSON.stringify({
    email: 'admin@grandhorizon.com',
    password: 'Admin@123',
    tenantSlug: 'grand-horizon'
});

const options = {
    hostname: 'localhost',
    port: 4000,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        try {
            const parsed = JSON.parse(body);
            console.log('Response:', JSON.stringify(parsed, null, 2));
        } catch {
            console.log('Raw body:', body.substring(0, 500));
        }
    });
});

req.on('error', e => console.error('Request failed:', e.message));
req.write(data);
req.end();
