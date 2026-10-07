import { api, Tag } from '@/api';
import { ClassData, ClassDataProps, ClassDataPropsWithId } from '../types';

export const classApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getClasses: builder.query<ClassData, void>({
      query: () => `/classes`,
      providesTags: (result) => [
        { type: Tag.CLASSES },
        ...(result?.classes?.map(({ id }) => ({ type: Tag.CLASSES, id })) ?? [])
      ]
    }),
    getClassDetail: builder.query<ClassDataPropsWithId, string | undefined>({
      query: (id) => `/classes/${id}`,
      providesTags: (result) => (result ? [{ type: Tag.CLASSES, id: result.id }] : [])
    }),
    addClass: builder.mutation<{ message: string }, ClassDataProps>({
      query: (payload) => ({
        url: `/classes`,
        method: 'POST',
        body: payload
      }),
      invalidatesTags: [Tag.CLASSES, Tag.NOTICE_RECIPIENT_LIST]
    }),
    updateClass: builder.mutation<{ message: string }, ClassDataPropsWithId>({
      query: ({ id, ...payload }) => ({
        url: `/classes/${id}`,
        method: 'PUT',
        body: payload
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: Tag.CLASSES, id },
        Tag.NOTICE_RECIPIENT_LIST,
        Tag.STUDENTS,
        Tag.CLASS_TEACHERS
      ]
    }),
    deleteClass: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/classes/${id}`,
        method: 'DELETE'
      }),
      invalidatesTags: [Tag.CLASSES, Tag.NOTICE_RECIPIENT_LIST, Tag.STUDENTS, Tag.CLASS_TEACHERS]
    })
  })
});

export const {
  useGetClassesQuery,
  useLazyGetClassesQuery,
  useGetClassDetailQuery,
  useAddClassMutation,
  useUpdateClassMutation,
  useDeleteClassMutation
} = classApi;
