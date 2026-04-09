-- Optimize GET /locations?departmentId=... (tenant + department + isActive filters)
CREATE INDEX "locations_tenantId_departmentId_idx" ON "locations"("tenantId", "departmentId");
