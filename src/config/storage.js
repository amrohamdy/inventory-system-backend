'use strict';

const logger = require('../utils/logger');
const { createLocalProvider } = require('../services/storage/local.provider');
const { createR2Provider } = require('../services/storage/r2.provider');

const readDriver = () => {
    const raw = String(process.env.STORAGE_DRIVER || 'local').trim().toLowerCase();
    if (raw === 'r2' || raw === 's3') return 'r2';
    return 'local';
};

let _instance = null;

const getStorage = () => {
    if (_instance) return _instance;

    const driver = readDriver();
    try {
        _instance = driver === 'r2' ? createR2Provider() : createLocalProvider();
        logger.info(`[storage] provider=${_instance.driver}`);
    } catch (err) {
        if (driver === 'r2') {
            logger.error(`[storage] R2 init failed, falling back to local: ${err.message}`);
            _instance = createLocalProvider();
        } else {
            throw err;
        }
    }
    return _instance;
};

const isLocalDriver = () => readDriver() === 'local';

const resetStorageForTest = () => {
    _instance = null;
};

module.exports = { getStorage, isLocalDriver, resetStorageForTest };
