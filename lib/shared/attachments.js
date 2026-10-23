// Shared upload protocol v1. Symbol state is scoped to the actual agent instance.
const active = Symbol.for('dsh.tools.current-uploads.v1');
export function currentFiles(agent,messages){
 if(!messages&&agent?.[active])return agent[active];
 const history=agent?.session?.snapshotEvents?.()||[];
 const latest=[...history].reverse().find(e=>e.type==='user/message'&&(e.data.source||e.data.message?.source)?.kind==='user');
 const supplied=messages?.filter(m=>m.source?.kind==='user')||[];
 const source=supplied.length?supplied:[latest?.data.message||latest?.data].filter(Boolean);
 return source.flatMap(m=>m.content||[]).filter(p=>p.type==='file').map(p=>p.attachment);
}
export function rememberFiles(agent,messages){agent[active]=currentFiles(agent,messages);return agent[active];}
