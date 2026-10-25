import {useState,useEffect} from 'react'
import {api,J,B} from './api'
import {DEMO} from './demo'

const when=t=>new Date(t).toLocaleString()
const Tag=({t,c=''})=><span className={'tag '+c}>{t}</span>

export default function App(){
  const [me,setMe]=useState(undefined),[toast,setToast]=useState(null)
  const say=(m,ok)=>{setToast({m,ok});clearTimeout(say.t);say.t=setTimeout(()=>setToast(null),3600)}
  const load=async()=>{try{setMe(await api('/auth/me'))}catch{setMe(null)}}
  useEffect(()=>{load()},[])
  if(me===undefined)return <div className="boot"><b>Opening the vault…</b><span>Free hosting sleeps when idle; the first request can take up to a minute.</span></div>
  return <>{me?<Shell me={me} say={say} out={()=>setMe(null)}/>:<Login onIn={load} say={say}/>}
    {toast&&<div role="status" className={'toast '+(toast.ok?'good':'bad')}>{toast.m}</div>}</>
}

function Login({onIn,say}){
  const [email,setE]=useState(''),[pw,setP]=useState(''),[show,setS]=useState(false),[busy,setB]=useState('')
  const go=async(e,p,k)=>{setB(k);try{await api('/auth/login',J('POST',{email:e,password:p}));await onIn()}catch(x){say(x.message);setB('')}}
  return <div className="login">
    <section className="keys">
      <h1>TrustVault</h1>
      <p className="lede">A file only opens for the people it was shared with. Every attempt, allowed or refused, is written to a record that shows if it was altered.</p>
      <label className="switch"><input type="checkbox" checked={show} onChange={e=>setS(e.target.checked)}/><i/><span>Show demo passwords</span></label>
      <ul>{DEMO.map(d=><li key={d.role}>
        <button className="key" disabled={!!busy} onClick={()=>go(d.email,d.pw,d.role)}>
          <b>{busy===d.role?'Signing in…':'Enter as '+d.role}</b>
          <em>{d.does}</em>
          <code>{d.email}</code>
          <code className={show?'':'masked'}>{show?d.pw:'••••••••••••'}</code>
        </button></li>)}</ul>
      <p className="fine">Throwaway accounts for evaluation. Uploaded files are lost when the free server restarts.</p>
    </section>
    <form className="signin" onSubmit={e=>{e.preventDefault();go(email,pw,'form')}}>
      <h2>Sign in</h2>
      <label>Email<input value={email} onChange={e=>setE(e.target.value)} autoComplete="username"/></label>
      <label>Password<input type="password" value={pw} onChange={e=>setP(e.target.value)} autoComplete="current-password"/></label>
      <button className="primary" disabled={!!busy}>{busy==='form'?'Signing in…':'Sign in'}</button>
      <p className="fine">Accounts are created by an administrator. There is no public sign-up.</p>
    </form></div>
}

function Shell({me,say,out}){
  const tabs=[['docs','Documents'],...(me.role==='admin'?[['audit','Audit trail'],['users','People']]:[])]
  const [tab,setTab]=useState('docs')
  const logout=async()=>{try{await api('/auth/logout',{method:'POST'})}catch{}out()}
  return <div className="shell">
    <aside><div className="logo">TrustVault</div>
      <nav>{tabs.map(([k,l])=><button key={k} className={tab===k?'on':''} onClick={()=>setTab(k)}>{l}</button>)}</nav>
      <div className="me"><b>{me.email}</b><Tag t={me.role} c="role"/><button className="ghost" onClick={logout}>Sign out</button></div></aside>
    <main>{tab==='docs'&&<Docs me={me} say={say}/>}{tab==='audit'&&<Audit say={say}/>}{tab==='users'&&<Users me={me} say={say}/>}</main></div>
}

function Docs({me,say}){
  const [rows,setRows]=useState(null),[f,setF]=useState({q:'',owner:'',category:'',from:'',to:''}),[sel,setSel]=useState(null),[file,setFile]=useState(null),[cat,setCat]=useState('general')
  const load=async()=>{const p=new URLSearchParams()
    if(f.q)p.set('q',f.q);if(f.owner)p.set('owner',f.owner);if(f.category)p.set('category',f.category)
    if(f.from)p.set('date_from',f.from+'T00:00:00Z');if(f.to)p.set('date_to',f.to+'T23:59:59Z')
    try{setRows(await api('/documents?'+p))}catch(e){say(e.message)}}
  useEffect(()=>{load()},[])
  const dl=async d=>{const r=await fetch(B+`/documents/${d.id}/download`,{credentials:'include'})
    if(!r.ok)return say('Refused: you do not have access. This attempt was recorded.')
    const u=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=u;a.download=d.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
  const up=async()=>{if(!file)return say('Choose a file first.');const fd=new FormData();fd.append('file',file);fd.append('category',cat)
    try{await api('/documents',{method:'POST',body:fd});say('Uploaded.',1);setFile(null);load()}catch(e){say(e.message)}}
  const set=k=>e=>setF({...f,[k]:e.target.value})
  return <>
    <h2>Documents</h2>
    {me.role==='owner'&&<div className="bar"><input type="file" onChange={e=>setFile(e.target.files[0])}/><input value={cat} onChange={e=>setCat(e.target.value)} placeholder="Category"/><button className="primary" onClick={up}>Upload</button><small>PDF, PNG, JPG or TXT, up to 5 MB. Type is checked from the bytes.</small></div>}
    <div className="bar"><input placeholder="Name contains" value={f.q} onChange={set('q')}/><input placeholder="Owner email" value={f.owner} onChange={set('owner')}/><input placeholder="Category" value={f.category} onChange={set('category')}/><input type="date" value={f.from} onChange={set('from')}/><input type="date" value={f.to} onChange={set('to')}/><button onClick={load}>Search</button></div>
    <div className="scroll"><table><thead><tr><th>Name</th><th>Owner</th><th>Category</th><th>Added</th><th>Your access</th><th/></tr></thead><tbody>
      {rows===null?<tr><td colSpan="6" className="empty">Loading…</td></tr>:rows.length===0?<tr><td colSpan="6" className="empty">{me.role==='owner'?'No documents match. Upload one above.':'Nothing shared with you yet. Ask an owner to grant you access.'}</td></tr>:
      rows.map(d=><tr key={d.id}><td>{d.name}</td><td>{d.owner}</td><td>{d.category}</td><td>{when(d.created_at)}</td><td><Tag t={d.access} c={d.access==='owner'?'ok':''}/></td>
        <td className="act"><button onClick={()=>dl(d)}>Download</button><button className="ghost" onClick={()=>setSel(d)}>Details</button></td></tr>)}
    </tbody></table></div>
    {sel&&<Detail d={sel} say={say} close={()=>setSel(null)} reload={load}/>}</>
}

function Detail({d,say,close,reload}){
  const owner=d.access==='owner',canEdit=owner||d.access==='edit'
  const [name,setN]=useState(d.name),[cat,setC]=useState(d.category),[em,setEm]=useState(''),[pm,setPm]=useState('read'),[gr,setGr]=useState([])
  const grants=async()=>{if(!owner)return;try{setGr(await api(`/documents/${d.id}/grants`))}catch(e){say(e.message)}}
  useEffect(()=>{grants()},[])
  const run=async(fn,ok,after)=>{try{await fn();say(ok,1);after&&after()}catch(e){say(e.message)}}
  return <div className="veil" onClick={close}><div className="sheet" role="dialog" onClick={e=>e.stopPropagation()}>
    <h3>{d.name}</h3><p className="mute">Owner {d.owner} · {(d.size/1024).toFixed(1)} KB · your access: {d.access}</p>
    {canEdit&&<><h4>Edit details</h4><div className="bar"><input value={name} onChange={e=>setN(e.target.value)}/><input value={cat} onChange={e=>setC(e.target.value)}/>
      <button className="primary" onClick={()=>run(()=>api(`/documents/${d.id}`,J('PATCH',{name,category:cat})),'Saved.',()=>{reload();close()})}>Save changes</button></div></>}
    {owner&&<><h4>Share</h4><div className="bar"><input placeholder="Person's email" value={em} onChange={e=>setEm(e.target.value)}/>
      <select value={pm} onChange={e=>setPm(e.target.value)}><option>read</option><option>edit</option></select>
      <button className="primary" onClick={()=>run(()=>api(`/documents/${d.id}/grants`,J('POST',{email:em,permission:pm})),'Access granted.',()=>{setEm('');grants()})}>Grant access</button></div>
      <h4>Who can open this</h4>{gr.length===0?<p className="mute">Only you.</p>:gr.map(g=><div className="grant" key={g.user_id}><span>{g.email} <Tag t={g.permission}/></span>
        <button className="danger" onClick={()=>run(()=>api(`/documents/${d.id}/grants/${g.user_id}`,{method:'DELETE'}),'Access revoked. It applies on their next request.',grants)}>Revoke</button></div>)}</>}
    <div className="foot">{owner?<button className="danger" onClick={()=>confirm('Delete this document for everyone?')&&run(()=>api(`/documents/${d.id}`,{method:'DELETE'}),'Deleted.',()=>{reload();close()})}>Delete document</button>:<span/>}<button className="ghost" onClick={close}>Close</button></div>
  </div></div>
}

function Audit({say}){
  const [rows,setRows]=useState([]),[a,setA]=useState(''),[o,setO]=useState(''),[doc,setD]=useState(''),[v,setV]=useState(null)
  const load=async()=>{const p=new URLSearchParams({limit:'200'});if(a)p.set('action',a);if(o)p.set('outcome',o);if(doc.trim())p.set('document_id',doc.trim())
    try{setRows(await api('/admin/audit?'+p))}catch(e){say(e.message)}}
  useEffect(()=>{load()},[])
  const verify=async()=>{try{setV(await api('/admin/audit/verify'))}catch(e){say(e.message)}}
  return <>
    <h2>Audit trail</h2><p className="mute">Who did what, including refused attempts. File contents are never shown here.</p>
    <div className="bar"><select value={a} onChange={e=>setA(e.target.value)}><option value="">All actions</option>{['login','upload','download','edit','delete','grant','revoke','user_create','user_disable'].map(x=><option key={x}>{x}</option>)}</select>
      <select value={o} onChange={e=>setO(e.target.value)}><option value="">All outcomes</option><option>allowed</option><option>denied</option></select>
      <input placeholder="Document id" value={doc} onChange={e=>setD(e.target.value)}/><button onClick={load}>Apply filters</button><button className="ghost" onClick={verify}>Check integrity</button></div>
    {v&&<p className={'verdict '+(v.intact?'ok':'bad')}>{v.intact?<>Chain intact. Head hash, to record outside this system: <code>{v.head_hash}</code></>:<>Tampering detected at row {v.first_bad_row}.</>}</p>}
    <div className="scroll"><table><thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Outcome</th><th>Document</th><th>Target</th><th>IP</th><th>Detail</th></tr></thead><tbody>
      {rows.length===0?<tr><td colSpan="9" className="empty">No events match.</td></tr>:rows.map(e=><tr key={e.id} className={e.outcome==='denied'?'denied':''}><td>{e.id}</td><td>{when(e.ts)}</td><td>{e.actor_email||'not signed in'}</td><td>{e.action}</td><td><Tag t={e.outcome} c={e.outcome==='denied'?'bad':'ok'}/></td><td>{e.document_id?e.document_id.slice(0,8):'–'}</td><td>{e.target_email||'–'}</td><td>{e.ip||'–'}</td><td>{e.detail}</td></tr>)}
    </tbody></table></div></>
}

function Users({me,say}){
  const [rows,setRows]=useState([]),[n,setN]=useState({email:'',password:'',role:'viewer'})
  const load=async()=>{try{setRows(await api('/admin/users'))}catch(e){say(e.message)}}
  useEffect(()=>{load()},[])
  const add=async()=>{try{await api('/admin/users',J('POST',n));say('Person added.',1);setN({email:'',password:'',role:'viewer'});load()}catch(e){say(e.message)}}
  const off=async u=>{if(!confirm(`Disable ${u.email}? Their sessions end immediately.`))return;try{await api(`/admin/users/${u.id}/disable`,{method:'POST'});say('Disabled. Live sessions ended.',1);load()}catch(e){say(e.message)}}
  return <>
    <h2>People</h2><p className="mute">Administrators create and disable accounts. They cannot open documents they were not granted.</p>
    <div className="bar"><input placeholder="Email" value={n.email} onChange={e=>setN({...n,email:e.target.value})}/><input type="password" placeholder="Password (10+ characters)" value={n.password} onChange={e=>setN({...n,password:e.target.value})}/>
      <select value={n.role} onChange={e=>setN({...n,role:e.target.value})}><option>viewer</option><option>owner</option><option>admin</option></select><button className="primary" onClick={add}>Add person</button></div>
    <div className="scroll"><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th/></tr></thead><tbody>
      {rows.map(u=><tr key={u.id}><td>{u.email}</td><td>{u.role}</td><td><Tag t={u.is_active?'active':'disabled'} c={u.is_active?'ok':'bad'}/></td><td className="act">{u.is_active&&u.id!==me.id&&<button className="danger" onClick={()=>off(u)}>Disable</button>}</td></tr>)}
    </tbody></table></div></>
}
