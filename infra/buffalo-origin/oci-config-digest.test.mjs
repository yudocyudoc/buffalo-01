import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dockerArchiveConfigDigest} from './oci-config-digest.mjs';

function withArchive(configText,mutate,callback){
 const dir=mkdtempSync(join(tmpdir(),'buffalo-oci-config-'));
 try{
  const sha=createHash('sha256').update(configText).digest('hex');
  writeFileSync(join(dir,sha+'.json'),configText);
  const spec={Config:sha+'.json',RepoTags:['buffalo:test'],Layers:[]};
  mutate?.(spec,dir);
  writeFileSync(join(dir,'manifest.json'),JSON.stringify([spec]));
  const tar=join(dir,'image.tar');
  execFileSync('tar',['-cf',tar,'-C',dir,'manifest.json',sha+'.json']);
  callback(tar,sha);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('config digest is hashed from actual config bytes, not manifest/image ID',()=>{
 withArchive('{"architecture":"amd64","os":"linux"}',null,(archive,sha)=>{
  assert.equal(dockerArchiveConfigDigest(archive),'sha256:'+sha);
  assert.notEqual(sha,createHash('sha256').update('[{"Config":"'+sha+'.json"}]').digest('hex'));
 });
});
test('manifest cannot select arbitrary files or claim unrelated config digest',()=>{
 withArchive('{"architecture":"amd64"}',spec=>{
  spec.Config='../outside-secret';
 },archive=>assert.throws(()=>dockerArchiveConfigDigest(archive),/IMAGE_CONFIG_PATH_UNSAFE/));
 withArchive('{"architecture":"amd64"}',spec=>{
  spec.Config='0'.repeat(64)+'.json';
 },archive=>assert.throws(()=>dockerArchiveConfigDigest(archive)));
});
