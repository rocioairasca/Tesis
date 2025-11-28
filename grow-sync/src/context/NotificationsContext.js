import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { notification as antNotification } from 'antd';
import io from 'socket.io-client';
import api from '../services/apiClient';
import { getUserDataByEmail } from '../services/authService';

const NotificationsContext = createContext();

export const useNotifications = () => {
    const context = useContext(NotificationsContext);
    if (!context) {
        throw new Error('useNotifications must be used within NotificationsProvider');
    }
    return context;
};

export const NotificationsProvider = ({ children }) => {
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [socket, setSocket] = useState(null);

    // Fetch notifications
    const fetchNotifications = useCallback(async (filters = {}) => {
        setLoading(true);
        try {
            const params = {};
            if (filters.read !== undefined) params.read = filters.read;
            if (filters.priority) params.priority = filters.priority;
            if (filters.page) params.page = filters.page;
            if (filters.pageSize) params.pageSize = filters.pageSize;

            const { data } = await api.get('/notifications', { params });
            setNotifications(Array.isArray(data) ? data : data?.data || []);
        } catch (error) {
            console.error('Error fetching notifications:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    // Fetch unread count
    const fetchUnreadCount = useCallback(async () => {
        try {
            const { data } = await api.get('/notifications/unread-count');
            setUnreadCount(data?.unreadCount || 0);
        } catch (error) {
            console.error('Error fetching unread count:', error);
        }
    }, []);

    // Mark notification as read
    const markAsRead = useCallback(async (notificationId) => {
        try {
            await api.patch(`/notifications/${notificationId}/read`);
            // Update local state
            setNotifications(prev =>
                prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
            );
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (error) {
            console.error('Error marking notification as read:', error);
        }
    }, []);

    // Mark all as read
    const markAllAsRead = useCallback(async () => {
        try {
            await api.patch('/notifications/read-all');
            // Update local state
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
            setUnreadCount(0);
        } catch (error) {
            console.error('Error marking all as read:', error);
        }
    }, []);

    // Initialize Socket.io
    useEffect(() => {
        let newSocket;

        const initSocket = async () => {
            const email = localStorage.getItem('auth_email');
            if (!email) return;

            try {
                // Obtener ID del usuario para unirse a la sala
                const userData = await getUserDataByEmail(email);
                const userId = userData.id;

                const socketUrl = process.env.REACT_APP_API_URL
                    ? process.env.REACT_APP_API_URL.replace('/api', '')
                    : 'http://localhost:4000';

                newSocket = io(socketUrl);
                setSocket(newSocket);

                newSocket.on('connect', () => {
                    console.log('Conectado al servidor de notificaciones');
                    newSocket.emit('join_room', userId);
                });

                newSocket.on('new_notification', (notification) => {
                    // Actualizar estado
                    setNotifications(prev => [notification, ...prev]);
                    setUnreadCount(prev => prev + 1);

                    // Mostrar toast
                    antNotification.info({
                        message: notification.title,
                        description: notification.message,
                        placement: 'topRight',
                        duration: 4,
                    });
                });

            } catch (error) {
                console.error('Error inicializando socket:', error);
            }
        };

        initSocket();

        return () => {
            if (newSocket) newSocket.disconnect();
        };
    }, []);

    // Polling for unread count (every 30 seconds) - Fallback
    useEffect(() => {
        fetchUnreadCount();
        const interval = setInterval(fetchUnreadCount, 30000);
        return () => clearInterval(interval);
    }, [fetchUnreadCount]);

    const value = {
        notifications,
        unreadCount,
        loading,
        fetchNotifications,
        fetchUnreadCount,
        markAsRead,
        markAllAsRead,
    };

    return (
        <NotificationsContext.Provider value={value}>
            {children}
        </NotificationsContext.Provider>
    );
};
