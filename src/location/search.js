import { geocodeSearch } from './geocode.js';

let debounceTimer = null;
let selectedIndex = -1;
let results = [];
let onSelectCallback = null;

const input    = () => document.getElementById('location-search');
const clearBtn = () => document.getElementById('search-clear');
const listEl   = () => document.getElementById('search-results');

export function initSearch(onSelect) {
  onSelectCallback = onSelect;

  input().addEventListener('input', onInput);
  input().addEventListener('keydown', onKeydown);
  input().addEventListener('focus', () => { if (results.length) showList(); });
  clearBtn().addEventListener('click', clearSearch);

  document.addEventListener('click', e => {
    if (!e.target.closest('.map-search-wrap')) hideList();
  });
}

function onInput(e) {
  const val = e.target.value.trim();
  clearBtn().hidden = val.length === 0;

  clearTimeout(debounceTimer);
  if (val.length < 2) { hideList(); return; }

  debounceTimer = setTimeout(() => runSearch(val), 300);
}

async function runSearch(query) {
  try {
    results = await geocodeSearch(query);
    renderList(results);
  } catch {
    hideList();
  }
}

function renderList(items) {
  const list = listEl();
  list.innerHTML = '';
  selectedIndex = -1;

  if (!items.length) { hideList(); return; }

  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'search-result-item';
    li.setAttribute('role', 'option');
    li.dataset.index = i;

    const name = document.createElement('div');
    name.className = 'search-result-name';
    name.textContent = item.name;

    const country = document.createElement('div');
    country.className = 'search-result-country';
    country.textContent = item.country;

    li.appendChild(name);
    li.appendChild(country);
    li.addEventListener('click', () => selectResult(i));
    list.appendChild(li);
  });

  showList();
}

function onKeydown(e) {
  if (listEl().hidden) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveFocus(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveFocus(-1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (selectedIndex >= 0) selectResult(selectedIndex);
  } else if (e.key === 'Escape') {
    hideList();
    input().blur();
  }
}

function moveFocus(dir) {
  const items = listEl().querySelectorAll('.search-result-item');
  if (!items.length) return;

  items[selectedIndex]?.classList.remove('focused');
  selectedIndex = (selectedIndex + dir + items.length) % items.length;
  items[selectedIndex].classList.add('focused');
  items[selectedIndex].scrollIntoView({ block: 'nearest' });
}

function selectResult(i) {
  const item = results[i];
  if (!item) return;
  input().value = item.name;
  clearBtn().hidden = false;
  hideList();
  onSelectCallback?.(item);
}

function clearSearch() {
  input().value = '';
  clearBtn().hidden = true;
  hideList();
  results = [];
  input().focus();
}

function showList() { listEl().hidden = false; }
function hideList() { listEl().hidden = true; selectedIndex = -1; }
