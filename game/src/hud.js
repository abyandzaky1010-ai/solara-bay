let healthBar;
let moneyLabel;
let healthFill;
let wantedStars = [];
let wantedDisplay;

export function createHUD() {
  const hud = document.createElement('div');
  hud.style.cssText = 'position: fixed; top: 10px; left: 10px; color: white; font-family: sans-serif; font-size: 14px; text-shadow: 1px 1px 2px black; z-index: 100;';
  
  // Health bar
  const healthLabel = document.createElement('div');
  healthLabel.textContent = 'Health';
  healthBar = document.createElement('div');
  healthBar.style.cssText = 'width: 150px; height: 16px; background: #333; border: 2px solid white; margin-bottom: 5px;';
  healthFill = document.createElement('div');
  healthFill.style.cssText = 'width: 100%; height: 100%; background: #3f8fa3;';
  healthBar.appendChild(healthFill);
  
  // Money
  moneyLabel = document.createElement('div');
  moneyLabel.textContent = '$0';
  moneyLabel.style.cssText = 'font-size: 18px; font-weight: bold; margin-bottom: 5px;';
  
  // Minimap placeholder
  const minimap = document.createElement('div');
  minimap.style.cssText = 'width: 150px; height: 150px; background: rgba(0,0,0,0.5); border: 2px solid white; position: absolute; bottom: 10px; left: 10px;';

  // Wanted level stars (top-right of the screen)
  wantedDisplay = document.createElement('div');
  wantedDisplay.style.cssText = 'position: fixed; top: 10px; right: 10px; font-family: sans-serif; font-size: 26px; line-height: 30px; letter-spacing: 2px; z-index: 100; text-shadow: 1px 1px 2px black; display: none;';
  wantedStars = [];
  for (let i = 0; i < 5; i++) {
    const star = document.createElement('span');
    star.textContent = '\u2606';
    star.style.color = '#888';
    wantedDisplay.appendChild(star);
    wantedStars.push(star);
  }
  document.body.appendChild(wantedDisplay);
  
  hud.appendChild(healthLabel);
  hud.appendChild(healthBar);
  hud.appendChild(moneyLabel);
  hud.appendChild(minimap);
  
  document.body.appendChild(hud);
  
  return { healthBar, moneyLabel };
}

export function updateHUD() {
  if (!moneyLabel) return;
  // Update money display
  moneyLabel.textContent = '$0';
}

export function setWantedLevel(level) {
  if (!wantedDisplay) return;
  const clamped = Math.max(0, Math.min(5, Math.floor(level) || 0));
  if (clamped === 0) {
    wantedDisplay.style.display = 'none';
  } else {
    wantedDisplay.style.display = 'block';
  }
  for (let i = 0; i < wantedStars.length; i++) {
    if (i < clamped) {
      wantedStars[i].textContent = '\u2605';
      wantedStars[i].style.color = '#ffd700';
    } else {
      wantedStars[i].textContent = '\u2606';
      wantedStars[i].style.color = '#888';
    }
  }
}
