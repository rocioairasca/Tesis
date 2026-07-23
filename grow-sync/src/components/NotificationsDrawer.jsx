import React, { useEffect, useState } from 'react';
import { Drawer, List, Button, Segmented, Empty, Tag, Space, Avatar } from 'antd';
import {
    CheckOutlined,
    CalendarOutlined,
    SyncOutlined,
    AlertOutlined,
    UserAddOutlined,
    ClockCircleOutlined,
    InfoCircleOutlined
} from './AppIcons';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationsContext';
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

    const getPriorityTag = (priority) => {
        const config = {
            high: { color: 'red', text: 'Alta' },
            medium: { color: 'orange', text: 'Media' },
            low: { color: 'blue', text: 'Baja' },
        };
        return <Tag color={config[priority]?.color}>{config[priority]?.text}</Tag>;
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

    const textWrapStyle = {
        maxWidth: '100%',
        minWidth: 0,
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
    };

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
                    renderItem={notification => (
                        <List.Item
                            onClick={() => handleNotificationClick(notification)}
                            style={{
                                backgroundColor: notification.read ? 'transparent' : '#f0f5ff',
                                padding: isMobile ? 10 : 12,
                                borderRadius: 8,
                                marginBottom: 8,
                                border: notification.read ? '1px solid #f0f0f0' : '1px solid #d6e4ff',
                                cursor: 'pointer',
                                transition: 'all 0.3s',
                                maxWidth: '100%',
                                overflow: 'hidden',
                                alignItems: isMobile ? 'flex-start' : 'center',
                            }}
                            className="notification-item"
                            actions={!isMobile ? [
                                !notification.read && (
                                    <Button
                                        type="link"
                                        size="small"
                                        icon={<CheckOutlined />}
                                        onClick={(e) => handleMarkAsRead(e, notification.id)}
                                    >
                                        Marcar leida
                                    </Button>
                                ),
                            ] : undefined}
                        >
                            <List.Item.Meta
                                style={{ maxWidth: '100%', minWidth: 0 }}
                                avatar={
                                    <Avatar
                                        style={{ backgroundColor: notification.read ? '#f5f5f5' : '#fff', flexShrink: 0 }}
                                        icon={getNotificationIcon(notification.type)}
                                    />
                                }
                                title={
                                    <Space size={6} wrap style={{ maxWidth: '100%', minWidth: 0 }}>
                                        <span style={{ fontWeight: notification.read ? 'normal' : 600, ...textWrapStyle }}>
                                            {notification.title}
                                        </span>
                                        {getPriorityTag(notification.priority)}
                                    </Space>
                                }
                                description={
                                    <div style={{ maxWidth: '100%', minWidth: 0 }}>
                                        <div style={{ marginBottom: 4, color: '#595959', ...textWrapStyle }}>
                                            {notification.message}
                                        </div>
                                        <div style={{ fontSize: 11, color: '#999', marginBottom: isMobile && !notification.read ? 8 : 0 }}>
                                            {dayjs(notification.created_at).fromNow()}
                                        </div>
                                        {isMobile && !notification.read && (
                                            <Button
                                                type="link"
                                                size="small"
                                                icon={<CheckOutlined />}
                                                onClick={(e) => handleMarkAsRead(e, notification.id)}
                                                style={{ paddingInline: 0, maxWidth: '100%' }}
                                            >
                                                Marcar leida
                                            </Button>
                                        )}
                                    </div>
                                }
                            />
                        </List.Item>
                    )}
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
                        { label: 'No leidas', value: 'unread' },
                    ]}
                />
                <Button size="small" onClick={handleMarkAllAsRead} type="primary" ghost block={isMobile}>
                    Marcar todas leidas
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
                    {renderNotificationGroup('Mas antiguas', groupedNotifications.older)}
                </div>
            )}
        </Drawer>
    );
};

export default NotificationsDrawer;
