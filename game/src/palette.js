// The city's colours, by what they are, plus one material factory so the
// renderer never allocates a material twice for the same look.

import * as THREE from 'three';

export const C = {
  sky: 0xbfe3ff,
  horizon: 0xeaf6ff,
  sun: 0xfff3d6,
  sand: 0xd8cdb2,
  asphalt: 0x3a3f46,
  roadline: 0xf3e9c8,
  sidewalk: 0xcfc6b8,
  grass: 0x6fae5e,
  water: 0x3d8ea8,
  glass: [0x7fa8c9, 0x9fc3d9, 0xb7d6e8],
  steel: [0x8f9aa6, 0xa8b2bc],
  stucco: [0xe8b7a0, 0xf2d0a4, 0xd9a8a0, 0xc9d2e8],
  roof: 0xc96f4a,
  trunk: 0x8a6f52,
  frond: 0x3f8f4f,
  sport: 0xd94f4f,
  sedan: 0x8ea3b8,
  taxi: 0xf7c948,
  copbody: 0xeef2f5,
  coptrim: 0x2b3b55,
  barRed: 0xff3b30,
  barBlue: 0x2f6bff,
  skin: [0xd9a066, 0xb07a4f, 0xf2c49b],
  shirt: [0xe07a5f, 0x35506b, 0x4f7a5e, 0x8a5fa8],
  pants: [0x35506b, 0x4a4a4a, 0x7a6a4f, 0x274a44],
  beacon: 0xffd24a,
  marker: 0xffd24a,
};

/** The three ways a surface is lit: matte lambert, flat unlit, or glossy glass. */
const cache = new Map();

/** A shared material for `hex`: lambent by default, glossy when glassy, unlit when flat. */
export function material(hex, opts = {}) {
  const flat = opts.flat === true;
  const glassy = opts.glassy === true;
  const key = hex * 4 + (flat ? 1 : 0) + (glassy ? 2 : 0);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let made;
  if (flat) made = new THREE.MeshBasicMaterial({ color: hex });
  else if (glassy) made = new THREE.MeshPhongMaterial({ color: hex, shininess: 80, specular: 0xffffff });
  else made = new THREE.MeshLambertMaterial({ color: hex });
  cache.set(key, made);
  return made;
}

/** Emissive material for sirens, beacons and glowing markers. */
export function glow(hex, intensity = 1.6) {
  const key = hex * 4 + 3 + Math.round(intensity * 10) * 4;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const made = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity) });
  cache.set(key, made);
  return made;
}
