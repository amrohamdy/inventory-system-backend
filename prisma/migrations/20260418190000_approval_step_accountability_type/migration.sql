-- Persist accountability chosen at each approval step (get-pass return workflows).
ALTER TABLE "approval_steps" ADD COLUMN "accountabilityType" "GetPassReturnAccountability";
