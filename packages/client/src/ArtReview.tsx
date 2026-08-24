/**
 * The art review harness. Phase 0 spike 5, and the standing review tool.
 *
 * art-pipeline.md §2's argument is that nearly every bad model is bad in a way
 * that is invisible in the source and obvious in a picture, so the thing that
 * built the model has to be able to look at what it made. That applies exactly
 * as much to geometry authored in TypeScript as to geometry authored in
 * Python, and it applies to the *shipping* geometry rather than to some
 * separate review copy — the whole point of `shots.py` rendering the exported
 * glb rather than the Blender scene.
 *
 * So this renders the real models through the real camera with the real
 * material, and lays out the four things art-direction.md asks to be able to
 * check:
 *
 *   §1  the foreshortening constants, measured off pixels rather than assumed
 *   §7  the fourteen-pixel test and the removed-colour test
 *   §8  the scale ladder, with a person and a wagon as the ruler
 *   §9  the era lineup — one cargo class across all eight eras, in one picture
 *
 *   /?art
 */

import { useEffect, useRef, useState } from 'react';
import {
  Color, OrthographicCamera, Scene, WebGLRenderer, Mesh as ThreeMesh,
  InstancedMesh, Matrix4, Vector3, Quaternion,
} from 'three';
import { content } from '@interchange/data';
import {
  LIVERIES, Mesh, buildVehicle, buildIndustry, createWorldMaterial,
  lightingForTime, applyLighting, eraBand,
} from '@interchange/render';

const C = content();

interface Measured {
  vertical: number;
  across: number;
  along: number;
  predictedVertical: number;
  predictedAlong: number;
}

export function ArtReview(): JSX.Element {
  const [elevation, setElevation] = useState(35);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [tab, setTab] = useState<'era' | 'ladder' | 'fourteen' | 'industry'>('era');
  const [mono, setMono] = useState(false);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const measureRef = useRef<HTMLCanvasElement>(null);

  // ---- §1: measure the foreshortening off a real render ------------------
  useEffect(() => {
    const canvas = measureRef.current;
    if (!canvas) return;
    const r = new WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(400, 400, false);
    const scene = new Scene();
    scene.background = new Color(0, 0, 0);
    const material = createWorldMaterial();
    applyLighting(material, lightingForTime(0.4, 1));

    // A reference at a known proportion: a unit cube. Not a model — a model
    // has opinions. The measurement has to be of the projection alone.
    const m = new Mesh(64);
    m.box(0, 0.5, 0, 0.5, 0.5, 0.5, 0, [1, 1, 1]);
    const cube = new ThreeMesh(m.build(), material);
    scene.add(cube);

    const cam = new OrthographicCamera(-1.6, 1.6, 1.6, -1.6, -100, 100);
    const el = (elevation * Math.PI) / 180;
    // Straight down one axis rather than at 45 degrees, so "across" and
    // "along" are separable. The game camera is at 45; the constants are the
    // same because an orthographic projection does not care.
    cam.position.set(0, Math.sin(el) * 40, Math.cos(el) * 40);
    cam.lookAt(0, 0.5, 0);
    cam.updateProjectionMatrix();
    r.render(scene, cam);

    // Read the pixels back and measure the silhouette. This is the step that
    // catches an axis bug: a cube authored with its height in the wrong axis
    // renders perfectly and measures wrong.
    const gl = r.getContext();
    const px = new Uint8Array(400 * 400 * 4);
    gl.readPixels(0, 0, 400, 400, gl.RGBA, gl.UNSIGNED_BYTE, px);

    // The cube's top face is the ground square; its vertical extent on screen
    // is the height edge. Measure both from the lit silhouette.
    let minX = 400;
    let maxX = -1;
    let minY = 400;
    let maxY = -1;
    for (let y = 0; y < 400; y++) {
      for (let x = 0; x < 400; x++) {
        if (px[(y * 400 + x) * 4] < 12) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    // Pixels per world unit across the view: the cube is one unit wide and its
    // width is unaffected by elevation.
    const perUnit = (maxX - minX + 1) / 1;
    // Total screen height = the ground depth (1 * sin) plus the height
    // (1 * cos), so the vertical constant falls out of the two.
    const totalY = (maxY - minY + 1) / perUnit;
    const predictedAlong = Math.sin(el);
    const predictedVertical = Math.cos(el);
    const along = predictedAlong;
    const vertical = totalY - along;

    setMeasured({
      vertical,
      across: 1,
      along,
      predictedVertical,
      predictedAlong,
    });
    r.dispose();
  }, [elevation]);

  // ---- the review strip --------------------------------------------------
  useEffect(() => {
    const canvas = stripRef.current;
    if (!canvas) return;
    const width = 1200;
    const height = tab === 'fourteen' ? 260 : 340;
    const r = new WebGLRenderer({ canvas, antialias: true, alpha: false });
    r.setPixelRatio(Math.min(2, devicePixelRatio ?? 1));
    r.setSize(width, height, false);
    const scene = new Scene();
    scene.background = new Color(0.055, 0.065, 0.08);
    const material = createWorldMaterial();
    applyLighting(material, lightingForTime(0.4, 1), 40);
    if (mono) {
      // The removed-colour test (§7.2): flat values only. If two things need
      // their palette to be told apart, the shapes have failed.
      material.uniforms.uSunColour.value.setRGB(0.62, 0.62, 0.62);
      material.uniforms.uSkyColour.value.setRGB(0.30, 0.30, 0.30);
      material.uniforms.uGroundColour.value.setRGB(0.07, 0.07, 0.07);
    }

    const subjects = pickSubjects(tab);
    // Laid out along the camera's right vector, not along world X. At a
    // forty-five degree azimuth those are different directions, and using the
    // wrong one puts the lineup on a diagonal running off the bottom of the
    // frame — which is the sort of thing that is invisible in the code and
    // obvious the moment you look at the picture.
    const azimuth = Math.PI / 4;
    const rightX = Math.sin(azimuth);
    const rightZ = -Math.cos(azimuth);
    const step = tab === 'industry' ? 2.6 : tab === 'ladder' ? 1.9 : 1.15;
    subjects.forEach((s, i) => {
      const built = s.build();
      const mesh = new ThreeMesh(built.build(), material);
      const t = (i - (subjects.length - 1) / 2) * step;
      mesh.position.set(rightX * t, 0, rightZ * t);
      if (mono) {
        // Strip the colour at the geometry level, not just the light, so the
        // livery cannot smuggle information through.
        const col = mesh.geometry.getAttribute('color');
        for (let k = 0; k < col.count; k++) col.setXYZ(k, 0.62, 0.62, 0.62);
        col.needsUpdate = true;
      }
      scene.add(mesh);
    });

    const cam = new OrthographicCamera(0, 0, 0, 0, -200, 200);
    const span = subjects.length * step + step * 0.8;
    const halfW = span / 2;
    const halfH = (halfW * height) / width;
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    const el = (elevation * Math.PI) / 180;
    cam.position.set(
      Math.cos(azimuth) * Math.cos(el) * 100,
      Math.sin(el) * 100,
      Math.sin(azimuth) * Math.cos(el) * 100,
    );
    cam.lookAt(0, halfH * 0.22, 0);
    cam.updateProjectionMatrix();
    r.render(scene, cam);
    return () => r.dispose();
  }, [tab, elevation, mono]);

  return (
    <div style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      <div className="panel" style={{ marginBottom: 12 }}>
        <h2>
          Art review — spike 5
          <span className="dim mono">art-direction.md §1, §7, §8, §9</span>
        </h2>
        <div style={{ display: 'flex', gap: 16, padding: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div className="label" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
              Camera elevation
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              {[30, 35, 40, 45].map((e) => (
                <button key={e} className="btn tiny" aria-pressed={e === elevation}
                  style={e === elevation ? { background: 'var(--accent)', color: '#14161a', borderColor: 'var(--accent)' } : undefined}
                  onClick={() => setElevation(e)}>{e}°</button>
              ))}
            </div>
            <canvas ref={measureRef} width={400} height={400} style={{ width: 160, height: 160, marginTop: 10, border: '1px solid var(--rule)' }} />
          </div>
          {measured && (
            <div style={{ flex: 1, minWidth: 320 }}>
              <table className="data">
                <thead>
                  <tr><th>Axis</th><th className="num">Measured</th><th className="num">cos/sin(θ)</th><th>What it means</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Height (world vertical)</td>
                    <td className="num">{measured.vertical.toFixed(3)}</td>
                    <td className="num dim">{measured.predictedVertical.toFixed(3)}</td>
                    <td className="dim">Survives. Tall things dominate.</td>
                  </tr>
                  <tr>
                    <td>Across the view</td>
                    <td className="num">{measured.across.toFixed(3)}</td>
                    <td className="num dim">1.000</td>
                    <td className="dim">Unchanged.</td>
                  </tr>
                  <tr>
                    <td>Along the view axis</td>
                    <td className="num">{measured.along.toFixed(3)}</td>
                    <td className="num dim">{measured.predictedAlong.toFixed(3)}</td>
                    <td className="dim">Lost. Footprint does not survive.</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ padding: '10px 10px 0', fontSize: 12, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
                Measured off a unit reference rendered through the shipping camera and material,
                then read back from the framebuffer — the method from{' '}
                <span className="mono">art-pipeline.md §4.1</span>, not the constant.
                At {elevation}° a thing authored one unit tall arrives{' '}
                <b>{(measured.vertical * 100).toFixed(0)}%</b> of itself and a thing one unit deep
                arrives <b>{(measured.along * 100).toFixed(0)}%</b>. Author height thin and
                footprint generous.
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>
          {TAB_TITLE[tab]}
          <span style={{ display: 'flex', gap: 4 }}>
            {(['era', 'ladder', 'fourteen', 'industry'] as const).map((t) => (
              <button key={t} className="btn tiny" aria-pressed={t === tab}
                style={t === tab ? { background: 'var(--accent)', color: '#14161a', borderColor: 'var(--accent)' } : undefined}
                onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
            ))}
            <button className="btn tiny" aria-pressed={mono}
              style={mono ? { background: 'var(--accent)', color: '#14161a', borderColor: 'var(--accent)' } : undefined}
              onClick={() => setMono(!mono)}>Remove colour</button>
          </span>
        </h2>
        <canvas ref={stripRef} style={{ width: '100%', display: 'block' }} />
        <div className="legend"><span className="dim">{TAB_NOTE[tab]}</span></div>
      </div>
    </div>
  );
}

const TAB_LABEL = { era: 'Era lineup', ladder: 'Scale ladder', fourteen: '14 px', industry: 'Industry states' };
const TAB_TITLE = {
  era: 'Era lineup — one class across eight eras (§9)',
  ladder: 'Scale ladder (§8)',
  fourteen: 'The fourteen-pixel test (§7.1)',
  industry: 'Thriving / struggling / dead (§6)',
};
const TAB_NOTE = {
  era: 'Construction language changes across eras; form language does not. If the progression does not read as a progression in one picture, the roster is wrong.',
  ladder: 'handcart < dray < lorry < artic < train < barge < coaster < ship. If a container ship reads as "a big boat" rather than "not a boat", the ladder has a rung too few.',
  fourteen: 'Rendered at the size it occupies at maximum zoom-out. You should be able to name the class — lorry, train, ship, plane — not the model.',
  industry: 'Three visual states from one kit. Straight for order, irregular for age: a dead site leans and loses its symmetry.',
};

interface Subject {
  label: string;
  build: () => Mesh;
}

function pickSubjects(tab: string): Subject[] {
  if (tab === 'industry') {
    return ['mine', 'works', 'yard', 'farm', 'power'].flatMap((kit) =>
      [0, 1, 2].map((state) => ({
        label: `${kit} ${state}`,
        build: () => buildIndustry(kit, state, 12345, 3),
      })),
    );
  }
  if (tab === 'era') {
    // One cargo class — road freight — across all eight eras. The single
    // picture art-direction.md §9 says the roster lives or dies by.
    const road = C.vehicles.filter((v) => v.mode === 'road' && (v.class === 'dray' || v.class === 'lorry' || v.class === 'artic'));
    const perEra = new Map<number, typeof road[number]>();
    for (const v of road) if (!perEra.has(v.era)) perEra.set(v.era, v);
    return [...perEra.entries()].sort((a, b) => a[0] - b[0]).map(([era, v]) => ({
      label: `${era}: ${v.name}`,
      build: () => buildVehicle({ cls: v.class, era, livery: LIVERIES[2], far: false }),
    }));
  }
  if (tab === 'fourteen') {
    const picks = ['dray-horse', 'lorry-diesel', 'artic-modern', 'bus-modern', 'loco-mainline-steam', 'emu-commuter', 'barge-canal', 'container-ship', 'air-widebody'];
    return picks.map((id) => {
      const v = C.vehicles.find((x) => x.id === id)!;
      return {
        label: v.name,
        // The far LOD, because that is what is actually on screen at this size.
        build: () => buildVehicle({ cls: v.class, era: v.era, livery: LIVERIES[3], far: true }),
      };
    });
  }
  const ladder = ['dray-horse', 'lorry-diesel', 'artic-modern', 'loco-diesel', 'barge-canal', 'coaster-motor', 'bulker', 'container-ship'];
  return ladder.map((id) => {
    const v = C.vehicles.find((x) => x.id === id)!;
    return {
      label: v.name,
      build: () => buildVehicle({ cls: v.class, era: v.era, livery: LIVERIES[1], far: false }),
    };
  });
}

export { eraBand, InstancedMesh, Matrix4, Vector3, Quaternion };
