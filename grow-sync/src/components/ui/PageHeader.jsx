import React from 'react';
import { Breadcrumb, Button, Dropdown, Space } from 'antd';
import { MoreOutlined } from '../AppIcons';
import useIsMobile from '../../hooks/useIsMobile';

export function PageHeader({ title, description, breadcrumb, primaryAction, secondaryActions = [] }) {
  const mobile = useIsMobile();
  const secondary = secondaryActions.filter(a => a.hidden !== true);
  return <header className="gs-ui-page-header">
    <div className="gs-ui-page-context">{breadcrumb && <Breadcrumb items={breadcrumb} />}<h1>{title}</h1>{description && <p>{description}</p>}</div>
    <Space wrap className="gs-ui-page-actions">
      {primaryAction && !primaryAction.hidden && <Button type="primary" icon={primaryAction.icon} onClick={primaryAction.onClick} disabled={primaryAction.disabled} loading={primaryAction.loading}>{primaryAction.label}</Button>}
      {mobile && secondary.length > 1 ? <Dropdown trigger={['click']} menu={{ items: secondary.map(a => ({ key: a.key, label: a.label, icon: a.icon, disabled: a.disabled, onClick: a.onClick })) }}><Button aria-label="Más acciones de la página" icon={<MoreOutlined />} /></Dropdown>
        : secondary.map(a => <Button key={a.key} icon={a.icon} onClick={a.onClick} disabled={a.disabled}>{a.label}</Button>)}
    </Space>
  </header>;
}
