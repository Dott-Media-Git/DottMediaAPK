// Run only in the authorised deployment workflow. Never print credentials.
import admin from 'firebase-admin';
const settings=JSON.parse(process.env.DOTTI_TIKTOK_SANDBOX_CONFIG||'{}');
const service=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'{}');
if(service.project_id!=='dottmediaapk')throw new Error('Unexpected Firebase project');
for(const key of ['clientKey','clientSecret','reviewEmail','reviewPassword','targetUsername'])if(!settings[key])throw new Error('Missing sandbox setting: '+key);
const app=admin.initializeApp({credential:admin.credential.cert(service),projectId:'dottmediaapk'});
const auth=app.auth(), db=app.firestore();
let user;
try{user=await auth.getUserByEmail(settings.reviewEmail);if(!user.customClaims?.dottiTikTokReview)throw new Error('Refusing to modify an unrelated account');}
catch(e){if(e.code!=='auth/user-not-found')throw e;
 user=await auth.createUser({email:settings.reviewEmail,password:settings.reviewPassword,emailVerified:true,displayName:'Dotti TikTok Sandbox Review'});
 await auth.setCustomUserClaims(user.uid,{dottiTikTokReview:true});
}
const identity={uid:user.uid,name:'Dotti TikTok Sandbox Review',email:settings.reviewEmail,emailVerified:true};
await db.collection('profiles').doc(user.uid).set({user:identity,subscriptionStatus:'active',onboardingComplete:true,
 crmData:{companyName:'Dotti Sandbox Review',email:settings.reviewEmail,phone:'',crmPrompt:'Sandbox review only',isActive:false,
 analytics:{leads:0,engagement:0,conversions:0,feedbackScore:0}}},{merge:true});
await db.collection('users').doc(user.uid).set({...identity,isSandboxReview:true},{merge:true});
await db.collection('tiktokSandboxConfig').doc('dotti-review').set({enabled:true,allowedUserIds:[user.uid],
 clientKey:settings.clientKey,clientSecret:settings.clientSecret,targetUsername:settings.targetUsername,
 redirectUri:'https://dottmediaapk.onrender.com/integrations/tiktok/callback',updatedAt:admin.firestore.FieldValue.serverTimestamp()});
console.log('Dotti sandbox configuration and isolated review account are ready. No emails or posts sent.');
await app.delete();
