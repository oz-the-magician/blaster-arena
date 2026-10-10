import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld} from '../dist/generator/world.js';
import {validateTopology} from '../dist/generator/topology.js';
test('world compiler: 300 seeds preserve circulation, higher tiers and safe straight stairs',()=>{
 const variants=new Set();for(let i=0;i<300;i++){const plan=generateWorld('world-'+i);assert.equal(validateTopology(plan.graph).valid,true);assert.equal(plan.graph.nodes.length,12);assert.equal(plan.connections.length,plan.graph.edges.filter(e=>e.walkable).length);assert.equal(plan.limit,110);assert.equal(plan.pit.h,-5);assert.ok(Math.max(...plan.graph.nodes.map(n=>n.height))>=14);assert.equal(plan.jumpPads.length,7);
 for(const r of plan.ramps){assert.ok(r.x0===r.x1||r.z0===r.z1);assert.ok(Math.abs(r.h-r.baseHeight)/Math.hypot(r.x1-r.x0,r.z1-r.z0)<.65);}
 for(const n of plan.graph.nodes)assert.ok(Math.abs(n.world.x)<90&&Math.abs(n.world.z)<90);
 variants.add(JSON.stringify({pit:plan.pit,zones:plan.zones,ramps:plan.ramps}));}assert.equal(variants.size,300);
});
test('same seed reproduces geometry and template choices',()=>assert.deepEqual(generateWorld('repeat'),generateWorld('repeat')));
test('ravine escape pads always have open sky (never under a bridge, crossing or tower)',()=>{
  for(let i=0;i<400;i++){const p=generateWorld('sky-'+i);
    for(const j of p.jumpPads.filter(j=>j.y<0))
      assert.ok(!p.skyPlatforms.some(q=>Math.abs(j.x-q.x)<q.w/2+1.5&&Math.abs(j.z-q.z)<q.d/2+1.5),'pad under platform, seed sky-'+i);}
});
