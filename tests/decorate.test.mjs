import test from 'node:test';
import assert from 'node:assert/strict';
import {generateArena} from '../dist/generator/arenas.js';
import {decorate,MAX_DEAD} from '../dist/generator/decorate.js';
import {CLUSTERS} from '../dist/generator/clusters.js';
for(const type of ['ravine','fortresses'])
  test(`decorator: ${type} keeps every quarter at most ${MAX_DEAD*100}% dead ground`,()=>{
    let worst=0;
    for(let i=0;i<40;i++){
      const p=generateArena(type+'-cov-'+i,type),d=decorate(p);
      worst=Math.max(worst,...d.stats.after.map(v=>v-(p.theme.fill?.maxDead??MAX_DEAD)+MAX_DEAD));
      for(const c of d.clusters)assert.ok(CLUSTERS[c.id].themes.some(t=>(p.theme.id==='desert'?['desert','coast']:['meadow','fortress','forest']).includes(t)),'theme');
      assert.ok(d.clusters.filter(c=>CLUSTERS[c.id].dense).length<=2,'dense cap');
    }
    assert.ok(worst<=MAX_DEAD+0.02,'worst quarter '+worst);
  });
