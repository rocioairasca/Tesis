import React, { useEffect, useState } from 'react';
import { Drawer, List, Button, Segmented, Empty } from 'antd';
import {
    CalendarOutlined,
    SyncOutlined,
    AlertOutlined,
    UserAddOutlined,
    ClockCircleOutlined,
    InfoCircleOutlined
} from './AppIcons';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationsContext';
import NotificationCard from './NotificationCard';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/es';
import useIsMobile from '../hooks/useIsMobile';

dayjs.extend(relativeTime);
dayjs.locale('es');

const NotificationsDrawer = ({ open, onClose }) => {
    const { notifications, loading, fetchNotifications, markAsRead, markAllAsRead } = useNotifications();
    const [filter, setFilter] = useState('all');
    const isMobile = useIsMobile();
    const navigate = useNavigate();

    useEffect(() => {
        if (open) {
            fetchNotifications({ read: filter === 'unread' ? false : undefined });
        }
    }, [open, filter, fetchNotifications]);

    const handleFilterChange = (value) => {
        setFilter(value);
    };

    const handleMarkAsRead = async (e, notificationId) => {
        e.stopPropagation();
        await markAsRead(notificationId);
    };

    const handleMarkAllAsRead = async () => {
        await markAllAsRead();
        fetchNotifications({ read: filter === 'unread' ? false : undefined });
    };

    const getNotificationIcon = (type) => {
        switch (type) {
            case 'planning_assigned':
                return <CalendarOutlined style={{ color: '#1890ff' }} />;
            case 'state_change':
                return <SyncOutlined style={{ color: '#52c41a' }} />;
            case 'low_stock':
                return <AlertOutlined style={{ color: '#faad14' }} />;
            case 'new_user':
                return <UserAddOutlined style={{ color: '#722ed1' }} />;
            case 'planning_upcoming':
                return <ClockCircleOutlined style={{ color: '#fa8c16' }} />;
            default:
                return <InfoCircleOutlined style={{ color: '#8c8c8c' }} />;
        }
    };

    const handleNotificationClick = async (notification) => {
        if (!notification.read) {
            markAsRead(notification.id);
        }

        const { type } = notification;
        if (type.startsWith('planning_') || type === 'state_change') {
            navigate('/planificaciones');
        } else if (type === 'low_stock') {
            navigate('/inventario');
        } else if (type === 'new_user') {
            navigate('/usuarios');
        }

        onClose();
    };

    const groupNotificationsByDate = (items) => {
        const today = dayjs().startOf('day');
        const yesterday = dayjs().subtract(1, 'day').startOf('day');
        const thisWeek = dayjs().subtract(7, 'days').startOf('day');

        const groups = {
            today: [],
            yesterday: [],
            thisWeek: [],
            older: [],
        };

        items.forEach(notification => {
            const notifDate = dayjs(notification.created_at);
            if (notifDate.isAfter(today)) {
                groups.today.push(notification);
            } else if (notifDate.isAfter(yesterday)) {
                groups.yesterday.push(notification);
            } else if (notifDate.isAfter(thisWeek)) {
                groups.thisWeek.push(notification);
            } else {
                groups.older.push(notification);
            }
        });

        return groups;
    };

    const groupedNotifications = groupNotificationsByDate(notifications);

    const renderNotificationGroup = (title, items) => {
        if (items.length === 0) return null;

        return (
            <div key={title} style={{ marginBottom: isMobile ? 18 : 24, maxWidth: '100%' }}>
                <h4 style={{ marginBottom: 12, color: '#666', fontSize: 14, fontWeight: 600 }}>
                    {title}
                </h4>
                <List
                    dataSource={items}
                    split={false}
                    renderItem={notification => <List.Item key={notification.id}><NotificationCard notification={notification} icon={getNotificationIcon(notification.type)} onOpen={handleNotificationClick} onRead={handleMarkAsRead} /></List.Item>}
                />
            </div>
        );
    };

    return (
        <Drawer
            className="notification-drawer"
            title="Notificaciones"
            placement="right"
            onClose={onClose}
            open={open}
            width={isMobile ? '100%' : 450}
            styles={{
                header: {
                    borderBottom: '1px solid #f0f0f0',
                    padding: isMobile ? '12px 16px' : undefined,
                    paddingBottom: isMobile ? 12 : 16,
                },
                body: {
                    padding: isMobile ? 12 : 24,
                    paddingTop: isMobile ? 12 : 16,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                },
                content: {
                    maxWidth: '100vw',
                    overflow: 'hidden',
                },
            }}
        >
            <div style={{
                marginBottom: isMobile ? 12 : 20,
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingBottom: isMobile ? 12 : 16,
                borderBottom: '1px solid #f0f0f0',
                maxWidth: '100%',
                overflowX: 'hidden',
            }}>
                <Segmented
                    value={filter}
                    onChange={handleFilterChange}
                    block={isMobile}
                    style={{ maxWidth: '100%' }}
                    options={[
                        { label: 'Todas', value: 'all' },
                        { label: 'No leídas', value: 'unread' },
                    ]}
                />
                <Button size="small" onClick={handleMarkAllAsRead} type="primary" ghost block={isMobile}>
                    Marcar todas leídas
                </Button>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>Cargando...</div>
            ) : notifications.length === 0 ? (
                <Empty
                    description={filter === 'unread' ? 'No hay notificaciones sin leer' : 'No hay notificaciones'}
                    style={{ marginTop: 60 }}
                />
            ) : (
                <div style={{ maxWidth: '100%', overflowX: 'hidden' }}>
                    {renderNotificationGroup('Hoy', groupedNotifications.today)}
                    {renderNotificationGroup('Ayer', groupedNotifications.yesterday)}
                    {renderNotificationGroup('Esta semana', groupedNotifications.thisWeek)}
                    {renderNotificationGroup('Más antiguas', groupedNotifications.older)}
                </div>
            )}
        </Drawer>
    );
};

export default NotificationsDrawer;
