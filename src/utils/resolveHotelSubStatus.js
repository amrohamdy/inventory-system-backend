/**
 * Terminal subscription labels: never overridden by license-end automation.
 */
const isTerminalHotelSubStatus = (v) => v === 'EXPIRED' || v === 'SUSPENDED';

const isLifetimeLicenseEnd = (licenseEndDate) =>
    licenseEndDate === null || licenseEndDate === '';

/**
 * Branch/hotel subscription label for create flows:
 * - Explicit EXPIRED / SUSPENDED in the payload is kept regardless of licenseEndDate.
 * - Lifetime license (licenseEndDate null or '') => ACTIVE unless terminal subStatus was sent.
 * - TRIAL only when explicitly requested and the license is not lifetime.
 * - Omitted or ACTIVE => ACTIVE (for dated licenses).
 */
function resolveHotelSubStatusForCreate({ subStatus, licenseEndDate }) {
    if (isTerminalHotelSubStatus(subStatus)) return subStatus;
    if (isLifetimeLicenseEnd(licenseEndDate)) return 'ACTIVE';
    if (subStatus === 'TRIAL') return 'TRIAL';
    return 'ACTIVE';
}

/**
 * Branch/hotel subscription label for update flows:
 * - Any explicit subStatus in the payload wins over date-based automation (Super Admin / API manual override).
 * - When subStatus is omitted, clearing licenseEndDate (null or empty) forces ACTIVE.
 * - Otherwise the existing subStatus is kept.
 */
function resolveHotelSubStatusForUpdate({
    currentSubStatus,
    payloadSubStatus,
    hasSubStatusInPayload,
    nextLicenseEndDate,
    hasLicenseEndDateInPayload,
}) {
    if (hasSubStatusInPayload) return payloadSubStatus;
    if (hasLicenseEndDateInPayload && isLifetimeLicenseEnd(nextLicenseEndDate)) {
        return 'ACTIVE';
    }
    return currentSubStatus;
}

module.exports = {
    resolveHotelSubStatusForCreate,
    resolveHotelSubStatusForUpdate,
};
