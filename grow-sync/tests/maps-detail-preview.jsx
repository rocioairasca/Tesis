// Read-only fixture. No API, credentials, geolocation or stored geometry changes.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ConfigProvider} from 'antd';
import MapSelector from '../src/components/MapSelector';
import SubLotEditor from '../src/features/lots/components/SubLotEditor';
import LotMapPreview from '../src/features/planning/components/LotMapPreview';
import useIsMobile from '../src/hooks/useIsMobile';
import {fixtureLots} from './lotsOverview.fixtures.mjs';
import {displayGeometry} from '../src/utils/mapGeometry.mjs';
import {appTheme} from '../src/theme/theme';
import {cssVariables} from '../src/theme/tokens';
import '../src/index.css';
const lot=fixtureLots[0];
const layout={...lot.active_layout,parent_geom_snapshot:displayGeometry(lot.location),parent_area_ha_snapshot:lot.area};
function Preview(){
  const [view,setView]=useState('selector');
  const mobile=useIsMobile();
  return <main style={{padding:16,minWidth:0}}><h1>Mapas de detalle · datos ficticios</h1>
    <label>Mapa a revisar <select value={view} onChange={e=>setView(e.target.value)}><option value="selector">Selector</option><option value="divisions">Divisiones</option><option value="planning">Planificación</option></select></label>
    {view==='selector' ? <MapSelector lots={fixtureLots.filter(l=>l.enabled)} /> : view==='divisions' ? <SubLotEditor lot={lot} layout={layout} editable={false} isMobile={mobile}/> : <LotMapPreview selections={[{lot_id:lot.id,lot_name:lot.name,lot_location:lot.location,sub_lot_id:layout.sub_lots[0].id,sub_lot_name:layout.sub_lots[0].name,sub_lot_geom:layout.sub_lots[0].geom}]}/>}
  </main>;
}
Object.entries(cssVariables).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));
if(import.meta.env.DEV) createRoot(document.getElementById('root')).render(<ConfigProvider theme={appTheme}><Preview/></ConfigProvider>);
