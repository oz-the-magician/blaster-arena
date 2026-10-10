import test from 'node:test';
import assert from 'node:assert/strict';
import {LayeredNavigation} from '../dist/engine/navigation.js';
test('overlapping floors stay independent; stairs connect both layers',()=>{
 const nav=new LayeredNavigation({min:0,size:9,step:1,floors:(x,z)=>[0,...(z<=3?[3]:z<=6?[6-z]:[])],clear:()=>true});
 const below=nav.path({x:0,y:0,z:0},{x:8,y:0,z:0});assert.equal(below.length,8);assert.ok(below.every(p=>p.y===0));
 const above=nav.path({x:0,y:3,z:0},{x:8,y:3,z:0});assert.equal(above.length,8);assert.ok(above.every(p=>p.y===3));
 const climb=nav.path({x:0,y:0,z:8},{x:0,y:3,z:0});assert.ok(climb.length);assert.ok(climb.some(p=>p.y===1));assert.equal(climb.at(-1).y,3);
});
test('a thin wall between open cells blocks a navigation edge',()=>{
 const nav=new LayeredNavigation({min:0,size:3,step:2,floors:()=>[0],clear:x=>Math.abs(x-1)>.1});
 assert.equal(nav.path({x:0,y:0,z:0},{x:2,y:0,z:0}).length,0);
});
