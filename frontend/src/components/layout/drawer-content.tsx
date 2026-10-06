import * as React from 'react';
import {
  AcUnitOutlined,
  ArrowDropDown,
  ArrowRight,
  WorkspacePremiumOutlined,
  VerifiedOutlined
} from '@mui/icons-material';
import {
  Box,
  Collapse,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography
} from '@mui/material';
import { blue } from '@mui/material/colors';
import { useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { getUserMenus, getUserRole } from '@/domains/auth/slice';

type DrawerContentProps = {
  handleNavigationClick: (name: string) => void;
  openNavMenu: string | null;
};

export const DrawerContent: React.FC<DrawerContentProps> = ({
  handleNavigationClick,
  openNavMenu
}) => {
  const menus = useSelector(getUserMenus);
  const role = useSelector(getUserRole);
  const API_URL = import.meta.env.VITE_API_URL;
  const iconBaseUrl = API_URL || '/backend-assets';

  const getIconUrl = (icon: React.ReactNode) =>
    typeof icon === 'string' && icon ? `${iconBaseUrl.replace(/\/$/, '')}/${icon}` : undefined;

  return (
    <div>
      <Toolbar sx={{ textDecoration: 'none' }} component={Link} to='/app'>
        <AcUnitOutlined color='primary' fontSize='large' />
        <Typography variant='h6' sx={{ ml: 2, color: blue[800] }}>
          School Admin
        </Typography>
      </Toolbar>
      <Divider />
      <List component='nav' sx={{ width: '100%' }}>
        {menus &&
          menus.map(({ name, path, subMenus, icon }) => {
            if (Array.isArray(subMenus) && subMenus.length > 0) {
              return (
                <Box key={name}>
                  <ListItemButton onClick={() => handleNavigationClick(name)}>
                    <ListItemIcon>
                      <img width='20px' height='20px' src={getIconUrl(icon)} alt='' />
                    </ListItemIcon>
                    <ListItemText primary={name} />
                    {openNavMenu === name ? <ArrowDropDown /> : <ArrowRight />}
                  </ListItemButton>
                  <Collapse in={openNavMenu === name} timeout='auto' unmountOnExit>
                    <List component='div'>
                      {subMenus.map(({ name, path }) => (
                        <ListItemButton
                          key={name}
                          component={Link}
                          to={`/app/${path}`}
                          sx={{ paddingLeft: '75px' }}
                        >
                          <ListItemText primary={name} />
                        </ListItemButton>
                      ))}
                    </List>
                  </Collapse>
                </Box>
              );
            } else {
              return (
                <ListItemButton key={name} component={Link} to={`/app/${path}`}>
                  <ListItemIcon>
                    <img width='20px' height='20px' src={getIconUrl(icon)} alt='' />
                  </ListItemIcon>
                  <ListItemText primary={name} />
                </ListItemButton>
              );
            }
          })}
        {(role === 'admin' || role === 'student') &&
          !menus?.some((menu) => menu.path === 'certificates') && (
            <ListItemButton component={Link} to='/app/certificates'>
              <ListItemIcon>
                <WorkspacePremiumOutlined />
              </ListItemIcon>
              <ListItemText primary='Certificates' />
            </ListItemButton>
          )}
        <ListItemButton component={Link} to='/verify'>
          <ListItemIcon>
            <VerifiedOutlined />
          </ListItemIcon>
          <ListItemText primary='Verify a certificate' />
        </ListItemButton>
      </List>
    </div>
  );
};
