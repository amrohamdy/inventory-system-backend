'use strict';

const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl: presign } = require('@aws-sdk/s3-request-presigner');
const logger = require('../../utils/logger');

const DEFAULT_TTL_SECONDS = 604800; // 7 days (S3 SigV4 hard cap)

const getTtl = () => {
    const n = parseInt(process.env.SIGNED_URL_TTL_SECONDS, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SECONDS;
};

const buildClient = () => {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);

    if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error(
            'R2 not configured: set R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY'
        );
    }

    return new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
    });
};

const createR2Provider = () => {
    const bucket = process.env.R2_BUCKET;
    if (!bucket) {
        throw new Error('R2 not configured: set R2_BUCKET');
    }
    const client = buildClient();

    return {
        driver: 'r2',

        async put(key, body, opts = {}) {
            await client.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    Body: body,
                    ContentType: opts.contentType || 'application/octet-stream',
                    Metadata: opts.originalName ? { 'original-name': encodeURIComponent(opts.originalName) } : undefined,
                })
            );
            return { key };
        },

        async getSignedUrl(key, ttlSeconds) {
            const url = await presign(
                client,
                new GetObjectCommand({ Bucket: bucket, Key: key }),
                { expiresIn: ttlSeconds || getTtl() }
            );
            return url;
        },

        async delete(key) {
            try {
                await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
                return true;
            } catch (err) {
                if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') return false;
                logger.warn(`[storage.r2] delete failed key=${key} reason=${err?.message}`);
                return false;
            }
        },

        async exists(key) {
            try {
                await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
                return true;
            } catch (err) {
                if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return false;
                throw err;
            }
        },
    };
};

module.exports = { createR2Provider };
