'use strict';

const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const pkg = require('../../package.json');

/**
 * Build the OpenAPI 3.0 spec. The source-of-truth is JSDoc comments in:
 *   - src/docs/schemas.js   (reusable components)
 *   - src/routes/*.routes.js (per-endpoint specs)
 *
 * Scope for this PR: auth + upload-related endpoints only. Everything else
 * will land in follow-up PRs.
 */
const buildServers = () => {
    const servers = [];
    const railwayHost = process.env.RAILWAY_PUBLIC_DOMAIN;
    if (railwayHost) {
        servers.push({ url: `https://${railwayHost}/api`, description: 'Railway (this deployment)' });
    }
    if ((process.env.NODE_ENV || 'development') !== 'production') {
        servers.push({ url: `http://localhost:${process.env.PORT || 4000}/api`, description: 'Local dev' });
    }
    return servers;
};

const spec = swaggerJsdoc({
    definition: {
        openapi: '3.0.3',
        info: {
            title: 'OS&E Cloud Inventory API',
            version: pkg.version || '1.0.0',
            description: [
                'Partial OpenAPI spec covering authentication + upload-related endpoints.',
                '',
                '### Testing workflow',
                '1. Call `POST /auth/login` with a seeded account to get an `accessToken`.',
                '2. Click **Authorize** in the Swagger UI header, paste the token under `bearerAuth`.',
                '3. Try any endpoint. For uploads, use the file picker in the Swagger UI form.',
                '',
                '### Uploads & display (frontend integration)',
                'The backend stores files in Cloudflare R2 (private bucket). Upload endpoints',
                'return an **object key**, not a URL — e.g. `tenants/<tenantId>/items/<uuid>.jpg`.',
                'You **cannot** open this key directly in a browser; it is a pointer into R2.',
                '',
                'Two-step integration:',
                '1. **Upload once** — `POST /items/:id/image` (or any upload endpoint). The response',
                '   contains the key; store it in your app state / render it from the DB field',
                '   (`Item.imageUrl`, `MovementDocument.attachmentUrl`, etc.).',
                '2. **Display every time** — call `GET /files/signed-url?key=<theKey>` to get a',
                '   HTTPS URL (valid 7 days by default). Use it as `<img src>` / `<a href>`.',
                '   Cache it for the TTL window; re-fetch on expiry or if you see a 403.',
                '',
                '```js',
                '// React example',
                'const res = await fetch(`/api/files/signed-url?key=${item.imageUrl}`, {',
                '  headers: { Authorization: `Bearer ${token}` }',
                '});',
                'const { data } = await res.json();',
                '<img src={data.url} />',
                '```',
                '',
                'Cross-tenant protection: `/files/signed-url` returns **403** if the key does not',
                'start with `tenants/<yourTenantId>/`. Legacy `/uploads/...` paths are served by',
                'the backend directly when `STORAGE_DRIVER=local` (dev fallback).',
            ].join('\n'),
        },
        servers: buildServers(),
        tags: [
            {
                name: 'Auth',
                description:
                    'Login, refresh, identity, and password reset. Start here: POST /auth/login returns an accessToken you paste into the Authorize dialog.',
            },
            {
                name: 'Items',
                description:
                    'Item master data — image upload writes a storage key to `Item.imageUrl`. Bulk import accepts Excel; bulk image upload accepts a ZIP keyed by barcode.',
            },
            {
                name: 'GRN',
                description:
                    'Goods Receipt Notes. Creating a GRN is multipart (invoice file + JSON lines). Invoice file is saved to storage; its key lands in `GrnImport.pdfAttachmentUrl`.',
            },
            {
                name: 'Breakage',
                description:
                    'Breakage documents. Attachments are appended to a JSON array in `MovementDocument.attachmentUrl` — each entry has `key`, `originalName`, `mimetype`, `size`.',
            },
            {
                name: 'Stock Report',
                description:
                    'Stock counting workflow. The upload endpoint receives a filled count sheet and updates counted quantities in-place.',
            },
            {
                name: 'Files',
                description:
                    'Cross-cutting file helpers. `GET /files/signed-url?key=...` turns any storage key returned by an upload endpoint into a short-lived HTTPS URL for display.',
            },
        ],
    },
    apis: [
        path.join(__dirname, '../docs/**/*.js'),
        path.join(__dirname, '../routes/**/*.js'),
    ],
});

module.exports = spec;
