import {test} from 'node:test';
import assert from 'node:assert/strict';
import {padImpulse,padContact} from '../dist/engine/jump-pad.js';
const pad={x:0,z:0,top:.28,speed:8,vertical:13};
test('impulse follows incoming motion; stationary contact launches vertically',()=>{const a=padImpulse(pad,{x:-3,z:4,y:0});assert(a.x<0&&a.z>0);assert(Math.abs(a.x/a.z+.75)<1e-9);assert(Math.abs(a.vertical-13)<1e-9);const idle=padImpulse(pad,{x:0,z:0,y:0});assert.equal(idle.x,0);assert.equal(idle.z,0);assert.equal(idle.vertical,13);});
test('falling boost is capped and heavier enemies launch lower',()=>{const fast=padImpulse(pad,{x:6,z:0,y:-100});assert(Math.abs(fast.vertical-14.04)<1e-9);assert(padImpulse(pad,{x:6,z:0,y:0},1.2).vertical<13);assert.equal(padContact(pad,{x:0,z:0,y:5}),false);assert.equal(padContact({...pad,disabled:true},{x:0,z:0,y:.28}),false);assert(padContact(pad,{x:0,z:0,y:.28}));});
