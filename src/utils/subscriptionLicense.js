/**
 * Date-based subscription enforcement (independent of persisted subStatus).
 */

function isLicenseEndDatePast(licenseEndDate, now = new Date()) {
    if (licenseEndDate === null || licenseEndDate === undefined || licenseEndDate === '') {
        return false;
    }
    const end = licenseEndDate instanceof Date ? licenseEndDate : new Date(licenseEndDate);
    if (Number.isNaN(end.getTime())) return false;
    return end < now;
}

/**
 * True if the tenant must be blocked for subscription reasons:
 * persisted EXPIRED, or license end date is strictly before now.
 */
function isTenantSubscriptionExpired(tenant) {
    if (!tenant) return false;
    if (tenant.subStatus === 'EXPIRED') return true;
    return isLicenseEndDatePast(tenant.licenseEndDate);
}

module.exports = {
    isLicenseEndDatePast,
    isTenantSubscriptionExpired,
};
