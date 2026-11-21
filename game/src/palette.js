// Palette for a sun-bleached coastal city: pastel stucco, blue-green sea,
// warm asphalt. material() hands out shared instances so hundreds of meshes
// cost a handful of shader programs.

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

const lambertCache = new Map();
const phongCache = new Map();
const basicCache = new Map();

/**
 * Shared material for a colour. glassy -> shiny Phong, flat -> unlit Basic.
 */
export function material(hex, { flat = false, glassy = false } = {}) {
  if (flat) {
    let m = basicCache.get(hex);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: hex });
      basicCache.set(hex, m);
    }
    return m;
  }
  if (glassy) {
    let p = phongCache.get(hex);
    if (!p) {
      p = new THREE.MeshPhongMaterial({ color: hex, shininess: 80, specular: 0xdfefff });
      phongCache.set(hex, p);
    }
    return p;
  }
  let l = lambertCache.get(hex);
  if (!l) {
    l = new THREE.MeshLambertMaterial({ color: hex });
    lambertCache.set(hex, l);
  }
  return l;
}

export function pickFrom(list, rng, key) {
  return list[rng.int(0, list.length - 1)];
}
