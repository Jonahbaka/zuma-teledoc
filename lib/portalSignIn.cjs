'use strict';
// A caller may resume a page only within the selected authenticated portal.
function portalReturnPath(value,portal) {
  if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||/[\\\u0000-\u001f\u007f]/.test(value))return null;
  try{
    const url=new URL(value,'https://doctarx.invalid');const decoded=decodeURIComponent(url.pathname);
    if(url.origin!=='https://doctarx.invalid'||/[\\\u0000-\u001f\u007f]/.test(decoded)||!url.pathname.startsWith(portal+'/')||!decoded.startsWith(portal+'/')||decoded.includes('/../')||decoded.includes('/./'))return null;
    return url.pathname+url.search+url.hash;
  }catch{return null;}
}
module.exports={portalReturnPath};
