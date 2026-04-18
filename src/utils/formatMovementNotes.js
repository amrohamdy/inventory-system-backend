'use strict';

/** Enum-style tokens (e.g. EMPLOYEE_DEDUCTION) → Title Case words */
function humanizeEnumToken(value) {
    if (value == null || value === '') return '—';
    const s = String(value).trim();
    return s
        .split('_')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

const KEY_FORMATTERS = {
    ACCOUNTABILITY: (val) => `Accountability: ${humanizeEnumToken(val)}`,
    MANAGER_NOTES: (val) => `Manager notes: ${val}`,
};

function formatOneSegment(segment) {
    const idx = segment.indexOf(':');
    if (idx <= 0) return segment;

    const key = segment.slice(0, idx).trim();
    const val = segment.slice(idx + 1).trim();

    const formatter = KEY_FORMATTERS[key];
    if (formatter) return formatter(val);

    const label = key
        .split('_')
        .filter(Boolean)
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(' ');

    if (/^[A-Z0-9_]+$/.test(val) && val.includes('_')) {
        return `${label}: ${humanizeEnumToken(val)}`;
    }
    return `${label}: ${val}`;
}

/**
 * Formats machine-prefixed notes (e.g. from get-pass returns) for display.
 * @param {string|null|undefined} raw
 * @param {{ separator?: string }} [opts] — default separator between pipe-separated segments is newline; use a single line for PDF rows.
 * @returns {string|null|undefined}
 */
function formatStructuredMovementNotes(raw, opts = {}) {
    if (raw == null || raw === '') return raw;
    const str = String(raw).trim();
    if (!str) return raw;

    const sep = opts.separator !== undefined ? opts.separator : '\n';
    const parts = str.split(/\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return raw;
    if (parts.length === 1 && !parts[0].includes(':')) return str;

    return parts.map(formatOneSegment).join(sep);
}

/** Prisma returns `approvalRequests` as a single relation object; list APIs use an array. Normalize for GET detail. */
function normalizeApprovalRequestsOnDocument(doc) {
    if (!doc || doc.approvalRequests === undefined) return doc;
    const ar = doc.approvalRequests;
    if (ar === null) return { ...doc, approvalRequests: [] };
    if (Array.isArray(ar)) return doc;
    return { ...doc, approvalRequests: [ar] };
}

/** Apply display formatting to document + line notes (Prisma movement doc). */
function formatMovementDocumentNotes(doc) {
    if (!doc) return doc;
    const withNotes = {
        ...doc,
        notes: doc.notes != null ? (formatStructuredMovementNotes(doc.notes) ?? doc.notes) : doc.notes,
        lines: Array.isArray(doc.lines)
            ? doc.lines.map((l) => ({
                ...l,
                notes: l.notes != null ? (formatStructuredMovementNotes(l.notes) ?? l.notes) : l.notes,
            }))
            : doc.lines,
    };
    return normalizeApprovalRequestsOnDocument(withNotes);
}

module.exports = {
    formatStructuredMovementNotes,
    humanizeEnumToken,
    formatMovementDocumentNotes,
    normalizeApprovalRequestsOnDocument,
};
