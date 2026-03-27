const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

const hashPassword = async (plainText) => {
    return bcrypt.hash(plainText, SALT_ROUNDS);
};

const comparePassword = async (plainText, hash) => {
    return bcrypt.compare(plainText, hash);
};

module.exports = { hashPassword, comparePassword };
