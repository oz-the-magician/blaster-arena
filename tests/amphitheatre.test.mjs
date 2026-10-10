import test from 'node:test';
import assert from 'node:assert/strict';
import {generateArena} from '../dist/generator/arenas.js';
test('amphitheatre: 100 seeds give three stands, straight stairs on axis rows, a lit night ring',()=>{
  for(let i=0;i<100;i++){
    const p=generateArena('amph-'+i,'amphitheatre','night');
    assert.equal(p.type,'amphitheatre');assert.equal(p.theme.id,'night');
    assert.deepEqual([...new Set(p.skyPlatforms.map(s=>s.h))].sort(),[2,4,6]);
    for(const r of p.ramps){assert.ok(r.x0===r.x1||r.z0===r.z1,'straight');assert.ok(r.x0===0||r.z0===0,'on an axis row');assert.ok((r.h-r.baseHeight)/Math.hypot(r.x1-r.x0,r.z1-r.z0)<.65);}
    for(const h of [2,4,6])assert.ok(p.ramps.some(r=>r.h===h),'every stand reachable');
    assert.ok(p.ramps.some(r=>r.baseHeight===0&&r.h===6),'a way up from outside');
    assert.ok(p.torches.filter(t=>t.light).length>=6);
    assert.ok(p.wallRuns.length>20);
  }
});
