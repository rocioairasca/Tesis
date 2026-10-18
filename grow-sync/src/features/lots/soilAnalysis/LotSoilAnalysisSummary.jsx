import React, {useEffect, useState} from 'react';
import {Alert, Button, Card, List, Spin, Typography} from 'antd';
import api from '../../../services/apiClient';
import {formatCalendarDate} from '../../../utils/calendarDate';
import {depthText, highlights, historyRows} from './soilAnalysisModel.mjs';
import './soilAnalysis.css';

export default function LotSoilAnalysisSummary({lotId, canCreate, onNavigate}) {
 const [state, setState] = useState({status:'loading', reports:[]});
 const [retry, setRetry] = useState(0);
 useEffect(() => {
  const controller = new AbortController();
  setState({status:'loading', reports:[]});
  api.get('/soil-analysis', {params:{lot_id:lotId, enabled:'true'}, signal:controller.signal})
   .then(({data}) => {if (!controller.signal.aborted) setState({status:'success', reports:data});})
   .catch(() => {if (!controller.signal.aborted) setState({status:'error', reports:[]});});
  return () => controller.abort();
 }, [lotId, retry]);
 const rows = historyRows(state.reports, lotId).slice(0, 3);
 const base = '/lotes/' + lotId + '/analisis-suelo';
 const create = () => onNavigate(base + '?new=true');
 return <section className="soil-lot-summary" aria-label="Análisis de suelo del lote">
  <Card size="small" title={<div className="soil-lot-summary-heading"><span>Análisis de suelo</span><div className="soil-lot-summary-actions">
   <Button size="small" onClick={() => onNavigate(base)}>Ver todos</Button>
   {canCreate && <Button size="small" onClick={create}>Nuevo análisis</Button>}
  </div></div>}>
   {state.status === 'loading' ? <div role="status"><Spin size="small"/> Cargando análisis de suelo…</div>
    : state.status === 'error' ? <Alert type="error" showIcon message="No pudimos cargar los análisis de suelo." action={<Button size="small" onClick={() => setRetry(n => n + 1)}>Reintentar</Button>}/>
    : !rows.length ? <div><Typography.Paragraph>Este lote todavía no tiene análisis de suelo cargados.</Typography.Paragraph>{canCreate && <Button size="small" onClick={create}>Cargar análisis</Button>}</div>
    : <List dataSource={rows} renderItem={row => <List.Item key={row.key}>
     <article className="soil-lot-summary-sample">
      <div className="soil-lot-summary-content">
       <Typography.Text strong>{formatCalendarDate(row.sample_date, 'Fecha no consignada')}</Typography.Text>
       <div>{row.sample_name || 'Muestra sin nombre'}</div>
       <small className="soil-secondary">{row.sub_lot_name || (row.sub_lot_id ? 'División sin nombre' : 'Lote completo')} · {depthText(row)}</small>
       <small className="soil-secondary">Informe {row.report.report_number || 'sin número'} · {row.report.laboratory || 'Laboratorio no consignado'}</small>
       <div className="soil-highlights">{highlights(row).map(h => <span key={h.name}>{h.name}: {h.text}</span>)}</div>
      </div>
      <Button size="small" onClick={() => onNavigate(base + '?reportId=' + encodeURIComponent(row.report.id))}>Ver análisis</Button>
     </article>
    </List.Item>}/>}
  </Card>
 </section>;
}
