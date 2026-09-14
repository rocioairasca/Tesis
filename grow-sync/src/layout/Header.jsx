import React, { useEffect, useState } from 'react';
import { Layout, Avatar, Button, Dropdown, Modal } from 'antd';
import { AppIcons } from '../components/AppIcons';
const LogoutOutlined = AppIcons.logout;
import { useNavigate } from 'react-router-dom';
import useIsMobile from '../hooks/useIsMobile';
import NotificationBell from '../components/NotificationBell';
import NotificationsDrawer from '../components/NotificationsDrawer';

const { Header } = Layout;

const AppHeader = ({ companyName }) => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [user, setUser] = useState(null);
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
  const displayName = user?.nickname || user?.username || user?.email || 'Usuario';
  const initials = displayName.split('@')[0].split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  const menu = { items: [
    { key: 'identity', disabled: true, label: <div className="gs-user-menu-identity"><strong>{displayName}</strong>{user?.email && user.email !== displayName && <span>{user.email}</span>}</div> },
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
    {contextHolder}
  </Header>;
};
export default AppHeader;
