import React,{createContext,useCallback,useContext,useState} from 'react';
const Context=createContext();
export const useNotifications=()=>useContext(Context);
export function FixtureNotifications({children}){
  const [notifications,setNotifications]=useState([{id:'notification',type:'planning_assigned',priority:'low',title:'Nueva tarea asignada',
    message:'Juan Pérez te asignó “Fumigación lote T4 y revisión de sectores con un título extenso para comprobar el espacio” para el 21/10/2026.',
    data:{planning_id:'11111111-1111-4111-8111-111111111111'},read:false,created_at:new Date().toISOString()}]);
  const fetchNotifications=useCallback(async()=>{},[]);
  const markAsRead=async id=>{
    window.__events.push('read-start');
    await new Promise(resolve=>setTimeout(resolve,100));
    window.__events.push('read-finished');
    setNotifications(rows=>rows.map(row=>row.id===id?{...row,read:true}:row));
  };
  return <Context.Provider value={{notifications,unreadCount:notifications.filter(n=>!n.read).length,loading:false,fetchNotifications,markAsRead,markAllAsRead:async()=>{}}}>{children}</Context.Provider>;
}
