// src/components/MobileBottomNavigationWrapper.jsx
import React from 'react';
import { useLocation } from 'react-router-dom';
import useIsMobile from '../hooks/useIsMobile';
import BottomNavigation from './NavbarBottom';

const MobileBottomNavigationWrapper = () => {
  const location = useLocation();
  const isMobile = useIsMobile();

  const hiddenRoutes = ['/', '/login', '/register', '/register-company'];
  const shouldHide = hiddenRoutes.includes(location.pathname);

  if (!isMobile || shouldHide) return null;

  return <BottomNavigation />;
};

export default MobileBottomNavigationWrapper;
