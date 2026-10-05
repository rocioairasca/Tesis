import React from 'react';
import {Segmented} from 'antd';
export default function PlanningRegistrationType({value=false,onChange}) {
 return <Segmented block value={value?'done':'planned'} style={{width:'100%',minWidth:0}}
   options={[{value:'planned',label:'Planificar'},{value:'done',label:'Ya realizada'}]}
   onChange={next=>onChange?.(next==='done')} />;
}
