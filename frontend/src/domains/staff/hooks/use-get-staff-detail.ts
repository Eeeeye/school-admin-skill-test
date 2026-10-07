import { useGetStaffDetailQuery } from '../api/staff-api';

export const useGetStaffDetail = (id: string | undefined) => useGetStaffDetailQuery(id);
