// 雨：細い線を、街の上の箱の中で落とし続ける（位置はシェーダーで時間から決めるので、毎フレーム書き換えない）。
import * as THREE from 'three';

const N = 2600;

export class Rain {
  constructor(scene) {
    const pos = new Float32Array(N * 2 * 3);
    const seed = new Float32Array(N * 2 * 4);
    let s = 7;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < N; i++) {
      const a = [r(), r(), r(), 0.75 + r() * 0.5];
      for (let k = 0; k < 2; k++) {
        pos[(i * 2 + k) * 3 + 1] = k; // 0：下の端、1：上の端
        seed.set(a, (i * 2 + k) * 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    this.u = { time: { value: 0 }, box: { value: new THREE.Vector4(-100, -100, 200, 200) }, height: { value: 60 }, amount: { value: 0 }, color: { value: new THREE.Color(0.75, 0.82, 0.9) } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false,
      vertexShader: `attribute vec4 seed; uniform float time, height, amount; uniform vec4 box; varying float vA;
        void main(){
          float sp = 32.0 * seed.w;
          float y = mod(seed.y * height - time * sp, height);
          vec3 p = vec3(box.x + seed.x * box.z, y + position.y * 1.6, box.y + seed.z * box.w);
          p.x += position.y * 0.25;
          vA = step(seed.x, amount) * (0.35 + 0.65 * position.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: 'uniform vec3 color; varying float vA; void main(){ if (vA <= 0.0) discard; gl_FragColor = vec4(color, vA * 0.55); }',
    });
    this.mesh = new THREE.LineSegments(g, m);
    this.mesh.name = 'rain';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.t = 0;
  }

  fit(b) {
    this.u.box.value.set(b.x0 - 10, b.z0 - 10, b.x1 - b.x0 + 20, b.z1 - b.z0 + 20);
  }

  update(dt, amount) {
    this.t += dt;
    this.u.time.value = this.t;
    this.u.amount.value = amount;
    this.mesh.visible = amount > 0.01;
  }
}
