import React from 'react';
import { Select } from 'antd';
import { FilterBar } from '../../components/ui';

// One shared filter zone for both views. State lives in Harvest.jsx so switching views, opening a record or
// coming back never resets it. Campaña is the primary filter; Estado/Procedencia only apply to individual records.
export default function HarvestFilters({ tab, filters, onChange, onClear, options, canDisabled, activeFilters }) {
  const records = tab === 'records';
  return <FilterBar
    search={{ value: filters.search, onChange: value => onChange('search', value), placeholder: records ? 'Buscar cosechas…' : 'Buscar lote o cultivo…' }}
    filters={<>
      <Select className="gs-harvest-campaign" aria-label="Campaña" placeholder={records ? 'Todas las campañas' : 'Seleccioná una campaña'} allowClear={records} showSearch optionFilterProp="label"
        value={filters.campaign} onChange={value => onChange('campaign', value)} options={options.campaigns} />
      <Select aria-label="Cultivo" placeholder="Todos los cultivos" allowClear showSearch optionFilterProp="label"
        value={filters.crop} onChange={value => onChange('crop', value)} options={options.crops} />
      <Select aria-label="Lote o sublote" placeholder="Lotes y sublotes" allowClear showSearch optionFilterProp="label"
        value={filters.surface} onChange={value => onChange('surface', value)} options={options.surfaces} />
    </>}
    moreFilters={records ? <>
      {canDisabled && <label className="gs-harvest-filter-field">Estado<Select aria-label="Estado" value={filters.state} onChange={value => onChange('state', value)}
        options={[{ value: 'active', label: 'Activas' }, { value: 'disabled', label: 'Deshabilitadas' }, { value: 'all', label: 'Todos' }]} /></label>}
      <label className="gs-harvest-filter-field">Procedencia<Select aria-label="Procedencia" placeholder="Todas" allowClear value={filters.origin} onChange={value => onChange('origin', value)}
        options={[{ value: 'current', label: 'Actual' }, { value: 'historical', label: 'Histórica' }, { value: 'unknown', label: 'No documentada' }]} /></label>
    </> : undefined}
    activeFilters={activeFilters} onClear={onClear} />;
}
