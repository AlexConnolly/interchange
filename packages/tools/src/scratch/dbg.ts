import { createWorld, Cmd, cmd, StopAction, NONE } from '@interchange/sim';
const w = createWorld({ seed: 1860, size: 384, townCount: 14, companyCount: 4 });
const c = w.content;
let from=-1,to=-1,best=1e9;
for(let a=0;a<w.sites.count;a++){ if(w.sites.node[a]===NONE) continue;
  for(const id of Object.keys(c.industries[w.sites.def[a]].recipe.outputs)){
    for(let b=0;b<w.sites.count;b++){ if(b===a||w.sites.node[b]===NONE) continue;
      if(c.industries[w.sites.def[b]].recipe.inputs[id]===undefined) continue;
      const d=Math.hypot(w.sites.x[a]-w.sites.x[b],w.sites.y[a]-w.sites.y[b]);
      if(d<best){best=d;from=a;to=b;} }}}
console.log('from',from,'node',w.sites.node[from],'tile',w.sites.tile[from],'to',to,'node',w.sites.node[to],'tile',w.sites.tile[to],'dist',best.toFixed(1));
const r = w.router.find(w.graph, w.assets, (w as any).routeCosts, w.sites.node[from], w.sites.node[to], 1, w.config.size);
console.log('route links:', r ? r.links.length : 'NULL', 'cost', r?.cost, 'ticks', r?.ticks);
if(r) { let cells=0; for(const l of r.links) cells+=w.graph.linkCellCount[l]; console.log('total cells', cells, 'tiles', cells/2); }
w.queue.push(cmd(1,1,Cmd.CreateService,0,0,0,0,'T'));
w.queue.push(cmd(2,1,Cmd.AddStop,0,from,0,StopAction.LoadFull));
w.queue.push(cmd(2,1,Cmd.AddStop,0,to,0,StopAction.Unload));
w.queue.push(cmd(3,1,Cmd.BuyVehicle,c.vehicleIndex.get('dray-horse')!,from));
w.queue.push(cmd(12,1,Cmd.AssignVehicle,0,0));
const names=['Idle','Travelling','Loading','Unloading','Broken','Queued'];
let prev='';
for(let i=0;i<3000;i++){
  w.step();
  const s=`state=${names[w.vehicles.state[0]]} link=${w.vehicles.link[0]} cursor=${w.vehicles.routeCursor[0]}/${w.vehicles.routeLen[0]} load=${w.vehicles.load[0]} target=${w.vehicles.targetNode[0]} order=${w.vehicles.orderIndex[0]} due=${w.vehicles.pathDueTick[0]} dwell=${w.vehicles.dwell[0]}`;
  if(s!==prev){ console.log('t'+w.tick, s); prev=s; }
}
console.log('deliveries', w.stats.delivered, 'tonnes', w.stats.tonnesMoved);
