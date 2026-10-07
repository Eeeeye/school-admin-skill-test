import * as React from 'react';
import { Campaign, Person } from '@mui/icons-material';
import {
  Avatar,
  Card,
  CardContent,
  Divider,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Typography
} from '@mui/material';
import { Link } from 'react-router-dom';

import { DATE_FORMAT, getFormattedDate } from '@/utils/helpers/date';
import { Notice } from '@/domains/notice/types';
const NO_RECORD = 'Record not found';

export const Notices = ({ notices }: { notices: Notice[] }) => {
  const visibleNotices = Array.isArray(notices)
    ? notices.filter(({ statusId }) => statusId !== 6)
    : [];
  let content: React.ReactNode | null = null;
  if (visibleNotices.length === 0) {
    content = <>{NO_RECORD}</>;
  } else {
    content = visibleNotices.map(({ id, title, author, createdDate }, index) => (
      <List key={id}>
        <ListItem alignItems='flex-start'>
          <ListItemAvatar title={author}>
            <Avatar>
              <Person />
            </Avatar>
          </ListItemAvatar>
          <ListItemText
            sx={{ minWidth: 0, overflowWrap: 'anywhere' }}
            primary={
              <Link to={`/app/notices/${id}`} className='notice-title'>
                {title}
              </Link>
            }
            secondary={getFormattedDate(createdDate, DATE_FORMAT)}
          />
        </ListItem>
        {index !== visibleNotices.length - 1 && <Divider variant='inset' component='li' />}
      </List>
    ));
  }

  return (
    <>
      <Stack direction='row' spacing={1} marginBottom={1}>
        <Campaign className='section-title' sx={{ paddingTop: '2px' }} />
        <Typography variant='h6' className='section-title'>
          Notices
        </Typography>
      </Stack>
      <Card>
        <CardContent>{content}</CardContent>
      </Card>
    </>
  );
};
