import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import {mp4Duration, reviewedPostInfo, publishReviewedTikTok, type TikTokCreator, type TikTokReview} from '../services/tiktokReviewedPublisher';
import {publishToTikTok} from '../packages/services/socialPlatforms/tiktokPublisher';

const creator: TikTokCreator = {creator_nickname:'Test creator', privacy_level_options:['SELF_ONLY','PUBLIC_TO_EVERYONE'], max_video_post_duration_sec:60, stitch_disabled:true};
const review: TikTokReview = {privacyLevel:'SELF_ONLY',allowComment:false,allowDuet:false,allowStitch:false,commercial:false,ownBrand:false,brandedContent:false,musicConsent:true,explicitConsent:true,reviewedOpenId:'test-account',aiGenerated:false};
function movie(seconds=8, version=0) {
  const payload=Buffer.alloc(version?112:100);payload[0]=version;
  payload.writeUInt32BE(1000,version?20:12);
  if(version)payload.writeBigUInt64BE(BigInt(seconds*1000),24);else payload.writeUInt32BE(seconds*1000,16);
  const box=(name:string,data:Buffer)=>{const b=Buffer.alloc(8+data.length);b.writeUInt32BE(b.length);b.write(name,4);data.copy(b,8);return b;};
  return box('moov',box('mvhd',payload));
}
test('server checks MP4 duration and rejects damaged movie headers',()=>{
  assert.equal(mp4Duration(movie()),8);assert.equal(mp4Duration(movie(12,1)),12);
  assert.throws(()=>mp4Duration(Buffer.from('not a movie')));assert.throws(()=>mp4Duration(movie().subarray(0,20)));
});
test('posting requires explicit consent, selected privacy, the reviewed account and allowed duration',()=>{
  const info=reviewedPostInfo(creator,review,'test-account',8,'My original caption');
  assert.equal(info.title,'My original caption');assert.equal(info.privacy_level,'SELF_ONLY');
  assert.equal(info.disable_comment,true);assert.equal(info.disable_duet,true);assert.equal(info.disable_stitch,true);
  for(const change of [{explicitConsent:false},{musicConsent:false},{privacyLevel:''},{privacyLevel:'NOT_AVAILABLE'},{reviewedOpenId:'other-account'},{allowStitch:true},{commercial:true}]) {
    assert.throws(()=>reviewedPostInfo(creator,{...review,...change},'test-account',8,''));
  }
  assert.throws(()=>reviewedPostInfo(creator,review,'test-account',61,''));
});
test('commercial disclosures cannot silently bypass visibility or consent rules',()=>{
  assert.throws(()=>reviewedPostInfo(creator,{...review,commercial:true,brandedContent:true},'test-account',8,''));
  assert.throws(()=>reviewedPostInfo(creator,{...review,ownBrand:true},'test-account',8,''));
  const paid=reviewedPostInfo(creator,{...review,privacyLevel:'PUBLIC_TO_EVERYONE',commercial:true,brandedContent:true},'test-account',8,'');
  assert.equal(paid.brand_content_toggle,true);assert.equal(paid.brand_organic_toggle,false);
  const own=reviewedPostInfo(creator,{...review,commercial:true,ownBrand:true,aiGenerated:true},'test-account',8,'');
  assert.equal(own.brand_organic_toggle,true);assert.equal(own.is_aigc,true);
});
test('background automation cannot publish without a creator review',async()=>{
  await assert.rejects(()=>publishToTikTok({caption:'Automatic post',videoUrl:'https://example.com/video.mp4'}),/creator review/);
});
test('reviewed upload queries current creator rules, submits the chosen settings and transfers the file only after consent',async()=>{
  const post=axios.post, put=axios.put;const calls: Array<{url:string;body:any}>=[];
  try {
    axios.post=(async(url:string,body:any)=>{calls.push({url,body});return {data:{error:{code:'ok'},data:url.includes('creator_info')?creator:{publish_id:'test-publish',upload_url:'https://open-upload.tiktokapis.com/test'}}};}) as any;
    axios.put=(async(url:string,body:any)=>{calls.push({url,body});return {status:201};}) as any;
    await assert.rejects(()=>publishReviewedTikTok('test-token','test-account',movie(),'',{...review,explicitConsent:false}),/consent/);
    assert.equal(calls.length,1); // Metadata lookup is permitted; no post init or media upload occurred.
    calls.length=0;
    const result=await publishReviewedTikTok('test-token','test-account',movie(),'Edited caption',review);
    assert.equal(result.publishId,'test-publish');assert.equal(calls.length,3);
    assert.match(calls[0].url,/creator_info/);assert.equal(calls[1].body.post_info.title,'Edited caption');
    assert.equal(calls[1].body.post_info.privacy_level,'SELF_ONLY');assert.equal(calls[1].body.source_info.source,'FILE_UPLOAD');
    assert.equal(calls[2].body.length,movie().length);
  } finally {axios.post=post;axios.put=put;}
});
test('a posting ban returned by TikTok stops the operation before upload',async()=>{
  const post=axios.post;let attempts=0;
  try {axios.post=(async()=>{attempts++;return {data:{error:{code:'spam_risk_too_many_posts',message:'Try again later'}}};}) as any;
    await assert.rejects(()=>publishReviewedTikTok('test-token','test-account',movie(),'',review),/Try again later/);assert.equal(attempts,1);
  }finally{axios.post=post;}
});
