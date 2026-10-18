const columns='id,full_name,email,role,enabled,company_id,companies(name)';
async function ownProfile(client,actor,changes){
 if(!actor?.id||!actor.company_id)throw Object.assign(new Error('No pudimos identificar tu perfil.'),{status:403});
 let query=client.from('users');
 if(changes)query=query.update({full_name:changes.full_name});
 const {data,error}=await query.select(columns).eq('id',actor.id).eq('company_id',actor.company_id).eq('enabled',true).maybeSingle();
 if(error)throw error;
 if(!data)throw Object.assign(new Error('Tu perfil no está disponible.'),{status:403});
 return {id:data.id,full_name:data.full_name,email:data.email,role:data.role,enabled:data.enabled,company_id:data.company_id,company_name:data.companies?.name||null};
}
module.exports={ownProfile};
