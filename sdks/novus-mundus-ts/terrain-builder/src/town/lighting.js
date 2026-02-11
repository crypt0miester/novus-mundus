/**
 * Town mode lighting — day/night cycle and layout-driven lighting.
 */

import * as THREE from 'three';

/**
 * Update town lighting based on layout config and/or time of day.
 * @param {THREE.Group} townGroup - The town scene group containing named lights
 * @param {THREE.Scene} scene - The main scene (for background color)
 * @param {object|null} layout - Town layout config (may be null)
 * @param {number} timeOfDay - Hour of day (0-24)
 */
export function updateTownLighting(townGroup, scene, layout, timeOfDay) {
  if (!townGroup) return;

  const lt = layout ? layout.lighting : null;
  const sunLight = townGroup.getObjectByName('town-sun');
  const ambLight = townGroup.getObjectByName('town-ambient');

  if (lt) {
    // ── Layout-driven lighting ──
    if (sunLight) {
      sunLight.color.set(lt.sunColor);
      sunLight.intensity = lt.sunIntensity;
      sunLight.position.set(lt.sunPosition[0], lt.sunPosition[1], lt.sunPosition[2]);
      if (lt.shadowMapSize) {
        sunLight.shadow.mapSize.width = lt.shadowMapSize;
        sunLight.shadow.mapSize.height = lt.shadowMapSize;
      }
      if (lt.shadowBias != null) sunLight.shadow.bias = lt.shadowBias;
    }
    if (ambLight) {
      ambLight.color.set(lt.ambientColor);
      ambLight.intensity = lt.ambientIntensity;
    }

    // Time-of-day still drives sky / fog for preview
    const h = timeOfDay;
    let skyColor;
    if (h < 6 || h > 20) skyColor = 0x0a0a2a;
    else if (h < 7 || h > 19) skyColor = 0x4a3060;
    else if (h < 8 || h > 18) skyColor = 0xd48040;
    else skyColor = 0x6ba3c7;
    scene.background = new THREE.Color(skyColor);
    if (scene.fog) scene.fog.color.setHex(skyColor);
    return;
  }

  // ── Legacy time-of-day driven lighting (no layout) ──
  const h = timeOfDay;
  const sunAngle = ((h - 6) / 12) * Math.PI;
  const sunY = Math.sin(sunAngle);
  const sunX = Math.cos(sunAngle) * 0.5;

  if (sunLight) {
    sunLight.position.set(sunX * 3, Math.max(sunY, 0.1) * 3, 2);
    const dayFactor = Math.max(0, Math.min(1, sunY + 0.3));
    sunLight.intensity = 0.3 + dayFactor * 1.5;
    if (h < 7 || h > 18) sunLight.color.setHex(0xff8844);
    else if (h < 8 || h > 17) sunLight.color.setHex(0xffcc88);
    else sunLight.color.setHex(0xffeedd);
  }

  if (ambLight) {
    const nightFactor = (h >= 6 && h <= 19) ? 1 : 0.3;
    ambLight.intensity = 0.4 + nightFactor * 0.8;
    if (h < 6 || h > 20) ambLight.color.setHex(0x223344);
    else ambLight.color.setHex(0x445566);
  }

  let skyColor;
  if (h < 6 || h > 20) skyColor = 0x0a0a2a;
  else if (h < 7 || h > 19) skyColor = 0x4a3060;
  else if (h < 8 || h > 18) skyColor = 0xd48040;
  else skyColor = 0x6ba3c7;
  scene.background = new THREE.Color(skyColor);
  if (scene.fog) scene.fog.color.setHex(skyColor);
}

/**
 * Apply layout lighting to existing town lights without rebuilding.
 * @param {THREE.Group} townGroup
 * @param {object} lightCfg - layout.lighting section
 */
export function applyLayoutLighting(townGroup, lightCfg) {
  if (!townGroup) return;
  const sunLight = townGroup.getObjectByName('town-sun');
  const ambLight = townGroup.getObjectByName('town-ambient');
  if (sunLight && lightCfg.sunColor) sunLight.color.set(lightCfg.sunColor);
  if (sunLight && lightCfg.sunIntensity != null) sunLight.intensity = lightCfg.sunIntensity;
  if (sunLight && lightCfg.sunPosition) sunLight.position.set(...lightCfg.sunPosition);
  if (ambLight && lightCfg.ambientColor) ambLight.color.set(lightCfg.ambientColor);
  if (ambLight && lightCfg.ambientIntensity != null) ambLight.intensity = lightCfg.ambientIntensity;
}
