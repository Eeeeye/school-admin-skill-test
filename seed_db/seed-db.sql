-- All seed changes are atomic. Reserved IDs are part of the application contract.
BEGIN;

DO $seed_validation$
BEGIN
    IF EXISTS (
        SELECT 1 FROM roles actual
        JOIN (VALUES (1, 'Admin'), (2, 'Teacher'), (3, 'Student')) expected(id, name)
          ON actual.id = expected.id OR actual.name = expected.name
        WHERE actual.id <> expected.id OR actual.name IS DISTINCT FROM expected.name
    ) THEN
        RAISE EXCEPTION 'Reserved role IDs mismatch: require 1=Admin, 2=Teacher, 3=Student';
    END IF;
    IF EXISTS (
        SELECT 1 FROM leave_status actual
        JOIN (VALUES (1, 'On Review'), (2, 'Approved'), (3, 'Cancelled')) expected(id, name)
          ON actual.id = expected.id OR actual.name = expected.name
        WHERE actual.id <> expected.id OR actual.name IS DISTINCT FROM expected.name
    ) THEN
        RAISE EXCEPTION 'Reserved leave status IDs mismatch: require 1=On Review, 2=Approved, 3=Cancelled';
    END IF;
    IF EXISTS (
        SELECT 1 FROM notice_status actual
        JOIN (VALUES
            (1, 'Draft', 'Draft'),
            (2, 'Submit for Review', 'Approval Pending'),
            (3, 'Submit for Deletion', 'Delete Pending'),
            (4, 'Reject', 'Rejected'),
            (5, 'Approve', 'Approved'),
            (6, 'Delete', 'Deleted')
        ) expected(id, name, alias)
          ON actual.id = expected.id OR actual.name = expected.name OR actual.alias = expected.alias
        WHERE actual.id <> expected.id OR actual.name IS DISTINCT FROM expected.name
           OR actual.alias IS DISTINCT FROM expected.alias
    ) THEN
        RAISE EXCEPTION 'Reserved notice status IDs or aliases mismatch; seed will not reassign existing data';
    END IF;
END;
$seed_validation$;

INSERT INTO access_controls(
    name,
    path,
    icon,
    parent_path,
    hierarchy_id,
    type,
    method
)
VALUES
('Get my account detail', 'account', NULL, NULL, NULL, 'screen', NULL),
('Get permissions', '/api/v1/permissions', NULL, NULL, NULL, 'api', 'GET'),
('Get teachers', '/api/v1/teachers', NULL, NULL, NULL, 'api', 'GET'),

-- start dashboard
('Dashoard', '', NULL, NULL, NULL, 'screen', NULL),
('Get dashboard data', '/api/v1/dashboard', NULL, '', NULL, 'api', 'GET'),
-- end dashboard

-- start auth
('Resend email verification', '/api/v1/auth/resend-email-verification', NULL, NULL, NULL, 'api', 'POST'),
('Resend password setup link', '/api/v1/auth/resend-pwd-setup-link', NULL, NULL, NULL, 'api', 'POST'),
('Reset password', '/api/v1/auth/reset-pwd', NULL, NULL, NULL, 'api', 'POST'),
-- end auth


-- start leave
('Leave', 'leave_parent', 'leave.svg', NULL, 2, 'menu-screen', NULL),
('Leave Define', 'leave/define', NULL, 'leave_parent', 1, 'menu-screen', NULL),
('Leave Request', 'leave/request', NULL, 'leave_parent', 2, 'menu-screen', NULL),
('Pending Leave Request', 'leave/pending', NULL, 'leave_parent', 3, 'menu-screen', NULL),
('Add leave policy', '/api/v1/leave/policies', NULL, 'leave_parent', NULL, 'api', 'POST'),
('Get all leave policies', '/api/v1/leave/policies', NULL, 'leave_parent', NULL, 'api', 'GET'),
('Get my leave policies', '/api/v1/leave/policies/me', NULL, 'leave_parent', NULL, 'api', 'GET'),
('Update leave policy', '/api/v1/leave/policies/:id', NULL, 'leave_parent', NULL, 'api', 'PUT'),
('Handle policy status', '/api/v1/leave/policies/:id/status', NULL, 'leave_parent', NULL, 'api', 'POST'),
('Add user to policy', '/api/v1/leave/policies/:id/users', NULL, 'leave_parent', NULL, 'api', 'POST'),
('Get policy users', '/api/v1/leave/policies/:id/users', NULL, 'leave_parent', NULL, 'api', 'GET'),
('Remove user from policy', '/api/v1/leave/policies/:id/users', NULL, 'leave_parent', NULL, 'api', 'DELETE'),
('Get policy eligible users', '/api/v1/leave/policies/eligible-users', NULL, 'leave_parent', NULL, 'api', 'GET'),
('Get user leave history', '/api/v1/leave/request', NULL, 'leave_parent', NULL, 'api', 'GET'),
('Create new leave request', '/api/v1/leave/request', NULL, 'leave_parent', NULL, 'api', 'POST'),
('Update leave request', '/api/v1/leave/request/:id', NULL, 'leave_parent', NULL, 'api', 'PUT'),
('Delete leave request', '/api/v1/leave/request/:id', NULL, 'leave_parent', NULL, 'api', 'DELETE'),
('Get pending leave requests', '/api/v1/leave/pending', NULL, 'leave_parent', NULL, 'api', 'GET'),
('Handle leave request status', '/api/v1/leave/pending/:id/status', NULL, 'leave_parent', NULL, 'api', 'POST'),
-- end leave

--start academics
('Academics', 'academics_parent', 'academics.svg', NULL, 3, 'menu-screen', NULL),
('Classes', 'classes', NULL, 'academics_parent', 1, 'menu-screen', NULL),
('Class Teachers', 'class-teachers', NULL, 'academics_parent', 2, 'menu-screen', NULL),
('Sections', 'sections', NULL, 'academics_parent', 3, 'menu-screen', NULL),
('Classes Edit', 'classes/edit/:id', NULL, 'academics_parent', NULL, 'screen', NULL),
('Class Teachers Edit', 'class-teachers/edit/:id', NULL, 'academics_parent', NULL, 'screen', NULL),
('Get all classes', '/api/v1/classes', NULL, 'academics_parent', NULL, 'api', 'GET'),
('Get class detail', '/api/v1/classes/:id', NULL, 'academics_parent', NULL, 'api', 'GET'),
('Add new class', '/api/v1/classes', NULL, 'academics_parent', NULL, 'api', 'POST'),
('Update class detail', '/api/v1/classes/:id', NULL, 'academics_parent', NULL, 'api', 'PUT'),
('Delete class', '/api/v1/classes/:id', NULL, 'academics_parent', NULL, 'api', 'DELETE'),
('Get class with teacher details', '/api/v1/class-teachers', NULL, 'academics_parent', NULL, 'api', 'GET'),
('Add class teacher', '/api/v1/class-teachers', NULL, 'academics_parent', NULL, 'api', 'POST'),
('Get class teacher detail', '/api/v1/class-teachers/:id', NULL, 'academics_parent', NULL, 'api', 'GET'),
('Update class teacher detail', '/api/v1/class-teachers/:id', NULL, 'academics_parent', NULL, 'api', 'PUT'),
('Section Edit', 'sections/edit/:id', NULL, 'academics_parent', NULL, 'screen', NULL),
('Get all sections', '/api/v1/sections', NULL, 'academics_parent', NULL, 'api', 'GET'),
('Add new section', '/api/v1/sections', NULL, 'academics_parent', NULL, 'api', 'POST'),
('Get section detail', '/api/v1/sections/:id', NULL, 'academics_parent', NULL, 'api', 'GET'),
('Update section detail', '/api/v1/sections/:id', NULL, 'academics_parent', NULL, 'api', 'PUT'),
('Delete section', '/api/v1/sections/:id', NULL, 'academics_parent', NULL, 'api', 'DELETE'),
-- end academics

-- start departments
('Get all departments', '/api/v1/departments', NULL, 'hr_parent', NULL, 'api', 'GET'),
('Add new department', '/api/v1/departments', NULL, 'hr_parent', NULL, 'api', 'POST'),
('Get department detail', '/api/v1/departments/:id', NULL, 'hr_parent', NULL, 'api', 'GET'),
('Update department detail', '/api/v1/departments/:id', NULL, 'hr_parent', NULL, 'api', 'PUT'),
('Delete department detail', '/api/v1/departments/:id', NULL, 'hr_parent', NULL, 'api', 'DELETE'),
-- end departments

--start student
('Students', 'students_parent', 'students.svg', NULL, 4, 'menu-screen', NULL),
('Student List', 'students', NULL, 'students_parent', 1, 'menu-screen', NULL),
('Add Student', 'students/add', NULL, 'students_parent', 2, 'menu-screen', NULL),
('View Student', 'students/:id', NULL, 'students_parent', NULL, 'screen', NULL),
('Edit Student', 'students/edit/:id', NULL, 'students_parent', NULL, 'screen', NULL),
('Get students', '/api/v1/students', NULL, 'students_parent', NULL, 'api', 'GET'),
('Add new student', '/api/v1/students', NULL, 'students_parent', NULL, 'api', 'POST'),
('Get student detail', '/api/v1/students/:id', NULL, 'students_parent', NULL, 'api', 'GET'),
('Handle student status', '/api/v1/students/:id/status', NULL, 'students_parent', NULL, 'api', 'POST'),
('Update student detail', '/api/v1/students/:id', NULL, 'students_parent', NULL, 'api', 'PUT'),
('Delete student', '/api/v1/students/:id', NULL, 'students_parent', NULL, 'api', 'DELETE'),
-- end student

-- start communication
('Communication', 'communication_parent', 'communication.svg', NULL, 5, 'menu-screen', NULL),
('Notice Board', 'notices', NULL, 'communication_parent', 1, 'menu-screen', NULL),
('Add Notice', 'notices/add', NULL, 'communication_parent', 2, 'menu-screen', NULL),
('Manage Notices', 'notices/manage', NULL, 'communication_parent', 3, 'menu-screen', NULL),
('Notice Recipients', 'notices/recipients', NULL, 'communication_parent', 4, 'menu-screen', NULL),
('View Notice', 'notices/:id', NULL, 'communication_parent', NULL, 'screen', NULL),
('Edit Notice', 'notices/edit/:id', NULL, 'communication_parent', NULL, 'screen', NULL),
('Edit Recipient', 'notices/recipients/edit/:id', NULL, 'communication_parent', NULL, 'screen', NULL),
('Get notice recipient list', '/api/v1/notices/recipients/list', NULL, 'communication_parent', NULL, 'api', 'GET'),
('Get notice recipients', '/api/v1/notices/recipients', NULL, 'communication_parent', NULL, 'api', 'GET'),
('Get notice recipient detail', '/api/v1/notices/recipients/:id', NULL, 'communication_parent', NULL, 'api', 'GET'),
('Add new notice recipient', '/api/v1/notices/recipients', NULL, 'communication_parent', NULL, 'api', 'POST'),
('Update notice recipient detail', '/api/v1/notices/recipients/:id', NULL, 'communication_parent', NULL, 'api', 'PUT'),
('Delete notice recipient detail', '/api/v1/notices/recipients/:id', NULL, 'communication_parent', NULL, 'api', 'DELETE'),
('Handle notice status', '/api/v1/notices/:id/status', NULL, 'communication_parent', NULL, 'api', 'POST'),
('Get notice detail', '/api/v1/notices/:id', NULL, 'communication_parent', NULL, 'api', 'GET'),
('Get all notices', '/api/v1/notices', NULL, 'communication_parent', NULL, 'api', 'GET'),
('Add new notice', '/api/v1/notices', NULL, 'communication_parent', NULL, 'api', 'POST'),
('Update notice detail', '/api/v1/notices/:id', NULL, 'communication_parent', NULL, 'api', 'PUT'),
-- end communication

-- start hr
('Human Resource', 'hr_parent', 'hr.svg', NULL, 6, 'menu-screen', NULL),
('Staff List', 'staffs', NULL, 'hr_parent', 1, 'menu-screen', NULL),
('Add Staff', 'staffs/add', NULL, 'hr_parent', 2, 'menu-screen', NULL),
('Departments', 'departments', NULL, 'hr_parent', 3, 'menu-screen', NULL),
('View Staffs', 'staffs/:id', NULL, 'hr_parent', NULL, 'screen', NULL),
('Edit Staff', 'staffs/edit/:id', NULL, 'hr_parent', NULL, 'screen', NULL),
('Get all staffs', '/api/v1/staffs', NULL, 'hr_parent', NULL, 'api', 'GET'),
('Add new staff', '/api/v1/staffs', NULL, 'hr_parent', NULL, 'api', 'POST'),
('Get staff detail', '/api/v1/staffs/:id', NULL, 'hr_parent', NULL, 'api', 'GET'),
('Update staff detail', '/api/v1/staffs/:id', NULL, 'hr_parent', NULL, 'api', 'PUT'),
('Handle staff status', '/api/v1/staffs/:id/status', NULL, 'hr_parent', NULL, 'api', 'POST'),
('Edit Department', 'departments/edit/:id', NULL, 'hr_parent', NULL, 'screen', NULL),
-- end hr

-- start access setting
('Access Setting', 'access_setting_parent', 'rolesAndPermissions.svg', NULL, 7, 'menu-screen', NULL),
('Roles & Permissions', 'roles-and-permissions', NULL, 'access_setting_parent', 1, 'menu-screen', NULL),
('Get all roles', '/api/v1/roles', NULL, 'access_setting_parent', NULL, 'api', 'GET'),
('Add new role', '/api/v1/roles', NULL, 'access_setting_parent', NULL, 'api', 'POST'),
('Switch user role', '/api/v1/roles/switch', NULL, 'access_setting_parent', NULL, 'api', 'POST'),
('Update role', '/api/v1/roles/:id', NULL, 'access_setting_parent', NULL, 'api', 'PUT'),
('Handle role status', '/api/v1/roles/:id/status', NULL, 'access_setting_parent', NULL, 'api', 'POST'),
('Get role detail', '/api/v1/roles/:id', NULL, 'access_setting_parent', NULL, 'api', 'GET'),
('Get role permissions', '/api/v1/roles/:id/permissions', NULL, 'access_setting_parent', NULL, 'api', 'GET'),
('Add role permissions', '/api/v1/roles/:id/permissions', NULL, 'access_setting_parent', NULL, 'api', 'POST'),
('Get role users', '/api/v1/roles/:id/users', NULL, 'access_setting_parent', NULL, 'api', 'GET')
-- end access setting
ON CONFLICT DO NOTHING;

INSERT INTO classes (name, sections) VALUES
('Grade 1', 'A,B,C'),
('Grade 2', 'A,B,C'),
('Grade 3', 'A,B,C'),
('Grade 4', 'A,B,C'),
('Grade 5', 'A,B,C'),
('Grade 6', 'A,B,C'),
('Grade 7', 'A,B,C'),
('Grade 8', 'A,B,C'),
('Grade 9', 'A,B,C'),
('Grade 10', 'A,B,C'),
('Grade 11', 'A,B,C'),
('Grade 12', 'A,B,C')
ON CONFLICT (name) DO NOTHING;

INSERT INTO sections (name) VALUES ('A'), ('B'), ('C')
ON CONFLICT (name) DO NOTHING;

INSERT INTO departments (name) VALUES
('Administration'), ('Academics'), ('Human Resources')
ON CONFLICT (name) DO NOTHING;

INSERT INTO leave_status (id, name) VALUES
(1, 'On Review'), (2, 'Approved'), (3, 'Cancelled')
ON CONFLICT DO NOTHING;

INSERT INTO roles (id, name, is_editable) VALUES
(1, 'Admin', false), (2, 'Teacher', false), (3, 'Student', false)
ON CONFLICT DO NOTHING;

INSERT INTO notice_status (id, name, alias) VALUES
(1, 'Draft', 'Draft'),
(2, 'Submit for Review', 'Approval Pending'),
(3, 'Submit for Deletion', 'Delete Pending'),
(4, 'Reject', 'Rejected'),
(5, 'Approve', 'Approved'),
(6, 'Delete', 'Deleted')
ON CONFLICT DO NOTHING;

-- Explicit reserved IDs must not collide with subsequent API-created records.
-- Never move a sequence backwards when this script is run again.
SELECT setval('roles_id_seq', GREATEST((SELECT last_value FROM roles_id_seq), (SELECT MAX(id) FROM roles)));
SELECT setval('leave_status_id_seq', GREATEST((SELECT last_value FROM leave_status_id_seq), (SELECT MAX(id) FROM leave_status)));
SELECT setval('notice_status_id_seq', GREATEST((SELECT last_value FROM notice_status_id_seq), (SELECT MAX(id) FROM notice_status)));

INSERT INTO users(name,email,role_id,created_dt,password, is_active, is_email_verified)
VALUES('John Doe','admin@school-admin.com',1, now(),'$argon2id$v=19$m=65536,t=3,p=4$21a+bDbESEI60WO1wRKnvQ$i6OrxqNiHvwtf1Xg3bfU5+AXZG14fegW3p+RSMvq1oU', true, true)
ON CONFLICT (email) DO NOTHING;

INSERT INTO user_profiles
(user_id, gender, marital_status, phone,dob,join_dt,qualification,experience,current_address,permanent_address,father_name,mother_name,emergency_phone)
VALUES
((SELECT id FROM users WHERE email = 'admin@school-admin.com'),'Male','Married','4759746607','2024-08-05',NULL,NULL,NULL,NULL,NULL,'stut','lancy','79374304')
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
