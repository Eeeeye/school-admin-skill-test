-- Upgrade the original assessment data without deleting application records.
CREATE TABLE IF NOT EXISTS departments (id SERIAL PRIMARY KEY, name VARCHAR(50) NOT NULL UNIQUE);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;

INSERT INTO departments(name) VALUES ('Administration'), ('Academics'), ('Human Resources') ON CONFLICT DO NOTHING;

-- Preserve role assignments when a legacy path and its corrected path coexist.
DO $navigation$
DECLARE entry RECORD; target_id INTEGER; corrected TEXT;
BEGIN
  FOR entry IN SELECT * FROM access_controls WHERE path LIKE '%markets%' OR path LIKE '%payments%' LOOP
    corrected := replace(entry.path, 'markets', 'class-teachers');
    corrected := replace(corrected, 'payments/edit/id', 'departments/edit/:id');
    corrected := replace(corrected, 'payments', 'departments');
    SELECT id INTO target_id FROM access_controls WHERE path = corrected AND method IS NOT DISTINCT FROM entry.method;
    IF target_id IS NOT NULL AND target_id <> entry.id THEN
      INSERT INTO permissions(role_id, access_control_id, type)
        SELECT role_id, target_id, type FROM permissions WHERE access_control_id = entry.id ON CONFLICT DO NOTHING;
      DELETE FROM permissions WHERE access_control_id = entry.id;
      DELETE FROM access_controls WHERE id = entry.id;
    ELSE
      UPDATE access_controls SET path = corrected,
        name = CASE WHEN entry.path = 'payments' THEN 'Departments' ELSE replace(replace(name, 'payment', 'department'), 'Payment', 'Department') END
        WHERE id = entry.id;
    END IF;
  END LOOP;
END;
$navigation$;

INSERT INTO access_controls(name,path,icon,parent_path,hierarchy_id,type,method) VALUES
('Certificates','certificates','academics.svg',NULL,8,'menu-screen',NULL),
('Departments','departments',NULL,'hr_parent',3,'menu-screen',NULL),
('Edit Department','departments/edit/:id',NULL,'hr_parent',NULL,'screen',NULL),
('Pending Notices','/api/v1/notices/pending',NULL,'communication_parent',NULL,'api','GET')
ON CONFLICT DO NOTHING;

-- Students can enter their account and read their own certificates. Certificate
-- API ownership is enforced separately and never trusts these UI permissions.
INSERT INTO permissions(role_id, access_control_id, type)
SELECT 3,id,type FROM access_controls WHERE path IN ('','account','certificates','/api/v1/dashboard')
ON CONFLICT DO NOTHING;
INSERT INTO permissions(role_id, access_control_id, type)
SELECT 2,id,type FROM access_controls WHERE path IN ('','account','/api/v1/dashboard')
ON CONFLICT DO NOTHING;

-- Migrate old department references only when the department name matches.
UPDATE user_profiles profile SET department_id = department.id
FROM payments legacy JOIN departments department ON lower(department.name) = lower(legacy.name)
WHERE profile.payment_id = legacy.id AND profile.department_id IS NULL;
