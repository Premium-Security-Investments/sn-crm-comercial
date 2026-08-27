#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { createAgt002RadarPipeline } from '../../agt002-radar-pipeline.js';
import { createSupabaseEsuDirectRefresher } from '../../esu-direct-refresh.js';
import { fetchEsuProcesses } from '../../esu-direct-crawl.js';
const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key){console.error(JSON.stringify({status:'unavailable',code:'AGT002_RADAR_ENTRYPOINT_CONFIG_INVALID'}));process.exitCode=1;}else{
 try{
  const database=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const now=()=>new Date().toISOString();
  const refresher=createSupabaseEsuDirectRefresher({database,now,fetchDirectProcesses:fetchEsuProcesses});
  const pipeline=createAgt002RadarPipeline({database,environment:process.env,now,refreshEsuDirect:()=>refresher.runOnce()});
  const result=await pipeline.runOnce();console.log(JSON.stringify(result));
 }
 catch{console.error(JSON.stringify({status:'unavailable',code:'AGT002_RADAR_ENTRYPOINT_FAILED'}));process.exitCode=1;}
}
