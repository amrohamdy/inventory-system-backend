const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const globalForPrisma = global;

const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'error' },
            { emit: 'event', level: 'warn' },
        ],
    });

if (process.env.NODE_ENV !== 'production') {
    prisma.$on('query', (e) => {
        if (process.env.LOG_QUERIES === 'true') {
            logger.debug(`Query: ${e.query} | Duration: ${e.duration}ms`);
        }
    });
}

prisma.$on('error', (e) => {
    logger.error('Prisma error:', e);
});

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

module.exports = prisma;
