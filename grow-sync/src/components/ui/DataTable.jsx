import React, { useState } from 'react';
import { Button, Checkbox, Dropdown, Pagination, Table } from 'antd';
import { MoreOutlined } from '../AppIcons';
import useIsMobile from '../../hooks/useIsMobile';
import { EmptyState, ErrorState, LoadingState } from './Display';

export function RowActions({ label, actions = [] }) {
  const visible = actions.filter(a => !a.hidden);
  if (!visible.length) return null;
  const regular = visible.filter(a => !a.danger), destructive = visible.filter(a => a.danger);
  const item = a => ({ key: a.key, label: a.label, icon: a.icon, danger: a.danger, disabled: a.disabled, onClick: a.onClick });
  const items = [...regular.map(item), ...(regular.length && destructive.length ? [{ type: 'divider' }] : []), ...destructive.map(item)];
  return <Dropdown trigger={['click']} menu={{ items }}><Button className="gs-ui-row-action" aria-label={label} icon={<MoreOutlined />} /></Dropdown>;
}

/** Local data is sliced here; server data is already paginated by its caller.
 * No requests, filtering, permission decisions or business mutations live here.
 */
export function DataTable({ title, description, columns, dataSource = [], rowKey = 'id', loading = false, error, onRetry, empty,
  pagination = {}, paginationMode = 'local', actions, rowLabel, renderMobile, mobileColumns,
  rowSelection, onChange, caption }) {
  const mobile = useIsMobile();
  const [localPage, setLocalPage] = useState(1);
  const keyOf = row => typeof rowKey === 'function' ? rowKey(row) : row[rowKey];
  const pageSize = pagination.pageSize || 10;
  const total = paginationMode === 'server' ? pagination.total ?? dataSource.length : dataSource.length;
  const current = Math.min(pagination.current ?? localPage, Math.max(1, Math.ceil(total / pageSize)));
  const pageRows = pagination === false || paginationMode === 'server' ? dataSource : dataSource.slice((current - 1) * pageSize, current * pageSize);
  const changePage = (page, size) => { setLocalPage(page); pagination.onChange?.(page, size); };
  const paging = pagination === false ? false : { current, pageSize, total, showSizeChanger: false, onChange: changePage, showTotal: n => `${n} registros` };
  const emptyContent = <EmptyState title={empty?.title || 'No encontramos registros para mostrar'} description={empty?.description} action={empty?.action} />;
  const tableColumns = [...columns.map(c => ({ ...c, ellipsis: c.ellipsis ?? true })), ...(actions ? [{ key: '__actions', title: 'Acciones', width: 88, render: (_, row) => <RowActions label={`Acciones de ${rowLabel?.(row) || keyOf(row)}`} actions={actions(row)} /> }] : [])];
  const fields = mobileColumns || columns.filter(c => c.dataIndex);
  const selectRow = (row, checked) => {
    const key = keyOf(row), keys = rowSelection.selectedRowKeys || [];
    const next = checked ? [...keys.filter(k => k !== key), key] : keys.filter(k => k !== key);
    const selected = dataSource.filter(r => next.includes(keyOf(r)));
    rowSelection.onChange?.(next, selected, { type: 'single' });
  };
  return <section className="gs-ui-data-table" aria-label={title || caption || 'Listado de registros'}>
    {title && <div className="gs-ui-table-header"><h2>{title}</h2>{description && <p>{description}</p>}</div>}
    {error ? <ErrorState error={error} onRetry={onRetry} /> : loading ? <LoadingState label="Cargando registros…" rows={4} /> : !mobile ?
      <Table columns={tableColumns} dataSource={dataSource} rowKey={rowKey} size="middle" tableLayout="fixed" pagination={paging} locale={{ emptyText: emptyContent }} rowSelection={rowSelection && {...rowSelection,getCheckboxProps:row=>({'aria-label':`Seleccionar ${rowLabel?.(row)||keyOf(row)}`,...rowSelection.getCheckboxProps?.(row)})}} onChange={onChange} />
      : <>
        {!pageRows.length ? emptyContent : <ul className="gs-ui-records">{pageRows.map((row, index) => <li key={keyOf(row)} className={rowSelection?.selectedRowKeys?.includes(keyOf(row))?'gs-ui-record--selected':undefined}>
          <div className="gs-ui-record-heading"><strong>{rowLabel?.(row) || `Registro ${keyOf(row)}`}</strong>
            {rowSelection && <Checkbox aria-label={`Seleccionar ${rowLabel?.(row) || keyOf(row)}`} checked={rowSelection.selectedRowKeys?.includes(keyOf(row)) || false} disabled={rowSelection.getCheckboxProps?.(row)?.disabled} onChange={e => selectRow(row, e.target.checked)} />}
            {actions && <RowActions label={`Acciones de ${rowLabel?.(row) || keyOf(row)}`} actions={actions(row)} />}
          </div>
          {renderMobile ? renderMobile(row) : <dl>{fields.map((c, i) => { const value = (Array.isArray(c.dataIndex) ? c.dataIndex : [c.dataIndex]).reduce((v, key) => v?.[key], row); return <div key={c.key || i}><dt>{c.title}</dt><dd>{c.render ? c.render(value, row, index) : value ?? '—'}</dd></div>; })}</dl>}
        </li>)}</ul>}
        {paging && total > 0 && <Pagination {...paging} simple className="gs-ui-pagination" onChange={(page, size) => { changePage(page, size); onChange?.({ ...paging, current: page, pageSize: size }, {}, {}, { currentDataSource: pageRows, action: 'paginate' }); }} />}
      </>}
  </section>;
}
