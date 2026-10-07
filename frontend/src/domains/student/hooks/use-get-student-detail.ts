import { useGetStudentDetailQuery } from '../api/student-api';

export const useGetStudentDetail = (id: string | undefined) => useGetStudentDetailQuery(id);
