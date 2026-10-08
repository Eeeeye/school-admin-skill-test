import { api, Tag } from '@/api';
import {
  LeavePolicyData,
  LeaveRequestApi,
  PolicyDetail,
  PolicyUserData,
  AddUserToPolicy,
  RemoveUserFromPolicy,
  EligiblePolicyUsers,
  PolicyStatus,
  LeaveRequestHistory,
  LeaveRequestApiWithId,
  MyLeavePolicyData,
  PendingLeaveRequestHistory,
  LeaveStatus
} from '../types';

export const leaveApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getMyLeaveHistory: builder.query<LeaveRequestHistory, void>({
      query: () => `/leave/request`,
      providesTags: (result) => [
        { type: Tag.LEAVE_HISTORY },
        ...(result?.leaveHistory?.map(({ id }) => ({ type: Tag.LEAVE_HISTORY, id })) ?? [])
      ]
    }),
    applyLeaveRequest: builder.mutation<{ message: string }, LeaveRequestApi>({
      query: (payload) => ({
        url: `/leave/request`,
        method: 'POST',
        body: payload
      }),
      invalidatesTags: (result) => (result ? [Tag.LEAVE_HISTORY, Tag.PENDING_LEAVES] : [])
    }),
    updateLeaveRequest: builder.mutation<{ message: string }, LeaveRequestApiWithId>({
      query: ({ id, ...restPayload }) => ({
        url: `/leave/request/${id}`,
        method: 'PUT',
        body: { ...restPayload }
      }),
      invalidatesTags: (result, _error, { id }) =>
        result
          ? [
              { type: Tag.LEAVE_HISTORY, id },
              { type: Tag.PENDING_LEAVES, id },
              Tag.MY_LEAVE_POLICIES,
              Tag.LEAVE_POLICY_USERS,
              Tag.DASHBOARD
            ]
          : []
    }),
    deleteLeaveRequest: builder.mutation<{ message: string }, number | undefined>({
      query: (id) => ({
        url: `/leave/request/${id}`,
        method: 'DELETE'
      }),
      invalidatesTags: (result, _error, id) =>
        result
          ? [
              { type: Tag.LEAVE_HISTORY, id },
              { type: Tag.PENDING_LEAVES, id },
              Tag.MY_LEAVE_POLICIES,
              Tag.LEAVE_POLICY_USERS,
              Tag.DASHBOARD
            ]
          : []
    }),

    getLeavePending: builder.query<PendingLeaveRequestHistory, void>({
      query: () => `/leave/pending`,
      providesTags: (result) => [
        { type: Tag.PENDING_LEAVES },
        ...(result?.pendingLeaves?.map(({ id }) => ({ type: Tag.PENDING_LEAVES, id })) ?? [])
      ]
    }),
    handlePendingLeaveStatus: builder.mutation<{ message: string }, LeaveStatus>({
      query: ({ id, status }) => ({
        url: `/leave/pending/${id}/status`,
        method: 'POST',
        body: { status }
      }),
      invalidatesTags: (result, _error, { id }) =>
        result
          ? [
              { type: Tag.LEAVE_HISTORY, id },
              { type: Tag.PENDING_LEAVES, id },
              Tag.MY_LEAVE_POLICIES,
              Tag.LEAVE_POLICY_USERS,
              Tag.DASHBOARD
            ]
          : []
    }),
    getLeavePolicies: builder.query<LeavePolicyData, void>({
      query: () => '/leave/policies',
      providesTags: (result) => [
        { type: Tag.LEAVE_POLICIES },
        ...(result?.leavePolicies?.map(({ id }) => ({ type: Tag.LEAVE_POLICIES, id })) ?? [])
      ]
    }),
    getEligibleLeavePolicyUsers: builder.query<EligiblePolicyUsers, void>({
      query: () => `leave/policies/eligible-users`,
      providesTags: (result) => [
        { type: Tag.LEAVE_ELIGIBLE_USERS },
        ...(result?.users?.map(({ id }) => ({ type: Tag.LEAVE_ELIGIBLE_USERS, id })) ?? [])
      ]
    }),
    getLeavePolicyUsers: builder.query<PolicyUserData, number>({
      query: (id) => `/leave/policies/${id}/users`,
      providesTags: (result) => [
        { type: Tag.LEAVE_POLICY_USERS },
        ...(result?.users?.map(({ id }) => ({ type: Tag.LEAVE_POLICY_USERS, id })) ?? [])
      ]
    }),
    addLeavePolicy: builder.mutation<{ message: string }, Pick<PolicyDetail, 'name'>>({
      query: ({ name }) => ({
        url: `/leave/policies`,
        method: 'POST',
        body: { name }
      }),
      invalidatesTags: (result) => (result ? [Tag.LEAVE_POLICIES] : [])
    }),
    updateLeavePolicy: builder.mutation<{ message: string }, Pick<PolicyDetail, 'name' | 'id'>>({
      query: ({ id, name }) => ({
        url: `/leave/policies/${id}`,
        method: 'PUT',
        body: { name }
      }),
      invalidatesTags: (result, _error, { id }) =>
        result
          ? [
              { type: Tag.LEAVE_POLICIES, id },
              Tag.MY_LEAVE_POLICIES,
              Tag.LEAVE_HISTORY,
              Tag.PENDING_LEAVES,
              Tag.DASHBOARD
            ]
          : []
    }),
    handleLeavePolicy: builder.mutation<{ message: string }, PolicyStatus>({
      query: ({ id, status }) => ({
        url: `/leave/policies/${id}/status`,
        method: 'POST',
        body: { status }
      }),
      invalidatesTags: (result, _error, { id }) =>
        result ? [{ type: Tag.LEAVE_POLICIES, id }, Tag.MY_LEAVE_POLICIES, Tag.DASHBOARD] : []
    }),
    addUserToPolicy: builder.mutation<{ message: string }, AddUserToPolicy>({
      query: ({ userList, id }) => ({
        url: `/leave/policies/${id}/users`,
        method: 'POST',
        body: { users: userList }
      }),
      invalidatesTags: (result) =>
        result
          ? [
              Tag.LEAVE_POLICY_USERS,
              Tag.LEAVE_ELIGIBLE_USERS,
              Tag.LEAVE_POLICIES,
              Tag.MY_LEAVE_POLICIES,
              Tag.DASHBOARD
            ]
          : []
    }),
    removeUserFromPolicy: builder.mutation<{ message: string }, RemoveUserFromPolicy>({
      query: ({ userId, policyId }) => ({
        url: `/leave/policies/${policyId}/users`,
        method: 'DELETE',
        body: { user: userId }
      }),
      invalidatesTags: (result, _error, { policyId }) => {
        return result
          ? [
              { type: Tag.LEAVE_POLICIES, id: policyId },
              Tag.MY_LEAVE_POLICIES,
              Tag.LEAVE_POLICY_USERS,
              Tag.DASHBOARD
            ]
          : [];
      }
    }),
    getMyLeavePolicies: builder.query<MyLeavePolicyData, void>({
      query: () => `/leave/policies/me`,
      providesTags: (result) => [
        { type: Tag.MY_LEAVE_POLICIES },
        ...(result?.leavePolicies?.map(({ id }) => ({ type: Tag.MY_LEAVE_POLICIES, id })) ?? [])
      ]
    })
  })
});

export const {
  useGetMyLeaveHistoryQuery,
  useGetLeavePendingQuery,
  useGetLeavePoliciesQuery,
  useGetEligibleLeavePolicyUsersQuery,
  useGetLeavePolicyUsersQuery,
  useAddLeavePolicyMutation,
  useUpdateLeavePolicyMutation,
  useHandleLeavePolicyMutation,
  useAddUserToPolicyMutation,
  useRemoveUserFromPolicyMutation,
  useApplyLeaveRequestMutation,
  useUpdateLeaveRequestMutation,
  useDeleteLeaveRequestMutation,
  useGetMyLeavePoliciesQuery,
  useHandlePendingLeaveStatusMutation
} = leaveApi;
