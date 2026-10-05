-- Indexes for lookups that otherwise scan whole tables as data grows: organization-wide lead and
-- account lists ordered by last update, leads by contact or account, users by organization,
-- outbox rows by delivery status and bot activity in the audit log. Adds no columns or data.
CREATE INDEX IF NOT EXISTS lead_org_updated ON lead(organization_id, updated_at);
CREATE INDEX IF NOT EXISTS lead_contact ON lead(contact_id);
CREATE INDEX IF NOT EXISTS lead_account ON lead(account_id);
CREATE INDEX IF NOT EXISTS account_org_updated ON account(organization_id, updated_at);
CREATE INDEX IF NOT EXISTS app_user_org ON app_user(organization_id);
CREATE INDEX IF NOT EXISTS outbox_status ON outbox(status);
CREATE INDEX IF NOT EXISTS audit_actor_kind_created ON audit_log(actor_kind, created_at);
