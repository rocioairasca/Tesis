import { campaignLabel } from '../../utils/campaigns.mjs';
import { calendarDateKey, parseCalendarDate, formatCalendarDate } from '../../utils/calendarDate';
import React, { useEffect, useState } from 'react';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Typography, notification } from 'antd';
import dayjs from 'dayjs';
import { getHarvestContext, finalizeHarvestCycle } from '../../services/harvestService';
import { getUserFriendlyError } from '../../utils/userFriendlyErrors';
import { hasPermission } from '../../utils/permissions';
import { PERMISSIONS } from '../../constants/permissions';
import { formatHectares, parseHectaresInput, formatHectaresInput } from '../../utils/harvestUtils';

const reasons = [
  ['measurement_difference', 'Diferencia de medición'], ['unharvested_area', 'Superficie no cosechada'],
  ['loss', 'Pérdida'], ['weather', 'Condiciones climáticas'], ['other', 'Otro'],
].map(([value, label]) => ({ value, label }));

export default function HarvestCycleFields({ form, fieldName, initialRecord, onFinalized }) {
  const surface = Form.useWatch(['items', fieldName, 'surface_key'], form);
  const cropId = Form.useWatch(['items', fieldName, 'crop_id'], form);
  const date = Form.useWatch('harvest_date', form);
  const dateString = calendarDateKey(date);
  const requestKey = JSON.stringify([initialRecord?.id, surface, cropId, dateString]);
  const [context, setContext] = useState(null);
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [saving, setSaving] = useState(false);
  const [closureForm] = Form.useForm();
  const canFinalize = hasPermission(JSON.parse(localStorage.getItem('user') || 'null'), PERMISSIONS.HARVEST_EDIT);
  const ready = context?.key === requestKey;
  const assignments = ready ? context.assignments || [] : [];
  const legacy = assignments.some((a) => a.harvest_closure_source === 'legacy');
  const available = ready ? context.editable_assignments || assignments : [];
  const maximum = available.reduce((sum, a) => sum + Math.round(Number(a.remaining_area_ha) * 100), 0) / 100;
  const unlinkedLegacy = !!initialRecord && ready && !context.error && !assignments.length;

  useEffect(() => {
    let obsolete = false;
    if (!initialRecord && (!surface || !cropId || !dateString)) return () => { obsolete = true; };
    const [, lotId, subLotId] = String(surface || '').split(':');
    const params = initialRecord ? { harvest_id: initialRecord.id }
      : { lot_id: lotId, sub_lot_id: subLotId, crop_id: cropId, harvest_date: dateString };
    getHarvestContext(params).then((data) => {
      if (!obsolete) setContext({ ...data, key: requestKey });
    }).catch((error) => {
      if (!obsolete) setContext({ key: requestKey, error: getUserFriendlyError(error, 'No se pudo consultar la superficie pendiente.') });
    });
    return () => { obsolete = true; };
  }, [requestKey, initialRecord, surface, cropId, dateString]);

  const finish = async () => {
    try {
      const values = await closureForm.validateFields();
      setSaving(true);
      await finalizeHarvestCycle(selectedCycle.id, { ...values, finalized_date: calendarDateKey(values.finalized_date), client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      notification.success({ message: 'Ciclo finalizado. La superficie pendiente quedó registrada.' });
      setSelectedCycle(null);
      onFinalized?.();
    } catch (error) {
      if (!error.errorFields) notification.error({ message: getUserFriendlyError(error, 'No se pudo finalizar el ciclo.') });
    } finally { setSaving(false); }
  };

  return <>
    <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
      {!ready && surface && cropId && <Typography.Text>Cargando disponibilidad del ciclo...</Typography.Text>}
      {ready && context.error && <Alert type="error" showIcon message={context.error} />}
      {assignments.map((a, index) => <Alert key={a.id} type={a.harvest_closure_source === 'legacy' ? 'warning' : 'info'}
        message={assignments.length > 1 ? `Ciclo ${index + 1}` : 'Superficie del ciclo'}
        description={<>
          <div>Cultivo: {a.crop_name || initialRecord?.crop_name || initialRecord?.crop} · Campaña: {campaignLabel(a.campaign_id || a.campaign_name ? a : initialRecord)}</div>
          <div>Inicio del ciclo: {formatCalendarDate(a.start_date)} · Fecha de cosecha: {formatCalendarDate(dateString)}</div>
          <div>Días transcurridos: {dateString && a.start_date ? parseCalendarDate(dateString).diff(parseCalendarDate(a.start_date), 'day') : '—'}</div>
          <div>Total: {formatHectares(a.total_area_ha)} · Cosechado: {formatHectares(a.harvested_area_ha)} · Pendiente: {formatHectares(a.remaining_area_ha)}</div>
          {a.harvest_closure_source && <div>Cierre: {{ legacy: 'legacy / desconocido', manual: 'finalización explícita', automatic: 'superficie completa' }[a.harvest_closure_source]}</div>}
          {canFinalize && !initialRecord && !a.end_date && Number(a.remaining_area_ha) > 0 && <Button size="small" style={{ marginTop: 8 }} onClick={() => {
            setSelectedCycle(a);
            closureForm.resetFields();
            closureForm.setFieldsValue({ finalized_date: date || dayjs() });
          }}>Finalizar cosecha del ciclo</Button>}
        </>} />)}
      {assignments.length > 1 && <Typography.Text type="secondary">Para una jornada parcial, registrá cada sublote por separado. El lote completo permite registrar todo el pendiente.</Typography.Text>}
      {legacy && <Typography.Text type="secondary">El cierre y las hectáreas legacy requieren conciliación para modificarse.</Typography.Text>}
    </Space>
    <Form.Item label="Superficie de esta jornada (ha)" name={[fieldName, 'harvested_area_ha']}
      extra="Las superficies se redondean a 2 decimales."
      rules={[{ required: true, message: 'Ingresá la superficie' }, { validator: (_, value) => {
        if (value == null || value === '' || !Number.isFinite(Number(value))) return Promise.reject(new Error('Ingresá una superficie válida.'));
        if (!ready || context.error) return Promise.reject(new Error('Esperá una consulta válida de disponibilidad.'));
        if (legacy && initialRecord && Number(value) === Number(initialRecord.harvested_area_ha)) return Promise.resolve();
        if (unlinkedLegacy) return Promise.resolve();
        if (legacy || assignments.some((a) => a.harvest_closure_source === 'manual') && !initialRecord) return Promise.reject(new Error('El ciclo ya está cerrado.'));
        if (Number(value) <= 0 || Math.round(Number(value) * 100) > Math.round(maximum * 100)) return Promise.reject(new Error('La superficie supera el pendiente o no es válida.'));
        if (!initialRecord && assignments.length > 1 && Number(value) !== maximum) return Promise.reject(new Error('Registrá la parcial por sublote.'));
        return Promise.resolve();
      } }]}>
      <InputNumber min={0.01} max={ready && !legacy && !unlinkedLegacy ? maximum : undefined} precision={2} step={0.01}
        decimalSeparator="," parser={parseHectaresInput} formatter={formatHectaresInput}
        addonAfter="ha"
        disabled={!ready || legacy} style={{ width: '100%' }} placeholder="0,00" />
    </Form.Item>
    <Modal title="Finalizar cosecha del ciclo" open={!!selectedCycle} onCancel={() => !saving && setSelectedCycle(null)}
      onOk={finish} confirmLoading={saving} okText="Finalizar ciclo" cancelText="Cancelar" destroyOnHidden>
      <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="La finalización usa solamente jornadas ya guardadas."
        description="Esta acción no guarda la jornada que estás completando. La diferencia de superficie quedará registrada." />
      <Alert type="warning" showIcon style={{ marginBottom: 16 }}
        message={`Se finalizará el ciclo con ${formatHectares(selectedCycle?.remaining_area_ha)} pendientes. Esta diferencia quedará registrada en el historial.`}
        description={`Total: ${formatHectares(selectedCycle?.total_area_ha)} · Cosechado: ${formatHectares(selectedCycle?.harvested_area_ha)}`} />
      <Form form={closureForm} layout="vertical" component="div">
        <Form.Item name="finalized_date" label="Fecha de finalización" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" disabledDate={value => calendarDateKey(value) > dayjs().format('YYYY-MM-DD')} /></Form.Item>
        <Form.Item name="reason" label="Motivo" rules={[{ required: true, message: 'Seleccioná el motivo' }]}><Select options={reasons} /></Form.Item>
        <Form.Item name="notes" label="Observación" dependencies={['reason']} rules={[({ getFieldValue }) => ({ validator: (_, value) =>
          getFieldValue('reason') === 'other' && !value?.trim() ? Promise.reject(new Error('Explicá el motivo')) : Promise.resolve() })]}>
          <Input.TextArea maxLength={2000} rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  </>;
}
