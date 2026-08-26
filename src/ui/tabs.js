import { setState } from '../state.js';

const panels = {
  conditions: document.getElementById('tab-conditions'),
  map:        document.getElementById('tab-map'),
  saved:      document.getElementById('tab-saved'),
};

const buttons = {
  conditions: document.getElementById('tab-btn-conditions'),
  map:        document.getElementById('tab-btn-map'),
  saved:      document.getElementById('tab-btn-saved'),
};

export function initTabs(onTabChange) {
  Object.keys(buttons).forEach(tab => {
    buttons[tab].addEventListener('click', () => switchTab(tab, onTabChange));
  });
}

export function switchTab(tab, onTabChange) {
  Object.keys(panels).forEach(t => {
    const isActive = t === tab;
    panels[t].hidden = !isActive;
    panels[t].classList.toggle('active', isActive);
    buttons[t].classList.toggle('active', isActive);
    buttons[t].setAttribute('aria-selected', isActive);
  });

  setState({ activeTab: tab });
  onTabChange?.(tab);
}
