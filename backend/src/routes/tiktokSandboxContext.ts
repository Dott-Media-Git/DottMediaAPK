import type {Router} from 'express';
import createHttpError from 'http-errors';
import {firestore} from '../db/firestore';
import {requireFirebaseStrict,type AuthedRequest} from '../middleware/firebaseAuth';
import {verifySignedState} from '../utils/oauthState';
import {runTikTokContext} from '../services/tiktokReviewConfig';
export function mountTikTokSandboxContext(router:Router){
 router.use('/integrations/tiktok',async(req,res,next)=>{
  try{
   const callback=req.path==='/callback';
   const state=callback&&typeof req.query.state==='string'?verifySignedState(req.query.state):null;
   const sandbox=state?.environment==='sandbox'||req.query.environment==='sandbox';
   if(!sandbox)return next();
   const enter=async()=>{
    const uid=callback?state?.userId:(req as AuthedRequest).authUser?.uid;
    if(!uid||callback&&state?.platform!=='tiktok')return next(createHttpError(401,'Invalid sandbox session'));
    let settings;
    try {settings=(await firestore.collection('tiktokSandboxConfig').doc('dotti-review').get()).data();}
    catch(error){
     const code=String((error as {code?:unknown})?.code||'unknown');
     console.error('[tiktok-sandbox] Configuration read failed',{code});
     return next(createHttpError(503,'Sandbox storage is temporarily unavailable (database code '+code+').'));
    }
    if(!settings?.enabled||!Array.isArray(settings.allowedUserIds)||!settings.allowedUserIds.includes(uid))return next(createHttpError(403,'Sandbox access is restricted to the review account'));
    if(!settings.clientKey||!settings.clientSecret||!settings.redirectUri)return next(createHttpError(503,'Sandbox configuration is incomplete'));
    runTikTokContext({environment:'sandbox',client:{clientKey:settings.clientKey,clientSecret:settings.clientSecret,redirectUri:settings.redirectUri},targetUsername:settings.targetUsername},()=>next());
   };
   if(callback)return await enter();
   if(req.path==='/start'&&typeof req.body?.idToken==='string')req.headers.authorization='Bearer '+req.body.idToken;
   return requireFirebaseStrict(req,res,error=>{if(error)return next(error);void enter().catch(next);});
  }catch(e){next(e);}
 });
}
