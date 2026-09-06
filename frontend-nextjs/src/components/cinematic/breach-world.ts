import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { encounterAt, impactAt } from './encounter-motion';

type Triple = [number, number, number];
export type BreachQuality = 'high' | 'low';

const random = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
};

/** A small, entirely procedural scene. Static details are merged by material. */
export function createBreachWorld(quality: BreachQuality = 'high') {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x191b1c, .019);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>();
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const fallbackOperators = new THREE.Group();
  scene.add(fallbackOperators);
  const ownGeometry = <T extends THREE.BufferGeometry>(geometry: T) => {
    geometries.add(geometry);
    return geometry;
  };
  const material = (color: number, roughness = .86, metalness = 0) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    materials.add(value);
    return value;
  };
  const charcoal = material(0x191e22), navy = material(0x29333a), armor = material(0x38434a);
  const strap = material(0x11171a), edge = material(0x586366), rubber = material(0x0e1214);
  const glass = material(0x536d75, .25, .55), brass = material(0xc9a36c, .35, .65);
  const stone = material(0xbbae96), stoneLight = material(0xe0d3b8), stoneDark = material(0x766e60);
  const groundDark = material(0x333536), groundLight = material(0xa1947c);
  const cloth = material(0x807a68), clothLight = material(0xb3a591), skin = material(0x9b8773);
  const gun = material(0x252a2c, .47, .52), gunEdge = material(0x69716c, .45, .55);
  const wood = material(0x755643), orange = material(0xec7729), fadedOrange = material(0xa7512b);
  const crateWood = material(0x85816e), crateBand = material(0x454b48, .55, .25);

  // Shared 256px mineral grain: lit surface relief, not a photograph backdrop.
  const mineralCanvas = document.createElement('canvas'); mineralCanvas.width = mineralCanvas.height = 256;
  const mineralContext = mineralCanvas.getContext('2d');
  if (mineralContext) {
    const pixels = mineralContext.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const grain = random(x + y * 257), coarse = random(Math.floor(x / 8) + Math.floor(y / 8) * 37);
      const value = 165 + grain * 62 + coarse * 25;
      const i = (x + y * 256) * 4;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value; pixels.data[i + 3] = 255;
    }
    mineralContext.putImageData(pixels, 0, 0);
  }
  const mineral = new THREE.CanvasTexture(mineralCanvas);
  mineral.wrapS = mineral.wrapT = THREE.RepeatWrapping; mineral.colorSpace = THREE.SRGBColorSpace; textures.add(mineral);
  for (const surface of [stone, stoneLight, stoneDark, groundDark, groundLight, crateWood]) {
    surface.map = mineral; surface.bumpMap = mineral; surface.bumpScale = .055; surface.roughness = .96;
  }

  function stoneUV(geometry: THREE.BufferGeometry) {
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const uv = new Float32Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
      const nx = Math.abs(normals.getX(i)), ny = Math.abs(normals.getY(i));
      uv[i * 2] = (nx > .65 ? positions.getZ(i) : positions.getX(i)) * .8;
      uv[i * 2 + 1] = (ny > .65 ? positions.getZ(i) : positions.getY(i)) * .8;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  const boxGeometry = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
  const sphereGeometry = ownGeometry(new THREE.SphereGeometry(1, 12, 8));
  const cylinderGeometry = ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 10));
  const capsuleGeometry = ownGeometry(new THREE.CapsuleGeometry(1, 2, 3, 10));
  const identity = new THREE.Matrix4();
  const transform = new THREE.Object3D();
  const matrix = new THREE.Matrix4();
  const vectorA = new THREE.Vector3(), vectorB = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function part(geometry: THREE.BufferGeometry, surface: THREE.Material, position: Triple,
    scale: Triple = [1, 1, 1], rotation: Triple = [0, 0, 0], parent = identity) {
    transform.position.set(...position);
    transform.scale.set(...scale);
    transform.rotation.set(...rotation);
    transform.updateMatrix();
    matrix.multiplyMatrices(parent, transform.matrix);
    const clone = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    clone.deleteAttribute('uv');
    clone.applyMatrix4(matrix);
    stoneUV(clone);
    const list = batches.get(surface) ?? [];
    list.push(clone);
    batches.set(surface, list);
  }
  const box = (surface: THREE.Material, position: Triple, scale: Triple, rotation: Triple = [0, 0, 0], parent = identity) =>
    part(boxGeometry, surface, position, scale, rotation, parent);
  const sphere = (surface: THREE.Material, position: Triple, scale: Triple, parent = identity) =>
    part(sphereGeometry, surface, position, scale, [0, 0, 0], parent);
  function segment(surface: THREE.Material, start: Triple, end: Triple, radius: number,
    parent = identity, rounded = false) {
    vectorA.set(...start); vectorB.set(...end);
    const length = vectorA.distanceTo(vectorB);
    transform.position.copy(vectorA).add(vectorB).multiplyScalar(.5);
    transform.quaternion.setFromUnitVectors(up, vectorB.sub(vectorA).normalize());
    transform.scale.set(radius, rounded ? length / 4 : length, radius);
    transform.updateMatrix();
    matrix.multiplyMatrices(parent, transform.matrix);
    const clone = (rounded ? capsuleGeometry : cylinderGeometry).toNonIndexed();
    clone.deleteAttribute('uv');
    clone.applyMatrix4(matrix);
    stoneUV(clone);
    const list = batches.get(surface) ?? [];
    list.push(clone); batches.set(surface, list);
  }

  scene.add(new THREE.HemisphereLight(0xc2d0d8, 0x211b16, .95));
  const sun = new THREE.DirectionalLight(0xffead0, 3.7);
  sun.position.set(5, 8, 2); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xb7d8e6, 3.2);
  rim.position.set(-4, 3, -4); scene.add(rim);
  const front = new THREE.DirectionalLight(0xd7e5ea, .85);
  front.position.set(-3, 4, 9); scene.add(front);

  // Chipped slabs, paving seams and a few pieces of exposed reinforcement.
  const slab = new THREE.Shape();
  slab.moveTo(-5.5, -2.75);
  [[-2.2, -2.9], [1.5, -2.72], [4.7, -2.45], [5.35, -1.7], [5.7, .6], [4.8, 2.75],
    [3.1, 3.12], [.7, 3], [-1.7, 3.2], [-4.6, 2.68], [-5.65, 1.1]].forEach(([x, y]) => slab.lineTo(x, y));
  slab.closePath();
  const slabGeometry = ownGeometry(new THREE.ExtrudeGeometry(slab, { depth: .24, bevelEnabled: false }));
  part(slabGeometry, groundDark, [0, -.22, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]);
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 13; column++) {
      const x = (column - 6) * .79 + (row % 2) * .13;
      const z = (row - 3.5) * .65;
      if (Math.abs(x) > 4.95 && Math.abs(z) > 1.7 || Math.abs(z) > 2 && random(row * 31 + column) < .25) continue;
      const shade = x < -.1 ? groundDark : (random(column + row * 71) > .74 ? stoneDark : groundLight);
      box(shade, [x, .008 + random(column + row * 17) * .018, z], [.775, .045, .63], [0, (random(column + row * 71) - .5) * .045, 0]);
    }
  }
  // Weathered Dust II arch behind the encounter.
  for (let row = 0; row < 7; row++) {
    const y = .3 + row * .56;
    box(row % 3 ? stone : stoneLight, [2.12, y, -1.85], [.82 + (row % 2) * .04, .53, .7]);
    if (row < 6) box(stoneDark, [-.7, y, -1.91], [.58, .54, .63]);
  }
  const archRadius = 1.42, archCenterX = .72, archCenterY = 2.84;
  for (let i = 0; i < 12; i++) {
    const angle = Math.PI * (i + .5) / 12;
    box(i % 3 ? stone : stoneLight,
      [archCenterX + Math.cos(angle) * archRadius, archCenterY + Math.sin(angle) * archRadius, -1.85],
      [.4, .56, .76], [0, 0, angle - Math.PI / 2]);
  }
  // Sandstone wall receding away from the breach, with contrasting plaster and blue tile courses.
  box(stone, [3.55, 2.07, -2.04], [2.12, 4.14, .48]);
  box(stoneLight, [3.56, 4.23, -2.03], [2.35, .22, .71]);
  box(stoneDark, [3.56, 4.39, -2.08], [2.42, .11, .76]);
  box(stoneLight, [4.58, 2.1, -1.92], [.25, 4.18, .6]);
  for (let i = 0; i < 5; i++) {
    box(armor, [2.72 + i * .39, .63, -1.785], [.365, .34, .035]);
    box(stoneLight, [2.72 + i * .39, .84, -1.765], [.37, .035, .04]);
  }
  // Recessed shutter and exposed sandstone around its opening.
  box(charcoal, [3.52, 2.5, -1.781], [1.23, 1.59, .032]);
  for (let i = 0; i < 8; i++) box(crateBand, [3.52, 1.84 + i * .18, -1.744], [1.11, .13, .045]);
  box(stoneLight, [3.52, 3.36, -1.73], [1.5, .14, .19]);
  box(stoneDark, [3.52, 1.64, -1.72], [1.47, .13, .25]);
  // Broken dark entry jamb, riveted metal and wiring make the opposing side feel industrial.
  box(charcoal, [-3.9, 2, -2.08], [1.9, 4, .4]);
  box(armor, [-2.91, 1.59, -2.03], [.15, 3.18, .54]);
  box(edge, [-3.9, 4.07, -2.07], [2.02, .14, .58]);
  for (let i = 0; i < 4; i++) box(navy, [-4.53 + i * .43, 1.7, -1.852], [.33, 3.27, .03]);
  segment(gunEdge, [-2.88, 3.2, -1.93], [-2.55, 3.56, -1.82], .026);
  segment(gunEdge, [-2.55, 3.56, -1.82], [-1.8, 3.54, -1.85], .026);
  segment(gunEdge, [-1.8, 3.54, -1.85], [-1.65, 3.2, -1.78], .026);

  function rifle(parent: THREE.Matrix4, y: number, isCT: boolean) {
    const offset = .18;
    box(gun, [.08, y, .69 + offset], [.11, .17, .54], [0, 0, 0], parent);
    box(isCT ? gun : wood, [.08, y - .015, .24 + offset], [.12, .15, .32], [.05, 0, 0], parent);
    box(rubber, [.08, y - .045, .04 + offset], [.16, .24, .055], [0, 0, 0], parent);
    box(isCT ? gun : wood, [.08, y + .004, 1.04 + offset], [.135, .15, .32], [0, 0, 0], parent);
    segment(gun, [.08, y + .008, 1.17 + offset], [.08, y + .008, 1.64 + offset], .032, parent);
    segment(gunEdge, [.08, y + .02, 1.34 + offset], [.08, y + .02, 1.44 + offset], .046, parent);
    box(gun, [.08, y + .095, 1.47 + offset], [.034, .15, .065], [0, 0, 0], parent);
    box(gunEdge, [.08, y + .095, .64 + offset], [.11, .036, .52], [0, 0, 0], parent);
    box(gun, [.08, y - .17, .55 + offset], [.085, .27, .12], [-.23, 0, 0], parent);
    box(gun, [.08, y - .22, .89 + offset], [.105, .35, .17], [isCT ? .13 : -.27, 0, 0], parent);
    if (isCT) {
      box(gun, [.08, y + .175, .67 + offset], [.13, .14, .15], [0, 0, 0], parent);
      box(glass, [.08, y + .183, .755 + offset], [.092, .086, .012], [0, 0, 0], parent);
      segment(gun, [.08, y, 1.63 + offset], [.08, y, 1.9 + offset], .055, parent);
    }
    for (let i = 0; i < 4; i++) box(gunEdge, [.151, y + .025, .94 + offset + i * .067], [.009, .028, .032], [0, 0, 0], parent);
  }

  function operator(position: Triple, yaw: number, isCT: boolean, kneeling = false, scale = 1) {
    const root = new THREE.Object3D();
    root.position.set(...position); root.rotation.y = yaw; root.scale.setScalar(scale); root.updateMatrix();
    const parent = root.matrix;
    const uniform = isCT ? navy : cloth, pads = isCT ? armor : charcoal;
    const hip = kneeling ? .75 : 1.05;
    const torso = hip + .38, head = hip + .99, rifleY = hip + .64;
    // Boots, staggered bent legs and knee armor form a braced rather than symmetrical pose.
    const backKnee: Triple = [-.17, kneeling ? .22 : .55, kneeling ? -.51 : -.18];
    const backAnkle: Triple = [-.18, .14, kneeling ? -.88 : -.49];
    const frontKnee: Triple = [.2, kneeling ? .5 : .63, .47];
    const frontAnkle: Triple = [.21, .14, .55];
    segment(uniform, [-.18, hip, -.06], backKnee, .165, parent, true);
    segment(uniform, backKnee, backAnkle, .125, parent, true);
    segment(uniform, [.18, hip, .02], frontKnee, .17, parent, true);
    segment(uniform, frontKnee, frontAnkle, .125, parent, true);
    sphere(pads, [frontKnee[0], frontKnee[1], frontKnee[2] + .105], [.14, .16, .075], parent);
    sphere(pads, [backKnee[0], backKnee[1], backKnee[2] + .1], [.135, .15, .07], parent);
    for (const ankle of [backAnkle, frontAnkle]) {
      box(rubber, [ankle[0], .12, ankle[2] + .08], [.27, .2, .46], [0, 0, 0], parent);
      box(strap, [ankle[0], .038, ankle[2] + .09], [.29, .046, .48], [0, 0, 0], parent);
      box(edge, [ankle[0], .231, ankle[2]], [.18, .014, .16], [0, 0, 0], parent);
    }
    sphere(uniform, [0, hip + .035, -.005], [.34, .2, .2], parent);
    sphere(uniform, [0, torso, -.025], [.345, .43, .215], parent);
    box(pads, [0, torso + .03, .16], [.49, .55, .14], [-.06, 0, 0], parent);
    box(strap, [0, torso, -.228], [.47, .51, .13], [.04, 0, 0], parent);
    box(strap, [0, hip + .09, 0], [.65, .08, .4], [0, 0, 0], parent);
    box(gunEdge, [0, hip + .09, .214], [.11, .067, .017], [0, 0, 0], parent);
    for (const x of [-.19, .19]) {
      box(strap, [x, torso + .3, .058], [.072, .23, .36], [0, 0, -.12 * Math.sign(x)], parent);
      box(pads, [x, torso - .085, .278], [.145, .23, .094], [-.06, 0, 0], parent);
      box(edge, [x, torso + .045, .279], [.125, .035, .11], [0, 0, 0], parent);
    }
    box(pads, [-.34, hip + .025, -.08], [.14, .25, .2], [0, 0, -.08], parent);
    box(pads, [.32, hip + .025, -.08], [.12, .29, .16], [0, 0, .08], parent);
    // A radio aerial, plate stitching, magazine loops, carabiner and shoulder patches.
    box(charcoal, [-.255, torso + .16, .24], [.093, .19, .07], [0, 0, 0], parent);
    segment(gun, [-.265, torso + .25, .24], [-.265, torso + .49, .24], .012, parent);
    for (let i = 0; i < 4; i++) box(edge, [-.145 + i * .097, torso + .085, .238], [.067, .019, .012], [0, 0, 0], parent);
    box(isCT ? fadedOrange : clothLight, [.349, torso + .24, -.02], [.018, .12, .1], [0, 0, 0], parent);
    // Bent arms grip the same rifle: firing hand at the trigger and support hand under the barrel.
    const shoulderRight: Triple = [.29, torso + .26, .005];
    const elbowRight: Triple = [.49, torso + .01, .16];
    const handRight: Triple = [.12, rifleY - .11, .76];
    const shoulderLeft: Triple = [-.29, torso + .23, .025];
    const elbowLeft: Triple = [-.32, torso + .025, .48];
    const handLeft: Triple = [.055, rifleY - .065, 1.23];
    segment(uniform, shoulderRight, elbowRight, .125, parent, true);
    segment(isCT ? uniform : skin, elbowRight, handRight, .095, parent, true);
    segment(uniform, shoulderLeft, elbowLeft, .12, parent, true);
    segment(isCT ? uniform : skin, elbowLeft, handLeft, .09, parent, true);
    sphere(pads, elbowRight, [.115, .115, .105], parent);
    sphere(rubber, handRight, [.082, .086, .11], parent);
    sphere(rubber, handLeft, [.085, .075, .115], parent);
    segment(strap, [-.24, torso + .24, .22], [.28, torso - .2, .22], .027, parent);
    // Heads use a sculptural helmet or wrapped balaclava, with dark lenses and respirator detail.
    segment(charcoal, [0, torso + .32, -.015], [0, head - .1, .025], .11, parent);
    sphere(isCT ? charcoal : clothLight, [0, head, .032], [.2, .247, .209], parent);
    if (isCT) {
      const helmetGeometry = ownGeometry(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * .63));
      part(helmetGeometry, armor, [0, head + .045, .015], [.244, .248, .248], [.1, 0, 0], parent);
      box(charcoal, [0, head + .016, .23], [.37, .085, .09], [.08, 0, 0], parent);
      for (const x of [-.094, .094]) {
        sphere(rubber, [x, head - .04, .2], [.097, .09, .065], parent);
        sphere(glass, [x, head - .031, .245], [.077, .061, .025], parent);
      }
      sphere(rubber, [0, head - .132, .233], [.117, .109, .091], parent);
      segment(gun, [-.04, head - .16, .27], [-.14, head - .19, .36], .065, parent);
      sphere(gunEdge, [-.145, head - .192, .36], [.055, .053, .024], parent);
      box(strap, [.234, head + .055, -.002], [.036, .1, .2], [0, 0, 0], parent);
      box(gunEdge, [0, head + .185, .17], [.11, .095, .05], [.2, 0, 0], parent);
    } else {
      sphere(charcoal, [0, head + .06, .025], [.214, .217, .216], parent);
      box(skin, [0, head + .012, .223], [.255, .062, .026], [0, 0, 0], parent);
      box(rubber, [0, head + .012, .241], [.223, .032, .017], [0, 0, 0], parent);
      sphere(cloth, [0, head - .13, .129], [.197, .12, .173], parent);
      for (let i = 0; i < 3; i++) box(clothLight, [0, head - .104 - i * .037, .258], [.3 - i * .017, .015, .012], [0, 0, .05], parent);
      box(cloth, [0, torso + .35, -.215], [.32, .23, .09], [-.1, 0, 0], parent);
    }
    rifle(parent, rifleY, isCT);
  }

  function flushBatches(parent: THREE.Object3D) {
    for (const [surface, pieces] of batches) {
      const geometry = mergeGeometries(pieces, false);
      if (geometry) { ownGeometry(geometry); parent.add(new THREE.Mesh(geometry, surface)); }
      pieces.forEach(piece => piece.dispose());
    }
    batches.clear();
  }
  flushBatches(scene);
  operator([-3.75, .04, -.5], Math.PI * .41, true, false, .94);
  operator([-2.62, .04, 1.1], Math.PI * .4, true, false, 1.09);
  operator([-1.4, .04, -.08], Math.PI * .42, true, true, 1.01);
  operator([2.31, .04, 1.02], -Math.PI * .4, false, true, 1.12);
  operator([3.75, .04, -.25], -Math.PI * .37, false, false, 1.07);
  flushBatches(fallbackOperators);

  function crate(position: Triple, scale: number, rotation = 0) {
    const root = new THREE.Object3D();
    root.position.set(...position); root.rotation.y = rotation; root.scale.setScalar(scale); root.updateMatrix();
    const parent = root.matrix;
    box(crateWood, [0, .5, 0], [1.04, 1, .9], [0, 0, 0], parent);
    for (let i = 0; i < 5; i++) {
      box(stoneDark, [-.42 + i * .21, .5, .456], [.012, .87, .012], [0, 0, 0], parent);
      box(stoneDark, [-.42 + i * .21, 1.006, 0], [.012, .01, .8], [0, 0, 0], parent);
    }
    for (const y of [.09, .91]) box(crateBand, [0, y, .468], [1.1, .105, .046], [0, 0, 0], parent);
    for (const x of [-.45, .45]) {
      box(crateBand, [x, .5, .479], [.09, 1.04, .05], [0, 0, 0], parent);
      box(crateBand, [x, 1.014, 0], [.09, .046, .96], [0, 0, 0], parent);
      for (const y of [.1, .9]) sphere(gunEdge, [x, y, .51], [.028, .028, .014], parent);
    }
    // A-site stencil is geometric, so it stays sharp without an image request.
    box(orange, [-.105, .51, .497], [.075, .45, .016], [0, 0, -.34], parent);
    box(orange, [.105, .51, .497], [.075, .45, .016], [0, 0, .34], parent);
    box(orange, [0, .455, .497], [.2, .063, .016], [0, 0, 0], parent);
  }
  crate([4.33, .04, 1.53], 1.05, -.14);
  crate([4.36, .04, .1], .79, .07);
  crate([-4.25, .04, 1.68], .7, .17);
  // Low cover leaves a clear lane around the front edge for both entry players.
  for (const side of [-1, 1]) {
    box(stoneDark, [side * 1.3, .58, 1.05], [.45, 1.1, 1.2]);
    box(stoneLight, [side * 1.3, 1.15, 1.05], [.49, .08, 1.24]);
  }
  // Loose bomb-site tape and a spent smoke grenade at the breach.
  box(fadedOrange, [1.9, .043, 2.22], [2.3, .007, .045], [0, -.08, 0]);
  box(fadedOrange, [3.02, .044, 1.22], [.045, .007, 2]);
  segment(armor, [.54, .13, .84], [.94, .13, .69], .105);
  segment(gun, [.94, .13, .69], [1.03, .13, .66], .065);
  box(orange, [.72, .22, .76], [.16, .028, .08], [0, .34, 0]);

  // Rubble at rest shares the same batched stone as the wall.
  const rubbleGeometry = ownGeometry(new THREE.IcosahedronGeometry(1, 0));
  stoneUV(rubbleGeometry);
  for (let i = 0; i < (quality === 'high' ? 62 : 32); i++) {
    const x = (random(i + 5) - .5) * 3.8 + .25, z = (random(i + 89) - .5) * 4.3;
    const size = .04 + random(i + 84) ** 2 * .25;
    part(rubbleGeometry, i % 3 ? stone : stoneDark, [x, size * .43 + .03, z],
      [size * 1.3, size * .6, size], [i * 1.24, i * .71, i * .33]);
  }

  // One mesh per static material keeps detailed uniforms affordable on integrated GPUs.
  for (const [surface, pieces] of batches) {
    const geometry = mergeGeometries(pieces, false);
    if (geometry) {
      ownGeometry(geometry);
      const mesh = new THREE.Mesh(geometry, surface);
      mesh.name = 'batched-scenery'; scene.add(mesh);
    }
    pieces.forEach(piece => piece.dispose());
  }
  batches.clear();

  const debrisCount = quality === 'high' ? 82 : 35;
  const debris = new THREE.InstancedMesh(rubbleGeometry, stoneLight, debrisCount);
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage); debris.frustumCulled = false; scene.add(debris);
  const debrisData = Array.from({ length: debrisCount }, (_, i) => {
    const angle = random(i + 818) * Math.PI * 2;
    const radius = .52 + random(i + 291) * 2.14;
    return { x: .45 + Math.cos(angle) * radius, y: 1.2 + random(i + 654) * 3.8,
      z: -.5 + (random(i + 512) - .5) * 3.8, scale: .025 + random(i + 907) ** 2 * .16,
      phase: random(i + 774) * Math.PI * 2, speed: .05 + random(i + 712) * .08 };
  });
  const shellGeometry = ownGeometry(new THREE.CylinderGeometry(.026, .028, .12, 6));
  const shellCount = quality === 'high' ? 19 : 8;
  const shells = new THREE.InstancedMesh(shellGeometry, brass, shellCount);
  shells.instanceMatrix.setUsage(THREE.DynamicDrawUsage); shells.frustumCulled = false; scene.add(shells);

  function radialTexture(smoke: boolean) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      if (smoke) {
        for (let i = 0; i < 28; i++) {
          const angle = random(i + 400) * Math.PI * 2, distance = random(i + 231) * 34;
          const x = 64 + Math.cos(angle) * distance, y = 64 + Math.sin(angle) * distance;
          const radius = 12 + random(i + 58) * 23;
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, 'rgba(255,255,255,.24)');
          gradient.addColorStop(.5, 'rgba(255,255,255,.1)');
          gradient.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
      } else {
        const gradient = ctx.createRadialGradient(64, 64, 3, 64, 64, 63);
        gradient.addColorStop(0, 'rgba(0,0,0,.85)');
        gradient.addColorStop(.42, 'rgba(0,0,0,.45)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
      }
    }
    const texture = new THREE.CanvasTexture(canvas); textures.add(texture); return texture;
  }
  const shadowTexture = radialTexture(false);
  const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: .68,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  materials.add(shadowMaterial);
  const shadowGeometry = ownGeometry(new THREE.PlaneGeometry(1, 1));
  const actorShadows = Array.from({length: quality === 'high' ? 4 : 2}, (_, i) => {
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1.4, 1.1, 1);
    shadow.renderOrder = 1; scene.add(shadow);
    return {shadow, ct: i % 2 === 0, support: i >= 2};
  });
  const smokeTexture = radialTexture(true);
  const smokeCount = quality === 'high' ? 17 : 8;
  const smoke = Array.from({ length: smokeCount }, (_, i) => {
    const surface = new THREE.SpriteMaterial({ map: smokeTexture, color: i % 3 ? 0xc7c2b6 : 0x71818a,
      transparent: true, opacity: .14, depthWrite: false, rotation: i * 1.34 });
    materials.add(surface);
    const sprite = new THREE.Sprite(surface);
    sprite.position.set((random(i + 983) - .5) * 7.8, .22 + random(i + 982) * .8,
      (random(i + 576) - .5) * 4.3);
    const size = 1.6 + random(i + 271) * 2.4;
    sprite.scale.set(size, size * .65, 1); sprite.renderOrder = 2; scene.add(sprite);
    return { sprite, x: sprite.position.x, y: sprite.position.y, z: sprite.position.z, size };
  });
  const dustCount = quality === 'high' ? 125 : 48;
  const dustGeometry = ownGeometry(new THREE.BufferGeometry());
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (random(i + 845) - .5) * 11;
    dustPositions[i * 3 + 1] = .4 + random(i + 716) * 5;
    dustPositions[i * 3 + 2] = (random(i + 486) - .5) * 7;
  }
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMaterial = new THREE.PointsMaterial({ color: 0xe4cfac, size: .017, transparent: true, opacity: .48, depthWrite: false });
  materials.add(dustMaterial);
  const dust = new THREE.Points(dustGeometry, dustMaterial); scene.add(dust);
  scene.userData.quality = quality;

  const dummy = new THREE.Object3D();
  function update(time: number, progress: number) {
    actorShadows.forEach(({shadow, ct, support}) => {
      const action = encounterAt(progress, ct, support);
      shadow.position.set((ct ? 1 : -1) * (-(support ? 4.35 : 3.5) + action.distance * 1.12), .075, support ? -1.05 : 1.05);
    });
    const travel = Math.max(0, Math.min(1, (progress - 1.3) / 1.7));
    scene.userData.debrisSpin = impactAt(progress, 0).age * 4;
    debrisData.forEach((piece, i) => {
      const impact = impactAt(progress, i), age = Math.min(1.4, impact.age);
      const side = i % 2 ? -1 : 1;
      dummy.position.set(side * 1.3 + (random(i + 91) - .5) * age * 2.1,
        Math.max(.09, 1.15 + age * (.7 + random(i + 22)) - age * age * 2.5),
        1.05 + age * (random(i + 33) * 1.6));
      dummy.rotation.set(piece.phase + age * 4, i * .71 + age * 6, i * .41 - age * 3);
      dummy.scale.setScalar(impact.active ? piece.scale * .36 : 0);
      dummy.updateMatrix(); debris.setMatrixAt(i, dummy.matrix);
    });
    debris.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < shellCount; i++) {
      const side = i % 2 ? -1 : 1, impact = impactAt(progress + .025, i), age = Math.min(1.4, impact.age);
      dummy.position.set(side * 1.75 + age * (random(i + 12) - .5),
        Math.max(.08, 1.48 + age * 1.3 - age * age * 3),
        1.2 + age * (1 + random(i + 85)));
      dummy.rotation.set(i * 1.2 + age * 5, i * .89 + age * 8, i + age * 6);
      dummy.scale.setScalar(impact.active ? .7 : 0); dummy.updateMatrix(); shells.setMatrixAt(i, dummy.matrix);
    }
    shells.instanceMatrix.needsUpdate = true;
    smoke.forEach(({ sprite, x, y, z, size }, i) => {
      sprite.position.set(x * (1 + travel * .5) + Math.sin(time * .047 + i) * .23, y + travel * .6 + Math.sin(time * .08 + i) * .095, z + travel * .8);
      sprite.material.rotation = i * 1.34 + time * .009 + travel * .3;
      sprite.material.opacity = .06 + travel * .1 + Math.sin(time * .1 + i) * .015;
      sprite.scale.set(size * (1 + travel * .65), size * (.65 + travel * .3), 1);
    });
    dust.rotation.y = Math.sin(time * .024) * .025; dust.position.y = Math.sin(time * .1) * .04;
  }
  update(0, 0);
  return {
    scene,
    update,
    setOperatorsVisible(visible: boolean) { fallbackOperators.visible = visible; },
    dispose() {
      scene.clear();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(surface => surface.dispose());
      textures.forEach(texture => texture.dispose());
      debris.dispose(); shells.dispose();
    },
  };
}
