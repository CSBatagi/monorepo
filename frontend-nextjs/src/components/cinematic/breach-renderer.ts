import { ACESFilmicToneMapping, PerspectiveCamera, WebGLRenderer } from 'three';
import { createBreachWorld } from './breach-world';
import { cameraAt, renderPixelRatio, type RenderTier } from './camera-path';
import { loadBreachOperators } from './breach-operators';

export function createBreachRenderer(canvas: HTMLCanvasElement, tier: RenderTier) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: tier === 'high', powerPreference: 'low-power', depth: true, stencil: false });
  renderer.setClearColor(0x0b0d0f, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const camera = new PerspectiveCamera(37, 1, .15, 85);
  let world: ReturnType<typeof createBreachWorld>;
  try { world = createBreachWorld(tier); } catch (error) { renderer.dispose(); throw error; }
  let disposed = false, operators: Awaited<ReturnType<typeof loadBreachOperators>> | undefined;
  void loadBreachOperators(tier === 'low').then(loaded => {
    if (disposed) { loaded.dispose(); return; }
    operators = loaded; world.scene.add(loaded.group); world.setOperatorsVisible(false);
    canvas.dispatchEvent(new Event('scene-assets-ready'));
  }).catch(() => { /* Procedural squad remains available when the model cannot load. */ });
  let width = 1, height = 1, degraded = false;
  const resize = (w: number, h: number) => {
    width = Math.max(1, w); height = Math.max(1, h);
    renderer.setPixelRatio(renderPixelRatio(width, height, window.devicePixelRatio, tier) * (degraded ? .75 : 1));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const mobile = width < 760;
    camera.fov = mobile ? 43 : 37;
    // Off-axis framing leaves the copy on the left and the breach on the right.
    camera.setViewOffset(width, height, mobile ? 0 : -width * .215, mobile ? -height * .035 : -height * .025, width, height);
    camera.updateProjectionMatrix();
  };
  return {
    resize,
    draw(time: number, progress: number, pointerX: number, pointerY: number) {
      const pose = cameraAt(progress);
      const mobile = width < 760;
      const distance = mobile ? Math.max(1.1, .9 / camera.aspect) : 1.22;
      camera.position.set(pose.x * distance + pointerX * .28, pose.y * distance + pointerY * .16, pose.z * distance);
      camera.lookAt(0, pose.targetY, 0);
      camera.rotateZ(pose.roll);
      world.update(time, progress);
      operators?.update(progress);
      renderer.render(world.scene, camera);
      canvas.dataset.action = `${progress.toFixed(3)} / ${world.scene.userData.debrisSpin.toFixed(3)}`;
      canvas.dataset.camera = `${pose.x.toFixed(2)},${pose.y.toFixed(2)},${pose.z.toFixed(2)}`;
      canvas.dataset.drawCalls = String(renderer.info.render.calls);
      canvas.dataset.triangles = String(renderer.info.render.triangles);
    },
    degrade() { if (!degraded) { degraded = true; resize(width, height); } },
    dispose() { disposed = true; operators?.dispose(); world.dispose(); renderer.dispose(); renderer.forceContextLoss(); },
  };
}
