import test from 'node:test';
import assert from 'node:assert/strict';
import {generateArena,ARENA_TYPES} from '../dist/generator/arenas.js';
test('fortresses: 200 seeds give mirrored keeps, a continuous upper lane and safe stairs',()=>{
  assert.ok(ARENA_TYPES.fortresses);
  for(let i=0;i<200;i++){
    const p=generateArena('fort-'+i,'fortresses');
    assert.equal(p.type,'fortresses');assert.equal(p.pit,undefined);
    const keeps=p.skyPlatforms.filter(s=>s.keep);assert.equal(keeps.length,2);
    assert.ok(Math.abs(keeps[0].x+keeps[1].x)<1e-9&&Math.abs(keeps[0].z+keeps[1].z)<1e-9,'keeps mirrored');
    assert.ok(p.skyPlatforms.every(s=>s.h===6),'single upper height');
    for(const r of p.ramps){assert.ok(r.x0===r.x1||r.z0===r.z1,'straight stairs');assert.ok(r.h/Math.hypot(r.x1-r.x0,r.z1-r.z0)<.65,'gentle stairs');}
    for(const n of p.graph.nodes)assert.ok(Math.abs(n.world.x)<100&&Math.abs(n.world.z)<100);
    assert.equal(p.zones.length,6);assert.equal(p.jumpPads.length,4);
  }
});
test('arena registry: seeds pick every type and ?type forces one',()=>{
  const seen=new Set();for(let i=0;i<60;i++)seen.add(generateArena('mix-'+i).type);
  assert.deepEqual([...seen].sort(),Object.keys(ARENA_TYPES).filter(k=>!ARENA_TYPES[k].special).sort());
  assert.equal(generateArena('x','ravine').type,'ravine');
});
