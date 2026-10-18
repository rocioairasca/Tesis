import React, { useEffect, useState } from 'react';
import { Layout, Avatar, Button, Dropdown, Modal, message } from 'antd';
import { AppIcons } from '../components/AppIcons';
const LogoutOutlined = AppIcons.logout;
import { useNavigate } from 'react-router-dom';
import useIsMobile from '../hooks/useIsMobile';
import UserProfileModal from '../features/profile/UserProfileModal';
import {userDisplayName,userInitials} from '../utils/userDisplay.mjs';
import NotificationBell from '../components/NotificationBell';
import NotificationsDrawer from '../components/NotificationsDrawer';

const { Header } = Layout;

const AppHeader = ({ companyName }) => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [user, setUser] = useState(null);
  const [profileOpen,setProfileOpen] = useState(false);
  const [feedback,feedbackHolder] = message.useMessage();
  const [notificationsDrawerOpen, setNotificationsDrawerOpen] = useState(false);
  const [modal, contextHolder] = Modal.useModal();

  useEffect(() => {
    try {
      const u = localStorage.getItem('user');
      setUser(u ? JSON.parse(u) : null);
    } catch { setUser(null); }
  }, []);

  const handleLogout = () => {
    try {
      localStorage.removeItem('access_token');
      localStorage.removeItem('id_token');
      localStorage.removeItem('auth_email');
      localStorage.removeItem('user');
    } catch { }
    navigate('/login', { replace: true });
  };
  const displayName = userDisplayName(user), initials = userInitials(user);
  const savedProfile = profile => {
    // Keep the existing session/permission representation; this endpoint edits only the name.
    let current=user;
    try { current=JSON.parse(localStorage.getItem('user')||'null'); } catch { }
    if(current?.id===profile.id){
      const updated={...current,full_name:profile.full_name};
      try { localStorage.setItem('user',JSON.stringify(updated)); } catch { }
      setUser(updated);
    }
    setProfileOpen(false);feedback.success('Tu nombre se actualizó.');
  };
  const menu = { items: [
    { key: 'identity', disabled: true, label: <div className="gs-user-menu-identity"><strong>{displayName}</strong>{user?.email && user.email !== displayName && <span>{user.email}</span>}{!user?.full_name?.trim() && <span>Completá tu perfil para que otros usuarios puedan identificarte en tareas y planificaciones.</span>}</div> },
    { key: 'profile', label: 'Editar perfil', onClick: () => setProfileOpen(true) },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Cerrar sesión', onClick: () => modal.confirm({ title: 'Cerrar sesión', content: '¿Estás seguro de que quieres cerrar sesión?', okText: 'Sí', cancelText: 'Cancelar', onOk: handleLogout }) },
  ] };

  return <Header className="gs-header">
    <div className="gs-company-context">
      {isMobile && <img src="/LogoGrande.png" alt="GrowSync" />}
      <div><span className="gs-company-caption">Empresa</span><strong title={companyName}>{companyName}</strong></div>
    </div>
    <div className="gs-header-actions">
      <NotificationBell onOpenDrawer={() => setNotificationsDrawerOpen(true)} />
      <Dropdown menu={menu} trigger={['click']} placement="bottomRight">
        <Button type="text" className="gs-user-menu-trigger" aria-label="Abrir menú de usuario" aria-haspopup="menu"><Avatar size={32}>{initials || 'U'}</Avatar></Button>
      </Dropdown>
    </div>
    <NotificationsDrawer open={notificationsDrawerOpen} onClose={() => setNotificationsDrawerOpen(false)} />
    {profileOpen && <UserProfileModal onClose={()=>setProfileOpen(false)} onSaved={savedProfile}/> }
    {feedbackHolder}
    {contextHolder}
  </Header>;
};
export default AppHeader;
