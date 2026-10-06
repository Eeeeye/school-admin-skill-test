import { api, Tag } from '@/api';

export type CertificateStatus = 'pending' | 'issued' | 'revoked' | 'failed';
export type Certificate = {
  id: string;
  studentId: number | null;
  studentName: string;
  title: string;
  description: string;
  recipientAddress: string;
  metadataCid: string | null;
  transactionHash: string | null;
  revocationTransactionHash?: string | null;
  status: CertificateStatus;
  createdAt: string;
  issuedAt?: string;
  revokedAt?: string;
  verificationUrl?: string;
  error?: string;
};
export type CertificateConfig = {
  available: boolean;
  chainId: number;
  contractAddress: string;
  issuerAddress: string;
  chainName: string;
  rpcUrl: string | null;
  demoMode: boolean;
  error?: string;
};
export type CertificateVerification = {
  id: string;
  exists: boolean;
  valid: boolean;
  status: CertificateStatus | 'not_found' | 'invalid';
  chainId: number;
  contractAddress: string;
  issuerAddress: string;
  recipientAddress: string;
  metadataCid: string;
  title: string;
  description: string;
  issuedAt?: string;
  revokedAt?: string;
  transactionHash: string;
  verificationUrl: string;
  metadataUrl: string;
};
export type IssueCertificate = {
  studentId: number;
  idempotencyKey: string;
  title: string;
  description?: string;
  recipientAddress: string;
};
export const certificateApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getCertificateConfig: builder.query<CertificateConfig, void>({
      query: () => '/certificates/config'
    }),
    getCertificates: builder.query<{ certificates: Certificate[] }, number | undefined>({
      query: (studentId) => `/certificates${studentId ? `?studentId=${studentId}` : ''}`,
      providesTags: [Tag.CERTIFICATES]
    }),
    issueCertificate: builder.mutation<{ certificate: Certificate }, IssueCertificate>({
      query: ({ idempotencyKey, ...body }) => ({
        url: '/certificates',
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey }
      }),
      invalidatesTags: [Tag.CERTIFICATES]
    }),
    retryCertificate: builder.mutation<{ certificate: Certificate }, string>({
      query: (id) => ({ url: `/certificates/${id}/retry`, method: 'POST' }),
      invalidatesTags: [Tag.CERTIFICATES]
    }),
    revokeCertificate: builder.mutation<{ certificate: Certificate }, string>({
      query: (id) => ({ url: `/certificates/${id}/revoke`, method: 'POST' }),
      invalidatesTags: [Tag.CERTIFICATES]
    }),
    verifyCertificate: builder.query<CertificateVerification, string>({
      query: (id) => `/certificates/verify/${encodeURIComponent(id)}`,
      providesTags: [Tag.CERTIFICATES]
    })
  })
});
export const {
  useGetCertificateConfigQuery,
  useGetCertificatesQuery,
  useIssueCertificateMutation,
  useRevokeCertificateMutation,
  useRetryCertificateMutation,
  useVerifyCertificateQuery
} = certificateApi;
