import React, { createContext, useCallback, useContext, useState } from 'react';
const Context=createContext();
export const useNotifications=()=>useContext(Context);
export function FixtureNotifications({children}){
 const [notifications,setNotifications]=useState([
  {id:'one',type:'low_stock',title:'Stock bajo',priority:'medium',message:'Bogard tiene bajo stock: 1.000000 L',read:false,created_at:new Date(Date.now()-86400000*4).toISOString()},
  {id:'two',type:'low_stock',title:'Stock bajo',priority:'high',message:'Metsulfuron tiene bajo stock: 0.800000 L',read:false,created_at:new Date().toISOString()},
  {id:'three',type:'low_stock',title:'Stock bajo',priority:'low',message:'Metsulfuron con un nombre largo para comprobar el espacio disponible tiene bajo stock: 0.015000 g',read:true,created_at:new Date().toISOString()},
 ]);
 const fetchNotifications=useCallback(async()=>{},[]);
 const markAsRead=async id=>{window.__marked.push(id);setNotifications(rows=>rows.map(row=>row.id===id?{...row,read:true}:row));};
 return <Context.Provider value={{notifications,loading:false,fetchNotifications,markAsRead,markAllAsRead:async()=>setNotifications(rows=>rows.map(row=>({...row,read:true})))}}>{children}</Context.Provider>;
}
