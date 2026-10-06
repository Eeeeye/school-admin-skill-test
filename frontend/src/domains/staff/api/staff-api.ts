import { api, Tag } from '@/api';
import { API_DATE_FORMAT, getFormattedDate } from '@/utils/helpers/date';
import { getQueryString } from '@/utils/helpers/get-query-string';
import {
  StaffData,
  StaffFilter,
  StaffFormProps,
  StaffFormPropsWithId,
  StaffStatusRequest
} from '../types';

export const staffApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getStaffs: builder.query<StaffData, StaffFilter>({
      query: (payload) => {
        const queryString = getQueryString(payload);
        return `/staffs${queryString}`;
      },
      providesTags: (result) =>
        result?.staffs?.map(({ id }) => {
          return { type: Tag.STAFFS, id };
        }) || [{ type: Tag.STAFFS }]
    }),
    getStaffDetail: builder.query<StaffFormPropsWithId, string | undefined>({
      query: (id) => (id ? `/staffs/${id}` : `/account/me`),
      transformResponse: (response: StaffFormPropsWithId) => {
        const normalized = { ...response };
        const textFields = [
          'name',
          'gender',
          'maritalStatus',
          'phone',
          'email',
          'qualification',
          'experience',
          'currentAddress',
          'permanentAddress',
          'fatherName',
          'motherName',
          'emergencyPhone'
        ] as const;
        for (const field of textFields)
          normalized[field] = response[field] == null ? '' : String(response[field]);
        return normalized;
      },
      providesTags: (result) => (result ? [{ type: Tag.STAFFS, id: result.id }] : [])
    }),
    handleStaffStatus: builder.mutation<{ message: string }, StaffStatusRequest>({
      query: ({ id, status }) => ({
        url: `/staffs/${id}/status`,
        method: 'POST',
        body: { status }
      }),
      invalidatesTags: (_result, _error, { id }) => [{ type: Tag.STAFFS, id }, Tag.STAFFS]
    }),
    addStaff: builder.mutation<{ message: string }, StaffFormProps>({
      query: (payload) => ({
        url: `/staffs`,
        method: 'POST',
        body: {
          ...payload,
          dob: getFormattedDate(payload.dob, API_DATE_FORMAT),
          joinDate: getFormattedDate(payload.joinDate, API_DATE_FORMAT)
        }
      }),
      invalidatesTags: [Tag.STAFFS]
    }),
    updateStaff: builder.mutation<{ message: string }, StaffFormPropsWithId>({
      query: ({ id, ...payload }) => ({
        url: `/staffs/${id}`,
        method: 'PUT',
        body: {
          ...payload,
          dob: getFormattedDate(payload.dob, API_DATE_FORMAT),
          joinDate: getFormattedDate(payload.joinDate, API_DATE_FORMAT)
        }
      }),
      invalidatesTags: (_result, _error, { id }) => [{ type: Tag.STAFFS, id }]
    })
  })
});

export const {
  useGetStaffsQuery,
  useLazyGetStaffsQuery,
  useLazyGetStaffDetailQuery,
  useGetStaffDetailQuery,
  useHandleStaffStatusMutation,
  useAddStaffMutation,
  useUpdateStaffMutation
} = staffApi;
