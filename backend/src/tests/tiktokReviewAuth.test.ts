import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

test('TikTok endpoints reject unsigned users and mock authentication, including the form-based OAuth entry', async()=>{
  process.env.ALLOW_MOCK_AUTH='true';
  process.env.ENCRYPTION_KEY=Buffer.alloc(32,1).toString('base64');
  process.env.WIDGET_SHARED_SECRET='test-only-tiktok-oauth-secret-not-a-live-key';
  const {default:router}=await import('../routes/tiktokIntegrationRoutes');
  const app=express();app.use(express.json());app.use(express.urlencoded({extended:false}));app.use(router);
  app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status||500).json({error:err.message}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',()=>resolve()));
  const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
  try {
    for(const path of ['/config','/status','/connect-url','/creator-info','/reviewed-posts/'+'a'.repeat(64)]) {
      assert.equal((await fetch(base+'/integrations/tiktok'+path)).status,401);
      assert.equal((await fetch(base+'/integrations/tiktok'+path,{headers:{Authorization:'Bearer mock-attacker'}})).status,403);
    }
    assert.equal((await fetch(base+'/integrations/tiktok/publish-reviewed',{method:'POST',headers:{Authorization:'Bearer mock-attacker'}})).status,403);
    assert.equal((await fetch(base+'/integrations/tiktok/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:'mock-attacker'})})).status,403);
    const callback=await fetch(base+'/integrations/tiktok/callback?code=test-code&state=forged');assert.equal(callback.status,400);
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('concurrent sandbox requests cannot change the production client or token namespace',async()=>{
 process.env.ALLOW_MOCK_AUTH='true';
 const {runTikTokContext,tikTokEnvironment,tikTokConnectionKey,tikTokClient}=await import('../services/tiktokReviewConfig');
 const tasks=Array.from({length:12},(_,i)=>runTikTokContext({environment:'sandbox',client:{clientKey:'test-'+i,clientSecret:'test-secret-'+i,redirectUri:'https://example.com/callback'}},async()=>{
  await new Promise(r=>setTimeout(r,i%3));assert.equal(tikTokEnvironment(),'sandbox');assert.equal(tikTokConnectionKey('same-user'),'same-user-tiktok-sandbox');assert.equal(tikTokClient().clientKey,'test-'+i);
 }));
 assert.equal(tikTokEnvironment(),'production');assert.equal(tikTokConnectionKey('same-user'),'same-user');
 await Promise.all(tasks);assert.equal(tikTokEnvironment(),'production');
});
