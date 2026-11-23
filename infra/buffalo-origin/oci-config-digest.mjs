/**
 * Extract and SHA-256 verify the IMAGE CONFIG bytes from a Docker save tar.
 * A Docker image ID can denote a manifest on some image stores and is NOT
 * a trustworthy alias for the OCI config digest. This helper does not build,
 * push, pull, deploy, or execute a container.
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const DIG=/^[a-f0-9]{64}$/;
const configPathOK=/^(?:[a-f0-9]{64}\.json|blobs\/sha256\/[a-f0-9]{64})$/;
export function dockerArchiveConfigDigest(archive){
 if(typeof archive!=='string'||archive.length===0)throw Error('ARCHIVE_PATH_MISSING');
 const manifest=JSON.parse(execFileSync('tar',['-xOf',archive,'manifest.json'],{maxBuffer:1024*1024}).toString('utf8'));
 if(!Array.isArray(manifest)||manifest.length!==1||typeof manifest[0]?.Config!=='string')
  throw Error('IMAGE_ARCHIVE_MANIFEST_INVALID');
 const path=manifest[0].Config;
 if(!configPathOK.test(path))throw Error('IMAGE_CONFIG_PATH_UNSAFE');
 const config=execFileSync('tar',['-xOf',archive,path],{maxBuffer:1024*1024});
 const hash=createHash('sha256').update(config).digest('hex');
 if(!DIG.test(hash)||!path.includes(hash))throw Error('IMAGE_CONFIG_HASH_MISMATCH');
 const parsed=JSON.parse(config.toString('utf8'));
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
  throw Error('IMAGE_CONFIG_NOT_JSON');
 return 'sha256:'+hash;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.argv.length!==3)throw Error('IMAGE_ARCHIVE_ARGUMENTS_INVALID');
  process.stdout.write(dockerArchiveConfigDigest(process.argv[2])+'\n');
 }catch(e){
  console.error('OCI_CONFIG_DIGEST_BLOCKED: '+e.message);
  process.exitCode=1;
 }
}
