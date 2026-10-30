import React, {useEffect, useRef, useState} from 'react';
import {fetchTikTokCreator, fetchTikTokReviewedPost, submitTikTokReviewedVideo, type TikTokCreatorReview} from '@services/tiktokIntegration';
type Props = {visible: boolean; onClose: () => void; orgId?: string};
const panel: React.CSSProperties = {background:'#111529',border:'1px solid #303653',borderRadius:18,padding:22,marginTop:16};
const field: React.CSSProperties = {display:'block',width:'100%',boxSizing:'border-box',padding:13,marginTop:8,borderRadius:10,border:'1px solid #4c5474',background:'#080c1d',color:'#f5f6ff',font:'inherit'};
const button: React.CSSProperties = {padding:'13px 19px',borderRadius:12,border:'1px solid #6f57cb',background:'#7450db',color:'white',font:'inherit',fontWeight:700,cursor:'pointer'};
const privacyNames: Record<string,string> = {SELF_ONLY:'Only me',PUBLIC_TO_EVERYONE:'Everyone',MUTUAL_FOLLOW_FRIENDS:'Friends',FOLLOWER_OF_CREATOR:'Followers'};
export default function TikTokPostComposer({visible,onClose,orgId}:Props) {
  const [creator,setCreator]=useState<TikTokCreatorReview|null>(null),[generation,setGeneration]=useState(0),[loading,setLoading]=useState(true);
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(''),[duration,setDuration]=useState(0),[caption,setCaption]=useState(''),[privacy,setPrivacy]=useState('');
  const [comment,setComment]=useState(false),[duet,setDuet]=useState(false),[stitch,setStitch]=useState(false);
  const [commercial,setCommercial]=useState(false),[ownBrand,setOwnBrand]=useState(false),[branded,setBranded]=useState(false),[aigc,setAigc]=useState(false);
  const [music,setMusic]=useState(false),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [job,setJob]=useState(''),[status,setStatus]=useState(''),[statusError,setStatusError]=useState('');
  const requestId=useRef('');
  const dirty=()=>{setMusic(false);setConsent(false);};
  useEffect(()=>{if(!visible)return;let active=true;setLoading(true);setError('');setPrivacy('');setComment(false);setDuet(false);setStitch(false);dirty();
    fetchTikTokCreator(orgId).then(c=>{if(active)setCreator(c)}).catch(e=>{if(active){setCreator(null);setError(e.message||'Unable to load TikTok creator')}}).finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};},[visible,orgId,generation]);
  useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  useEffect(()=>{if(!job||!visible)return;let active=true,working=false,finished=false;
    const poll=async()=>{if(working||finished)return;working=true;try{const r=await fetchTikTokReviewedPost(job,orgId);if(active){setStatus(r.status);setStatusError(r.fail_reason||r.message||'');if(['PUBLISH_COMPLETE','FAILED','REQUIRES_CHECK'].includes(r.status))finished=true;}}catch(e:any){if(active)setStatusError(e.message||'Unable to check TikTok status')}finally{working=false}};
    void poll();const timer=setInterval(()=>void poll(),7000);return()=>{active=false;clearInterval(timer)};},[job,visible,orgId]);
  if(!visible)return null;
  const c=creator?.creator;
  const valid=!!(file&&duration>0&&c&&duration<=c.max_video_post_duration_sec&&privacy&&music&&consent&&(!commercial||ownBrand||branded)&&!(branded&&privacy==='SELF_ONLY'));
  async function post(e:React.FormEvent){e.preventDefault();if(!valid||!file||!creator||busy||job)return;setBusy(true);setError('');
    if(!requestId.current)requestId.current=crypto.randomUUID();
    try{const r=await submitTikTokReviewedVideo(file,caption,{privacyLevel:privacy,allowComment:comment,allowDuet:duet,allowStitch:stitch,commercial,ownBrand,brandedContent:branded,musicConsent:music,explicitConsent:consent,reviewedOpenId:creator.openId,aiGenerated:aigc},requestId.current,orgId);setJob(r.jobId);setStatus(r.status);setStatusError(r.message||'');}
    catch(e:any){setError((e.message||'Submission could not be confirmed')+' If the request timed out, retrying this submission checks the same request rather than creating another post.');}finally{setBusy(false)}
  }
  function newReview(){setJob('');setStatus('');setStatusError('');setError('');setFile(null);setDuration(0);setCaption('');setCommercial(false);setOwnBrand(false);setBranded(false);setAigc(false);requestId.current='';setGeneration(x=>x+1);}
  const check=(label:string,value:boolean,change:(v:boolean)=>void,disabled=false)=> <label style={{display:'flex',gap:10,alignItems:'flex-start',margin:'12px 0',opacity:disabled ? .5 : 1}}><input type="checkbox" checked={value} disabled={disabled||busy||!!job} onChange={e=>{change(e.target.checked);dirty();}}/>{label}</label>;
  return <div role="dialog" aria-modal="true" aria-label="Review and post to TikTok" style={{position:'fixed',inset:0,zIndex:10000,overflowY:'auto',background:'rgba(4,5,17,.97)',color:'#f4f6ff',fontFamily:'system-ui,sans-serif',padding:'24px 16px'}}>
    <div style={{maxWidth:930,margin:'0 auto',paddingBottom:40}}><header style={{display:'flex',justifyContent:'space-between',gap:20,alignItems:'center'}}><strong>Dotti <span style={{color:'#b29bff'}}>· TikTok</span></strong><button style={{...button,background:'transparent'}} disabled={busy} onClick={onClose}>Close</button></header>
      <h1 style={{fontSize:34,marginBottom:8}}>Your video. Your choice.</h1><p style={{color:'#b4bddc'}}>Preview your original video and choose exactly how it reaches TikTok.</p>
      {loading?<p role="status">Loading your current TikTok account and posting settings…</p>:<>
      <section style={panel} aria-label="Connected TikTok account"><div style={{display:'flex',alignItems:'center',gap:14}}>{c?.creator_avatar_url&&<img src={c.creator_avatar_url} alt="TikTok creator avatar" width={54} height={54} style={{borderRadius:'50%'}}/>}<div><strong>{c?.creator_nickname||c?.creator_username||'TikTok account unavailable'}</strong><div style={{color:'#b4bddc',marginTop:4}}>{c?.creator_username?'@'+c.creator_username:''}</div></div><span style={{marginLeft:'auto',color:'#d5c8ff'}}>{creator?.environment==='sandbox'?'SANDBOX TEST':'CONNECTED ACCOUNT'}</span></div><button type="button" style={{...button,marginTop:15,background:'transparent'}} disabled={busy||!!job} onClick={()=>setGeneration(x=>x+1)}>Refresh account settings</button>{creator?.environment==='sandbox'&&<p style={{color:'#b4bddc'}}>Sandbox content is for testing. Public posting is unavailable before TikTok approval.</p>}</section>
      <form onSubmit={post}>
        <fieldset disabled={busy||!!job} style={{border:0,padding:0,margin:0,minWidth:0}}>
        <section style={panel}><h2>1. Choose and preview</h2><label>Original video · MP4, up to 80 MB<input style={field} type="file" accept="video/mp4" onChange={e=>{const f=e.target.files?.[0];setError('');dirty();setDuration(0);requestId.current='';if(f&&(f.type!=='video/mp4'||f.size>80*1024*1024)){setError('Choose an MP4 video smaller than 80 MB.');setFile(null);return;}setFile(f||null);}}/></label>
          {preview&&<video key={preview} aria-label="Video preview" src={preview} controls playsInline preload="metadata" style={{width:'100%',maxHeight:360,marginTop:18,background:'#000',borderRadius:12}} onLoadedMetadata={e=>setDuration(e.currentTarget.duration)} onError={()=>{setDuration(0);setError('This video cannot be previewed. Choose another MP4.')}}/>}
          {c&&<p style={{color:'#b4bddc'}}>Account video limit: {c.max_video_post_duration_sec} seconds.{duration>0?' Selected: '+Math.round(duration)+' seconds.':''}</p>}
          {c&&duration>c.max_video_post_duration_sec&&<p role="alert" style={{color:'#ffaab6'}}>This video exceeds the account’s duration limit.</p>}
          <label>Caption<textarea style={{...field,minHeight:95}} maxLength={2200} value={caption} onChange={e=>{setCaption(e.target.value);dirty();}} placeholder="Write your caption and hashtags"/></label><small>{caption.length}/2200</small>
        </section>
        <section style={panel}><h2>2. Choose who can see and interact</h2><label>Who can watch this video?<select required style={field} value={privacy} onChange={e=>{setPrivacy(e.target.value);dirty();}}><option value="" disabled>Choose visibility</option>{c?.privacy_level_options?.map(p=><option key={p} value={p} disabled={branded&&p==='SELF_ONLY'}>{privacyNames[p]||p}</option>)}</select></label>
          {check('Allow comments',comment,setComment,!!c?.comment_disabled)}{check('Allow Duet',duet,setDuet,!!c?.duet_disabled)}{check('Allow Stitch',stitch,setStitch,!!c?.stitch_disabled)}<p style={{color:'#b4bddc'}}>Unavailable interactions are disabled by the creator’s TikTok settings. Nothing is enabled automatically.</p>
        </section>
        <section style={panel}><h2>3. Content disclosures</h2>{check('This video promotes a brand, product or service',commercial,v=>{setCommercial(v);if(!v){setOwnBrand(false);setBranded(false)}})}
          {commercial&&<div style={{borderLeft:'3px solid #9073f5',paddingLeft:18}}>{check('Your brand — promoting your own business',ownBrand,setOwnBrand)}{check('Branded content — promoting another brand / paid partnership',branded,setBranded,privacy==='SELF_ONLY')}
            {privacy==='SELF_ONLY'&&<p>Branded content cannot be private. Choose another available visibility to enable it.</p>}
            {!(ownBrand||branded)&&<p>Select at least one brand disclosure before posting.</p>}
            {(ownBrand||branded)&&<p>This video will be labelled “{branded?'Paid partnership':'Promotional content'}”.</p>}
          </div>}{check('AI-generated content: this video contains realistic AI-generated imagery, audio or video',aigc,setAigc)}
        </section>
        <section style={panel}><h2>4. Confirm before uploading</h2><label style={{display:'block',margin:'14px 0'}}><input type="checkbox" checked={music} onChange={e=>setMusic(e.target.checked)}/> By posting, you agree to TikTok’s {branded&&<><a style={{color:'#c7b6ff'}} target="_blank" rel="noreferrer" href="https://www.tiktok.com/legal/page/global/bc-policy/en">Branded Content Policy</a> and </>}<a style={{color:'#c7b6ff'}} target="_blank" rel="noreferrer" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en">Music Usage Confirmation</a>.</label>
          <label style={{display:'block',margin:'14px 0'}}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> I reviewed the video, account, caption and settings, and authorise Dotti to upload and post this video to this TikTok account.</label>
          <p style={{color:'#b4bddc'}}>No video is sent to TikTok until you confirm and press the button. Processing and profile visibility can take a few minutes.</p>
          <button style={{...button,opacity:valid&&!busy&&!job?1:.45}} disabled={!valid||busy||!!job}>{busy?'Submitting to TikTok…':'Confirm & post to TikTok'}</button>
        </section></fieldset>
      </form></>}
      {error&&<p role="alert" style={{...panel,color:'#ffc0cc'}}>{error}</p>}
      {job&&<section role="status" style={panel}><h2>{status==='PUBLISH_COMPLETE'?'TikTok confirmed publication':status==='FAILED'?'TikTok could not publish this video':'TikTok submission status'}</h2><p>{status?.replaceAll('_',' ')}</p>{statusError&&<p>{statusError}</p>}<p>Keep this page open to check progress. Do not submit the same video again while its status is uncertain.</p>{['PUBLISH_COMPLETE','FAILED'].includes(status)&&<button style={button} onClick={newReview}>Create another post</button>}</section>}
    </div>
  </div>;
}
