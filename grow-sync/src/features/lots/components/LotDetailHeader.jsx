import React from 'react';
import {Breadcrumb, Button, Tag} from 'antd';
import {ArrowLeftOutlined, PlusOutlined, SyncOutlined} from '../../../components/AppIcons';
import {formatNumber} from '../../../utils/numberFormat';

export default function LotDetailHeader({lot,divisionCount,loading,saving,canRegister,onBack,onRefresh,onRegister,onNewDivision}) {
  return <header className="lot-detail-header">
    <Breadcrumb items={[{title:<Button type="link" onClick={onBack}>Lotes</Button>},{title:lot?.name || 'Lote'}]}/>
    <div className="lot-detail-header-row">
      <div className="lot-detail-heading">
        <Button icon={<ArrowLeftOutlined/>} aria-label="Volver a Lotes" onClick={onBack}/>
        <div><div className="lot-detail-title"><h1>{lot?.name || 'Lote'}</h1>
          {typeof lot?.enabled==='boolean'&&<Tag color={lot.enabled?'green':'default'}>{lot.enabled?'Activo':'Deshabilitado'}</Tag>}
        </div><p>Superficie total: {formatNumber(lot?.area_ha ?? lot?.area)} ha{divisionCount>0&&<> · {divisionCount} sublotes</>}</p></div>
      </div>
      <div className="lot-detail-actions">
        <Button icon={<SyncOutlined/>} onClick={onRefresh} loading={loading}>Actualizar</Button>
        {canRegister&&<Button onClick={onRegister}>Registrar cultivo</Button>}
        <Button type="primary" icon={<PlusOutlined/>} onClick={onNewDivision} loading={saving}>Nueva división</Button>
      </div>
    </div>
  </header>;
}
