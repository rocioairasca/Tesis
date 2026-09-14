import React from 'react';
import { Alert, Button, Empty, Segmented, Skeleton, Spin, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { tokens } from '../../theme/tokens';
import { getUserFriendlyError } from '../../utils/userFriendlyErrors';

const tones = { success: tokens.success, warning: tokens.warning, danger: tokens.error, error: tokens.error, info: tokens.info, neutral: tokens.textSecondary };
export function StatusBadge({ children, tone = 'neutral', icon }) {
  return <span className="gs-ui-status" style={{ '--status-color': tones[tone] || tones.neutral }}>{icon ? <span aria-hidden="true">{icon}</span> : <span className="gs-ui-status-dot" aria-hidden="true" />}{children}</span>;
}
export function CategoryTag({ children, icon }) {
  return <Tag className="gs-ui-category" icon={icon}>{children}</Tag>;
}
export function Metric({ label, value, helper, icon, status, compact = false, onClick, disabled = false }) {
  const content = <><span className="gs-ui-metric-label">{icon && <span aria-hidden="true">{icon}</span>}{label}</span><strong className="gs-ui-metric-value">{value}</strong>{status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}{helper && <span className="gs-ui-helper">{helper}</span>}</>;
  const className = `gs-ui-metric${compact ? ' gs-ui-metric--compact' : ''}`;
  return onClick ? <button type="button" className={className} disabled={disabled} onClick={onClick}>{content}</button> : <div className={className}>{content}</div>;
}
export function ViewSwitcher({ label = 'Vista del contenido', options, value, onChange, disabled }) {
  return <div className="gs-ui-switcher" role="group" aria-label={label}><Segmented options={options} value={value} onChange={onChange} disabled={disabled} /></div>;
}
export function EmptyState({ title, description, icon, action }) {
  return <div className="gs-ui-empty"><Empty image={icon || Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>{title}</strong>{description && <p>{description}</p>}</>}>{action && <Button type="primary" {...action.buttonProps} onClick={action.onClick} disabled={action.disabled}>{action.label}</Button>}</Empty></div>;
}
export function EntityLink({ children, to, onClick, disabled = false, ariaLabel }) {
  if (disabled) return <span className="gs-ui-entity gs-ui-entity--disabled" aria-disabled="true">{children}</span>;
  return to ? <Link className="gs-ui-entity" to={to} aria-label={ariaLabel}>{children}</Link> : <button type="button" className="gs-ui-entity" onClick={onClick} aria-label={ariaLabel}>{children}</button>;
}
export function LoadingState({ label = 'Cargando contenido…', variant = 'content', rows = 3 }) {
  return <div className="gs-ui-loading" role="status" aria-live="polite" aria-busy="true"><span className="gs-ui-helper">{label}</span>{variant === 'action' ? <Spin size="small" /> : <Skeleton active title paragraph={{ rows }} />}</div>;
}
export function ErrorState({ error, message = 'No se pudo cargar el contenido. Intentá nuevamente.', onRetry, retrying = false }) {
  return <Alert type="error" showIcon message={getUserFriendlyError(error, message)} action={onRetry && <Button onClick={onRetry} loading={retrying} disabled={retrying}>Reintentar</Button>} />;
}
