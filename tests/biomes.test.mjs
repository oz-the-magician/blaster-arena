import test from 'node:test';
import assert from 'node:assert/strict';
import {generateArena,ARENA_TYPES} from '../dist/generator/arenas.js';
import {BIOMES,HOME_BIOME} from '../dist/generator/biomes.js';
test('biomes: every type comes in every biome, home biome most often, night gets torches',()=>{
  for(const type of Object.keys(ARENA_TYPES)){
    const seen={};
    for(let i=0;i<120;i++){const p=generateArena('bio-'+i,type);seen[p.biome]=(seen[p.biome]||0)+1;
      assert.equal(p.theme.id,p.biome);assert.deepEqual(p.theme.lights,BIOMES[p.biome].lights);
      if(p.biome==='night')assert.ok(p.torches?.length>=6,'night arenas have torches');else assert.ok(!p.torches,'no torches by day');}
    assert.deepEqual(Object.keys(seen).sort(),Object.keys(BIOMES).sort(),type+' covers all biomes');
    assert.ok(seen[HOME_BIOME[type]]>=Math.max(...Object.values(seen))*0.99,type+' home biome is the most frequent');
  }
  const forced=generateArena('x','ravine','night');assert.equal(forced.biome,'night');
});
