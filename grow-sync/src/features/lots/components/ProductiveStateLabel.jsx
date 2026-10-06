import React from 'react';
import {stateLabel,conflictMessage,observedLabel} from '../productiveStatePresentation.mjs';
export default function ProductiveStateLabel({unit,details=false}){
 return <span style={{display:'inline-flex',flexDirection:'column',maxWidth:'100%',whiteSpace:'normal',overflowWrap:'anywhere'}}>
  <span>{stateLabel(unit)}</span>
  {unit?.state?.conflict&&<small style={{color:'#64748b',lineHeight:1.4}}>{conflictMessage}</small>}
  {details&&observedLabel(unit)&&<small>{observedLabel(unit)}</small>}
 </span>;
}
