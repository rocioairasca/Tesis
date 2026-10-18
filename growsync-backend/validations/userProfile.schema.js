const {z}=require('zod');
const profile=z.strictObject({full_name:z.string().trim().min(2,'Ingresá al menos 2 caracteres.').max(100,'El nombre no puede superar los 100 caracteres.').refine(value=>!/[\u0000-\u001f\u007f]/.test(value),'El nombre no puede incluir caracteres de control.')});
function validateProfile(req,res,next){
 if(Object.keys(req.query||{}).length)return res.status(400).json({message:'El perfil propio no acepta parámetros de consulta.'});
 if(req.method==='GET'){
  if(req.body&&Object.keys(req.body).length)return res.status(400).json({message:'La consulta del perfil no acepta datos en el cuerpo.'});
  return next();
 }
 const result=profile.safeParse(req.body);
 if(!result.success){
  const extra=result.error.issues.some(issue=>issue.code==='unrecognized_keys');
  return res.status(400).json({message:extra?'Solo podés modificar Nombre y apellido desde tu perfil.':'Ingresá Nombre y apellido: entre 2 y 100 caracteres, sin caracteres de control.'});
 }
 req.body=result.data;next();
}
module.exports={profile,validateProfile};
