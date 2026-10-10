// 1 つの地図の世界：シミュレーションと、その見た目（街・信号・車・歩行者）をまとめて持つ。
// 日が変わるたびに作り直す（dispose で片づける）。
import * as THREE from 'three';
import { Sim } from './sim/Sim.js';
import { MAPS } from './maps.js';
import { CityView } from './view/CityView.js';
import { SignalView } from './view/SignalView.js';
import { CarView } from './view/CarView.js';
import { PedView } from './view/PedView.js';

export const SIM_DT = 1 / 60;

export class World {
  constructor(scene, mapId, { seed = 1, modes = {}, phases = {} } = {}) {
    this.scene = scene;
    this.mapId = mapId;
    this.def = MAPS[mapId];
    this.root = new THREE.Group();
    this.root.name = 'world-' + mapId;
    scene.add(this.root);
    this.sim = new Sim(this.def, { seed, modes, phases });
    this.city = new CityView(this.root, this.sim.net, this.def);
    this.signals = new SignalView(this.root, this.sim.net);
    this.cars = new CarView(this.root);
    this.peds = new PedView(this.root);
    this.acc = 0;
  }

  get net() { return this.sim.net; }

  /** シミュレーションを dt 秒ぶん進める（決まった刻みで）。 */
  step(dt, onEvent) {
    this.acc += dt;
    let n = 0;
    while (this.acc >= SIM_DT && n < 12) {
      this.sim.step(SIM_DT);
      if (onEvent) for (const e of this.sim.out) onEvent(e);
      this.sim.out.length = 0;
      this.acc -= SIM_DT;
      n++;
    }
    if (n >= 12) this.acc = 0;
  }

  /** 見た目を今のシミュレーションに合わせる。 */
  sync(dt, night, rain) {
    this.signals.update(dt);
    this.cars.update(this.sim.cars, dt, night);
    this.peds.update(this.sim.peds.list, dt, rain);
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
      else m?.dispose?.();
    });
  }
}
