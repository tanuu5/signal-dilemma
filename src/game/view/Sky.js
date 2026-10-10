// 空と光：時刻（時）と雨から、背景の色・霧・太陽・環境光・夜の度合いを決める。
// 背景は大きな球の内側にグラデーションを塗る（霧の影響を受けない）。
import * as THREE from 'three';
import { clamp, lerp } from '../../core/math.js';

// 時刻ごとの見た目（間はなめらかにつなぐ）
const KEYS = [
  { h: 0, top: '#151c3d', hor: '#1d2547', bot: '#0b0f22', sunEl: -0.4, sun: '#7c8cff', sunI: 0.15, sky: '#6a7ab8', gnd: '#30324c', hemiI: 1.25, exp: 1.04, night: 1 },
  { h: 5.2, top: '#3d3f6e', hor: '#2d3360', bot: '#151a33', sunEl: -0.05, sun: '#ff9a6a', sunI: 0.3, sky: '#5a5f8f', gnd: '#2a2630', hemiI: 0.7, exp: 1.0, night: 0.85 },
  { h: 6.4, top: '#f3c9b4', hor: '#f6dccd', bot: '#a9a9c4', sunEl: 0.12, sun: '#ffb47a', sunI: 1.4, sky: '#a9b8de', gnd: '#5a4a44', hemiI: 0.95, exp: 1.02, night: 0.35 },
  { h: 8.0, top: '#cfe6f6', hor: '#e9eef0', bot: '#bcd0de', sunEl: 0.42, sun: '#fff1d6', sunI: 2.5, sky: '#d6e9ff', gnd: '#7d7262', hemiI: 1.15, exp: 1.04, night: 0 },
  { h: 12, top: '#cde6fa', hor: '#e6f0f5', bot: '#b6cddf', sunEl: 0.95, sun: '#fffaf0', sunI: 2.8, sky: '#dcecff', gnd: '#857a68', hemiI: 1.2, exp: 1.02, night: 0 },
  { h: 15.5, top: '#d6e4f2', hor: '#efeee9', bot: '#c0ccd6', sunEl: 0.55, sun: '#fff0d0', sunI: 2.5, sky: '#dfe8f7', gnd: '#857560', hemiI: 1.12, exp: 1.03, night: 0 },
  { h: 17.2, top: '#f4c7a0', hor: '#f9dcc0', bot: '#c8a9a2', sunEl: 0.16, sun: '#ffab5c', sunI: 2.0, sky: '#e9c7b0', gnd: '#6a5040', hemiI: 0.95, exp: 1.05, night: 0.15 },
  { h: 18.2, top: '#7a5f9a', hor: '#c88a8f', bot: '#4b3c5c', sunEl: 0.0, sun: '#ff7a50', sunI: 0.8, sky: '#9b7fa6', gnd: '#3a3038', hemiI: 0.75, exp: 1.0, night: 0.55 },
  { h: 19.2, top: '#252b5a', hor: '#1f2550', bot: '#10132a', sunEl: -0.2, sun: '#8a9cff', sunI: 0.2, sky: '#6a74b0', gnd: '#2c2e48', hemiI: 1.2, exp: 1.04, night: 0.95 },
  { h: 24, top: '#151c3d', hor: '#1d2547', bot: '#0b0f22', sunEl: -0.4, sun: '#7c8cff', sunI: 0.15, sky: '#6a7ab8', gnd: '#30324c', hemiI: 1.25, exp: 1.04, night: 1 },
];
const RAIN = { top: '#9aa4ae', hor: '#a9b1b8', bot: '#6f7984', sky: '#aab4bf' };

const _a = new THREE.Color(), _b = new THREE.Color();
const mix = (c1, c2, t) => _a.set(c1).lerp(_b.set(c2), t).clone();

export class Sky {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    // 背景：画面いっぱいのグラデーション（上から見下ろすので、空ではなく「撮影の背景紙」のように）
    const geo = new THREE.PlaneGeometry(2, 2);
    this.uniforms = { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, bot: { value: new THREE.Color() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, depthWrite: false, depthTest: false, fog: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: `uniform vec3 top, hor, bot; varying vec2 vUv;
        void main(){
          float y = vUv.y;
          vec3 c = y > 0.55 ? mix(hor, top, smoothstep(0.55, 1.0, y)) : mix(bot, hor, smoothstep(0.0, 0.55, y));
          // 真ん中を少し明るく（台座のうしろに光）
          float r = length((vUv - vec2(0.5, 0.52)) * vec2(1.6, 1.0));
          c *= 1.0 + 0.10 * (1.0 - smoothstep(0.0, 0.75, r));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.name = 'backdrop';
    this.dome.renderOrder = -100;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
    this.hemi = new THREE.HemisphereLight(0xdfe9ff, 0x7a6a58, 1.1);
    this.sun = new THREE.DirectionalLight(0xfff4dc, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.hemi, this.sun, this.sun.target);
    scene.fog = new THREE.Fog(0xcfe3f0, 300, 900);
    this.night = 0;
    this.hours = 8;
    this.rain = 0;
  }

  /** 影を落とす範囲を、街の大きさに合わせる。 */
  fitShadow(bounds) {
    const w = (bounds.x1 - bounds.x0) / 2 + 12, d = (bounds.z1 - bounds.z0) / 2 + 12;
    const r = Math.max(w, d) * 1.1;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 900 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.center = new THREE.Vector3((bounds.x0 + bounds.x1) / 2, 0, (bounds.z0 + bounds.z1) / 2);
    this.radius = r;
  }

  set(hours, rain = 0) {
    this.hours = hours;
    this.rain = rain;
    const h = ((hours % 24) + 24) % 24;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
    const A = KEYS[i], B = KEYS[i + 1];
    const t = clamp((h - A.h) / Math.max(0.001, B.h - A.h), 0, 1);
    const s = t * t * (3 - 2 * t);
    const r = clamp(rain, 0, 1) * (1 - lerp(A.night, B.night, s) * 0.6);
    const col = (k) => mix(A[k], B[k], s);
    const top = col('top'), hor = col('hor'), bot = col('bot');
    if (r > 0) { top.lerp(_b.set(RAIN.top), r * 0.8); hor.lerp(_b.set(RAIN.hor), r * 0.75); bot.lerp(_b.set(RAIN.bot), r * 0.7); }
    this.uniforms.top.value.copy(top);
    this.uniforms.hor.value.copy(hor);
    this.uniforms.bot.value.copy(bot);
    this.scene.fog.color.copy(hor).lerp(bot, 0.25);
    // 霧はカメラから街までの距離に合わせる（遠くから見下ろすので、近い霧だと街ごと白くなる）
    const cd = this.camDist || 200;
    this.scene.fog.near = cd * lerp(1.15, 0.95, r);
    this.scene.fog.far = cd * lerp(3.2, 2.2, r);
    // 太陽：朝は東、夕方は西。高さは表から
    const el = lerp(A.sunEl, B.sunEl, s);
    const az = ((h - 6) / 12) * Math.PI; // 6 時に東（+x）、12 時に南、18 時に西
    const dir = new THREE.Vector3(Math.cos(az), Math.max(0.12, Math.sin(Math.max(el, 0.02)) + 0.05), Math.sin(az) * 0.55 + 0.35).normalize();
    const c = this.center || new THREE.Vector3();
    const R = (this.radius || 120) * 2.2;
    this.sun.position.copy(c).addScaledVector(dir, R);
    this.sun.target.position.copy(c);
    this.sun.color.copy(col('sun'));
    this.sun.intensity = lerp(A.sunI, B.sunI, s) * (1 - r * 0.65);
    this.hemi.color.copy(col('sky'));
    if (r > 0) this.hemi.color.lerp(_b.set(RAIN.sky), r * 0.6);
    this.hemi.groundColor.copy(col('gnd'));
    this.hemi.intensity = lerp(A.hemiI, B.hemiI, s) * (1 + r * 0.1);
    this.night = clamp(lerp(A.night, B.night, s) + r * 0.25, 0, 1);
    this.exposure = lerp(A.exp, B.exp, s) * (1 - r * 0.06);
    return this.night;
  }
}
