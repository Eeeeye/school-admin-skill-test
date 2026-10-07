import { api, Tag } from '@/api';
import {
  NoticeData,
  NoticeDetailProps,
  NoticeFormProps,
  NoticeFormPropsWithId,
  NoticeRecipient,
  NoticeRecipientWithId,
  RecipientData,
  RecipientResponse,
  ReviewNotice
} from '../types';

export const noticeApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getNotices: builder.query<NoticeData, void>({
      query: () => `/notices`,
      providesTags: (result) => [
        { type: Tag.NOTICES },
        ...(result?.notices?.map(({ id }) => ({ type: Tag.NOTICES, id })) ?? [])
      ]
    }),
    getAllPendingNotices: builder.query<NoticeData, void>({
      query: () => `/notices/pending`,
      providesTags: (result) => [
        { type: Tag.PENDING_NOTICES },
        ...(result?.notices?.map(({ id }) => ({ type: Tag.PENDING_NOTICES, id })) ?? [])
      ]
    }),
    getNoticeDetail: builder.query<NoticeDetailProps, string | undefined>({
      query: (id) => `/notices/${id}`,
      providesTags: (result) => (result ? [{ type: Tag.NOTICES, id: result.id }] : [])
    }),
    getMyNotices: builder.query<NoticeData, void>({
      query: () => `/notices/me`,
      providesTags: (result) => [
        { type: Tag.NOTICES },
        ...(result?.notices?.map(({ id }) => ({ type: Tag.NOTICES, id })) ?? [])
      ]
    }),
    addNotice: builder.mutation<{ message: string }, NoticeFormProps>({
      query: (payload) => ({
        url: `/notices`,
        method: 'POST',
        body: payload
      }),
      invalidatesTags: [Tag.NOTICES, Tag.PENDING_NOTICES, Tag.DASHBOARD]
    }),
    updateNotice: builder.mutation<{ message: string }, NoticeFormPropsWithId>({
      query: ({ id, ...payload }) => ({
        url: `/notices/${id}`,
        method: 'PUT',
        body: payload
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: Tag.NOTICES, id: Number(id) },
        Tag.PENDING_NOTICES,
        Tag.DASHBOARD
      ]
    }),
    handleNoticeStatus: builder.mutation<{ message: string }, ReviewNotice>({
      query: ({ id, status }) => ({
        url: `/notices/${id}/status`,
        method: 'POST',
        body: { status }
      }),
      invalidatesTags: [Tag.NOTICES, Tag.PENDING_NOTICES, Tag.DASHBOARD]
    }),
    getNoticeRecipientList: builder.query<RecipientResponse, void>({
      query: () => `/notices/recipients/list`,
      providesTags: (result) => [
        { type: Tag.NOTICE_RECIPIENT_LIST },
        ...(result?.noticeRecipients?.map(({ id }) => ({ type: Tag.NOTICE_RECIPIENT_LIST, id })) ??
          [])
      ]
    }),
    getNoticeRecipients: builder.query<RecipientData, void>({
      query: () => `/notices/recipients`,
      providesTags: (result) => [
        { type: Tag.NOTICE_RECIPIENTS },
        ...(result?.noticeRecipients?.map(({ id }) => ({ type: Tag.NOTICE_RECIPIENTS, id })) ?? [])
      ]
    }),
    getNoticeRecipient: builder.query<NoticeRecipientWithId, number>({
      query: (id) => `/notices/recipients/${id}`,
      providesTags: (result) => (result ? [{ type: Tag.NOTICE_RECIPIENTS, id: result.id }] : [])
    }),
    addNoticeRecipient: builder.mutation<{ message: string }, NoticeRecipient>({
      query: (payload) => ({
        url: `/notices/recipients`,
        method: 'POST',
        body: { ...payload }
      }),
      invalidatesTags: [Tag.NOTICE_RECIPIENTS, Tag.NOTICE_RECIPIENT_LIST]
    }),
    updateNoticeRecipient: builder.mutation<{ message: string }, NoticeRecipientWithId>({
      query: ({ id, ...rest }) => ({
        url: `/notices/recipients/${id}`,
        method: 'PUT',
        body: { ...rest }
      }),
      invalidatesTags: (result, _error, { id }) =>
        result ? [{ type: Tag.NOTICE_RECIPIENTS, id }, Tag.NOTICE_RECIPIENT_LIST] : []
    }),
    deleteNoticeRecipient: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/notices/recipients/${id}`,
        method: 'DELETE'
      }),
      invalidatesTags: (result, _error, id) =>
        result ? [{ type: Tag.NOTICE_RECIPIENTS, id }, Tag.NOTICE_RECIPIENT_LIST] : []
    })
  })
});

export const {
  useGetNoticesQuery,
  useGetNoticeDetailQuery,
  useGetMyNoticesQuery,
  useLazyGetNoticeRecipientListQuery,
  useGetNoticeRecipientListQuery,
  useAddNoticeMutation,
  useUpdateNoticeMutation,
  useHandleNoticeStatusMutation,
  useGetNoticeRecipientsQuery,
  useGetNoticeRecipientQuery,
  useAddNoticeRecipientMutation,
  useUpdateNoticeRecipientMutation,
  useDeleteNoticeRecipientMutation,
  useGetAllPendingNoticesQuery
} = noticeApi;
