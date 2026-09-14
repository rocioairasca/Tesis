import React, { useState } from 'react';
import { Button, Input, Space, Tag } from 'antd';
import useIsMobile from '../../hooks/useIsMobile';
import { FormDrawer } from './Overlays';
import { CloseOutlined } from '../AppIcons';

export function FilterBar({ search, filters, moreFilters, activeFilters = [], onClear }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const count = activeFilters.length;
  return <section className="gs-ui-filter-bar" aria-label="Buscar y filtrar">
    <div className="gs-ui-filter-controls">
      {search && <Input.Search className="gs-ui-search" aria-label={search.label || 'Buscar'} placeholder={search.placeholder || 'Buscar…'} allowClear value={search.value} onChange={e => search.onChange(e.target.value)} />}
      {mobile ? (filters || moreFilters) && <Button onClick={() => setOpen(true)}>Filtros{count ? ` (${count})` : ''}</Button> : <><div className="gs-ui-inline-filters">{filters}</div>{moreFilters && <Button onClick={() => setOpen(true)}>Más filtros</Button>}</>}
    </div>
    {count > 0 && <Space wrap className="gs-ui-active-filters" aria-label="Filtros activos">{activeFilters.map(f => <Tag key={f.key}>{f.label}{f.onRemove && <Button type="text" size="small" aria-label={`Quitar filtro ${f.label}`} icon={<CloseOutlined />} onClick={f.onRemove} />}</Tag>)}{onClear && <Button type="link" onClick={onClear}>Limpiar filtros</Button>}</Space>}
    <FormDrawer open={open} onClose={() => setOpen(false)} title="Filtros" footer={<Space wrap>{onClear && <Button disabled={!count} onClick={onClear}>Limpiar filtros</Button>}<Button type="primary" onClick={() => setOpen(false)}>Ver resultados</Button></Space>}>
      <div className="gs-ui-filter-sheet">{mobile && filters}{moreFilters}</div>
    </FormDrawer>
  </section>;
}
