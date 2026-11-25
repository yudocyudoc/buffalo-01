// configure-pages returns "/project" for project sites or "" for root/custom domains.
// Preserve upstream's historical local default when the variable is not supplied.
export function pagesBase(path=process.env.PAGES_BASE_PATH){
  if(path===undefined)return '/sd-ai/';
  if(path===''||path==='/')return '/';
  if(typeof path!=='string'||!/^\/[A-Za-z0-9_.-]+\/?$/.test(path)||['/.','/..','/./','/../'].includes(path))
    throw new Error('Invalid PAGES_BASE_PATH');
  return path.endsWith('/')?path:path+'/';
}
