import test from 'node:test';
import assert from 'node:assert/strict';
import {generateArena} from '../dist/generator/arenas.js';
test('hill: 200 seeds give nested terraces, a tall summit tower, a moat with four bridges and a siege camp',()=>{
  for(let i=0;i<200;i++){
    const p=generateArena('hill-'+i,'hill');
    assert.equal(p.type,'hill');
    const t=p.skyPlatforms.filter(s=>s.solid).sort((a,b)=>a.h-b.h);
    assert.deepEqual(t.map(s=>s.h),[3,6,15]);
    for(let k=1;k<3;k++)assert.ok(t[k].w<t[k-1].w-20&&t[k].d<t[k-1].d-20,'each terrace leaves an 11 m ring');
    for(const r of p.ramps){assert.ok(r.x0===r.x1||r.z0===r.z1);assert.ok((r.h-r.baseHeight)/Math.hypot(r.x1-r.x0,r.z1-r.z0)<.65);}
    for(const h of [3,6,15])assert.ok(p.ramps.some(r=>r.h===h),'every level has a stair onto it');
    assert.ok(p.skyPlatforms.some(s=>s.landing&&s.h===10.5),'tower stairs have a landing');assert.ok(p.skyPlatforms.some(s=>s.landing&&s.h===15),'tower stairs end on a top landing');
    assert.equal(p.moat.length,4);assert.equal(p.skyPlatforms.filter(s=>s.bridge).length,4);
    assert.equal(p.fixedClusters.length,8);
    assert.ok(p.ramps.filter(r=>r.baseHeight===0).length>=2,'at least two ways up from the ground');
    assert.ok(p.wallRuns.length>=12);
  }
});
