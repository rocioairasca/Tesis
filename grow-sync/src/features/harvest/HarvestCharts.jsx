import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line } from 'recharts';
import { EmptyState } from '../../components/ui';
import { tokens } from '../../theme/tokens';
import { formatNumber } from '../../utils/numberFormat';
import { campaignChartRows, yieldChartRows } from '../dashboard/chartPresentation.mjs';

const palette = [tokens.info, tokens.brand.accent, tokens.brand.primary, tokens.brand.lime, tokens.warning];
const shorten = value => String(value).length > 20 ? `${String(value).slice(0, 19)}…` : value;
export default function HarvestCharts({ data }) {
  if (!data || !Number(data.summary.total_records)) return <EmptyState title="Sin cosechas para graficar" />;
  const crops = yieldChartRows(data.byCrop);
  const campaigns = campaignChartRows(yieldChartRows(data.byCampaign));
  const tooltip = <Tooltip formatter={(value, name) => [`${formatNumber(value)} ${name === 'Producción' ? 'kg' : 'kg/ha'}`, name]} />;
  return <div className="gs-harvest-charts">
    <section className="gs-harvest-panel"><h2>Producción por cultivo</h2><div className="gs-harvest-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={crops} dataKey="production_kg" nameKey="crop" innerRadius="48%" outerRadius="80%">{crops.map((row, index) => <Cell key={row.crop} fill={palette[index % palette.length]} />)}</Pie><Tooltip formatter={value => [`${formatNumber(value)} kg`, 'Producción']} /></PieChart></ResponsiveContainer></div><ul className="gs-harvest-legend">{crops.map((row,index) => <li key={row.crop}><i style={{background:palette[index % palette.length]}} /><span title={row.crop}>{row.crop}</span><strong>{formatNumber(row.production_kg)} kg</strong></li>)}</ul></section>
    <section className="gs-harvest-panel"><h2>Rendimiento por cultivo</h2><p className="gs-ui-helper">kg/ha · ponderado por superficie</p><div className="gs-harvest-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={crops} layout="vertical" margin={{left:0,right:16,top:8,bottom:8}}><CartesianGrid horizontal={false} stroke={tokens.border} /><XAxis type="number" tickFormatter={value=>formatNumber(value,0)} /><YAxis type="category" dataKey="crop" width={100} tickFormatter={shorten} tick={{fontSize:12}} />{tooltip}<Bar name="Rendimiento" dataKey="chartYield" radius={[0,4,4,0]} maxBarSize={24}>{crops.map((row,index)=><Cell key={row.crop} fill={palette[index%palette.length]}/>)}</Bar></BarChart></ResponsiveContainer></div></section>
    <section className="gs-harvest-panel"><h2>Rendimiento por campaña</h2>{campaigns.chronological && campaigns.rows.length > 1 ? <><p className="gs-ui-helper">kg/ha · evolución entre períodos</p><div className="gs-harvest-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={campaigns.rows} margin={{left:0,right:16,top:8,bottom:8}}><CartesianGrid vertical={false} stroke={tokens.border}/><XAxis dataKey="campaign" tick={{fontSize:12}}/><YAxis width={54} tickFormatter={value=>formatNumber(value,0)}/>{tooltip}<Line name="Rendimiento" dataKey="chartYield" stroke={tokens.info} strokeWidth={2} connectNulls={false}/></LineChart></ResponsiveContainer></div></> : <><p className="gs-ui-helper">{campaigns.chronological ? 'Se necesitan al menos dos períodos para mostrar una evolución.' : 'Faltan fechas de campaña para establecer una secuencia temporal.'}</p><ul className="gs-harvest-legend">{campaigns.rows.map(row=><li key={row.campaign_id ?? row.campaign}><span title={row.campaign}>{row.campaign}</span><strong>{formatNumber(row.chartYield)} kg/ha</strong></li>)}</ul></>}</section>
  </div>;
}
