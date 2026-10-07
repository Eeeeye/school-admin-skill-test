import { lazy } from 'react';
import 'react-toastify/dist/ReactToastify.css';
import { createBrowserRouter, Navigate } from 'react-router-dom';

import { ProtectedRoute } from './protected-route';
const AppRoot = lazy(() => import('./app-root').then((module) => ({ default: module.AppRoot })));
const LoginPage = lazy(() =>
  import('@/domains/auth/pages').then((module) => ({ default: module.LoginPage }))
);
const SetupPasswordPage = lazy(() =>
  import('@/domains/auth/pages').then((module) => ({ default: module.SetupPasswordPage }))
);
const DashboardPage = lazy(() =>
  import('@/domains/dashboard/pages').then((module) => ({ default: module.DashboardPage }))
);
const LeaveDefine = lazy(() =>
  import('@/domains/leave/pages').then((module) => ({ default: module.LeaveDefine }))
);
const MyLeaveRequest = lazy(() =>
  import('@/domains/leave/pages').then((module) => ({ default: module.MyLeaveRequest }))
);
const PendingRequest = lazy(() =>
  import('@/domains/leave/pages').then((module) => ({ default: module.PendingRequest }))
);
const EditClass = lazy(() =>
  import('@/domains/class/pages').then((module) => ({ default: module.EditClass }))
);
const ListClasses = lazy(() =>
  import('@/domains/class/pages').then((module) => ({ default: module.ListClasses }))
);
const EditClassTeacher = lazy(() =>
  import('@/domains/class-teacher/pages').then((module) => ({ default: module.EditClassTeacher }))
);
const ListClassTeachers = lazy(() =>
  import('@/domains/class-teacher/pages').then((module) => ({ default: module.ListClassTeachers }))
);
const AddStudent = lazy(() =>
  import('@/domains/student/pages').then((module) => ({ default: module.AddStudent }))
);
const EditStudent = lazy(() =>
  import('@/domains/student/pages').then((module) => ({ default: module.EditStudent }))
);
const ListStudents = lazy(() =>
  import('@/domains/student/pages').then((module) => ({ default: module.ListStudents }))
);
const ViewStudent = lazy(() =>
  import('@/domains/student/pages').then((module) => ({ default: module.ViewStudent }))
);
const AddNotice = lazy(() =>
  import('@/domains/notice/pages').then((module) => ({ default: module.AddNotice }))
);
const EditNotice = lazy(() =>
  import('@/domains/notice/pages').then((module) => ({ default: module.EditNotice }))
);
const EditNoticeRecipientPage = lazy(() =>
  import('@/domains/notice/pages').then((module) => ({ default: module.EditNoticeRecipientPage }))
);
const ListNoticeRecipients = lazy(() =>
  import('@/domains/notice/pages').then((module) => ({ default: module.ListNoticeRecipients }))
);
const ListNotices = lazy(() =>
  import('@/domains/notice/pages').then((module) => ({ default: module.ListNotices }))
);
const ManageNotices = lazy(() =>
  import('@/domains/notice/pages').then((module) => ({ default: module.ManageNotices }))
);
const ViewNotice = lazy(() =>
  import('@/domains/notice/pages').then((module) => ({ default: module.ViewNotice }))
);
const AddStaff = lazy(() =>
  import('@/domains/staff/pages').then((module) => ({ default: module.AddStaff }))
);
const EditStaff = lazy(() =>
  import('@/domains/staff/pages').then((module) => ({ default: module.EditStaff }))
);
const ListStaffs = lazy(() =>
  import('@/domains/staff/pages').then((module) => ({ default: module.ListStaffs }))
);
const ViewStaff = lazy(() =>
  import('@/domains/staff/pages').then((module) => ({ default: module.ViewStaff }))
);
const AccountPage = lazy(() =>
  import('@/domains/account/pages').then((module) => ({ default: module.AccountPage }))
);
const EditSectionPage = lazy(() =>
  import('@/domains/section/pages').then((module) => ({ default: module.EditSectionPage }))
);
const ListSectionPage = lazy(() =>
  import('@/domains/section/pages').then((module) => ({ default: module.ListSectionPage }))
);
const EditDepartmentPage = lazy(() =>
  import('@/domains/department/pages').then((module) => ({ default: module.EditDepartmentPage }))
);
const ListDepartmentsPage = lazy(() =>
  import('@/domains/department/pages').then((module) => ({ default: module.ListDepartmentsPage }))
);
import { ErrorPage, NotFound } from '@/components/errors';
const MainLayout = lazy(() =>
  import('@/components/layout').then((module) => ({ default: module.MainLayout }))
);
const CertificatesPage = lazy(() =>
  import('@/domains/certificate/pages/certificates-page').then((module) => ({
    default: module.CertificatesPage
  }))
);
const VerifyCertificatePage = lazy(() =>
  import('@/domains/certificate/pages/verify-certificate-page').then((module) => ({
    default: module.VerifyCertificatePage
  }))
);
const RoleAndPermission = lazy(() =>
  import('@/domains/role-and-permission/pages').then((module) => ({
    default: module.RoleAndPermission
  }))
);

export const routes = [
  { path: '/verify', element: <VerifyCertificatePage />, errorElement: <ErrorPage /> },
  { path: '/verify/:id', element: <VerifyCertificatePage />, errorElement: <ErrorPage /> },
  {
    path: '/',
    element: <Navigate to='/app' replace />
  },
  {
    path: '/auth/login',
    element: <LoginPage />,
    errorElement: <ErrorPage message='Error loading login page' />
  },
  {
    path: '/auth/setup-password/:token',
    element: <SetupPasswordPage />,
    errorElement: <ErrorPage message='Error loading password setup page' />
  },
  {
    path: '/app',
    element: (
      <ProtectedRoute>
        <AppRoot />
      </ProtectedRoute>
    ),
    errorElement: (
      <MainLayout>
        <ErrorPage message='Error loading the app' />
      </MainLayout>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'certificates', element: <CertificatesPage /> },
      { path: 'leave/define', element: <LeaveDefine /> },
      { path: 'leave/request', element: <MyLeaveRequest /> },
      { path: 'leave/pending', element: <PendingRequest /> },
      { path: 'classes', element: <ListClasses /> },
      { path: 'classes/edit/:id', element: <EditClass /> },
      { path: 'class-teachers', element: <ListClassTeachers /> },
      { path: 'class-teachers/edit/:id', element: <EditClassTeacher /> },
      { path: 'sections', element: <ListSectionPage /> },
      { path: 'sections/edit/:id', element: <EditSectionPage /> },
      { path: 'students', element: <ListStudents /> },
      { path: 'students/add', element: <AddStudent /> },
      { path: 'students/:id', element: <ViewStudent /> },
      { path: 'students/edit/:id', element: <EditStudent /> },
      { path: 'notices', element: <ListNotices /> },
      { path: 'notices/add', element: <AddNotice /> },
      { path: 'notices/:id', element: <ViewNotice /> },
      { path: 'notices/edit/:id', element: <EditNotice /> },
      { path: 'notices/manage', element: <ManageNotices /> },
      { path: 'staffs', element: <ListStaffs /> },
      { path: 'staffs/add', element: <AddStaff /> },
      { path: 'staffs/:id', element: <ViewStaff /> },
      { path: 'staffs/edit/:id', element: <EditStaff /> },
      { path: 'roles-and-permissions', element: <RoleAndPermission /> },
      { path: 'departments', element: <ListDepartmentsPage /> },
      { path: 'departments/edit/:id', element: <EditDepartmentPage /> },
      { path: 'notices/recipients', element: <ListNoticeRecipients /> },
      { path: 'notices/recipients/edit/:id', element: <EditNoticeRecipientPage /> },
      { path: '*', element: <NotFound /> }
    ]
  },
  {
    path: '*',
    element: <NotFound />,
    errorElement: <ErrorPage />
  }
];

export const router = createBrowserRouter(routes);
