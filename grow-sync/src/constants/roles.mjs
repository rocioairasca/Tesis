export const ROLE_OPTIONS=[
 {value:0,label:'Empleado'}, {value:1,label:'Supervisor'},
 {value:2,label:'Dueño'}, {value:3,label:'Administrador'},
];
export const roleLabel=role=>ROLE_OPTIONS.find(option=>String(option.value)===String(role))?.label||'No informado';
