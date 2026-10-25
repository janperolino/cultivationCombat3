import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, DT, GRID } from '../src/sim.ts';
function arena() {
 const w = new World(); w.ai = false;
 w.cells.forEach(c => {c.elevation=0;c.depth=0;c.hp=0;c.kind=0;});
 Object.assign(w.actors[0],{x:100,y:100,z:1});
 return w;
}
const input={move:{x:1,y:0},aim:{x:300,y:100},autoAltitude:true};
test('clearance assist crosses cover at normal and highest dash speed',()=>{
 for(const dash of [false,true]) {
 const w=arena(),a=w.actors[0]; a.realm=3;
 for(let y=22;y<28;y++) Object.assign(w.cells[y*GRID+30],{kind:1,hp:55,max:55});
 if(dash) w.dash(a,input.move);
 for(let i=0;i<100;i++) w.step(input);
 assert.ok(a.x>140); assert.ok(a.z>=9); assert.ok(a.z<=10);
 }
});
test('clearance assist raises over a ridge and does not descend on the far side',()=>{
 const w=arena(),a=w.actors[0];
 for(let y=0;y<GRID;y++) w.cells[y*GRID+30].elevation=13;
 for(let i=0;i<160;i++) w.step(input);
 assert.ok(a.x>170); assert.ok(a.z>14); const z=a.z;
 for(let i=0;i<60;i++) w.step(input);
 assert.equal(a.z,z);
});
test('manual descent overrides assistance and disabling it restores blocking',()=>{
 for(const mode of ['manual','disabled']) {
 const w=arena(),a=w.actors[0];
 for(let y=22;y<28;y++) Object.assign(w.cells[y*GRID+30],{kind:1,hp:55,max:55});
 for(let i=0;i<100;i++) w.step({...input,autoAltitude:mode==='manual',climb:mode==='manual'?-1:0});
 assert.ok(a.x<120); assert.ok(a.z<=1);
 }
});
test('assist does not track enemies, raise idle players or exceed ceiling',()=>{
 const w=arena(),a=w.actors[0]; w.actors[1].z=60;
 for(let i=0;i<60;i++) w.step({...input,move:{x:0,y:0}});
 assert.equal(a.z,1);
 a.z=65; for(let i=0;i<60;i++) w.step(input); assert.equal(a.z,65);
});
