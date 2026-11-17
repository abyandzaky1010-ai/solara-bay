export function createHUD() {
  const hud = document.createElement('div');
  hud.style.cssText = 'position: fixed; top: 10px; left: 10px; color: white; font-family: sans-serif; font-size: 14px; text-shadow: 1px 1px 2px black; z-index: 100;';
  
  // Health bar
  const healthLabel = document.createElement('div');
  healthLabel.textContent = 'Health';
  const healthBar = document.createElement('div');
  healthBar.style.cssText = 'width: 150px; height: 16px; background: #333; border: 2px solid white; margin-bottom: 5px;';
  const healthFill = document.createElement('div');
  healthFill.style.cssText = 'width: 100%; height: 100%; background: #3f8fa3;';
  healthBar.appendChild(healthFill);
  
  // Money
  const moneyLabel = document.createElement('div');
  moneyLabel.textContent = '$0';
  moneyLabel.style.cssText = 'font-size: 18px; font-weight: bold; margin-bottom: 5px;';
  
  // Minimap placeholder
  const minimap = document.createElement('div');
  minimap.style.cssText = 'width: 150px; height: 150px; background: rgba(0,0,0,0.5); border: 2px solid white; position: absolute; bottom: 10px; left: 10px;';
  
  hud.appendChild(healthLabel);
  hud.appendChild(healthBar);
  hud.appendChild(moneyLabel);
  hud.appendChild(minimap);
  
  document.body.appendChild(hud);
  
  return { healthBar, moneyLabel };
}

export function updateHUD() {
  // Update money display
  moneyLabel.textContent = '$0';
}
