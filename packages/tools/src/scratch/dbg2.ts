import { createWorld, NONE } from '@interchange/sim';
const w = createWorld({ seed: 1860, size: 384, townCount: 14, companyCount: 4 });
const c = w.content;
const from=31,to=33;
console.log('from def', c.industries[w.sites.def[from]].name, 'to def', c.industries[w.sites.def[to]].name);
const cargoCount=c.cargo.length;
console.log('cargoCount', cargoCount, 'SiteTable.cargoCount', w.sites.cargoCount);
const coke=c.cargoIndex.get('coke')!;
console.log('coke index', coke);
console.log('from stock coke', w.sites.stockOf(from,coke), 'cap', w.sites.capacity[from*cargoCount+coke]);
console.log('to   stock coke', w.sites.stockOf(to,coke), 'cap', w.sites.capacity[to*cargoCount+coke]);
console.log('to inputs', JSON.stringify(c.industries[w.sites.def[to]].recipe.inputs));
console.log('addStock test ->', w.sites.addStock(to, coke, 3));
console.log('to stock after', w.sites.stockOf(to,coke));
// what does bestCargoAt pick at `from`?
const handling = c.vehicles[c.vehicleIndex.get('dray-horse')!].handling;
for(let k=0;k<cargoCount;k++){ const have=w.sites.stockOf(from,k); if(have>0) console.log('  from has', c.cargo[k].name, have, 'handling', c.cargo[k].handling, 'ok?', handling.includes(c.cargo[k].handling as never)); }
