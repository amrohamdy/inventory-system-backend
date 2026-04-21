'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const spec = require('../config/swagger');
const { swaggerAuth } = require('../middleware/swagger-auth');

const router = express.Router();

// Raw spec for programmatic consumers (e.g. generating a client SDK).
router.get('/api-docs.json', swaggerAuth, (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(spec);
});

// The UI itself. Using `serveFiles` + `setup` with `explorer: true` so users
// can swap specs; here we only have one so it stays hidden in practice.
router.use(
    '/api-docs',
    swaggerAuth,
    swaggerUi.serveFiles(spec, { explorer: false }),
    swaggerUi.setup(spec, {
        explorer: false,
        swaggerOptions: {
            persistAuthorization: true,
            displayRequestDuration: true,
        },
        customSiteTitle: 'OS&E Inventory — API Docs',
    }),
);

module.exports = router;
