/**
 * Branch/hotel subscription label for create flows:
 * - Lifetime license (licenseEndDate null or '') => ACTIVE (never TRIAL).
 * - TRIAL only when explicitly requested and not lifetime.
 * - Omitted or ACTIVE => ACTIVE.
 */
function resolveHotelSubStatusForCreate({ subStatus, licenseEndDate }) {
    if (licenseEndDate === null || licenseEndDate === '') return 'ACTIVE';
    if (subStatus === 'TRIAL') return 'TRIAL';
    return 'ACTIVE';
}

module.exports = { resolveHotelSubStatusForCreate };
