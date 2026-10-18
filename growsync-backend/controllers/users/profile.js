const {ownProfile}=require('../../services/userProfile');
module.exports=client=>async(req,res,next)=>{
 try{res.set('Cache-Control','no-store');res.json(await ownProfile(client,req.user,req.method==='PATCH'?req.body:undefined));}
 catch(error){next(error);}
};
