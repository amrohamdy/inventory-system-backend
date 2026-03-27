require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const { enforcetenantScope } = require('./middleware/tenantScope');
const { enforceSubscription } = require('./middleware/subscription');
const logger = require('./utils/logger');
const routes = require('./routes');
const adminRoutes = require('./routes/superAdmin.routes');
require('./utils/scheduler'); // Initialize cron jobs

const app = express();

// ─── Security Middleware ───────────────────────────────────────────────────
app.use(helmet({
    // Allow images & assets to be loaded cross-origin (frontend on :5173, backend on :4000)
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
const corsOrigins = process.env.CORS_ORIGIN?.trim()
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : ['http://localhost:5173', 'http://localhost:4200'];

const isDev = (process.env.NODE_ENV || 'development') !== 'production';

app.use(cors({
    // Callback: exact allow-list from env + localhost/127.0.0.1 on common dev ports (Origin differs: localhost vs 127.0.0.1)
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (corsOrigins.includes(origin)) return callback(null, true);
        if (isDev && /^https?:\/\/(localhost|127\.0\.0\.1):(4200|5173)$/.test(origin)) {
            return callback(null, true);
        }
        callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// ─── Rate Limiting ─────────────────────────────────────────────────────────
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 2000,
    message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);

const authLimiter = rateLimit({
    windowMs: isDev ? 60 * 1000 : 15 * 60 * 1000,
    max: isDev ? 1000 : 20,
    skip: () => isDev, // Disable login throttling in development
    message: { success: false, message: 'Too many login attempts, please try again later.' },
});
app.use('/api/auth/login', authLimiter);

// ─── Body Parsing ─────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Static Files (uploaded images) ───────────────────────────────────────
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Request Logging ──────────────────────────────────────────────────────
app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
}));

// ─── Health Check ─────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'OS&E Inventory API is running',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
    });
});

// ─── API Routes ───────────────────────────────────────────────────────────
// Super Admin routes — separate scope, own auth guard inside the router
app.use('/api/admin', adminRoutes);

// Tenant-scoped routes (auth + SaaS middleware applied inside routes/index.js)
app.use('/api', routes);

// ─── Error Handling ───────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    logger.info(`🚀 OS&E API Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app;
