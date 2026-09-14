import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, LabelList, AreaChart, Area } from 'recharts';
import { EmptyState } from '../../components/ui';
import { tokens } from '../../theme/tokens';
import { formatNumber } from '../../utils/numberFormat';
import useIsMobile from '../../hooks/useIsMobile';
import { yieldChartRows, campaignChartRows } from './chartPresentation.mjs';
const palette = [tokens.brand.lime, tokens.brand.primary, `color-mix(in srgb, ${tokens.brand.primary} 65%, ${tokens.brand.lime})`, `color-mix(in srgb, ${tokens.brand.primary} 25%, ${tokens.brand.lime})`, `color-mix(in srgb, ${tokens.brand.primary} 80%, ${tokens.brand.lime})`];
const shorten = value => String(value).length > 16 ? `${String(value).slice(0,15)}…` : String(value);
const axisStyle = { fill:tokens.textSecondary,fontSize:11 };
const tooltipStyle = { borderRadius:tokens.radius.control,borderColor:tokens.border,maxWidth:'min(240px, calc(100vw - 140px))',whiteSpace:'normal',overflowWrap:'anywhere' };
export default function DashboardChart({ rows, kind, unit, yieldUnit }) {
  const mobile = useIsMobile();
  const yields = kind === 'yield';
  const campaign = yields ? null : campaignChartRows(rows);
  const data = yields ? yieldChartRows(rows) : campaign.rows;
  const group = yields ? 'crop' : 'campaign';
  const value = yields ? 'chartYield' : 'production_kg';
  const suffix = yields ? yieldUnit : unit;
  const title = yields ? 'Rendimiento por cultivo' : campaign.chronological ? 'Evolución de producción por campaña' : 'Producción por campaña';
  const bars = yields || !campaign.chronological;
  const Chart = bars ? BarChart : AreaChart;
  if (!data.length) return <EmptyState title={yields ? 'Sin datos por cultivo' : 'Sin datos por campaña'} />;
  return <figure className="gs-dashboard-chart"><figcaption>{title} <span>({suffix})</span></figcaption>
    <div className="gs-dashboard-chart-canvas" role="img" aria-label={`${title}. ${data.map(row => `${row[group]}: ${row[value] == null ? 'Sin datos' : `${formatNumber(row[value])} ${suffix}`}`).join('; ')}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}><Chart data={data} margin={{top:24,right:16,bottom:8,left:0}} accessibilityLayer>
        <CartesianGrid stroke={tokens.border} strokeOpacity={0.55} vertical={false}/>
        <XAxis dataKey={group} tickFormatter={shorten} minTickGap={16} tick={axisStyle} tickLine={false} axisLine={false}/>
        <YAxis tickFormatter={value => new Intl.NumberFormat('es-AR',{notation:'compact'}).format(value)} tick={axisStyle} width={48} tickLine={false} axisLine={false}/>
        <Tooltip formatter={value => [`${formatNumber(value)} ${suffix}`,yields ? 'Rendimiento' : 'Producción']} contentStyle={tooltipStyle}/>
        {bars ? <Bar dataKey={value} maxBarSize={48} radius={[4,4,0,0]} isAnimationActive={false}>
          {data.map((row,index) => <Cell key={`${row.campaign_id ?? row.crop ?? row.campaign}:${index}`} fill={palette[index % palette.length]}/>)}
          {!mobile && data.length <= 5 && <LabelList dataKey={value} position="top" formatter={value => value == null ? '' : formatNumber(value)} fill={tokens.textPrimary} fontSize={11}/>}
        </Bar> : <Area type="linear" dataKey={value} stroke={tokens.brand.primary} strokeWidth={2} fill={tokens.brand.primary} fillOpacity={0.08} dot={{r:3,fill:tokens.brand.primary}} activeDot={{r:5}} connectNulls={false} isAnimationActive={false}/>}
      </Chart></ResponsiveContainer>
    </div>
    {yields && data.some(row => row.chartYield == null) && <p className="gs-dashboard-note">Sin rendimiento informado para cultivos sin superficie registrada.</p>}
    {!yields && !campaign.chronological && <p className="gs-dashboard-note">Faltan fechas de campaña para establecer una secuencia temporal completa.</p>}
  </figure>;
}
