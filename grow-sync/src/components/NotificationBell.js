import React, { useState } from 'react';
import { Badge, Dropdown, Button, Empty } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { useNotifications } from '../context/NotificationsContext';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/es';

dayjs.extend(relativeTime);
dayjs.locale('es');

const NotificationBell = ({ onOpenDrawer }) => {
    const { notifications, unreadCount, markAsRead, fetchNotifications } = useNotifications();
    const [dropdownOpen, setDropdownOpen] = useState(false);

    // Fetch recent notifications when dropdown opens
    const handleDropdownOpenChange = async (open) => {
        setDropdownOpen(open);
        if (open) {
            await fetchNotifications({ pageSize: 5 });
        }
    };

    const handleNotificationClick = async (notification) => {
        if (!notification.read) {
            await markAsRead(notification.id);
        }
        setDropdownOpen(false);
        // Aquí podrías agregar navegación basada en el tipo de notificación
    };

    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'high': return '#ff4d4f';
            case 'medium': return '#faad14';
            case 'low': return '#1890ff';
            default: return '#1890ff';
        }
    };

    const dropdownMenu = {
        items: notifications.length > 0 ? [
            ...notifications.slice(0, 5).map(notification => ({
                key: notification.id,
                label: (
                    <div
                        onClick={() => handleNotificationClick(notification)}
                        style={{
                            padding: '8px 0',
                            borderLeft: `3px solid ${getPriorityColor(notification.priority)}`,
                            paddingLeft: 8,
                            backgroundColor: notification.read ? 'transparent' : '#f0f5ff',
                        }}
                    >
                        <div style={{ fontWeight: notification.read ? 'normal' : 'bold', marginBottom: 4 }}>
                            {notification.title}
                        </div>
                        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                            {notification.message}
                        </div>
                        <div style={{ fontSize: 11, color: '#999' }}>
                            {dayjs(notification.created_at).fromNow()}
                        </div>
                    </div>
                ),
            })),
            {
                key: 'view-all',
                label: (
                    <Button
                        type="link"
                        block
                        onClick={() => {
                            setDropdownOpen(false);
                            onOpenDrawer();
                        }}
                    >
                        Ver todas las notificaciones
                    </Button>
                ),
            },
        ] : [
            {
                key: 'empty',
                label: (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="No hay notificaciones"
                        style={{ padding: '20px 0' }}
                    />
                ),
            },
        ],
    };

    return (
        <Dropdown
            menu={dropdownMenu}
            trigger={['click']}
            open={dropdownOpen}
            onOpenChange={handleDropdownOpenChange}
            placement="bottomRight"
            overlayStyle={{ width: 350, maxHeight: 400, overflow: 'auto' }}
        >
            <Badge count={unreadCount} overflowCount={99}>
                <Button
                    type="text"
                    icon={<BellOutlined style={{ fontSize: 20 }} />}
                    style={{ border: 'none' }}
                />
            </Badge>
        </Dropdown>
    );
};

export default NotificationBell;
