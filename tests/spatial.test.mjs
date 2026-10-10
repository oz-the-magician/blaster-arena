import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialIndex} from '../dist/engine/spatial.js';

test('negative coordinates, cell boundaries, relocation and removal',()=>{
  const index=new SpatialIndex(8),item={};
  index.insert(item,{min:{x:-9,z:-1},max:{x:0,z:1}});
  assert(index.queryPoint(-8,0).includes(item));
  assert(index.queryPoint(0,0).includes(item));
  assert(!index.queryPoint(24,0).includes(item));
  index.insert(item,{min:{x:25,z:25},max:{x:26,z:26}});
  assert(!index.queryPoint(-8,0).includes(item));
  assert(index.queryPoint(25,25).includes(item));
  index.remove(item);
  assert.equal(index.cells.size,0);
});

test('diagonal and vertical rays keep all intersected cells',()=>{
  const index=new SpatialIndex(8),item={};
  index.insert(item,{min:{x:15,z:15},max:{x:17,z:17}});
  assert(index.querySegment({x:0,z:0},{x:1,z:1},20).includes(item));
  assert(index.querySegment({x:16,z:16},{x:0,z:0},30).includes(item));
  assert.throws(()=>index.querySegment({x:0,z:0},{x:1,z:0},Infinity));
});
