export const B='/api'   // same-origin on Vercel (rewritten to the backend), so the SameSite=Strict cookie works
export async function api(p,o={}){
  const r=await fetch(B+p,{credentials:'include',...o});let b=null;try{b=await r.json()}catch{}
  if(!r.ok){const d=b&&b.detail;const e=new Error(Array.isArray(d)?'Invalid input':(d||r.statusText));e.status=r.status;throw e}
  return b}
export const J=(method,data)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
