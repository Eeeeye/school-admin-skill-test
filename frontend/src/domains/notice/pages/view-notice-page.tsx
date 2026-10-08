import * as React from 'react';
import { Delete, Edit } from '@mui/icons-material';
import { Box, Divider, IconButton, Paper, Stack, Typography } from '@mui/material';
import { toast } from 'react-toastify';
import { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { SerializedError } from '@reduxjs/toolkit';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { getUserId, getUserRole } from '@/domains/auth/slice';
import { canEditNotice, canDeleteNotice } from '@/utils/helpers/get-notice-permission';

import { DATE_FORMAT, getFormattedDate } from '@/utils/helpers/date';
import { DialogModal } from '@/components/dialog-modal';
import { getErrorMsg } from '@/utils/helpers/get-error-message';
import { useGetNoticeDetailQuery, useHandleNoticeStatusMutation } from '../api/notice-api';
import { ViewNoticeSkeleton } from '../components';

export const ViewNotice = () => {
  const { id } = useParams();
  const currentUserId = useSelector(getUserId);
  const role = useSelector(getUserRole);
  const [modalOpen, setModalOpen] = React.useState(false);

  const navigate = useNavigate();
  const [deleteNotice, { isLoading: isDeletingNotice }] = useHandleNoticeStatusMutation();
  const { currentData: noticeDetail, isFetching, isError, error } = useGetNoticeDetailQuery(id);

  const toggleDeleteConfirmationModal = () => {
    setModalOpen(!modalOpen);
  };
  const onSave = async () => {
    try {
      const result = await deleteNotice({
        id: Number(id),
        status: role === 'admin' ? 6 : 3
      }).unwrap();
      toast.info(result.message);
      toggleDeleteConfirmationModal();
      navigate('/app/notices');
      closeModal();
    } catch (error) {
      toast.error(getErrorMsg(error as FetchBaseQueryError | SerializedError).message);
    }
  };
  const closeModal = () => {
    setModalOpen(false);
  };

  let content: null | React.ReactElement = null;
  if (isFetching && !noticeDetail) {
    content = <ViewNoticeSkeleton />;
  } else if (isError) {
    content = <>{getErrorMsg(error).message}</>;
  } else if (!noticeDetail) {
    content = <>Record not found</>;
  } else {
    const { id, title, description, author, authorId, createdDate, status } = noticeDetail;

    content = (
      <>
        <Box component='div' display='flex' justifyContent='space-between' alignItems='center'>
          <Box component='div' sx={{ mb: 2, minWidth: 0, overflowWrap: 'anywhere' }}>
            <Typography component='div' variant='h5'>
              {title}
            </Typography>
            <Typography component='div' variant='subtitle2' display='inline' color='text.primary'>
              {author}
            </Typography>
            <Typography component='div' variant='subtitle2' display='inline' color='text.secondary'>
              {` - ${getFormattedDate(createdDate, DATE_FORMAT)}`}
            </Typography>
          </Box>
          <Box component='div' sx={{ flexShrink: 0 }}>
            <Stack direction='row' spacing={1}>
              {canEditNotice(authorId, status, currentUserId, role) && (
                <IconButton
                  aria-label='Edit notice'
                  color='primary'
                  component={Link}
                  to={`/app/notices/edit/${id}`}
                >
                  <Edit />
                </IconButton>
              )}
              {canDeleteNotice(authorId, status, currentUserId, role) && (
                <IconButton
                  aria-label={role === 'admin' ? 'Delete notice' : 'Request notice deletion'}
                  color='primary'
                  onClick={toggleDeleteConfirmationModal}
                >
                  <Delete />
                </IconButton>
              )}
            </Stack>
          </Box>
        </Box>
        <Divider />
        <Typography component='p' sx={{ py: 3, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {description}
        </Typography>
      </>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      {content}
      <DialogModal
        isSaving={isDeletingNotice}
        actionFooterCancelText='No'
        actionFooterSaveText='Yes'
        isOpen={modalOpen}
        titleText={role === 'admin' ? 'Delete Notice' : 'Request Notice Deletion'}
        handleSave={onSave}
        closeModal={closeModal}
      >
        <Typography variant='body1'>
          {role === 'admin'
            ? 'Are you sure you want to delete this notice?'
            : 'Request administrator approval to delete this notice?'}
        </Typography>
      </DialogModal>
    </Paper>
  );
};
