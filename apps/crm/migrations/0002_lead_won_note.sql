-- Won needs a closing value (expected_value) and an evidence note stored on the lead.
ALTER TABLE lead ADD COLUMN won_note TEXT;
-- Pending-request checks filter approvals by lead.
CREATE INDEX approval_lead_kind_status ON approval(lead_id, kind, status);
