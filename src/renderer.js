import {GPUPreview} from './gpu-preview.js';
import {icon,decorateIcons} from './icons.js';
const adjustments=window.PocketAdjustments;
const history=new adjustments.History();
const pocket = window.pocket;
const library = window.PocketLibrary;

const DEFAULT_EDIT = {
  profile: 'auto', lutStrength: 100, vivid: false, exposure: 0,
  brilliance: 0, contrast: 0, highlights: 0, shadows: 0,
  saturation: 0, warmth: 0, tint: 0, trimStart: 0, trimEnd: 0, mute: false, gainDb: 0
};

const state = {
  clips: [], edits: {}, luts: {}, source: '', output: '',
  organization: { projects: [], assignments: {}, favorites: [] },
  view: { projectId: '', chapterId: '', sort: 'oldest' },
  exportSettings: { resolution: '1080', quality: 'balanced', maxMB: '' },
  activeId: null, selected: new Set(), playhead: 0, frameToken: 0,
  previewToken: 0, bulk: false, selectionAnchor: null, colorClipboard: null, exportRecords: {}, exportPresets: [],
  saveTimer: null, saveChain: Promise.resolve(), frameTimer: null, thumbnailObserver: null,
  thumbQueue: [], thumbLoading: 0, exporting: false
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {
  sourceName: $('#source-name'), clipCount: $('#clip-count'), selectionSummary: $('#selection-summary'),
  openFolder: $('#open-folder-button'), emptyOpen: $('#empty-open-folder'), defaultFolder: $('#default-folder-button'),
  rescan: $('#rescan-button'), clearSelection: $('#clear-selection'), grid: $('#clip-grid'), empty: $('#empty-state'),
  selectAllFiltered: $('#select-all-filtered'),
  search: $('#search-input'), profileFilter: $('#profile-filter'), dateFilter: $('#date-filter'),
  projectFilter: $('#project-filter'), chapterChips: $('#chapter-chips'), sort: $('#sort-select'),
  favoritesFilter: $('#favorites-filter'), selectedFilter: $('#selected-filter'), clearFilters: $('#clear-filters'),
  manageLibrary: $('#manage-library'), libraryDialog: $('#library-dialog'), projectList: $('#project-list'),
  chapterList: $('#chapter-list'), manageProject: $('#manage-project-select'), newProjectName: $('#new-project-name'),
  newChapterName: $('#new-chapter-name'), createProject: $('#create-project'), createChapter: $('#create-chapter'),
  assignCount: $('#assign-selection-count'), assignProject: $('#assign-project-select'), assignChapter: $('#assign-chapter-select'),
  assignSelected: $('#assign-selected'),
  scanProgress: $('#scan-progress'), scanCount: $('#scan-count'), scanBar: $('#scan-progress-bar'),
  activeName: $('#active-name'), activeMeta: $('#active-meta'), activeProfile: $('#active-profile'),
  placeholder: $('#viewer-placeholder'), frame: $('#frame-image'), video: $('#preview-video'),
  frameLoading: $('#frame-loading'), beforeHold: $('#before-hold'), seek: $('#seek-slider'),
  currentTime: $('#current-time'), durationTime: $('#duration-time'), markStart: $('#mark-start'),
  markEnd: $('#mark-end'), playPreview: $('#play-preview'), trimStart: $('#trim-start-readout'),
  trimEnd: $('#trim-end-readout'), editControls: $('#edit-controls'), profileSelect: $('#profile-select'),
  profileHint: $('#profile-hint'), vividRow: $('#vivid-row'), resetAll: $('#reset-all'),
   lightControls: $('#light-controls'), colorControls: $('#color-controls'),
  exportCount: $('#export-count'), resolution: $('#resolution-select'), quality: $('#quality-select'),
  maxSize: $('#max-size-input'), outputPath: $('#output-path'), chooseOutput: $('#choose-output'),
  exportError: $('#export-error'), exportJob: $('#export-job'), exportState: $('#export-state'),
  exportPercent: $('#export-percent'), exportBar: $('#export-progress-bar'), exportItems: $('#export-items'),
  startExport: $('#start-export'), cancelExport: $('#cancel-export'), revealExports: $('#reveal-exports'),
  toastRegion: $('#toast-region'), previousClip: $('#previous-clip'), nextClip: $('#next-clip'), activeFavorite: $('#active-favorite')
};

let gpu;
function setupPreview(){
  gpu=new GPUPreview(els.video,$('#grade-canvas'),pocket,time=>{
    state.playhead=time;els.seek.value=time;els.currentTime.textContent=formatTime(time);setRangeFill(els.seek);
    if(stream.on)syncStreamProgress();
    $('span',els.playPreview).textContent=els.video.paused?'Play preview':'Pause';
  });
  gpu.onError=error=>toast(friendlyError(error),'error');
  gpu.onEnd=clip=>{if(stream.on&&stream.autoplay&&clip.id===state.activeId)streamStep(1,true);};
  for(const type of ['play','pause'])els.video.addEventListener(type,syncStreamBar);
  window.pocketPreview=gpu;
}

const controlDefs = [
  ['exposure', 'Exposure', -2, 2, .05, 'light'], ['brilliance', 'Brilliance', -100, 100, 1, 'light'],
  ['contrast', 'Contrast', -100, 100, 1, 'light'], ['highlights', 'Highlights', -100, 100, 1, 'light'],
  ['shadows', 'Shadows', -100, 100, 1, 'light'], ['saturation', 'Saturation', -100, 100, 1, 'color'],
  ['warmth', 'Warmth', -100, 100, 1, 'color'], ['tint', 'Tint', -100, 100, 1, 'color']
];

function buildSliders() {
  for (const [key, label, min, max, step, section] of controlDefs) {
    const row = document.createElement('label');
    row.className = 'range-control';
    row.innerHTML = `<span><span>${label}</span><output>0</output></span><input data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="0">`;
    if (key === 'brilliance') {
      row.title = 'Lifts darker detail and softens bright areas.';
    }
    (section === 'light' ? els.lightControls : els.colorControls).append(row);
  }
}

function activeClip() { return state.clips.find(clip => clip.id === state.activeId) || null; }

function ensureEdit(clip) {
  if (!clip) return { ...DEFAULT_EDIT };
  if (!state.edits[clip.id]) state.edits[clip.id] = { ...DEFAULT_EDIT, trimEnd: Number(clip.duration) || 0 };
  state.edits[clip.id] = { ...DEFAULT_EDIT, trimEnd: Number(clip.duration) || 0, ...state.edits[clip.id] };
  return state.edits[clip.id];
}

function resolvedProfile(clip, edit = ensureEdit(clip)) {
  return edit.profile === 'auto' ? clip?.profile : edit.profile;
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${(safe % 60).toFixed(2).padStart(5, '0')}`;
}

function formatDuration(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return minutes ? `${minutes}:${String(remainder).padStart(2, '0')}` : `0:${String(remainder).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(value / 1e6))} MB`;
}

function formatFps(fps) {
  const value = Number(fps);
  if (!Number.isFinite(value)) return '?';
  return value.toFixed(2).replace(/\.00$/, '');
}

function pathTail(path) { return path ? path.split(/[\\/]/).filter(Boolean).pop() || path : ''; }

function clipNumber(clip) { return library?.clipNumber(clip) ?? null; }
function captureTime(clip) { return library?.captureTime(clip) || ''; }
function membership(clipId) { return library?.membership(state.organization, clipId) || state.organization.assignments?.[clipId] || { projectId: '', chapterId: '' }; }
function inChapter(member, chapterId) { return library?.inChapter(state.organization, member, chapterId) ?? member.chapterId === chapterId; }
function orderedClips(clips) { return library?.orderedClips(clips, state.view.sort) || [...clips]; }
function favoritesSet() { return new Set(state.organization.favorites || []); }

function clipLabel(clip) {
  const number = clipNumber(clip);
  return number == null ? 'Clip' : `#${String(number).padStart(4, '0')}`;
}

function profileLabel(clip) {
  const edit=ensureEdit(clip);
  return edit.profile==='auto'?(clip.profile&&clip.profile!=='Unknown'?`Auto: ${clip.profile}`:'Profile unknown'):`Manual: ${edit.profile}`;
}
function profileDescription(clip) {
  const detected=clip.profile||'Unknown',edit=ensureEdit(clip);
  const source=detected==='Unknown'?'Recording profile could not be determined from file metadata.':`Detected profile: ${detected}.`;
  return `${source} ${edit.profile==='auto'?'Using automatic detection.':`Using ${edit.profile} by manual choice.`}`;
}
function detectedSummary(clips) {
  const counts=new Map();
  for(const clip of clips){const profile=clip.profile||'Unknown';counts.set(profile,(counts.get(profile)||0)+1);}
  return [...counts].sort(([a],[b])=>a.localeCompare(b)).map(([profile,count])=>`${count} ${profile}`).join(', ');
}

function timeLabel(clip) {
  const value = captureTime(clip);
  if (!value) return '';
  const match = value.match(/T(\d{2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function dateLabel(value) {
  if (!value) return 'Unknown date';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value.slice(0, 10);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function projectById(id) { return state.organization.projects?.find(project => project.id === id) || null; }
function chapterById(project, id) { return project?.chapters?.find(chapter => chapter.id === id) || null; }

function currentView() {
  return {
    projectId: state.view.projectId || '', chapterId: state.view.chapterId || '', sort: state.view.sort || 'oldest',
    activeId: state.activeId, playhead: state.playhead, selected: [...state.selected],
    search: els.search.value, profile: els.profileFilter.value, date: els.dateFilter.value,
    favoritesOnly: els.favoritesFilter.getAttribute('aria-pressed') === 'true',
    selectedOnly: els.selectedFilter.getAttribute('aria-pressed') === 'true'
  };
}

function savePayload() {
  state.view = { ...state.view, ...currentView() };
  return { edits: state.edits, exportSettings: state.exportSettings, organization: state.organization, exportPresets: state.exportPresets, view: state.view };
}

function friendlyError(error, fallback = 'Something went wrong. Try again.') {
  const raw = typeof error === 'string' ? error : error?.message;
  if (!raw) return fallback;
  if (/cancel/i.test(raw)) return 'The action was cancelled.';
  if (/permission|access|eperm/i.test(raw)) return 'Pocket Room could not access that folder. Choose another folder or update its permissions.';
  if (/disk|space|enospc/i.test(raw)) return 'There is not enough disk space to finish this action.';
  return raw.length > 180 ? fallback : raw;
}

function toast(message, type = '') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  els.toastRegion.append(item);
  setTimeout(() => item.remove(), 3800);
}

function setRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const percent = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--value', `${percent}%`);
}

function updateSourceHeader() {
  els.sourceName.textContent = state.source ? pathTail(state.source) : 'No folder selected';
  els.sourceName.title = state.source || '';
  els.clipCount.textContent = `${state.clips.length} clip${state.clips.length === 1 ? '' : 's'}`;
  els.rescan.disabled = !state.source;
}

function updateSelectionUI() {
  const count = state.selected.size;
  const visibleSelected = filteredClips().filter(clip => state.selected.has(clip.id)).length;
  const hiddenSelected = count - visibleSelected;
  els.selectionSummary.textContent = count ? `${count} selected${hiddenSelected ? `, ${hiddenSelected} hidden` : ''}` : 'Select clips to export';
  els.exportCount.textContent = count ? `${count} clip${count === 1 ? '' : 's'} ready` : 'No clips selected';
  els.startExport.disabled = count === 0 || state.exporting;
  updateScope();
  els.clearSelection.style.visibility = count ? 'visible' : 'hidden';
  const visible = filteredClips();
  const allVisibleSelected = visible.length > 0 && visible.every(clip => state.selected.has(clip.id));
  els.selectAllFiltered.textContent = allVisibleSelected ? 'Unselect all' : 'Select all';
  els.selectAllFiltered.disabled = visible.length === 0;
  els.assignCount.textContent = count ? `${count} clip${count === 1 ? '' : 's'} selected` : 'No clips selected';
  els.assignSelected.disabled = count === 0;
  $$('.clip-card').forEach(card => {
    const checkbox = $('input[type="checkbox"]', card);
    if (checkbox) checkbox.checked = state.selected.has(card.dataset.id);
  });
}

function selectionChanged() {
  finishAdjustment();
  if (!state.selected.size) state.bulk=false;
  if (els.selectedFilter.getAttribute('aria-pressed') === 'true') applyFilters();
  else updateSelectionUI();
  renderActiveClip();
  scheduleSave();
}

function selectionMatches() {
  const scope=$('#selection-scope').value;
  let clips;
  if(scope==='view')clips=filteredClips();
  else if(scope==='trip')clips=state.clips.filter(c=>!state.view.projectId||membership(c.id).projectId===state.view.projectId);
  else {
    const [projectId,chapterId]=JSON.parse(scope);
    clips=state.clips.filter(c=>{const m=membership(c.id);return m.projectId===projectId&&inChapter(m,chapterId);});
  }
  const text=$('#selection-numbers').value.trim();
  if(!text)return clips;
  const ranges=text.split(',').map(part=>{
    const match=part.trim().match(/^#?(\d+)(?:\s*[-–]\s*#?(\d+))?$/);
    if(!match)throw new Error('Use clip numbers or ranges, like 107-157, 162.');
    const lo=Number(match[1]),hi=Number(match[2]??match[1]);
    if(!Number.isSafeInteger(lo)||!Number.isSafeInteger(hi)||lo>hi)throw new Error('Each range must start with the lower clip number.');
    return [lo,hi];
  });
  return clips.filter(c=>{const n=clipNumber(c);return n!==null&&ranges.some(([lo,hi])=>n>=lo&&n<=hi);});
}
function previewSelection() {
  const status=$('#selection-match-count');let clips=[],error='';
  try{clips=selectionMatches();}catch(e){error=e.message;}
  status.classList.toggle('invalid',Boolean(error));
  $('#selection-numbers').setAttribute('aria-invalid',String(Boolean(error)));
  const visible=new Set(filteredClips().map(c=>c.id));
  const hidden=clips.filter(c=>!visible.has(c.id)).length;
  status.textContent=error||`${clips.length} matching clip${clips.length===1?'':'s'}${hidden?`, ${hidden} hidden by your current filters`:''}.`;
  $('#selection-scope-hint').textContent=$('#selection-scope').value==='view'?'Uses all current filters, including Selected.':'Uses the whole group, regardless of search, date, profile or other filters.';
  $('#add-selection').disabled=$('#replace-selection').disabled=Boolean(error)||!clips.length;
}
function openSelection() {
  finishAdjustment();
  const select=$('#selection-scope');select.replaceChildren();
  select.add(new Option('Current filtered clips','view'));
  select.add(new Option(state.view.projectId?'Entire current trip':'Entire library','trip'));
  for(const project of state.organization.projects.filter(p=>!state.view.projectId||p.id===state.view.projectId)){
    const group=document.createElement('optgroup');group.label=project.name;
    for(const chapter of project.chapters)group.append(new Option(chapter.name,JSON.stringify([project.id,chapter.id])));
    select.append(group);
  }
  $('#selection-numbers').value='';previewSelection();$('#selection-dialog').showModal();$('#selection-numbers').focus();
}
function applySelection(replace=false) {
  let clips;try{clips=selectionMatches();}catch{previewSelection();return;}
  if(!clips.length)return;
  finishAdjustment();
  if(replace)state.selected.clear();
  for(const clip of clips)state.selected.add(clip.id);
  state.selectionAnchor=clips[0].id;
  $('#selection-dialog').close();selectionChanged();
}

function populateFilters() {
  const currentProfile = els.profileFilter.value;
  const currentDate = els.dateFilter.value;
  const profiles = [...new Set(state.clips.map(c => c.profile).filter(Boolean))].sort();
  const dates = [...new Set(state.clips.map(c => captureTime(c).slice(0, 10)).filter(Boolean))].sort().reverse();
  els.profileFilter.innerHTML = '<option value="">Detected: all</option>' + profiles.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  els.dateFilter.innerHTML = '<option value="">Any date</option>' + dates.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  els.profileFilter.value = profiles.includes(currentProfile) ? currentProfile : '';
  els.dateFilter.value = dates.includes(currentDate) ? currentDate : '';
  els.projectFilter.innerHTML = '<option value="">All trips</option>' + (state.organization.projects || []).map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('');
  els.projectFilter.value = projectById(state.view.projectId) ? state.view.projectId : '';
  renderChapterChips();
}

function renderChapterChips() {
  const project = projectById(state.view.projectId);
  if (!project) { els.chapterChips.innerHTML = ''; return; }
  const members = state.clips.map(clip => membership(clip.id)).filter(member => member.projectId === project.id);
  const count = chapterId => members.filter(member => inChapter(member, chapterId)).length;
  els.chapterChips.innerHTML = [{ id: '', name: 'All' }, ...(project.chapters || [])].map(chapter => `<button class="chapter-chip${state.view.chapterId === chapter.id ? ' active' : ''}" data-chapter-id="${escapeHtml(chapter.id)}" type="button">${escapeHtml(chapter.name)} <b>${count(chapter.id)}</b></button>`).join('');
  $$('.chapter-chip', els.chapterChips).forEach(button => button.addEventListener('click', () => {
    state.view.chapterId = button.dataset.chapterId;
    applyFilters(true);
  }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function filteredClips() {
  const query = els.search.value.trim().toLowerCase();
  const favorites = favoritesSet();
  return orderedClips(state.clips.filter(clip => {
    const member = membership(clip.id);
    const matchesQuery = !query || [clip.name, clip.camera, clip.profile, clip.path].some(value => String(value || '').toLowerCase().includes(query));
    const matchesProfile = !els.profileFilter.value || clip.profile === els.profileFilter.value;
    const matchesDate = !els.dateFilter.value || captureTime(clip).startsWith(els.dateFilter.value);
    const matchesProject = !state.view.projectId || member.projectId === state.view.projectId;
    const matchesChapter = inChapter(member, state.view.chapterId);
    const matchesFavorite = els.favoritesFilter.getAttribute('aria-pressed') !== 'true' || favorites.has(clip.id);
    const matchesSelected = els.selectedFilter.getAttribute('aria-pressed') !== 'true' || state.selected.has(clip.id);
    return matchesQuery && matchesProfile && matchesDate && matchesProject && matchesChapter && matchesFavorite && matchesSelected;
  }));
}

function applyFilters(save = false) {
  finishAdjustment();
  const clips = filteredClips();
  if (clips.length && !clips.some(clip => clip.id === state.activeId)) setActiveClip(clips[0].id, false);
  else if (!clips.length) {
    state.frameToken += 1;
    stopGradedPreview();
    state.previewToken += 1;
    clearTimeout(state.frameTimer);
    els.video.pause();
    els.video.removeAttribute('src');
    els.video.load();
    els.video.hidden = true;
    els.frame.removeAttribute('src');
    els.frame.hidden = true;
    els.frameLoading.classList.add('hidden');
    state.activeId = null;
    renderActiveClip();
  }
  renderChapterChips();
  renderClips();
  updateNavigation();
  updateClearFilters();
  if (save) scheduleSave();
}

function updateClearFilters() {
  const active = Boolean(els.search.value || els.profileFilter.value || els.dateFilter.value || state.view.chapterId || els.favoritesFilter.getAttribute('aria-pressed') === 'true' || els.selectedFilter.getAttribute('aria-pressed') === 'true');
  els.clearFilters.classList.toggle('hidden', !active);
}

function renderClips() {
  if (state.thumbnailObserver) state.thumbnailObserver.disconnect();
  els.grid.innerHTML = '';
  const clips = filteredClips();
  els.empty.classList.toggle('hidden', state.clips.length > 0);
  els.grid.classList.toggle('hidden', state.clips.length === 0);
  if (state.clips.length && !clips.length) {
    const none = document.createElement('div');
    none.className = 'empty-state';
    none.innerHTML = '<h2>No matching clips</h2><p>Try a different search or filter.</p>';
    els.grid.append(none);
    updateSelectionUI();
    return;
  }
  const fragment = document.createDocumentFragment();
  let lastDate = null;
  const groupDates = state.view.sort === 'oldest' || state.view.sort === 'newest';
  const favorites = favoritesSet();
  for (const clip of clips) {
    const captured = captureTime(clip);
    const dateKey = captured.slice(0, 10) || 'unknown';
    if (groupDates && dateKey !== lastDate) {
      const heading = document.createElement('div');
      heading.className = 'date-heading';
      heading.textContent = dateLabel(captured);
      fragment.append(heading);
      lastDate = dateKey;
    }
    const card = document.createElement('article');
    card.className = `clip-card${clip.id === state.activeId ? ' active' : ''}`;
    card.dataset.id = clip.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.title = clip.name;
    card.setAttribute('aria-label', `Open ${clip.name}`);
    card.innerHTML = `
      <div class="clip-thumb" data-thumb-id="${escapeHtml(clip.id)}"><span class="thumb-skeleton"></span><span class="duration-pill">${formatDuration(clip.duration)}</span></div>
      <label class="clip-check" aria-label="Select ${escapeHtml(clip.name)}"><input type="checkbox" ${state.selected.has(clip.id) ? 'checked' : ''}></label>
      <button class="favorite-card${favorites.has(clip.id) ? ' active' : ''}" type="button" aria-label="${favorites.has(clip.id) ? 'Remove favorite' : 'Add favorite'}">${icon('star')}</button>
      <div class="clip-info"><strong><span>${clipLabel(clip)}</span><time>${escapeHtml(timeLabel(clip))}</time></strong><span class="clip-profile" data-profile-id="${clip.id}" title="${escapeHtml(profileDescription(clip))}">${escapeHtml(profileLabel(clip))}</span><span title="${escapeHtml(clip.camera || 'Camera')}">${escapeHtml(pathTail(clip.camera || 'Camera'))}</span><small class="clip-status" data-status-id="${clip.id}">${clipStatus(clip)}</small></div>`;
    card.addEventListener('click', event => {
      if (event.target.closest('.clip-check, .favorite-card')) return;
      if (event.shiftKey || event.metaKey || event.ctrlKey) selectClip(clip.id,event.shiftKey);
      else state.selectionAnchor=clip.id;
      setActiveClip(clip.id);
    });
    card.addEventListener('keydown', event => {
      if (event.target !== card) return;
      if (event.key === 'Enter') { event.preventDefault(); setActiveClip(clip.id); }
    });
    $('input[type="checkbox"]', card).addEventListener('click', event => {
      selectClip(clip.id,event.shiftKey,event.target.checked);
    });
    $('.favorite-card', card).addEventListener('click', event => { event.stopPropagation(); toggleFavorite(clip.id); });
    fragment.append(card);
  }
  els.grid.append(fragment);
  setupThumbnailObserver();
  updateSelectionUI();
}

function setupThumbnailObserver() {
  state.thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      state.thumbnailObserver.unobserve(entry.target);
      state.thumbQueue.push(entry.target);
    }
    pumpThumbnails();
  }, { root: els.grid, rootMargin: '120px' });
  $$('.clip-thumb[data-thumb-id]', els.grid).forEach(node => state.thumbnailObserver.observe(node));
}

function pumpThumbnails() {
  while (state.thumbLoading < 1 && state.thumbQueue.length) {
    const node = state.thumbQueue.shift();
    if (!node?.isConnected) continue;
    state.thumbLoading += 1;
    pocket.thumbnail(node.dataset.thumbId).then(url => {
      if (!node.isConnected || !url) return;
      const img = new Image();
      img.alt = '';
      img.src = url;
      $('.thumb-skeleton', node)?.remove();
      node.prepend(img);
    }).catch(() => {
      const skeleton = $('.thumb-skeleton', node);
      if (skeleton) skeleton.style.animation = 'none';
    }).finally(() => { state.thumbLoading -= 1; pumpThumbnails(); });
  }
}

function setActiveClip(id, save = true) {
  finishAdjustment();
  state.previewToken += 1;
  const clip = state.clips.find(item => item.id === id);
  if (!clip) return;
  const changed=state.activeId!==id;
  els.video.pause();
  state.activeId = id;
  const edit = ensureEdit(clip);
  state.playhead = changed?edit.trimStart:Math.min(Math.max(state.playhead, edit.trimStart), edit.trimEnd || clip.duration);
  $('span',els.playPreview).textContent='Play preview';
  els.video.hidden = true;
  els.frame.hidden = true;
  $$('.clip-card').forEach(card => card.classList.toggle('active', card.dataset.id === id));
  renderActiveClip();
  queueFrame();
  updateNavigation();
  if (save) scheduleSave();
}

function renderActiveClip() {
  const clip = activeClip();
  const hasClip = Boolean(clip);
  els.placeholder.hidden = hasClip;
  if (!hasClip) els.frame.hidden = true;
  els.beforeHold.classList.toggle('hidden', !hasClip);
  els.editControls.disabled = !hasClip;
  els.resetAll.disabled = !hasClip;
  els.markStart.disabled = !hasClip;
  els.markEnd.disabled = !hasClip;
  els.playPreview.disabled = !hasClip;
  $('#stream-toggle').disabled = !hasClip;
  if(!hasClip){gpu?.clear();$('#profile-notice').hidden=true;$('#color-blocked').hidden=true;$('#mixed-hint').hidden=true;}
  els.seek.disabled = !hasClip;
  els.activeFavorite.disabled = !hasClip;
  if (!clip) {
    els.activeName.textContent = 'No clip selected';
    els.activeMeta.textContent = '';
    els.activeProfile.textContent = '';
    els.currentTime.textContent = formatTime(0);
    els.durationTime.textContent = formatTime(0);
    els.activeFavorite.classList.remove('active');
    els.activeFavorite.innerHTML = icon('star');
    updateNavigation();
    return;
  }
  const edit = ensureEdit(clip);
  els.activeName.textContent = clip.name;
  const member = membership(clip.id);
  const project = projectById(member.projectId);
  const chapter = chapterById(project, member.chapterId);
  const captured = captureTime(clip);
  els.activeMeta.textContent = [clipLabel(clip), chapter?.name, captured ? dateLabel(captured) : '', timeLabel(clip), `${clip.width || '?'} × ${clip.height || '?'}`, `${formatFps(clip.fps)} fps`, formatBytes(clip.size)].filter(Boolean).join(' / ');
  els.activeProfile.textContent = profileLabel(clip);
  els.activeProfile.title = profileDescription(clip);
  els.seek.max = String(Number(clip.duration) || 0);
  els.seek.value = String(state.playhead);
  els.currentTime.textContent = formatTime(state.playhead);
  els.durationTime.textContent = formatTime(clip.duration);
  els.trimStart.textContent = `${Number(edit.trimStart).toFixed(2)}s`;
  els.trimEnd.textContent = `${Number(edit.trimEnd).toFixed(2)}s`;
  const profiles=scopeIds('profile').map(id=>state.edits[id]?.profile??'auto');
  const mixedProfile=state.bulk&&profiles.some(value=>value!==profiles[0]);
  const profileClips=state.bulk?state.clips.filter(c=>state.selected.has(c.id)):[clip];
  const detectedProfiles=[...new Set(profileClips.map(c=>c.profile||'Unknown'))];
  $('option[value="auto"]',els.profileSelect).textContent=`Auto detect: ${detectedProfiles.length===1?(detectedProfiles[0]==='Unknown'?'unknown':detectedProfiles[0]):'mixed profiles'}`;
  $('#mixed-profile').hidden=!mixedProfile;
  els.profileSelect.value = mixedProfile?'mixed':state.bulk?profiles[0]??edit.profile:edit.profile;
  els.activeFavorite.disabled = false;
  const favorite = favoritesSet().has(clip.id);
  els.activeFavorite.classList.toggle('active', favorite);
  els.activeFavorite.innerHTML = icon('star');
  els.activeFavorite.setAttribute('aria-pressed',String(favorite));
  els.profileHint.textContent = state.bulk
    ? `${mixedProfile?'Selected clips have different profile settings.':els.profileSelect.value==='auto'?'Each selected clip uses its own detected profile.':`${els.profileSelect.value} applies to ${profiles.length} selected clip${profiles.length===1?'':'s'}.`} Detected: ${detectedSummary(profileClips)}.`
    : profileDescription(clip);
  for (const input of $$('[data-setting]', els.editControls)) {
    const key = input.dataset.setting;
    const values=scopeIds(key).map(id=>state.edits[id]?.[key]??DEFAULT_EDIT[key]);
    const mixed=values.some(value=>value!==values[0]);
    const value=state.bulk&&adjustments.COLOR_KEYS.includes(key)?values[0]??edit[key]:edit[key];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = value;
    input.dataset.mixed=String(mixed);
    input.setAttribute('aria-valuetext',mixed?'Mixed':String(value));
    if (input.type === 'range') {
      const output = input.closest('.range-control')?.querySelector('output');
      if (output && !output.querySelector('input')) output.textContent = mixed ? 'Mixed' : displayControlValue(key, value);
      setRangeFill(input);
    }
  }
  $('#mixed-hint').hidden=!state.bulk||!$$('[data-setting]',els.editControls).some(input=>adjustments.COLOR_KEYS.includes(input.dataset.setting)&&input.dataset.mixed==='true');
  updateLutAvailability();
  updateSelectionUI();
  refreshStatus();
  setRangeFill(els.seek);
  updateNavigation();
}

function updateNavigation() {
  const clips = filteredClips();
  const index = clips.findIndex(clip => clip.id === state.activeId);
  els.previousClip.disabled = index <= 0;
  els.nextClip.disabled = index < 0 || index >= clips.length - 1;
}

function navigateClip(offset) {
  const clips = filteredClips();
  const index = clips.findIndex(clip => clip.id === state.activeId);
  const next = clips[index + offset];
  if (next) setActiveClip(next.id);
}

function toggleFavorite(id = state.activeId) {
  if (!id) return;
  const favorites = favoritesSet();
  favorites.has(id) ? favorites.delete(id) : favorites.add(id);
  state.organization.favorites = [...favorites];
  applyFilters();
  renderActiveClip();
  if (state.activeId) queueFrame();
  scheduleSave();
}

function displayControlValue(key, value) {
  const numeric = Number(value);
  if (key === 'exposure') return `${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}`;
  return `${numeric > 0 ? '+' : ''}${numeric}`;
}

function lutKey(profile) {
  return ({ 'D-Log2': 'dlog2', 'D-Log': 'dlog', 'D-Log M': 'dlogm' })[profile] || null;
}

function updateLutAvailability() {
  const clip = activeClip();
  if (!clip) return;
  const edit = ensureEdit(clip);
  const profile = resolvedProfile(clip, edit);
  const key = lutKey(profile);
  const lutAvailable = key ? Boolean(state.luts[key]) : false;
  const strength = $('[data-setting="lutStrength"]', els.editControls);
  strength.disabled = state.bulk ? !scopeIds('lutStrength').length : !lutAvailable;
  $('#lut-strength-control').title = lutAvailable ? '' : key ? `No ${profile} LUT is available` : 'This profile does not use a camera LUT';
  const vividAvailable = profile === 'D-Log2' && Boolean(state.luts.dlog2Vivid);
  els.vividRow.classList.toggle('hidden', !vividAvailable);
  const unresolved=profile==='Unknown'||profile==='HLG';
  const notice=$('#profile-notice');notice.hidden=!unresolved;
  notice.textContent=profile==='Unknown'?'Original preview. Choose the recorded input profile to enable color adjustments. BT.709 tags do not identify the recording mode.':'Original preview. HDR grading is not available.';
  const targets=state.bulk?state.clips.filter(c=>state.selected.has(c.id)):[clip];
  const unknown=targets.filter(c=>resolvedProfile(c)==='Unknown').length;
  const hlg=targets.filter(c=>resolvedProfile(c)==='HLG').length;
  const blocked=unknown+hlg>0;
  const reason=unknown?(state.bulk?`${unknown} selected clip${unknown===1?' has':'s have'} an unknown input profile. Choose the recorded profile to enable Brilliance and the other color controls.`:'Choose this clip\'s recorded input profile to enable Brilliance and the other color controls.'):(hlg?'Color controls are unavailable for HLG footage. Select SDR clips, or correct the input profile if it was set incorrectly.':'');
  $('#color-blocked').hidden=!blocked;
  $('#color-blocked-text').textContent=reason;
  $('#edit-previewed').hidden=!state.bulk;
  $('#resolve-profile').textContent=state.bulk?'Choose profile for selected clips':'Choose input profile';
  for(const control of $$('[data-setting]',els.editControls))if(adjustments.COLOR_KEYS.includes(control.dataset.setting)){
    control.disabled=blocked||(!state.bulk&&control.dataset.setting==='lutStrength'&&!lutAvailable);
    control.setAttribute('aria-describedby','color-blocked-text mixed-hint');
    control.closest('.range-control').title=blocked?reason:control.dataset.setting==='lutStrength'&&!state.bulk&&!lutAvailable?'This input profile does not use a camera LUT.':'';
  }
  els.profileSelect.disabled=false;
  $('[data-setting="vivid"]').disabled=state.bulk;
  $('[data-setting="mute"]').disabled=state.bulk;
  $('[data-setting="gainDb"]').disabled=state.bulk;
  $('.reset-link[data-reset="profile"]').disabled=false;
  els.markStart.disabled=state.bulk;els.markEnd.disabled=state.bulk;
}

function updateEdit(key,value,render=true) {
  const ids=scopeIds(key);if(!ids.length)return;
  if(!history.pending)history.begin(`Change ${key}`,ids,state.edits);
  for(const id of ids)state.edits[id][key]=value;
  state.previewToken+=1;
  scheduleSave();
  if(render){renderActiveClip();if(gpu?.clip?.id===state.activeId)gpu.setGrade(activeClip(),ensureEdit(activeClip()));else queueFrame();}
  refreshStatus();
}

function queueFrame(before=false){
  const clip=activeClip();if(!clip||!gpu)return;
  const edit=ensureEdit(clip),time=state.playhead,token=++state.frameToken;
  gpu.setGrade(clip,edit,before);els.frame.hidden=true;
  if(gpu.clip?.id===clip.id)return;
  els.frameLoading.classList.remove('hidden');
  gpu.load(clip,time).then(()=>{if(token===state.frameToken)gpu.setGrade(clip,ensureEdit(clip),before);}).catch(error=>{if(token===state.frameToken)toast(friendlyError(error),'error');}).finally(()=>els.frameLoading.classList.add('hidden'));
}

function previewProfileError(clip) {
  const profile = resolvedProfile(clip);
  if (profile === 'Unknown') return 'Choose Normal, D-Log M, D-Log, or D-Log2 to render an edited preview.';
  if (profile === 'HLG') return 'HLG editing is unavailable. Choose SDR footage.';
  return '';
}

function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    const payload = savePayload();
    state.saveChain = state.saveChain.then(() => pocket.save(payload)).catch(error => toast(friendlyError(error, 'Changes could not be saved.'), 'error'));
  }, 300);
}

window.pocketFlush = () => {
  document.activeElement?.matches('.numeric-entry') && document.activeElement.blur();
  finishAdjustment();
  clearTimeout(state.saveTimer);
  const payload = savePayload();
  state.saveChain = state.saveChain.catch(() => {}).then(() => pocket.save(payload));
  return state.saveChain;
};

async function saveSettings(){
  try{await window.pocketFlush();toast('Settings saved.');}
  catch(error){toast(friendlyError(error,'Settings could not be saved.'),'error');}
}

async function chooseSource(useDefault = false) {
  setFolderLoading(true);
  try {
    const result = useDefault ? await pocket.defaultSource() : await pocket.chooseSource();
    if (!result?.source) return;
    state.source = result.source;
    updateSourceHeader();
    await scan(result.source);
  } catch (error) {
    toast(friendlyError(error, 'The folder could not be opened.'), 'error');
  } finally { setFolderLoading(false); }
}

function setFolderLoading(loading) {
  els.openFolder.disabled = loading;
  els.emptyOpen.disabled = loading;
  els.defaultFolder.disabled = loading;
  els.openFolder.textContent = loading ? 'Opening…' : 'Open folder';
}

async function scan(path) {
  els.scanProgress.classList.remove('hidden');
  els.scanCount.textContent = 'Starting';
  els.scanBar.style.width = '2%';
  try {
    const result = await pocket.scan(path);
    if (result?.source) state.source = result.source;
    if (Array.isArray(result?.clips)) state.clips = result.clips;
    if (result?.organization) state.organization = result.organization;
    if (result?.view) state.view = { ...state.view, ...result.view };
    reconcileState();
    renderAll();
  } catch (error) {
    toast(friendlyError(error, 'The folder could not be scanned.'), 'error');
  } finally {
    els.scanProgress.classList.add('hidden');
  }
}

function reconcileState() {
  // A saved trip or chapter can disappear after a rescan. Fall back to all clips.
  const project = projectById(state.view.projectId);
  if (!project) state.view.projectId = '';
  if (!chapterById(project, state.view.chapterId)) state.view.chapterId = '';
  const valid = new Set(state.clips.map(clip => clip.id));
  state.selected = new Set([...state.selected].filter(id => valid.has(id)));
  if(!state.selected.size)state.bulk=false;
  if (state.activeId && !valid.has(state.activeId)) state.activeId = null;
  for (const clip of state.clips) ensureEdit(clip);
  const clips = filteredClips();
  if (clips.length && !clips.some(clip => clip.id === state.activeId)) state.activeId = clips[0].id;
}

function renderAll() {
  updateSourceHeader();
  populateFilters();
  renderClips();
  renderActiveClip();
}

function slugId(name) {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
  return `${base}-${Date.now().toString(36)}`;
}

function renderManageDialog() {
  // Folder trips are rebuilt on every scan, so the dialog explains them instead of editing them.
  const folders = state.organization.folders === true;
  els.libraryDialog.classList.toggle('folder-mode', folders);
  $('#library-dialog-intro').textContent = folders ? 'They match the subfolders of the folder you opened.' : 'Labels stay inside Pocket Room. Original files do not move.';
  const projects = state.organization.projects || [];
  const options = projects.map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`).join('');
  const currentManage = projectById(els.manageProject.value) ? els.manageProject.value : projects[0]?.id || '';
  els.manageProject.innerHTML = options;
  els.assignProject.innerHTML = options;
  els.manageProject.value = currentManage;
  els.assignProject.value = projectById(state.view.projectId) ? state.view.projectId : currentManage;
  els.projectList.innerHTML = projects.map(project => `<div class="manage-row"><input data-project-name="${escapeHtml(project.id)}" value="${escapeHtml(project.name)}" aria-label="Trip name"><button data-rename-project="${escapeHtml(project.id)}" type="button">Save</button></div>`).join('');
  const project = projectById(currentManage);
  els.chapterList.innerHTML = (project?.chapters || []).map(chapter => `<div class="manage-row"><input data-chapter-name="${escapeHtml(chapter.id)}" value="${escapeHtml(chapter.name)}" aria-label="Chapter name"><button data-rename-chapter="${escapeHtml(chapter.id)}" type="button">Save</button></div>`).join('');
  renderAssignChapters();
}

function renderAssignChapters() {
  const project = projectById(els.assignProject.value);
  els.assignChapter.innerHTML = '<option value="">No chapter</option>' + (project?.chapters || []).map(chapter => `<option value="${escapeHtml(chapter.id)}">${escapeHtml(chapter.name)}</option>`).join('');
}

function addProject() {
  const name = els.newProjectName.value.trim();
  if (!name) return;
  state.organization.projects.push({ id: slugId(name), name, chapters: [] });
  els.newProjectName.value = '';
  renderManageDialog(); populateFilters(); scheduleSave();
}

function addChapter() {
  const project = projectById(els.manageProject.value);
  const name = els.newChapterName.value.trim();
  if (!project || !name) return;
  project.chapters ||= [];
  project.chapters.push({ id: slugId(name), name });
  els.newChapterName.value = '';
  renderManageDialog(); populateFilters(); scheduleSave();
}

function handleManageClick(event) {
  const projectId = event.target.dataset.renameProject;
  if (projectId) {
    const project = projectById(projectId);
    const name = $(`[data-project-name="${CSS.escape(projectId)}"]`, els.projectList)?.value.trim();
    if (project && name) { project.name = name; renderManageDialog(); populateFilters(); scheduleSave(); }
  }
  const chapterId = event.target.dataset.renameChapter;
  if (chapterId) {
    const project = projectById(els.manageProject.value);
    const chapter = chapterById(project, chapterId);
    const name = $(`[data-chapter-name="${CSS.escape(chapterId)}"]`, els.chapterList)?.value.trim();
    if (chapter && name) { chapter.name = name; renderManageDialog(); renderChapterChips(); renderActiveClip(); scheduleSave(); }
  }
}

function assignSelectedClips() {
  if (!state.selected.size || !els.assignProject.value) return;
  state.organization.assignments ||= {};
  for (const id of state.selected) state.organization.assignments[id] = { projectId: els.assignProject.value, chapterId: els.assignChapter.value };
  populateFilters(); applyFilters(); renderActiveClip(); scheduleSave();
  toast(`${state.selected.size} selected clip${state.selected.size === 1 ? '' : 's'} assigned.`);
}

function showTab(name) {
  $$('.tab').forEach(tab => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  $('#edit-panel').classList.toggle('hidden', name !== 'edit');
  $('#export-panel').classList.toggle('hidden', name !== 'export');
}

function resetControls(group='all') {
  const ids=scopeIds(group==='profile'?'profile':'exposure');if(!ids.length)return;
  finishAdjustment();history.begin('Reset adjustments',ids,state.edits);
  for(const id of ids){
    const clip=state.clips.find(c=>c.id===id),edit=ensureEdit(clip);
    if(group==='profile')Object.assign(edit,{profile:'auto',lutStrength:100,vivid:false});
    else if(state.bulk)Object.assign(edit,adjustments.color(DEFAULT_EDIT));
    else if(group==='all')state.edits[id]={...DEFAULT_EDIT,trimEnd:clip.duration};
    else edit[group]=DEFAULT_EDIT[group];
  }
  finishAdjustment();afterAdjustment();
}

// Streaming mode is session-only. It hides the editor so a shared window shows only
// the graded picture, and walks the current filtered order.
const stream={on:false,autoplay:true,idleTimer:null};
function playable(clip){return resolvedProfile(clip)!=='HLG';}
function setStreaming(on){
  if(on===stream.on)return;
  if(on&&!activeClip()){const first=filteredClips().find(playable);if(!first)return toast('No clips to show. Change the filters first.','error');setActiveClip(first.id);}
  if(on&&(els.libraryDialog.open||$('#selection-dialog').open))return;
  finishAdjustment();document.activeElement?.blur();
  stream.on=on;document.body.classList.toggle('streaming',on);$('#stream-bar').hidden=!on;
  gpu?.setMaxSize(on?1920:1280);
  if(on){syncStreamBar();wakeStream();}else{clearTimeout(stream.idleTimer);document.body.classList.remove('stream-idle');renderActiveClip();}
}
function wakeStream(){
  if(!stream.on)return;
  document.body.classList.remove('stream-idle');clearTimeout(stream.idleTimer);
  stream.idleTimer=setTimeout(()=>{if(stream.on&&!$('#stream-bar').matches(':hover'))document.body.classList.add('stream-idle');},2500);
}
function syncStreamBar(){
  if(!stream.on)return;
  const clip=activeClip(),clips=filteredClips(),index=clips.findIndex(c=>c.id===clip?.id);
  const member=clip?membership(clip.id):{},chapter=chapterById(projectById(member.projectId),member.chapterId),captured=clip?captureTime(clip):'';
  $('#stream-title').textContent=clip?(chapter?.name||clipLabel(clip)):'';
  $('#stream-meta').textContent=clip?[chapter?clipLabel(clip):'',captured?dateLabel(captured):''].filter(Boolean).join(' / '):'';
  $('#stream-count').textContent=index<0?'':`${index+1} of ${clips.length}`;
  $('#stream-previous').disabled=index<=0;$('#stream-next').disabled=index<0||index>=clips.length-1;
  const paused=els.video.paused;const play=$('#stream-play');
  play.innerHTML=icon(paused?'play':'pause');play.setAttribute('aria-label',paused?'Play':'Pause');
  syncStreamProgress();
}
function syncStreamProgress(){
  const clip=activeClip();if(!clip)return;const edit=ensureEdit(clip),end=edit.trimEnd||clip.duration,span=Math.max(.01,end-edit.trimStart);
  $('#stream-progress').style.width=`${Math.min(100,Math.max(0,(state.playhead-edit.trimStart)/span*100))}%`;
}
// Moves through the filtered order, skipping clips that cannot play, and keeps playing.
function streamStep(offset,auto=false){
  const clips=filteredClips();let index=clips.findIndex(c=>c.id===state.activeId);
  do index+=offset;while(clips[index]&&!playable(clips[index]));
  const next=clips[index];
  if(!next){if(auto)syncStreamBar();return;}
  setActiveClip(next.id);syncStreamBar();playPreview();
}
function stopGradedPreview(){gpu?.clear();}
async function playPreview(){
  const clip=activeClip();if(!clip)return;
  if(resolvedProfile(clip)==='HLG')return toast('HLG editing is unavailable. Choose SDR footage.','error');
  try{if(!els.video.paused){els.video.pause();$('span',els.playPreview).textContent='Play preview';return;}
    await gpu.load(clip,state.playhead);if(state.activeId!==clip.id)return;gpu.setGrade(clip,ensureEdit(clip));await gpu.play();if(state.activeId===clip.id)$('span',els.playPreview).textContent=els.video.paused?'Play preview':'Pause';
  }catch(error){toast(friendlyError(error),'error');}
}

function validateExport() {
  if (!state.selected.size) return 'Select at least one clip to export.';
  if (!state.output) return 'Choose an output folder.';
  const unknown = [...state.selected].map(id => state.clips.find(clip => clip.id === id)).filter(Boolean).filter(clip => resolvedProfile(clip) === 'Unknown');
  if (unknown.length) return `${unknown.length} selected clip${unknown.length === 1 ? ' has' : 's have'} an unknown profile. Choose Normal, D-Log M, D-Log, or D-Log2 in the inspector before exporting.`;
  const hlg = [...state.selected].map(id => state.clips.find(clip => clip.id === id)).filter(Boolean).filter(clip => resolvedProfile(clip) === 'HLG');
  if (hlg.length) return `${hlg.length} selected clip${hlg.length === 1 ? ' uses' : 's use'} HLG. Choose SDR footage before exporting.`;
  const maxMB = els.maxSize.value;
  if (maxMB !== '' && Number(maxMB) <= 0) return 'Maximum size must be greater than 0 MB.';
  return '';
}

async function startExport() {
  const error = validateExport();
  els.exportError.classList.toggle('hidden', !error);
  els.exportError.textContent = error;
  if (error) return;
  state.exporting = true;
  els.startExport.disabled = true;
  els.cancelExport.classList.remove('hidden');
  els.revealExports.classList.add('hidden');
  els.exportJob.classList.remove('hidden');
  els.exportState.textContent = 'Starting export';
  try {
    await pocket.export({
      ids: orderedClips(state.clips.filter(clip => state.selected.has(clip.id))).map(clip => clip.id), edits: state.edits,
      options: { resolution: state.exportSettings.resolution, quality: state.exportSettings.quality, maxMB: state.exportSettings.maxMB === '' ? null : Number(state.exportSettings.maxMB) },
      output: state.output
    });
  } catch (err) {
    state.exporting = false;
    els.cancelExport.classList.add('hidden');
    els.startExport.disabled = false;
    els.exportError.textContent = friendlyError(err, 'The export could not be started.');
    els.exportError.classList.remove('hidden');
  }
}

function handleExport(event = {}) {
  for(const item of event.items||[])if(item.status==='done'&&item.receipt)state.exportRecords[item.id]=item.receipt;
  refreshStatus();
  const progress = Math.max(0, Math.min(1, Number(event.progress) || 0));
  els.exportJob.classList.remove('hidden');
  els.exportPercent.textContent = `${Math.round(progress * 100)}%`;
  els.exportBar.style.width = `${progress * 100}%`;
  els.exportItems.innerHTML = (event.items || []).map(item => `
    <div class="export-item ${escapeHtml(item.status)}">
      <strong title="${escapeHtml(item.error || item.path || '')}">${escapeHtml(item.name)}</strong><span>${escapeHtml(item.status)}</span>
      <div class="mini-progress"><i style="width:${Math.max(0, Math.min(100, Number(item.progress) > 1 ? Number(item.progress) : Number(item.progress || 0) * 100))}%"></i></div>
    </div>`).join('');
  const labels = { running: 'Exporting', complete: 'Export complete', 'completed-with-errors': 'Finished with errors', cancelled: 'Export cancelled' };
  els.exportState.textContent = labels[event.state] || 'Exporting';
  state.exporting = event.state === 'running';
  els.cancelExport.classList.toggle('hidden', !state.exporting);
  els.startExport.disabled = state.exporting || state.selected.size === 0;
  if (event.state === 'complete') {
    els.revealExports.classList.remove('hidden');
    toast('Export complete.');
  }
  if (event.state === 'completed-with-errors') {
    els.revealExports.classList.remove('hidden');
    toast('Export finished with errors.', 'error');
  }
  if (event.state === 'cancelled') toast('Export cancelled.');
  const failed = (event.items || []).find(item => item.status === 'failed');
  if (failed) {
    els.exportError.textContent = `${failed.name}: ${failed.error || 'Export failed.'}`;
    els.exportError.classList.remove('hidden');
  }
}

function bindEvents() {
  els.openFolder.addEventListener('click', () => chooseSource());
  els.emptyOpen.addEventListener('click', () => chooseSource());
  els.defaultFolder.addEventListener('click', () => chooseSource(true));
  els.rescan.addEventListener('click', () => scan(state.source));
  $('#open-selection').addEventListener('click',openSelection);
  $('#close-selection').addEventListener('click',()=>$('#selection-dialog').close());
  $('#selection-scope').addEventListener('change',previewSelection);
  $('#selection-numbers').addEventListener('input',previewSelection);
  $('#selection-form').addEventListener('submit',event=>{event.preventDefault();applySelection();});
  $('#replace-selection').addEventListener('click',()=>applySelection(true));
  els.clearSelection.addEventListener('click', () => { state.selected.clear(); selectionChanged(); });
  els.selectAllFiltered.addEventListener('click', () => {
    const visible = filteredClips();
    const allSelected = visible.length > 0 && visible.every(clip => state.selected.has(clip.id));
    for (const clip of visible) allSelected ? state.selected.delete(clip.id) : state.selected.add(clip.id);
    selectionChanged();
  });
  [els.search, els.profileFilter, els.dateFilter].forEach(input => input.addEventListener(input === els.search ? 'input' : 'change', () => applyFilters(true)));
  els.projectFilter.addEventListener('change', () => { state.view.projectId = els.projectFilter.value; state.view.chapterId = ''; applyFilters(true); });
  els.sort.addEventListener('change', () => { state.view.sort = els.sort.value; applyFilters(true); });
  [els.favoritesFilter, els.selectedFilter].forEach(button => button.addEventListener('click', () => {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    applyFilters(true);
  }));
  els.clearFilters.addEventListener('click', () => {
    els.search.value = ''; els.profileFilter.value = ''; els.dateFilter.value = '';
    state.view.chapterId = '';
    els.favoritesFilter.setAttribute('aria-pressed', 'false'); els.selectedFilter.setAttribute('aria-pressed', 'false');
    applyFilters(true);
  });
  els.previousClip.addEventListener('click', () => navigateClip(-1));
  els.nextClip.addEventListener('click', () => navigateClip(1));
  els.activeFavorite.addEventListener('click', () => toggleFavorite());
  els.manageLibrary.addEventListener('click', () => { renderManageDialog(); els.libraryDialog.showModal(); });
  els.manageProject.addEventListener('change', renderManageDialog);
  els.assignProject.addEventListener('change', renderAssignChapters);
  els.createProject.addEventListener('click', addProject);
  els.createChapter.addEventListener('click', addChapter);
  els.projectList.addEventListener('click', handleManageClick);
  els.chapterList.addEventListener('click', handleManageClick);
  els.assignSelected.addEventListener('click', assignSelectedClips);
  $$('.tab').forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab)));

  els.seek.addEventListener('input', () => {
    state.playhead = Number(els.seek.value);
    gpu?.seek(state.playhead);
    els.currentTime.textContent = formatTime(state.playhead);
    setRangeFill(els.seek);
    queueFrame();
  });
  els.markStart.addEventListener('click', () => {
    const clip = activeClip(); if (!clip) return;
    const edit = ensureEdit(clip);
    if (state.playhead >= edit.trimEnd) return toast('Trim start must be before trim end.', 'error');
    updateEdit('trimStart', state.playhead);finishAdjustment();
  });
  els.markEnd.addEventListener('click', () => {
    const clip = activeClip(); if (!clip) return;
    const edit = ensureEdit(clip);
    if (state.playhead <= edit.trimStart) return toast('Trim end must be after trim start.', 'error');
    updateEdit('trimEnd', state.playhead);finishAdjustment();
  });
  els.playPreview.addEventListener('click', playPreview);
  $('#stream-toggle').addEventListener('click',()=>setStreaming(true));
  $('#stream-exit').addEventListener('click',()=>setStreaming(false));
  $('#stream-play').addEventListener('click',playPreview);
  $('#stream-previous').addEventListener('click',()=>streamStep(-1));
  $('#stream-next').addEventListener('click',()=>streamStep(1));
  $('#stream-autoplay').addEventListener('change',event=>{stream.autoplay=event.target.checked;event.target.blur();});
  for(const type of ['mousemove','pointerdown','wheel'])window.addEventListener(type,wakeStream,{passive:true});
  $('.viewer-stage').addEventListener('click',()=>{if(stream.on)playPreview();});

  const showBefore = event => { event.preventDefault(); els.beforeHold.classList.add('held'); queueFrame(true, true); };
  const showAfter = event => { event.preventDefault(); els.beforeHold.classList.remove('held'); queueFrame(false, true); };
  els.beforeHold.addEventListener('pointerdown', showBefore);
  els.beforeHold.addEventListener('pointerup', showAfter);
  els.beforeHold.addEventListener('pointerleave', event => { if (els.beforeHold.classList.contains('held')) showAfter(event); });
  els.beforeHold.addEventListener('pointercancel', showAfter);

  els.profileSelect.addEventListener('change', () => {updateEdit('profile', els.profileSelect.value);finishAdjustment();});
  $$('[data-setting]',els.editControls).forEach(input=>{
    const key=input.dataset.setting;
    input.addEventListener('pointerdown',()=>{finishAdjustment();history.begin(`Change ${key}`,scopeIds(key),state.edits);});
    input.addEventListener(input.type==='checkbox'?'change':'input',()=>{
      updateEdit(key,input.type==='checkbox'?input.checked:Number(input.value));
      if(input.type==='checkbox')finishAdjustment();
    });
    input.addEventListener('change',finishAdjustment);
    input.addEventListener('blur',finishAdjustment);
    input.addEventListener('keyup',finishAdjustment);
    if(input.type==='range'){
      input.addEventListener('dblclick',()=>{finishAdjustment();updateEdit(key,DEFAULT_EDIT[key]);finishAdjustment();});
      const output=input.closest('.range-control').querySelector('output');
      output.tabIndex=0;output.setAttribute('role','button');output.setAttribute('aria-label',`Set ${key}`);
      input.setAttribute('aria-label',input.closest('.range-control').querySelector('span > span').textContent);
      output.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openNumeric(input,output);});
      output.addEventListener('keydown',event=>{if(event.target===output&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openNumeric(input,output);}});
    }
  });
  window.addEventListener('pointerup',finishAdjustment);
  window.addEventListener('pointercancel',finishAdjustment);
  $$('.reset-link').forEach(button => button.addEventListener('click', () => resetControls(button.dataset.reset)));
  els.resetAll.addEventListener('click', () => resetControls('all'));


  [els.resolution, els.quality, els.maxSize].forEach(input => input.addEventListener('change', () => {
    state.exportSettings = { resolution: els.resolution.value, quality: els.quality.value, maxMB: els.maxSize.value };
    renderPresets();refreshStatus();scheduleSave();
  }));
  els.chooseOutput.addEventListener('click', async () => {
    try {
      const result = await pocket.chooseOutput();
      if (result?.output) { state.output = result.output; els.outputPath.textContent = result.output; els.outputPath.title = result.output; }
    } catch (error) { toast(friendlyError(error, 'The output folder could not be selected.'), 'error'); }
  });
  els.startExport.addEventListener('click', startExport);
  els.cancelExport.addEventListener('click', async () => {
    els.cancelExport.disabled = true;
    try { await pocket.cancelExport(); } catch (error) { toast(friendlyError(error, 'The export could not be cancelled.'), 'error'); }
    finally { els.cancelExport.disabled = false; }
  });
  els.revealExports.addEventListener('click', () => pocket.reveal().catch(error => toast(friendlyError(error, 'The export folder could not be opened.'), 'error')));
  window.addEventListener('beforeunload', () => {
    window.pocketFlush().catch(() => {});
  });
  window.addEventListener('keydown', event => {
    if((event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();if(!event.repeat)saveSettings();}
  },true);
  window.addEventListener('keydown', event => {
    if(!stream.on||event.metaKey||event.ctrlKey||event.altKey)return;
    wakeStream();
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setStreaming(false);}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopImmediatePropagation();streamStep(event.key==='ArrowLeft'?-1:1);}
  },true);
  window.addEventListener('keydown', event => {
    if($('#selection-dialog').open||els.libraryDialog.open)return;
    const target = event.target;
    if(event.code==='Space'&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!isTextEditing()&&!(target instanceof HTMLSelectElement)&&!target?.matches('input[type=checkbox], [role=switch]')){
      event.preventDefault();
      if(!event.repeat)playPreview();
      return;
    }
    if((event.metaKey||event.ctrlKey)&&!isTextEditing()){
      const key=event.key.toLowerCase();
      const action=key==='z'?(event.shiftKey?'redo':'undo'):event.shiftKey&&key==='c'?'copy':event.shiftKey&&key==='v'?'paste':null;
      if(action){event.preventDefault();editCommand(action);return;}
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target?.isContentEditable || els.libraryDialog.open) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); navigateClip(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); navigateClip(1); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFavorite(); }
    if (event.key.toLowerCase() === 'x' && state.activeId) {
      event.preventDefault();
      state.selectionAnchor=state.activeId;
      state.selected.has(state.activeId) ? state.selected.delete(state.activeId) : state.selected.add(state.activeId);
      selectionChanged();
      if (els.selectedFilter.getAttribute('aria-pressed') !== 'true') renderClips();
    }
  });
}

function scopeIds(key='exposure') {
  if(state.bulk){
    if(key!=='profile'&&!adjustments.COLOR_KEYS.includes(key))return [];
    return state.clips.filter(c=>state.selected.has(c.id)).map(c=>c.id);
  }
  return state.activeId?[state.activeId]:[];
}
function updateScope(){
  const ids=scopeIds(),visible=new Set(filteredClips().map(c=>c.id));
  const hidden=ids.filter(id=>!visible.has(id)).length;
  $('#scope-label').textContent=state.bulk?`Editing ${ids.length} selected clip${ids.length===1?'':'s'}`:'Editing this clip';
  $('#scope-hint').textContent=state.bulk?`${hidden?`${hidden} hidden by filters. `:''}Color and input profile affect all selected clips. Trim and audio stay per clip.`:`${activeClip()?`Editing ${clipLabel(activeClip())} only. `:''}${state.selected.size?`${state.selected.size} selected. Choose Edit selected clips to change them together.`:'Select clips to edit them together.'}`;
  $('#bulk-edit').textContent=state.bulk?'Return to single clip':'Edit selected clips';
  $('#bulk-edit').disabled=!state.bulk&&(!state.selected.size||!state.activeId);
  $('#edit-panel').classList.toggle('bulk-mode',state.bulk);
  $('#copy-color').disabled=!state.activeId;
  $('#paste-color').disabled=!state.colorClipboard||!ids.length;
  els.resetAll.textContent=state.bulk?'Reset selected color':'Reset clip';
  $('#undo-edit').disabled=!history.undoStack.length;
  $('#redo-edit').disabled=!history.redoStack.length;
  $('#undo-edit').title=history.undoStack.length?`Undo ${history.undoStack.at(-1).label}, Cmd+Z`:'Undo, Cmd+Z';
  $('#redo-edit').title=history.redoStack.length?`Redo ${history.redoStack.at(-1).label}, Shift+Cmd+Z`:'Redo, Shift+Cmd+Z';
}
function finishAdjustment(){history.commit(state.edits);if($('#bulk-edit'))updateScope();}
function afterAdjustment(){
  state.previewToken+=1;scheduleSave();renderActiveClip();refreshStatus();
  if(activeClip()){const edit=ensureEdit(activeClip()),previous=state.playhead;state.playhead=Math.max(edit.trimStart,Math.min(state.playhead,edit.trimEnd));if(state.playhead!==previous)gpu?.seek(state.playhead);renderActiveClip();queueFrame();}
}
function selectClip(id,range=false,checked){
  finishAdjustment();
  const ids=range?adjustments.rangeIds(filteredClips(),state.selectionAnchor,id):[id];
  const select=range?true:checked??!state.selected.has(id);
  for(const item of ids)select?state.selected.add(item):state.selected.delete(item);
  if(!range||!state.selectionAnchor)state.selectionAnchor=id;
  selectionChanged();
}
function isTextEditing(){const el=document.activeElement;return el?.isContentEditable||el instanceof HTMLTextAreaElement||(el instanceof HTMLInputElement&&!['range','checkbox','button'].includes(el.type));}
function editCommand(command){
  if(command==='save'){saveSettings();return;}
  if(command==='stream'){setStreaming(!stream.on);return;}
  if(isTextEditing()){
    if(command==='undo'||command==='redo')document.execCommand(command);
    return;
  }
  if(els.libraryDialog.open||$('#selection-dialog').open)return;
  finishAdjustment();
  if(command==='undo'||command==='redo'){
    if(history.move(command,state.edits))afterAdjustment();
  }else if(command==='copy'&&activeClip()){
    state.colorClipboard=adjustments.color(ensureEdit(activeClip()));updateScope();toast('Color adjustments copied.');
  }else if(command==='paste'&&state.colorClipboard){
    const ids=scopeIds();if(!ids.length)return;
    history.begin('Paste color',ids,state.edits);
    for(const id of ids)Object.assign(state.edits[id],state.colorClipboard);
    finishAdjustment();afterAdjustment();
  }
  updateScope();
}
function openNumeric(slider,output){
  if(slider.disabled||els.editControls.disabled||output.querySelector('input'))return;
  finishAdjustment();
  const input=document.createElement('input');input.className='numeric-entry';input.type='number';input.min=slider.min;input.max=slider.max;input.step=slider.step;input.setAttribute('aria-label',`Exact ${slider.dataset.setting}`);
  input.value=slider.dataset.mixed==='true'?'':slider.value;input.placeholder=slider.dataset.mixed==='true'?'Mixed':'';
  output.replaceChildren(input);input.focus();input.select();let done=false;
  const commit=(cancel=false)=>{
    if(done)return;done=true;
    const value=Number(input.value);
    if(!cancel&&input.value.trim()!==''&&Number.isFinite(value)){
      const min=Number(slider.min),max=Number(slider.max),step=Number(slider.step);
      const clamped=Math.max(min,Math.min(max,value));
      const rounded=Number((Math.round((clamped-min)/step)*step+min).toFixed(4));
      updateEdit(slider.dataset.setting,rounded);
      finishAdjustment();
    }
    output.replaceChildren();renderActiveClip();
  };
  input.addEventListener('click',event=>event.stopPropagation());
  input.addEventListener('keydown',event=>{
    event.stopPropagation();
    if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();commit(event.key==='Escape');output.focus();}
  });
  input.addEventListener('blur',()=>commit());
}
function clipStatus(clip){
  const labels=[];if(adjustments.edited(clip,ensureEdit(clip)))labels.push('Edited');
  const receipt=state.exportRecords[clip.id];
  if(receipt)labels.push(receipt.signature===adjustments.signature(clip,ensureEdit(clip),state.exportSettings)?'Exported':'Export outdated');
  return labels.join(' / ');
}
function refreshStatus(){
  for(const node of $$('[data-profile-id]')){const clip=state.clips.find(c=>c.id===node.dataset.profileId);if(clip){node.textContent=profileLabel(clip);node.title=profileDescription(clip);}}
  for(const node of $$('[data-status-id]')){const clip=state.clips.find(c=>c.id===node.dataset.statusId);node.textContent=clip?clipStatus(clip):'';}
  $('#clip-status').textContent=activeClip()?clipStatus(activeClip()):'';
}
function renderPresets(){
  const select=$('#preset-select');
  select.innerHTML='<option value="">Custom settings</option><option value="default">1080p balanced</option>'+state.exportPresets.map((p,i)=>`<option value="${i}">${escapeHtml(p.name)}</option>`).join('');
  const current=JSON.stringify(adjustments.exportOptions(state.exportSettings));
  const index=state.exportPresets.findIndex(p=>JSON.stringify(adjustments.exportOptions(p))===current);
  select.value=index>=0?String(index):current===JSON.stringify(adjustments.exportOptions())?'default':'';
}
function bindPolish(){
  $('#resolve-profile').addEventListener('click',()=>{els.profileSelect.scrollIntoView({block:'nearest'});els.profileSelect.focus();});
  $('#edit-previewed').addEventListener('click',()=>{if(state.bulk)$('#bulk-edit').click();});
  for(const [id,command] of [['undo-edit','undo'],['redo-edit','redo'],['copy-color','copy'],['paste-color','paste']])$('#'+id).addEventListener('click',()=>editCommand(command));
  $('#bulk-edit').addEventListener('click',()=>{
    finishAdjustment();state.bulk=!state.bulk;
    if(state.bulk&&!state.selected.has(state.activeId)){
      const first=filteredClips().find(c=>state.selected.has(c.id))||state.clips.find(c=>state.selected.has(c.id));
      if(first)setActiveClip(first.id);
    }
    renderActiveClip();updateScope();
  });
  $('#preset-select').addEventListener('change',()=>{
    const value=$('#preset-select').value;if(!value)return;
    const options=value==='default'?adjustments.exportOptions():adjustments.exportOptions(state.exportPresets[Number(value)]);
    state.exportSettings={...options,maxMB:options.maxMB||''};
    els.resolution.value=String(options.resolution);els.quality.value=options.quality;els.maxSize.value=options.maxMB||'';
    refreshStatus();scheduleSave();
  });
  $('#save-preset').addEventListener('click',()=>{
    const name=$('#preset-name').value.trim();if(!name)return;
    if(els.maxSize.value!==''&&(!Number.isFinite(Number(els.maxSize.value))||Number(els.maxSize.value)<=0)){toast('Maximum size must be greater than 0 MB.','error');return;}
    const preset={name,...adjustments.exportOptions(state.exportSettings)};
    const i=state.exportPresets.findIndex(p=>p.name===name);if(i<0)state.exportPresets.push(preset);else state.exportPresets[i]=preset;
    $('#preset-name').value='';renderPresets();scheduleSave();toast('Export preset saved.');
  });
}

function registerBackendEvents() {
  pocket.onScan(progress => {
    els.scanProgress.classList.remove('hidden');
    const done = Number(progress?.done) || 0;
    const total = Number(progress?.total) || 0;
    els.scanCount.textContent = total ? `${done} / ${total}` : `${done} found`;
    els.scanBar.style.width = `${total ? Math.min(100, (done / total) * 100) : 8}%`;
    if (Array.isArray(progress?.clips)) {
      state.clips = progress.clips;
      reconcileState();
      renderAll();
    }
  });
  pocket.onExport(handleExport);
  pocket.onCommand(editCommand);
}

async function init() {
  if (!pocket) {
    els.empty.querySelector('p').textContent = 'The app connection is unavailable. Restart Pocket Room.';
    [els.openFolder, els.emptyOpen, els.defaultFolder].forEach(button => button.disabled = true);
    return;
  }
  buildSliders();
  decorateIcons();
  setupPreview();
  bindPolish();
  bindEvents();
  registerBackendEvents();
  try {
    const data = await pocket.init();
    state.clips = Array.isArray(data?.clips) ? data.clips : [];
    state.edits = data?.edits && typeof data.edits === 'object' ? data.edits : {};
    state.exportRecords=data?.exportRecords||{};state.exportPresets=data?.exportPresets||[];
    state.luts = data?.luts && typeof data.luts === 'object' ? data.luts : {};
    state.source = data?.source || '';
    state.output = data?.output || '';
    state.organization = data?.organization || state.organization;
    state.view = { ...state.view, ...(data?.view || {}) };
    state.activeId = state.view.activeId || null;
    state.playhead = Number(state.view.playhead) || 0;
    state.selected = new Set(Array.isArray(state.view.selected) ? state.view.selected : []);
    state.exportSettings = { ...state.exportSettings, ...(data?.exportSettings || {}) };
    els.resolution.value = String(state.exportSettings.resolution || '1080');
    els.quality.value = state.exportSettings.quality || 'balanced';
    els.maxSize.value = state.exportSettings.maxMB ?? '';
    renderPresets();
    els.outputPath.textContent = state.output || 'Choose a folder';
    els.outputPath.title = state.output;
    els.search.value = state.view.search || '';
    els.sort.value = state.view.sort || 'oldest';
    els.favoritesFilter.setAttribute('aria-pressed', String(Boolean(state.view.favoritesOnly)));
    els.selectedFilter.setAttribute('aria-pressed', String(Boolean(state.view.selectedOnly)));
    reconcileState();
    renderAll();
    els.profileFilter.value = state.view.profile || '';
    els.dateFilter.value = state.view.date || '';
    applyFilters();
    if (state.activeId) queueFrame(false, true);
  } catch (error) {
    toast(friendlyError(error, 'Pocket Room could not load its saved state.'), 'error');
    renderAll();
  }
}

init();
