-- Remove synthetic demo rows and staff-created rows that hang off them.
-- Staff rows use ordinary ids, so each delete follows the parent chain
-- (demo contact, account, product, course, class, lead, enrollment, charge).
-- Child tables go first. audit_log matches entity_id only, never free text.
-- outbox and idempotency_key are not demo data and are left untouched.
-- Payload text is not a delete key. The loader emptiness check therefore
-- ignores outbox, idempotency_key, and audit_log rows that are not demo data.
-- Every business table must still be empty, and a demo audit_log row still blocks the load.
-- Afterwards lead_counter.next_value is one past the highest remaining L- code
-- (or 1 when no lead remains). fee_counter is removed when no charge remains,
-- otherwise it is one past the highest remaining HP code.
-- Does not delete app_user, team, department, organization, user_session, or agent_token.
-- Id sets are ordinary tables, dropped at the end. D1 rejects TEMP tables and PRAGMA foreign_keys.
-- Usage from apps/crm, only when you intend to change remote data:
--   node node_modules/wrangler/bin/wrangler.js d1 execute abm-crm-eval --remote --file seed/cleanup-demo.sql

DROP TABLE IF EXISTS demo_contact;
DROP TABLE IF EXISTS demo_account;
DROP TABLE IF EXISTS demo_product;
DROP TABLE IF EXISTS demo_course;
DROP TABLE IF EXISTS demo_class;
DROP TABLE IF EXISTS demo_contract;
DROP TABLE IF EXISTS demo_lead;
DROP TABLE IF EXISTS demo_enrollment;
DROP TABLE IF EXISTS demo_session;
DROP TABLE IF EXISTS demo_trial;
DROP TABLE IF EXISTS demo_attendance;
DROP TABLE IF EXISTS demo_charge;
DROP TABLE IF EXISTS demo_payment;

CREATE TABLE demo_contact (id TEXT PRIMARY KEY);
INSERT INTO demo_contact (id) SELECT id FROM contact WHERE id LIKE 'demo-%';

CREATE TABLE demo_account (id TEXT PRIMARY KEY);
INSERT INTO demo_account (id) SELECT id FROM account WHERE id LIKE 'demo-%';

CREATE TABLE demo_product (id TEXT PRIMARY KEY);
INSERT INTO demo_product (id) SELECT id FROM product WHERE id LIKE 'demo-%';

CREATE TABLE demo_course (id TEXT PRIMARY KEY);
INSERT INTO demo_course (id)
SELECT id FROM course WHERE id LIKE 'demo-%' OR product_id IN (SELECT id FROM demo_product);

CREATE TABLE demo_class (id TEXT PRIMARY KEY);
INSERT INTO demo_class (id)
SELECT id FROM class_group WHERE id LIKE 'demo-%' OR course_id IN (SELECT id FROM demo_course);

CREATE TABLE demo_contract (id TEXT PRIMARY KEY);
INSERT INTO demo_contract (id)
SELECT id FROM partner_contract WHERE id LIKE 'demo-%' OR account_id IN (SELECT id FROM demo_account);

CREATE TABLE demo_lead (id TEXT PRIMARY KEY);
INSERT INTO demo_lead (id)
SELECT id FROM lead
WHERE id LIKE 'demo-%'
   OR contact_id IN (SELECT id FROM demo_contact)
   OR account_id IN (SELECT id FROM demo_account)
   OR partner_contract_id IN (SELECT id FROM demo_contract);

CREATE TABLE demo_enrollment (id TEXT PRIMARY KEY);
WITH RECURSIVE walk(id) AS (
  SELECT id FROM enrollment
  WHERE id LIKE 'demo-%'
     OR contact_id IN (SELECT id FROM demo_contact)
     OR class_id IN (SELECT id FROM demo_class)
     OR lead_id IN (SELECT id FROM demo_lead)
  UNION
  SELECT e.id FROM enrollment e JOIN walk w ON e.transferred_from_enrollment_id = w.id
)
INSERT INTO demo_enrollment (id) SELECT id FROM walk;

CREATE TABLE demo_session (id TEXT PRIMARY KEY);
INSERT INTO demo_session (id)
SELECT id FROM class_session WHERE id LIKE 'demo-%' OR class_id IN (SELECT id FROM demo_class);

CREATE TABLE demo_trial (id TEXT PRIMARY KEY);
INSERT INTO demo_trial (id)
SELECT id FROM trial_booking
WHERE id LIKE 'demo-%'
   OR lead_id IN (SELECT id FROM demo_lead)
   OR session_id IN (SELECT id FROM demo_session);

CREATE TABLE demo_attendance (id TEXT PRIMARY KEY);
INSERT INTO demo_attendance (id)
SELECT id FROM attendance
WHERE id LIKE 'demo-%'
   OR session_id IN (SELECT id FROM demo_session)
   OR enrollment_id IN (SELECT id FROM demo_enrollment)
   OR trial_booking_id IN (SELECT id FROM demo_trial);

INSERT OR IGNORE INTO demo_session (id)
SELECT id FROM class_session WHERE makeup_for_attendance_id IN (SELECT id FROM demo_attendance);
INSERT OR IGNORE INTO demo_trial (id)
SELECT id FROM trial_booking
WHERE lead_id IN (SELECT id FROM demo_lead) OR session_id IN (SELECT id FROM demo_session);
INSERT OR IGNORE INTO demo_attendance (id)
SELECT id FROM attendance
WHERE session_id IN (SELECT id FROM demo_session)
   OR enrollment_id IN (SELECT id FROM demo_enrollment)
   OR trial_booking_id IN (SELECT id FROM demo_trial);

INSERT OR IGNORE INTO demo_session (id)
SELECT id FROM class_session WHERE makeup_for_attendance_id IN (SELECT id FROM demo_attendance);
INSERT OR IGNORE INTO demo_trial (id)
SELECT id FROM trial_booking
WHERE lead_id IN (SELECT id FROM demo_lead) OR session_id IN (SELECT id FROM demo_session);
INSERT OR IGNORE INTO demo_attendance (id)
SELECT id FROM attendance
WHERE session_id IN (SELECT id FROM demo_session)
   OR enrollment_id IN (SELECT id FROM demo_enrollment)
   OR trial_booking_id IN (SELECT id FROM demo_trial);

CREATE TABLE demo_charge (id TEXT PRIMARY KEY);
INSERT INTO demo_charge (id)
SELECT id FROM charge
WHERE id LIKE 'demo-%'
   OR contact_id IN (SELECT id FROM demo_contact)
   OR enrollment_id IN (SELECT id FROM demo_enrollment);

CREATE TABLE demo_payment (id TEXT PRIMARY KEY);
INSERT INTO demo_payment (id)
SELECT p.id FROM payment p
WHERE p.id LIKE 'demo-%'
   OR p.contact_id IN (SELECT id FROM demo_contact)
   OR (
     EXISTS (
       SELECT 1 FROM payment_allocation a
       WHERE a.payment_id = p.id AND a.charge_id IN (SELECT id FROM demo_charge)
     )
     AND NOT EXISTS (
       SELECT 1 FROM payment_allocation a
       WHERE a.payment_id = p.id AND a.charge_id NOT IN (SELECT id FROM demo_charge)
     )
   );

DELETE FROM audit_log
WHERE id LIKE 'demo-%'
   OR entity_id LIKE 'demo-%'
   OR entity_id IN (SELECT id FROM demo_contact)
   OR entity_id IN (SELECT id FROM demo_account)
   OR entity_id IN (SELECT id FROM demo_product)
   OR entity_id IN (SELECT id FROM demo_course)
   OR entity_id IN (SELECT id FROM demo_class)
   OR entity_id IN (SELECT id FROM demo_contract)
   OR entity_id IN (SELECT id FROM demo_lead)
   OR entity_id IN (SELECT id FROM demo_enrollment)
   OR entity_id IN (SELECT id FROM demo_session)
   OR entity_id IN (SELECT id FROM demo_trial)
   OR entity_id IN (SELECT id FROM demo_attendance)
   OR entity_id IN (SELECT id FROM demo_charge)
   OR entity_id IN (SELECT id FROM demo_payment)
   OR entity_id IN (
     SELECT id FROM payment_allocation
     WHERE charge_id IN (SELECT id FROM demo_charge) OR payment_id IN (SELECT id FROM demo_payment)
   )
   OR entity_id IN (SELECT id FROM task WHERE id LIKE 'demo-%' OR lead_id IN (SELECT id FROM demo_lead))
   OR entity_id IN (SELECT id FROM activity WHERE id LIKE 'demo-%' OR lead_id IN (SELECT id FROM demo_lead))
   OR entity_id IN (SELECT id FROM approval WHERE id LIKE 'demo-%' OR lead_id IN (SELECT id FROM demo_lead))
   OR entity_id IN (SELECT id FROM lead_step WHERE id LIKE 'demo-%' OR lead_id IN (SELECT id FROM demo_lead))
   OR entity_id IN (SELECT id FROM consent WHERE id LIKE 'demo-%' OR contact_id IN (SELECT id FROM demo_contact))
   OR entity_id IN (SELECT id FROM privacy_request WHERE id LIKE 'demo-%' OR contact_id IN (SELECT id FROM demo_contact))
   OR entity_id IN (
     SELECT id FROM customer_product
     WHERE id LIKE 'demo-%' OR contact_id IN (SELECT id FROM demo_contact) OR product_id IN (SELECT id FROM demo_product)
   )
   OR entity_id IN (
     SELECT id FROM contact_point WHERE id LIKE 'demo-%' OR contact_id IN (SELECT id FROM demo_contact)
   )
   OR entity_id IN (
     SELECT id FROM account_contact
     WHERE id LIKE 'demo-%' OR contact_id IN (SELECT id FROM demo_contact) OR account_id IN (SELECT id FROM demo_account)
   )
   OR entity_id IN (SELECT id FROM class_teacher WHERE id LIKE 'demo-%' OR class_id IN (SELECT id FROM demo_class))
   OR entity_id IN (
     SELECT id FROM partner_contract_step
     WHERE id LIKE 'demo-%' OR contract_id IN (SELECT id FROM demo_contract)
   );

DELETE FROM payment_allocation
WHERE charge_id IN (SELECT id FROM demo_charge)
   OR payment_id IN (SELECT id FROM demo_payment);

DELETE FROM payment WHERE id IN (SELECT id FROM demo_payment);

DELETE FROM charge WHERE id IN (SELECT id FROM demo_charge);

DELETE FROM attendance WHERE id IN (SELECT id FROM demo_attendance);

DELETE FROM trial_booking WHERE id IN (SELECT id FROM demo_trial);

DELETE FROM enrollment WHERE id IN (SELECT id FROM demo_enrollment);

DELETE FROM class_session WHERE id IN (SELECT id FROM demo_session);

DELETE FROM class_teacher WHERE class_id IN (SELECT id FROM demo_class) OR id LIKE 'demo-%';

DELETE FROM class_group WHERE id IN (SELECT id FROM demo_class);

DELETE FROM course WHERE id IN (SELECT id FROM demo_course);

DELETE FROM consent WHERE contact_id IN (SELECT id FROM demo_contact) OR id LIKE 'demo-%';

DELETE FROM customer_product
WHERE contact_id IN (SELECT id FROM demo_contact)
   OR product_id IN (SELECT id FROM demo_product)
   OR id LIKE 'demo-%';

DELETE FROM privacy_request WHERE contact_id IN (SELECT id FROM demo_contact) OR id LIKE 'demo-%';

DELETE FROM approval WHERE lead_id IN (SELECT id FROM demo_lead) OR id LIKE 'demo-%';

DELETE FROM activity WHERE lead_id IN (SELECT id FROM demo_lead) OR id LIKE 'demo-%';

DELETE FROM task WHERE lead_id IN (SELECT id FROM demo_lead) OR id LIKE 'demo-%';

DELETE FROM lead_step WHERE lead_id IN (SELECT id FROM demo_lead) OR id LIKE 'demo-%';

DELETE FROM lead WHERE id IN (SELECT id FROM demo_lead);

DELETE FROM partner_contract_step WHERE contract_id IN (SELECT id FROM demo_contract) OR id LIKE 'demo-%';

DELETE FROM partner_contract WHERE id IN (SELECT id FROM demo_contract);

DELETE FROM contact_point WHERE contact_id IN (SELECT id FROM demo_contact) OR id LIKE 'demo-%';

DELETE FROM account_contact
WHERE contact_id IN (SELECT id FROM demo_contact)
   OR account_id IN (SELECT id FROM demo_account)
   OR id LIKE 'demo-%';

DELETE FROM contact WHERE id IN (SELECT id FROM demo_contact);

DELETE FROM account WHERE id IN (SELECT id FROM demo_account);

DELETE FROM product WHERE id IN (SELECT id FROM demo_product);

UPDATE lead_counter
SET next_value = COALESCE((
  SELECT MAX(CAST(SUBSTR(code, 3) AS INTEGER)) + 1
  FROM lead
  WHERE organization_id = lead_counter.organization_id
    AND code GLOB 'L-[0-9]*'
), 1);

DELETE FROM fee_counter
WHERE NOT EXISTS (
  SELECT 1 FROM charge WHERE charge.organization_id = fee_counter.organization_id
);

UPDATE fee_counter
SET next_value = COALESCE((
  SELECT MAX(CAST(SUBSTR(code, 3) AS INTEGER)) + 1
  FROM charge
  WHERE organization_id = fee_counter.organization_id
    AND code GLOB 'HP[0-9]*'
), 1);

INSERT INTO fee_counter (organization_id, next_value)
SELECT grouped.organization_id, grouped.next_value
FROM (
  SELECT organization_id, COALESCE(MAX(CAST(SUBSTR(code, 3) AS INTEGER)) + 1, 1) AS next_value
  FROM charge
  WHERE code GLOB 'HP[0-9]*'
  GROUP BY organization_id
) AS grouped
WHERE NOT EXISTS (
  SELECT 1 FROM fee_counter WHERE fee_counter.organization_id = grouped.organization_id
);

DROP TABLE IF EXISTS demo_contact;
DROP TABLE IF EXISTS demo_account;
DROP TABLE IF EXISTS demo_product;
DROP TABLE IF EXISTS demo_course;
DROP TABLE IF EXISTS demo_class;
DROP TABLE IF EXISTS demo_contract;
DROP TABLE IF EXISTS demo_lead;
DROP TABLE IF EXISTS demo_enrollment;
DROP TABLE IF EXISTS demo_session;
DROP TABLE IF EXISTS demo_trial;
DROP TABLE IF EXISTS demo_attendance;
DROP TABLE IF EXISTS demo_charge;
DROP TABLE IF EXISTS demo_payment;
