// ===== MTG Commander Viewer — app.js =====

const SCRYFALL_SETS_URL = 'https://api.scryfall.com/sets';
const SCRYFALL_SEARCH_URL = 'https://api.scryfall.com/cards/search';

// Set types we care about (skip tokens, promos, etc.)
const ALLOWED_SET_TYPES = new Set([
  'core',
  'expansion',
  'masters',
  'draft_innovation',
  'commander',
  'funny',
]);

// Cache of fetched commanders per set code
const commanderCache = {};

// Rate-limit helper — Scryfall asks for 50-100ms between requests
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequestTime = 0;

async function scryfallFetch(url) {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 100) {
    await delay(100 - elapsed);
  }
  lastRequestTime = Date.now();
  const res = await fetch(url);
  if (res.status === 404) return null; // no results
  if (!res.ok) throw new Error(`Scryfall error: ${res.status}`);
  return res.json();
}

// ===== Fetch all sets, filter & sort =====
async function loadSets() {
  const data = await scryfallFetch(SCRYFALL_SETS_URL);
  if (!data || !data.data) return [];

  return data.data
    .filter((s) => ALLOWED_SET_TYPES.has(s.set_type) && !s.digital)
    .sort((a, b) => new Date(a.released_at) - new Date(b.released_at));
}

// ===== Fetch commanders for a set (with pagination) =====
async function fetchCommanders(setCode) {
  if (commanderCache[setCode]) return commanderCache[setCode];

  const cards = [];
  let url = `${SCRYFALL_SEARCH_URL}?q=t%3Alegendary+t%3Acreature+set%3A${encodeURIComponent(setCode)}&order=name&unique=cards`;

  try {
    while (url) {
      const data = await scryfallFetch(url);
      if (!data) break;
      cards.push(...data.data);
      url = data.has_more ? data.next_page : null;
    }
  } catch (e) {
    // 404 == no results, anything else log
    if (!e.message.includes('404')) console.warn(`Error fetching commanders for ${setCode}:`, e);
  }

  commanderCache[setCode] = cards;
  return cards;
}

// ===== SVG chevron icon =====
function chevronSVG() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('set-chevron');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
  return svg;
}

// ===== Format release date =====
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ===== Get best image URI from a card =====
function getCardImage(card) {
  if (card.image_uris && card.image_uris.normal) return card.image_uris.normal;
  // Double-faced cards store images on card_faces
  if (card.card_faces && card.card_faces[0] && card.card_faces[0].image_uris) {
    return card.card_faces[0].image_uris.normal;
  }
  return null;
}

// ===== Color definitions =====
const COLORS = [
  { code: 'W', label: 'White', symbol: 'W', cssClass: 'color-w' },
  { code: 'U', label: 'Blue',  symbol: 'U', cssClass: 'color-u' },
  { code: 'B', label: 'Black', symbol: 'B', cssClass: 'color-b' },
  { code: 'R', label: 'Red',   symbol: 'R', cssClass: 'color-r' },
  { code: 'G', label: 'Green', symbol: 'G', cssClass: 'color-g' },
  { code: 'C', label: 'Colorless', symbol: 'C', cssClass: 'color-c' },
];

// ===== Build the in-set toolbar =====
function createToolbar(onUpdate) {
  const state = { sort: 'name', colors: new Set() };

  const toolbar = document.createElement('div');
  toolbar.className = 'set-toolbar';

  // Sort group
  const sortGroup = document.createElement('div');
  sortGroup.className = 'toolbar-group';
  const sortLabel = document.createElement('span');
  sortLabel.className = 'toolbar-label';
  sortLabel.textContent = 'Sort:';
  sortGroup.appendChild(sortLabel);

  const sortBtns = document.createElement('div');
  sortBtns.className = 'toolbar-btns';

  ['name', 'mana'].forEach((key) => {
    const btn = document.createElement('button');
    btn.className = 'toolbar-btn' + (key === 'name' ? ' active' : '');
    btn.textContent = key === 'name' ? 'Name' : 'Mana Value';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.sort = key;
      sortBtns.querySelectorAll('.toolbar-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onUpdate(state);
    });
    sortBtns.appendChild(btn);
  });
  sortGroup.appendChild(sortBtns);
  toolbar.appendChild(sortGroup);

  // Color filter group
  const colorGroup = document.createElement('div');
  colorGroup.className = 'toolbar-group';
  const colorLabel = document.createElement('span');
  colorLabel.className = 'toolbar-label';
  colorLabel.textContent = 'Colors:';
  colorGroup.appendChild(colorLabel);

  const colorBtns = document.createElement('div');
  colorBtns.className = 'toolbar-btns';

  COLORS.forEach(({ code, label, symbol, cssClass }) => {
    const btn = document.createElement('button');
    btn.className = `toolbar-btn color-filter ${cssClass}`;
    btn.textContent = symbol;
    btn.title = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.colors.has(code)) {
        state.colors.delete(code);
        btn.classList.remove('active');
      } else {
        state.colors.add(code);
        btn.classList.add('active');
      }
      onUpdate(state);
    });
    colorBtns.appendChild(btn);
  });
  colorGroup.appendChild(colorBtns);
  toolbar.appendChild(colorGroup);

  return { toolbar, state };
}

// ===== Filter & sort cards =====
function filterAndSortCards(cards, state) {
  let filtered = cards;

  if (state.colors.size > 0) {
    const wantColorless = state.colors.has('C');
    const selectedColors = [...state.colors].filter((c) => c !== 'C');

    filtered = cards.filter((card) => {
      const ci = card.color_identity || [];
      if (wantColorless && ci.length === 0) return true;
      if (selectedColors.length === 0) return wantColorless && ci.length === 0;
      return selectedColors.some((c) => ci.includes(c));
    });
  }

  const sorted = [...filtered].sort((a, b) => {
    if (state.sort === 'mana') {
      return (a.cmc || 0) - (b.cmc || 0) || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });

  return sorted;
}

// ===== Build a single set section =====
function createSetSection(set) {
  const section = document.createElement('div');
  section.className = 'set-section';
  section.id = `set-${set.code}`;

  // Header
  const header = document.createElement('div');
  header.className = 'set-header';

  const left = document.createElement('div');
  left.className = 'set-header-left';

  // Set icon
  if (set.icon_svg_uri) {
    const icon = document.createElement('img');
    icon.className = 'set-icon';
    icon.src = set.icon_svg_uri;
    icon.alt = '';
    icon.loading = 'lazy';
    left.appendChild(icon);
  }

  const name = document.createElement('span');
  name.className = 'set-name';
  name.textContent = set.name;
  left.appendChild(name);

  const date = document.createElement('span');
  date.className = 'set-date';
  date.textContent = `(${formatDate(set.released_at)})`;
  left.appendChild(date);

  // Commander count badge (shown after fetch)
  const badge = document.createElement('span');
  badge.className = 'commander-count';
  badge.dataset.setCode = set.code;
  left.appendChild(badge);

  header.appendChild(left);

  // Chevron
  header.appendChild(chevronSVG());

  section.appendChild(header);

  // Body (collapsible)
  const body = document.createElement('div');
  body.className = 'set-body';
  const inner = document.createElement('div');
  inner.className = 'set-body-inner';
  body.appendChild(inner);
  section.appendChild(body);

  // Click handler
  let fetched = false;
  let allCards = [];
  let gridContainer = null;
  let toolbarState = null;

  header.addEventListener('click', async () => {
    const isOpen = section.classList.contains('open');

    if (isOpen) {
      // Collapse
      body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => {
        body.style.maxHeight = '0';
      });
      section.classList.remove('open');
      return;
    }

    // Expand
    section.classList.add('open');

    if (!fetched) {
      fetched = true;
      inner.innerHTML = `
        <div class="set-loading">
          <div class="spinner"></div>
          <span>Fetching commanders…</span>
        </div>`;
      body.style.maxHeight = body.scrollHeight + 'px';

      allCards = await fetchCommanders(set.code);
      inner.innerHTML = '';

      badge.textContent = allCards.length;
      badge.classList.add('visible');

      // Add toolbar
      const { toolbar, state } = createToolbar((newState) => {
        toolbarState = newState;
        renderCardGrid(gridContainer, filterAndSortCards(allCards, newState));
      });
      toolbarState = state;
      inner.appendChild(toolbar);

      // Card grid container
      gridContainer = document.createElement('div');
      inner.appendChild(gridContainer);
      renderCardGrid(gridContainer, filterAndSortCards(allCards, toolbarState));
    }

    // Animate open
    body.style.maxHeight = body.scrollHeight + 'px';
    const onEnd = () => {
      if (section.classList.contains('open')) {
        body.style.maxHeight = 'none';
      }
      body.removeEventListener('transitionend', onEnd);
    };
    body.addEventListener('transitionend', onEnd);
  });

  return section;
}

// ===== Render card grid =====
function renderCardGrid(container, cards) {
  container.innerHTML = '';

  if (!cards || cards.length === 0) {
    container.innerHTML = '<p class="set-message">No commanders match the current filters.</p>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'card-grid';

  cards.forEach((card) => {
    const imgUrl = getCardImage(card);
    if (!imgUrl) return;

    const link = document.createElement('a');
    link.className = 'card-link';
    link.href = card.scryfall_uri;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = `${card.name} (MV: ${card.cmc || 0})`;

    const img = document.createElement('img');
    img.src = imgUrl;
    img.alt = card.name;
    img.loading = 'lazy';

    link.appendChild(img);
    grid.appendChild(link);
  });

  container.appendChild(grid);
}

// ===== State =====
let allSets = [];
let sortAsc = true; // true = oldest first

// ===== Render sets into DOM =====
function renderSets() {
  const container = document.getElementById('sets-container');
  container.innerHTML = '';

  const sorted = [...allSets].sort((a, b) => {
    const diff = new Date(a.released_at) - new Date(b.released_at);
    return sortAsc ? diff : -diff;
  });

  const fragment = document.createDocumentFragment();
  sorted.forEach((set) => {
    fragment.appendChild(createSetSection(set));
  });
  container.appendChild(fragment);
}

// ===== Sort toggle =====
function initSortToggle() {
  const btn = document.getElementById('sort-toggle');
  if (!btn) return;

  btn.addEventListener('click', () => {
    sortAsc = !sortAsc;
    btn.classList.toggle('desc', !sortAsc);
    btn.querySelector('.sort-label').textContent = sortAsc ? 'Oldest First' : 'Newest First';
    renderSets();
  });
}

// ===== Init =====
async function init() {
  const spinner = document.getElementById('loading-spinner');
  const container = document.getElementById('sets-container');

  initSortToggle();

  try {
    const data = await scryfallFetch(SCRYFALL_SETS_URL);
    if (!data || !data.data) {
      spinner.classList.add('hidden');
      container.innerHTML = '<p class="set-message">No sets found.</p>';
      return;
    }

    allSets = data.data.filter((s) => ALLOWED_SET_TYPES.has(s.set_type) && !s.digital);
    spinner.classList.add('hidden');

    if (allSets.length === 0) {
      container.innerHTML = '<p class="set-message">No sets found.</p>';
      return;
    }

    renderSets();
  } catch (err) {
    spinner.classList.add('hidden');
    container.innerHTML = `<p class="set-message">Failed to load sets. Please try again later.<br><small>${err.message}</small></p>`;
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', init);
