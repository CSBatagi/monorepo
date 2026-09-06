// Perspective-projected geometry, projectiles and procedural smoke. The image
// is only an environment plate; every effect has its own world-space motion.
export type Vec3 = { x: number; y: number; z: number };
export type Camera = { yaw: number; pitch: number; roll: number; travel: number };
const TAU = Math.PI * 2;
const random = (seed: number) => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
const cycle = (time: number, duration: number) => ((time % duration) + duration) % duration;

export function debrisAt(index: number, time: number): Vec3 & { age: number; spin: number; size: number } {
  const age = cycle(time * .72 + random(index + 3) * 9, 9);
  const angle = random(index + 11) * TAU, velocity = 85 + random(index + 7) * 165;
  return { x: 390 + Math.cos(angle) * velocity * age,
    y: -130 + Math.sin(angle) * velocity * age + 19 * age * age,
    z: 1600 - (110 + random(index + 17) * 100) * age,
    age, spin: time * (.35 + random(index + 31)) + index, size: 5 + random(index + 23) ** 2 * 30 };
}
export function projectileAt(index: number, time: number) {
  const age = cycle(time + index * .91, 5.8), direction = index % 2 === 0 ? 1 : -1;
  return { age, active: age < .94,
    start: { x: direction * -1600, y: -230 + random(index + 54) * 520, z: 800 + random(index + 81) * 950 },
    velocity: { x: direction * 3300, y: -130 + random(index + 82) * 260, z: -480 } };
}
function smokeTexture(tone: number) {
  const sprite = document.createElement('canvas'); sprite.width = sprite.height = 192;
  const ctx = sprite.getContext('2d'); if (!ctx) return sprite;
  for (let i = 0; i < 42; i++) {
    const angle = random(i + 55) * TAU, radius = random(i + 9) * 50;
    const x = 96 + Math.cos(angle) * radius, y = 96 + Math.sin(angle) * radius;
    const size = 15 + random(i + 12) * 34, shade = tone + Math.round(random(i + 28) * 30);
    const g = ctx.createRadialGradient(x, y, 0, x, y, size);
    g.addColorStop(0, `rgba(${shade},${shade},${shade - 8},.17)`);
    g.addColorStop(.45, `rgba(${shade},${shade},${shade - 8},.09)`);
    g.addColorStop(1, `rgba(${shade},${shade},${shade - 8},0)`);
    ctx.fillStyle = g; ctx.fillRect(x - size, y - size, size * 2, size * 2);
  }
  return sprite;
}
export class Battlefield {
  private smoke = [smokeTexture(145), smokeTexture(205), smokeTexture(68)];
  private stone: CanvasPattern | null;
  private width = 1; private height = 1; private focal = 750;
  private anchorX = .54; private anchorY = .5;
  private camera: Camera = { yaw: 0, pitch: 0, roll: 0, travel: 0 };
  constructor(private ctx: CanvasRenderingContext2D) {
    const texture = document.createElement('canvas'); texture.width = texture.height = 64;
    const grain = texture.getContext('2d');
    if (grain) for (let i = 0; i < 650; i++) {
      grain.fillStyle = i % 3 ? 'rgba(0,0,0,.3)' : 'rgba(255,248,227,.3)';
      grain.fillRect(random(i + 3) * 64, random(i + 97) * 64, 1 + random(i + 14) * 3, 1 + random(i + 56) * 2);
    }
    this.stone = ctx.createPattern(texture, 'repeat');
  }
  private project(p: Vec3) {
    const c = this.camera, z = p.z - 1100;
    const x = p.x * Math.cos(c.yaw) - z * Math.sin(c.yaw);
    const depth = z * Math.cos(c.yaw) + p.x * Math.sin(c.yaw) + 1100 - c.travel;
    const y = p.y * Math.cos(c.pitch) - (depth - 1100) * Math.sin(c.pitch), scale = this.focal / Math.max(100, depth);
    return { x: this.width * this.anchorX + (x * Math.cos(c.roll) - y * Math.sin(c.roll)) * scale,
      y: this.height * this.anchorY + (y * Math.cos(c.roll) + x * Math.sin(c.roll)) * scale, scale, depth };
  }
  private puff(position: Vec3, size: number, rotation: number, alpha: number, tone: number) {
    const p = this.project(position); if (p.depth < 100) return;
    const diameter = Math.min(size * p.scale, this.width * 1.8), ctx = this.ctx;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(p.x, p.y); ctx.rotate(rotation);
    ctx.drawImage(this.smoke[tone], -diameter / 2, -diameter / 2, diameter, diameter); ctx.restore();
  }
  draw(width: number, height: number, time: number, camera: Camera) {
    this.width = width; this.height = height; this.camera = camera;
    // A phone frames a narrow, tall slice of a world composed for landscape. Tying the
    // focal length to the frame's longer reach keeps the breach inside the shot instead
    // of cropping to an empty patch of sky, and a raised horizon puts the debris in the
    // band above the briefing panel, which is the only part of the plate a phone shows.
    const compact = width < 700;
    this.focal = Math.max(compact ? 330 : 500, Math.min(950, Math.max(width, height * .55) * .65));
    this.anchorX = compact ? .48 : .54; this.anchorY = compact ? .38 : .5;
    const ctx = this.ctx; ctx.clearRect(0, 0, width, height);
    // Expanding, rolling smoke volumes moving away from the breach.
    for (let i = 0; i < (compact ? 26 : 30); i++) {
      const age = cycle(time * .48 + i * .71, 13), spread = age * 40;
      const alpha = Math.min(1, age / 2, (13 - age) / 3) * .42;
      this.puff({ x: 360 + Math.sin(i * 4.7 + age * .15) * (110 + spread), y: 140 - age * 43 + Math.cos(i) * 130, z: 1800 - age * 62 },
        380 + age * 49, i + age * .08, alpha, i % 2);
    }
    // Solid fragments tumble on multiple axes, with ballistic motion and lit faces.
    const shards = Array.from({ length: compact ? 58 : 64 }, (_, i) => debrisAt(i, time)).sort((a, b) => b.z - a.z);
    for (const shard of shards) {
      const s = shard.size;
      const vertices: Vec3[] = [{ x: -s, y: -s * .5, z: -s * .3 }, { x: s * .4, y: -s * .7, z: -s * .4 },
        { x: s, y: s * .35, z: -s * .2 }, { x: -s * .6, y: s * .6, z: -s * .5 },
        { x: -s * .7, y: -s * .35, z: s * .3 }, { x: s * .3, y: -s * .45, z: s * .5 },
        { x: s * .7, y: s * .3, z: s * .4 }, { x: -s * .55, y: s * .4, z: s * .25 }];
      const rotated = vertices.map(v => {
        const x = v.x * Math.cos(shard.spin) - v.z * Math.sin(shard.spin), z = v.x * Math.sin(shard.spin) + v.z * Math.cos(shard.spin);
        const y = v.y * Math.cos(shard.spin * .7) - z * Math.sin(shard.spin * .7);
        return this.project({ x: shard.x + x, y: shard.y + y, z: shard.z + v.y * Math.sin(shard.spin * .7) + z * Math.cos(shard.spin * .7) });
      });
      if (rotated.some(v => v.depth < 100)) continue;
      ctx.globalAlpha = Math.min(1, shard.age / .35, (9 - shard.age) / .7) * .85;
      const faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
      faces.sort((a, b) => b.reduce((sum, id) => sum + rotated[id].depth, 0) - a.reduce((sum, id) => sum + rotated[id].depth, 0));
      for (const [face, ids] of faces.entries()) {
        const shade = Math.round(45 + 90 * (.5 + .5 * Math.sin(shard.spin + face * 1.5)));
        ctx.fillStyle = `rgb(${shade + 8},${shade + 5},${shade})`; ctx.strokeStyle = 'rgba(227,221,204,.18)'; ctx.lineWidth = .5;
        ctx.beginPath(); ids.forEach((id, n) => n ? ctx.lineTo(rotated[id].x, rotated[id].y) : ctx.moveTo(rotated[id].x, rotated[id].y)); ctx.closePath(); ctx.fill();
        if (this.stone) { ctx.fillStyle = this.stone; ctx.fill(); }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // Moving projectile heads, fading trails and separately tumbling brass casings.
    for (let i = 0; i < (compact ? 5 : 6); i++) {
      const shot = projectileAt(i, time); if (!shot.active) continue;
      const at = (age: number) => this.project({ x: shot.start.x + shot.velocity.x * age, y: shot.start.y + shot.velocity.y * age, z: shot.start.z + shot.velocity.z * age });
      const head = at(shot.age), tail = at(Math.max(0, shot.age - .075));
      const g = ctx.createLinearGradient(tail.x, tail.y, head.x + .01, head.y);
      g.addColorStop(0, '#d9923500'); g.addColorStop(.8, '#e2af6480'); g.addColorStop(1, '#fff1c8');
      ctx.strokeStyle = g; ctx.lineWidth = Math.max(1, head.scale * 1.6);
      ctx.beginPath(); ctx.moveTo(tail.x, tail.y); ctx.lineTo(head.x, head.y); ctx.stroke();
      ctx.fillStyle = '#fff0c0'; ctx.beginPath(); ctx.ellipse(head.x, head.y, Math.max(1.5, head.scale * 3), Math.max(.7, head.scale), 0, 0, TAU); ctx.fill();
      const casing = this.project({ x: 420 + shot.age * 260, y: 10 - shot.age * 240 + shot.age ** 2 * 330, z: 950 - shot.age * 250 });
      ctx.save(); ctx.translate(casing.x, casing.y); ctx.rotate(shot.age * 14 + i); ctx.fillStyle = '#ab8750'; ctx.fillRect(-6 * casing.scale, -2 * casing.scale, 12 * casing.scale, 4 * casing.scale); ctx.restore();
    }
    for (let i = 0; i < (compact ? 60 : 65); i++) {
      const p = this.project({ x: (random(i + 200) - .5) * 3400 + Math.sin(time * .2 + i) * 70, y: (random(i + 300) - .5) * 1500 - cycle(time * 12 + i * 3, 120), z: 300 + cycle(i * 179 - time * 30, 2200) });
      ctx.fillStyle = i % 7 ? '#ddd7c84d' : '#e6ad57a0'; ctx.beginPath(); ctx.arc(p.x, p.y, Math.min(3, Math.max(.5, p.scale)), 0, TAU); ctx.fill();
    }
    for (let i = 0; i < (compact ? 7 : 9); i++) {
      const age = cycle(time * .25 + i * 1.3, 12);
      this.puff({ x: -1100 + i * 290 + Math.sin(age * .25 + i) * 200, y: 490 - age * 18, z: 600 + i * 95 }, 850 + age * 35, age * .035 + i, Math.sin(age / 12 * Math.PI) * .42, 2);
    }
  }
}
