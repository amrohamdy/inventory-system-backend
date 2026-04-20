'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = __dirname;
const cache = new Map();

const readTemplate = (name) => {
    if (cache.has(name)) return cache.get(name);
    const file = path.join(TEMPLATES_DIR, `${name}.html`);
    const raw = fs.readFileSync(file, 'utf8');
    cache.set(name, raw);
    return raw;
};

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/**
 * Render template by substituting {{var}} placeholders. Default behaviour is HTML-escape.
 * Use {{{var}}} for raw substitution (trusted HTML fragment assembled by the caller).
 * Missing vars become empty strings.
 */
const render = (name, vars = {}) => {
    const tmpl = readTemplate(name);
    return tmpl
        .replace(/\{\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\}/g, (_, key) => {
            const value = resolvePath(vars, key);
            return value == null ? '' : String(value);
        })
        .replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
            const value = resolvePath(vars, key);
            return escapeHtml(value);
        });
};

const resolvePath = (obj, dotted) => {
    if (!obj) return undefined;
    const parts = String(dotted).split('.');
    let cursor = obj;
    for (const part of parts) {
        if (cursor == null) return undefined;
        cursor = cursor[part];
    }
    return cursor;
};

const clearCache = () => cache.clear();

module.exports = { render, clearCache };
