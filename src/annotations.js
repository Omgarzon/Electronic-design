/**
 * annotations.js — the callout data for the 3D model.
 *
 * Kept free of Three.js imports so the page can build the annotation UI
 * before the renderer is lazy-loaded. Positions are in the model's world
 * space, measured against the exported bounding box:
 *
 *   x −0.94 … 0.94   y 0.00 … 0.77   z −0.79 … 0.79   (front = +Z)
 *
 * `side` decides which way the label reads from its dot.
 */
export const ANCHORS = [
  {
    id: 'sensor',
    position: [0.02, 0.6, 0.34],
    meta: 'PMB-1.3 · forward head',
    title: 'Dual-sensor head',
    body: '48 MP visual sensor and a 640 × 512 radiometric thermal core on one stabilised optical bench, so every thermal pixel has a visual twin.',
    side: 'right',
  },
  {
    id: 'compute',
    position: [-0.29, 0.7, -0.12],
    meta: 'PMB-1.3 · module body',
    title: 'Sealed compute bay',
    body: 'Aluminium monocoque housing a 40 TOPS inference board and 512 GB of NVMe. Grades defects in flight, independent of the downlink.',
    side: 'left',
  },
  {
    id: 'gimbal',
    position: [-0.13, 0.41, 0.23],
    meta: 'PMB-1.3 · gimbal',
    title: 'Three-axis gimbal',
    body: 'Holds the sensor to ±0.01° against gusts, so the aircraft can translate along a wall while the camera keeps a steady look.',
    side: 'right',
  },
  {
    id: 'motor',
    position: [0.74, 0.44, -0.4],
    meta: 'Airframe · rotor',
    title: 'Folding rotor set',
    body: 'Four 1.2 kW brushless motors on 24-inch folding props. The aircraft collapses into a 620 mm case for one-person transport.',
    side: 'right',
  },
];
