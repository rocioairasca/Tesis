import React from 'react';
import { Avatar, Button, Tag } from 'antd';
import { CheckOutlined } from './AppIcons';
import { presentNotification } from '../utils/userFriendlyErrors';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/es';
import './notificationCard.css';
dayjs.extend(relativeTime);
const priorities = { high: ['red', 'Alta'], medium: ['orange', 'Media'], low: ['blue', 'Baja'] };
export default function NotificationCard({ notification: raw, icon, onOpen, onRead }) {
  const notification = presentNotification(raw);
  const priority = priorities[notification.priority];
  return <article className={'gs-notification-card' + (notification.read ? '' : ' gs-notification-card--unread')} data-read={Boolean(notification.read)}>
    <Avatar size={28} icon={icon} />
    <div className="gs-notification-content">
      <button type="button" className="gs-notification-open" onClick={() => onOpen(notification)}>
        <span className="gs-notification-heading"><strong>{notification.title}</strong>{priority && <Tag color={priority[0]}>{priority[1]}</Tag>}</span>
        <span className="gs-notification-message">{notification.message}</span>
      </button>
      <div className="gs-notification-footer"><time dateTime={notification.created_at}>{dayjs(notification.created_at).locale('es').fromNow()}</time>{!notification.read && <Button type="text" size="small" icon={<CheckOutlined />} onClick={event => onRead(event, notification.id)}>Marcar leída</Button>}</div>
    </div>
  </article>;
}
