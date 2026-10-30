import {config} from '../config';
import {AsyncLocalStorage} from 'node:async_hooks';
type Context = {environment:'sandbox'|'production';client?:{clientKey:string;clientSecret:string;redirectUri:string};targetUsername?:string};
const context=new AsyncLocalStorage<Context>();
export const runTikTokContext=<T>(value:Context,fn:()=>T)=>context.run(value,fn);
export const tikTokSandboxUsername=()=>context.getStore()?.targetUsername;
export const tikTokEnvironment = () => context.getStore()?.environment || (process.env.TIKTOK_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production');
export const tikTokConnectionKey = (uid: string) => tikTokEnvironment() === 'sandbox' ? `${uid}-tiktok-sandbox` : uid;
export function tikTokClient() {
  const current=context.getStore()?.client;if(current)return current;
  return tikTokEnvironment() === 'sandbox' ? {
    clientKey: process.env.TIKTOK_SANDBOX_CLIENT_KEY || '', clientSecret: process.env.TIKTOK_SANDBOX_CLIENT_SECRET || '',
    redirectUri: process.env.TIKTOK_SANDBOX_REDIRECT_URI || '',
  } : config.tiktok;
}
