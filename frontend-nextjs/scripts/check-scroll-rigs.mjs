import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import * as skeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as geometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { loadRig } from './cs2-rig-fixture.mjs';
function load(name,imports){const exports={};const code=ts.transpileModule(fs.readFileSync(`src/components/cinematic/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,require:key=>{assert(key in imports,key);return imports[key];}});return exports;}
const motion=load('encounter-motion',{});
const {loadBreachOperators}=load('breach-operators',{three:THREE,'./encounter-motion':motion,'three/addons/utils/SkeletonUtils.js':skeletonUtils,'three/addons/utils/BufferGeometryUtils.js':geometryUtils,'three/addons/loaders/GLTFLoader.js':{GLTFLoader:class{loadAsync(url){return loadRig(`public${url}`);}}}});
for(const low of [true,false]){
const operators=await loadBreachOperators(low);assert.equal(operators.group.children.length,low?2:4);
const first=operators.group.children[0];let mesh;first.traverse(n=>{if(!mesh&&n instanceof THREE.SkinnedMesh)mesh=n;});
function sample(p){operators.update(p);operators.group.updateMatrixWorld(true);mesh.skeleton.update();return mesh.getVertexPosition(500,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);}
const start=sample(0),advanced=sample(.9),held=sample(.9),reversed=sample(0);
assert(start.distanceTo(advanced)>1,'A player travels more than a metre to cover');assert(advanced.distanceTo(held)<1e-6);assert(start.distanceTo(reversed)<1e-5);
for(const actor of operators.group.children){
 const find=prefix=>{let found;actor.traverse(n=>{if(n.name.startsWith(prefix)&&/^\d+$/.test(n.name.slice(prefix.length)))found=n;});return found;};
 for(const p of [.1,.4,.8,1.2,1.5,2.4,3]){sample(p);for(const side of ['l','r']){const foot=find(`ankle_${side}_`).getWorldPosition(new THREE.Vector3());assert(Number.isFinite(foot.y));assert(foot.y>.1&&foot.y<.5,`Foot height ${foot.y}`);}}
}
function ankleAt(p){sample(p);let ankle;first.traverse(n=>{if(/^ankle_l_\d+$/.test(n.name))ankle=n;});return ankle.getWorldPosition(new THREE.Vector3());}
assert(ankleAt(.1).distanceTo(ankleAt(.11))<.002,'Actual rig support foot must not skate');
sample(1.3);const position=first.position.clone();sample(1.8);assert(first.position.distanceTo(position)<1e-8,'Firing stance does not slide');
operators.dispose();}
for(const left of [true,false]){const a=motion.footAt(.05,left),b=motion.footAt(.06,left);if(a.planted&&b.planted)assert(Math.abs(a.forward+.05-b.forward-.06)<1e-8,'Support foot remains fixed in world space');}
assert(!motion.impactAt(0,0).active);assert(motion.impactAt(1.4,0).active);
console.log('CS2 rigs pass: model tiers, metre-scale travel, stable firing stance, grounded ankles, pose reversal, planted-foot trajectory, and impact timing.');
