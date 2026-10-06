-- Ready-to-use audiences connect announcements to departments and student classes.
-- The API resolves these grouping keys through fixed queries, never stored SQL.
ALTER TABLE notices ALTER COLUMN recipient_first_field TYPE VARCHAR(50);
INSERT INTO notice_recipient_types(role_id, primary_dependent_name, primary_dependent_select)
SELECT 2, 'Department', 'departments'
WHERE NOT EXISTS (SELECT 1 FROM notice_recipient_types WHERE role_id=2);
INSERT INTO notice_recipient_types(role_id, primary_dependent_name, primary_dependent_select)
SELECT 3, 'Class', 'classes'
WHERE NOT EXISTS (SELECT 1 FROM notice_recipient_types WHERE role_id=3);
UPDATE notice_recipient_types SET primary_dependent_name='Department', primary_dependent_select='departments' WHERE role_id=2;
UPDATE notice_recipient_types SET primary_dependent_name='Class', primary_dependent_select='classes' WHERE role_id=3;
