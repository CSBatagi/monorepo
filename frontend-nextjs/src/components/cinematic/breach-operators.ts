import { Bone, BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, SkinnedMesh, Texture, Vector3, type BufferGeometry, type Object3D, type Material } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { encounterAt, footAt } from './encounter-motion';

// Aim in world space; the two Valve rigs have different bone-local axes.
const a = new Vector3(), b = new Vector3(), c = new Vector3(), direction = new Vector3(), bend = new Vector3(), joint = new Vector3();
const rotation = new Quaternion(), parentRotation = new Quaternion(), worldRotation = new Quaternion();
function pointBone(bone: Object3D, child: Object3D, target: Vector3) {
  bone.getWorldPosition(a); child.getWorldPosition(b);
  direction.subVectors(target, a).normalize(); b.sub(a).normalize();
  rotation.setFromUnitVectors(b, direction);
  bone.getWorldQuaternion(worldRotation); worldRotation.premultiply(rotation);
  bone.parent!.getWorldQuaternion(parentRotation).invert();
  bone.quaternion.copy(parentRotation.multiply(worldRotation)); bone.updateMatrixWorld(true);
}
function solveLimb(upper: Object3D, lower: Object3D, end: Object3D, target: Vector3, pole: Vector3) {
  upper.getWorldPosition(a); lower.getWorldPosition(b); end.getWorldPosition(c);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const d = Math.min(l1 + l2 - .001, Math.max(.001, a.distanceTo(target)));
  direction.subVectors(target, a).normalize();
  bend.subVectors(pole, a).addScaledVector(direction, -bend.dot(direction)).normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  joint.copy(a).addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
  pointBone(upper, lower, joint); pointBone(lower, end, target);
}

/** Two shared optimized models; purpose-authored poses, no in-place run loop. */
export async function loadBreachOperators(low: boolean) {
  const loader = new GLTFLoader(), tier = low ? 'mobile' : 'desktop';
  const sources = await Promise.all(['sas', 'phoenix'].map(name => loader.loadAsync(`/models/cinematic/${name}-${tier}.glb`)));
  const group = new Group(), geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  sources.forEach(source => source.scene.traverse(node => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) { textures.add(value); value.anisotropy = low ? 1 : 2; }
    }
  }));
  const gunMaterial = new MeshStandardMaterial({ color: 0x242a2c, roughness: .42, metalness: .55 });
  const woodMaterial = new MeshStandardMaterial({ color: 0x694330, roughness: .8 });
  const flashMaterial = new MeshBasicMaterial({ color: 0xffc46f, transparent: true, opacity: .95, depthWrite: false });
  materials.add(gunMaterial); materials.add(woodMaterial); materials.add(flashMaterial);
  function makeRifle(ct: boolean) {
    const rifle = new Group(), parts: BufferGeometry[] = [];
    function box(x:number,y:number,z:number,w:number,h:number,d:number,angle=0) {
      const geometry = new BoxGeometry(w,h,d); geometry.rotateX(angle); geometry.translate(x,y,z); parts.push(geometry);
    }
    box(0,0,.1,.075,.11,.36); box(0,-.08,-.02,.055,.16,.09,-.25);
    box(0,.005,-.2,.09,.1,.25); box(0,.015,.39,.07,.08,.24); box(0,.075,.11,.045,.035,.32);
    if (ct) box(0,-.15,.19,.055,.24,.1,.12);
    else for(let i=0;i<4;i++) box(0,-.1-i*.05,.18-i*i*.006,.06,.065,.12,-i*.13);
    const barrel = new CylinderGeometry(.017,.017,ct?.48:.35,8); barrel.rotateX(Math.PI/2); barrel.translate(0,.015,.65); parts.push(barrel);
    box(0,.07,.57,.025,.11,.035);
    const merged = mergeGeometries(parts); parts.forEach(g=>g.dispose()); geometries.add(merged); rifle.add(new Mesh(merged,gunMaterial));
    if(!ct) { const g = new BoxGeometry(.085,.085,.23); g.translate(0,.012,.37); geometries.add(g); rifle.add(new Mesh(g,woodMaterial)); }
    const g = new CylinderGeometry(.015,.11,.22,5); g.rotateX(Math.PI/2); geometries.add(g);
    const flash = new Mesh(g,flashMaterial); flash.position.set(0,.015,.96); flash.visible=false; rifle.add(flash);
    return { rifle, flash };
  }
  const placements = low ? [{ct:true,support:false},{ct:false,support:false}] : [{ct:true,support:false},{ct:false,support:false},{ct:true,support:true},{ct:false,support:true}];
  const actors = placements.map(({ct,support}) => {
    const actor = new Group(), root = clone(sources[ct ? 0 : 1].scene);
    actor.name = `${ct?'SAS':'Phoenix'}-${support?'cover':'entry'}`;
    actor.add(root); actor.scale.setScalar(1.12); group.add(actor);
    const bones: Bone[] = []; root.traverse(node=>{ if(node instanceof Bone) bones.push(node); if(node instanceof Mesh) node.frustumCulled=false; });
    const rest = bones.map(bone=>({bone,q:bone.quaternion.clone(),p:bone.position.clone()}));
    const bone = (name:string) => {
      const result = bones.find(node=>node.name.startsWith(`${name}_`) && /^\d+$/.test(node.name.slice(name.length+1)));
      if(!result) throw new Error(`Missing CS2 joint ${name}`); return result;
    };
    const limbs = (side:string,arm:boolean) => arm ? [bone(`arm_upper_${side}`),bone(`arm_lower_${side}`),bone(`hand_${side}`)] : [bone(`leg_upper_${side}`),bone(`leg_lower_${side}`),bone(`ankle_${side}`)];
    const leftLeg=limbs('l',false),rightLeg=limbs('r',false),leftArm=limbs('l',true),rightArm=limbs('r',true);
    root.updateMatrixWorld(true);
    const ankleRest=[leftLeg[2].getWorldQuaternion(new Quaternion()),rightLeg[2].getWorldQuaternion(new Quaternion())];
    const {rifle,flash}=makeRifle(ct); actor.add(rifle);
    const target=new Vector3(),pole=new Vector3(),q=new Quaternion(),actorQ=new Quaternion();
    const solve=(limb:Bone[],x:number,y:number,z:number,px:number,py:number,pz:number)=>{
      target.set(x,y,z); actor.localToWorld(target); pole.set(px,py,pz); actor.localToWorld(pole);
      solveLimb(limb[0],limb[1],limb[2],target,pole);
    };
    return {
      actor,
      update(progress:number) {
        const state=encounterAt(progress,ct,support);
        const side=ct?1:-1, start=support?4.35:3.5;
        actor.position.set(side*(-start+state.distance*1.12),.07,support?-1.05:1.05); actor.rotation.y=side*Math.PI/2;
        rest.forEach(({bone,q,p})=>{bone.quaternion.copy(q);bone.position.copy(p);});
        root.position.y=-.1-state.crouch; root.position.z=.055*state.aim-state.recoil*.025;
        actor.updateMatrixWorld(true); actor.getWorldQuaternion(actorQ);
        for(const [index,limb] of [leftLeg,rightLeg].entries()) {
          const foot=footAt(state.distance,index===0),x=index===0?.145:-.145;
          solve(limb,x,.11+foot.lift,foot.forward-.09,x,.48,foot.forward+.55);
          // Boots remain level throughout support and swing.
          limb[2].parent!.getWorldQuaternion(q).invert();
          limb[2].quaternion.copy(q.multiply(actorQ).multiply(ankleRest[index])); limb[2].updateMatrixWorld(true);
        }
        const gunY=1.46-state.crouch-(1-state.aim)*.25;
        rifle.position.set(-.12,gunY,.19-state.recoil*.045); rifle.rotation.x=-(1-state.aim)*.28-state.recoil*.045;
        rifle.updateMatrixWorld(true);
        solve(rightArm,-.12,gunY-.07,.2-state.recoil*.045,-.55,gunY-.3,.1);
        solve(leftArm,-.12,gunY-.015,.46-state.recoil*.045,.48,gunY-.3,.25);
        flash.visible=state.flash;
        actor.userData.action={...state,feet:[footAt(state.distance,true),footAt(state.distance,false)]};
      },
      dispose(){root.traverse(node=>{if(node instanceof SkinnedMesh) node.skeleton.dispose();});},
    };
  });
  let last=NaN;
  const update=(progress:number)=>{const p=Math.round(progress*10000)/10000;if(p===last)return;last=p;actors.forEach(actor=>actor.update(p));};
  update(0);
  return {group,update,dispose(){actors.forEach(actor=>actor.dispose());group.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{t.dispose();t.source.data?.close?.();});}};
}
