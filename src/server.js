require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const logger = require('./utils/logger');
const routes = require('./routes');
const adminRoutes = require('./routes/superAdmin.routes');
require('./utils/scheduler'); // Initialize cron jobs

const app = express();

// Railway / reverse proxies: required for correct client IP and express-rate-limit (X-Forwarded-For)
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

// ─── Security Middleware ───────────────────────────────────────────────────
app.use(helmet({
    // Allow images & assets to be loaded cross-origin (frontend on :5173, backend on :4000)
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
const isDev = (process.env.NODE_ENV || 'development') !== 'production';

// Reflect any request Origin so credentialed cross-origin requests work from any host (not `*` — incompatible with credentials: true).
app.use(cors({
    origin: true,
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

const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 100 : 5,
    message: { success: false, message: 'Too many reset requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/auth/forgot-password', forgotPasswordLimiter);

const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isDev ? 200 : 20,
    message: { success: false, message: 'Too many reset attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/auth/reset-password', resetPasswordLimiter);

// ─── Body Parsing ─────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ─── Static Files (uploaded images) ───────────────────────────────────────
// Only active when STORAGE_DRIVER=local (dev fallback). In production with R2,
// files are served via short-lived signed URLs from /api/files/signed-url
// after authenticate + tenant-prefix validation.
const path = require('path');
const { isLocalDriver } = require('./config/storage');
if (isLocalDriver()) {
    app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
    logger.info('[storage] serving legacy /uploads via express.static (STORAGE_DRIVER=local)');
}

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

// ─── API Docs (Swagger UI + raw spec) ─────────────────────────────────────
// Mounted before the API routes so the basicAuth gate in docs.routes.js
// handles its own 401 without going through the JWT authenticate chain.
app.use('/', require('./routes/docs.routes'));

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
