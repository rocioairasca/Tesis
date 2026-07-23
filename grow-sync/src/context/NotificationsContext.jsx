import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { notification as antNotification } from "antd";
import io from "socket.io-client";
import api from "../services/apiClient";
import { getUserDataByEmail } from "../services/authService";
import { getApiOrigin } from "../services/apiBase";

const NotificationsContext = createContext();

export const useNotifications = () => {
  const context = useContext(NotificationsContext);

  if (!context) {
    throw new Error(
      "useNotifications must be used within NotificationsProvider"
    );
  }

  return context;
};

export const NotificationsProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = useCallback(async (filters = {}) => {
    const token = localStorage.getItem("access_token");

    if (!token) {
      setNotifications([]);
      return;
    }

    setLoading(true);

    try {
      const params = {};

      if (filters.read !== undefined) {
        params.read = filters.read;
      }

      if (filters.priority) {
        params.priority = filters.priority;
      }

      if (filters.page) {
        params.page = filters.page;
      }

      if (filters.pageSize) {
        params.pageSize = filters.pageSize;
      }

      const { data } = await api.get("/notifications", {
        params,
      });

      setNotifications(
        Array.isArray(data) ? data : data?.data || []
      );
    } catch (error) {
      if (error?.response?.status !== 401) {
        console.error(
          "Error fetching notifications:",
          error
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    const token = localStorage.getItem("access_token");

    if (!token) {
      setUnreadCount(0);
      return;
    }

    try {
      const { data } = await api.get(
        "/notifications/unread-count"
      );

      setUnreadCount(data?.unreadCount || 0);
    } catch (error) {
      if (error?.response?.status !== 401) {
        console.error(
          "Error fetching unread count:",
          error
        );
      }
    }
  }, []);

  const markAsRead = useCallback(async (notificationId) => {
    const token = localStorage.getItem("access_token");

    if (!token) {
      return;
    }

    try {
      await api.patch(
        `/notifications/${notificationId}/read`
      );

      setNotifications((prev) =>
        prev.map((notification) =>
          notification.id === notificationId
            ? {
                ...notification,
                read: true,
              }
            : notification
        )
      );

      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      if (error?.response?.status !== 401) {
        console.error(
          "Error marking notification as read:",
          error
        );
      }
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    const token = localStorage.getItem("access_token");

    if (!token) {
      return;
    }

    try {
      await api.patch("/notifications/read-all");

      setNotifications((prev) =>
        prev.map((notification) => ({
          ...notification,
          read: true,
        }))
      );

      setUnreadCount(0);
    } catch (error) {
      if (error?.response?.status !== 401) {
        console.error(
          "Error marking all as read:",
          error
        );
      }
    }
  }, []);

  useEffect(() => {
    let newSocket;

    const initSocket = async () => {
      const token = localStorage.getItem("access_token");
      const email = localStorage.getItem("auth_email");

      if (!token || !email) {
        return;
      }

      try {
        const userData = await getUserDataByEmail(email);
        const userId = userData?.id;

        if (!userId) {
          return;
        }

        newSocket = io(getApiOrigin());

        newSocket.on("connect", () => {
          console.log(
            "Conectado al servidor de notificaciones"
          );

          newSocket.emit("join_room", userId);
        });

        newSocket.on(
          "new_notification",
          (notification) => {
            setNotifications((prev) => [
              notification,
              ...prev,
            ]);

            setUnreadCount((prev) => prev + 1);

            antNotification.info({
              message: notification.title,
              description:
                notification.message ||
                notification.body,
              placement: "topRight",
              duration: 4,
            });
          }
        );

        newSocket.on("connect_error", (error) => {
          console.error(
            "Error conectando al socket de notificaciones:",
            error
          );
        });
      } catch (error) {
        if (error?.response?.status !== 401) {
          console.error(
            "Error inicializando socket:",
            error
          );
        }
      }
    };

    initSocket();

    return () => {
      if (newSocket) {
        newSocket.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("access_token");

    if (!token) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    fetchUnreadCount();

    const interval = setInterval(() => {
      const currentToken =
        localStorage.getItem("access_token");

      if (currentToken) {
        fetchUnreadCount();
      } else {
        setNotifications([]);
        setUnreadCount(0);
      }
    }, 30000);

    return () => {
      clearInterval(interval);
    };
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