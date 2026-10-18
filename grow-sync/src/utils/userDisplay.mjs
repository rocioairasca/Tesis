const text=value=>typeof value==='string'?value.trim():'';
export const userDisplayName=user=>text(user?.full_name)||text(user?.email)||'Usuario';
export function userInitials(user){
 const name=text(user?.full_name);
 if(!name)return ([...text(user?.email)][0]||'U').toLocaleUpperCase('es');
 const words=name.split(/\s+/),first=[...words[0]][0],last=words.length>1?[...words.at(-1)][0]:'';
 return (first+last).toLocaleUpperCase('es');
}
export const userOptions=users=>users.map(user=>({value:user.id??user._id,label:userDisplayName(user),email:text(user.email)}));
