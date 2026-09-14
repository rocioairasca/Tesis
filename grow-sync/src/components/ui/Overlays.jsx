import React, { useRef, useState } from 'react';
import { Button, Drawer, Modal, Space } from 'antd';
import useIsMobile from '../../hooks/useIsMobile';
import { ErrorState } from './Display';

export function FormDrawer({ title, children, footer, wide = false, busy = false, onClose, styles, rootClassName = '', ...props }) {
  const mobile = useIsMobile();
  return <Drawer {...props} rootClassName={`gs-ui-overlay ${rootClassName}`} title={title} width={mobile ? '100%' : wide ? 680 : 500} placement="right" onClose={() => !busy && onClose?.()} closable={!busy} maskClosable={!busy} keyboard={!busy} footer={footer && <div className="gs-ui-overlay-footer">{footer}</div>} styles={{ ...styles, body: { padding: mobile ? 16 : 24, ...styles?.body } }}>{children}</Drawer>;
}
export function FocusModal({ title, children, footer, busy = false, onCancel, width = 480, rootClassName = '', ...props }) {
  return <Modal {...props} rootClassName={`gs-ui-overlay ${rootClassName}`} title={title} width={width} onCancel={() => !busy && onCancel?.()} closable={!busy} maskClosable={!busy} keyboard={!busy} footer={footer == null ? null : <div className="gs-ui-overlay-footer">{footer}</div>}>{children}</Modal>;
}
export function ConfirmDialog({ open, title, description, consequences, confirmLabel, cancelLabel = 'Cancelar', destructive = false, onConfirm, onCancel, onSuccess }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const lock = useRef(false);
  const confirm = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await onConfirm(); onSuccess?.(); }
    catch (e) { setError(e); }
    finally { lock.current = false; setBusy(false); }
  };
  return <FocusModal open={open} title={title} busy={busy} onCancel={() => { setError(null); onCancel?.(); }} footer={<Space wrap><Button disabled={busy} onClick={() => { setError(null); onCancel?.(); }}>{cancelLabel}</Button><Button type="primary" danger={destructive} loading={busy} disabled={busy} onClick={confirm}>{confirmLabel}</Button></Space>}>
    <p>{description}</p>{consequences && <p className="gs-ui-helper">{consequences}</p>}{error && <ErrorState error={error} message="No se pudo completar la acción. Podés volver a intentarlo." />}
  </FocusModal>;
}
