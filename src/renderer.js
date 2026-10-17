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
  thumbQueue: [], thumbLoading: 0, exporting: false, preferences: { autoplay: true }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {
  sourceName: $('#source-name'), sourceDetail: $('#source-detail'), clipCount: $('#clip-count'), contextTitle: $('#context-title'), selectionSummary: $('#selection-summary'),
  openFolder: $('#open-folder-button'), emptyOpen: $('#empty-open-folder'), defaultFolder: $('#default-folder-button'),
  rescan: $('#rescan-button'), clearSelection: $('#clear-selection'), grid: $('#clip-grid'), empty: $('#empty-state'),
  selectAllFiltered: $('#select-all-filtered'),
  search: $('#search-input'), profileFilter: $('#profile-filter'), dateFilter: $('#date-filter'),
  showFilter: $('#show-filter'), sidebarList: $('#sidebar-list'), sort: $('#sort-select'), clearFilters: $('#clear-filters'),
  filmstrip: $('#filmstrip'), shell: $('#app-shell'), libraryDialog: $('#library-dialog'), projectList: $('#project-list'),
  chapterList: $('#chapter-list'), manageProject: $('#manage-project-select'), newProjectName: $('#new-project-name'),
  newChapterName: $('#new-chapter-name'), createProject: $('#create-project'), createChapter: $('#create-chapter'),
  assignCount: $('#assign-selection-count'), assignProject: $('#assign-project-select'), assignChapter: $('#assign-chapter-select'),
  assignSelected: $('#assign-selected'),
  scanProgress: $('#scan-progress'), scanCount: $('#scan-count'), scanBar: $('#scan-progress-bar'),
  activeName: $('#active-name'), activeMeta: $('#active-meta'),
  placeholder: $('#viewer-placeholder'), frame: $('#frame-image'), video: $('#preview-video'),
  frameLoading: $('#frame-loading'), beforeHold: $('#before-hold'), seek: $('#seek-slider'),
  currentTime: $('#current-time'), durationTime: $('#duration-time'), markStart: $('#mark-start'),
  markEnd: $('#mark-end'), playPreview: $('#play-preview'), trimStart: $('#trim-start-readout'),
  trimEnd: $('#trim-end-readout'), editControls: $('#edit-controls'), profileSelect: $('#profile-select'),
  profileHint: $('#profile-hint'), resetAll: $('#reset-all'), lookSection: $('#look-section'), moreControls: $('#more-controls'),
  basicControls: $('#basic-controls'), lightControls: $('#light-controls'), colorControls: $('#color-controls'),
  exportCount: $('#export-count'), resolution: $('#resolution-select'), quality: $('#quality-select'),
  maxSize: $('#max-size-input'), outputPath: $('#output-path'), chooseOutput: $('#choose-output'),
  exportError: $('#export-error'), exportJob: $('#export-job'), exportState: $('#export-state'),
  exportPercent: $('#export-percent'), exportBar: $('#export-progress-bar'), exportItems: $('#export-items'),
  startExport: $('#start-export'), cancelExport: $('#cancel-export'), revealExports: $('#reveal-exports'),
  toastRegion: $('#toast-region'), previousClip: $('#previous-clip'), nextClip: $('#next-clip'), activeFavorite: $('#active-favorite')
};

let gpu;
// Filled, rounded play and pause glyphs, shared by the viewer and streaming mode.
const PLAY_GLYPH='<path d="M7 3.9v16.2c0 .9 1 1.4 1.7.9l12.2-8.1c.6-.4.6-1.4 0-1.8L8.7 3c-.7-.5-1.7 0-1.7.9Z"/>';
const PAUSE_GLYPH='<rect x="5.5" y="3.5" width="4.8" height="17" rx="1.4"/><rect x="13.7" y="3.5" width="4.8" height="17" rx="1.4"/>';
function syncPlayButton(){const paused=els.video.paused;$('svg',els.playPreview).innerHTML=paused?PLAY_GLYPH:PAUSE_GLYPH;els.playPreview.setAttribute('aria-label',paused?'Play':'Pause');els.playPreview.classList.toggle('playing',!paused);}
function setupPreview(){
  gpu=new GPUPreview(els.video,$('#grade-canvas'),pocket,time=>{
    state.playhead=time;els.seek.value=time;els.currentTime.textContent=formatTime(time);setRangeFill(els.seek);
    if(stream.on)syncStreamProgress();
    $('span',els.playPreview).textContent=els.video.paused?'Play preview':'Pause';
  });
  gpu.onError=error=>toast(friendlyError(error),'error');
  gpu.onGraded=()=>scheduleLooks();
  gpu.onEnd=clip=>{diag(`end ${clip.name} autoplay=${state.preferences.autoplay}`);if(state.preferences.autoplay&&clip.id===state.activeId)streamStep(1,true);};
  for(const type of ['play','pause','emptied'])els.video.addEventListener(type,()=>{syncPlayButton();syncStreamBar();});
  for(const type of ['seeked','pause','loadeddata'])els.video.addEventListener(type,()=>scheduleLooks());
  for(const type of ['seeked','pause','play'])els.video.addEventListener(type,()=>{const clip=activeClip();if(clip&&resolvedProfile(clip)==='HLG')hlgStill();});
  // While scrubbing an HLG clip, the moving video shows through until the new still is ready.
  els.video.addEventListener('seeking',()=>{els.frame.hidden=true;});
  syncPlayButton();
  window.pocketPreview=gpu;
}

// The three controls people reach for sit on top. The rest wait under More.
const controlDefs = [
  ['exposure', 'Exposure', -3, 3, .05, 'basic'], ['saturation', 'Saturation', -100, 100, 1, 'basic'],
  ['warmth', 'Warmth', -100, 100, 1, 'basic'], ['brilliance', 'Brilliance', -100, 100, 1, 'light'],
  ['contrast', 'Contrast', -100, 100, 1, 'light'], ['highlights', 'Highlights', -100, 100, 1, 'light'],
  ['shadows', 'Shadows', -100, 100, 1, 'light'], ['tint', 'Tint', -100, 100, 1, 'color']
];

function buildSliders() {
  for (const [key, label, min, max, step, section] of controlDefs) {
    const row = document.createElement('label');
    row.className = 'range-control';
    row.innerHTML = `<span><span>${label}</span><output>0</output></span><input data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" value="0">`;
    if (key === 'brilliance') {
      row.title = 'Lifts darker detail and softens bright areas.';
    }
    ({ basic: els.basicControls, light: els.lightControls, color: els.colorControls })[section].append(row);
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
function profileTag(clip) {
  const edit = ensureEdit(clip);
  if (edit.profile !== 'auto') return edit.profile;
  return clip.profile === 'Unknown' ? 'Unknown' : clip.profile === 'HLG' ? 'HLG' : '';
}
// The menu already names the detected profile, so the hint only speaks when there is more to say.
function profileHint(clip) {
  const edit = ensureEdit(clip);
  // A hand-set profile that matches the file needs no comment.
  if (edit.profile !== 'auto' && edit.profile === clip.profile) return '';
  if (edit.profile !== 'auto') return clip.profile === 'Unknown' ? `You set ${edit.profile}. The file does not record its profile.` : `Detected ${clip.profile}. You set ${edit.profile}.`;
  return clip.profile === 'Unknown' ? 'The file does not record how it was recorded. Choose the profile you used.' : '';
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

function dateLabel(value, long = false) {
  if (!value) return 'Unknown date';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value.slice(0, 10);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString(undefined, long ? { weekday: 'long', month: 'long', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
}
function resolutionLabel(clip) {
  const short = Math.min(clip.width || 0, clip.height || 0);
  return short >= 2160 ? '4K' : short >= 1440 ? '2.7K' : short ? `${short}p` : '';
}

function projectById(id) { return state.organization.projects?.find(project => project.id === id) || null; }
function chapterById(project, id) { return project?.chapters?.find(chapter => chapter.id === id) || null; }

function currentView() {
  return {
    projectId: state.view.projectId || '', chapterId: state.view.chapterId || '', sort: state.view.sort || 'oldest',
    activeId: state.activeId, playhead: state.playhead, selected: [...state.selected],
    search: els.search.value, profile: els.profileFilter.value, date: els.dateFilter.value,
    favoritesOnly: Boolean(state.view.favoritesOnly), selectedOnly: Boolean(state.view.selectedOnly), mode: state.view.mode || 'viewer'
  };
}

function savePayload() {
  state.view = { ...state.view, ...currentView() };
  return { edits: state.edits, exportSettings: state.exportSettings, organization: state.organization, exportPresets: state.exportPresets, view: state.view, preferences: state.preferences };
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
  // Two-sided controls fill from their neutral point, so the direction of a change is visible.
  const zero = min < 0 && max > 0 ? (-min / (max - min)) * 100 : 0;
  input.style.setProperty('--value', `${percent}%`);
  input.style.setProperty('--lo', `${Math.min(zero, percent)}%`);
  input.style.setProperty('--hi', `${Math.max(zero, percent)}%`);
}

// The source is named after the card when it is one, like Finder does.
function sourceLabel(path) { const card = path?.match(/^\/Volumes\/([^/]+)/); return card ? card[1] : pathTail(path); }
function plural(n, word) { return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`; }
function updateSourceHeader() {
  els.sourceName.textContent = state.source ? sourceLabel(state.source) : 'No folder';
  els.sourceDetail.textContent = state.source ? `${pathTail(state.source)}, ${plural(state.clips.length, 'clip')}` : 'Choose a folder of clips';
  $('#open-folder-button').title = state.source ? `${state.source}. Click to open another folder.` : 'Open a folder of clips';
  els.rescan.disabled = !state.source;
  updateContextTitle();
}
// The window title names what the browser shows, so the sidebar selection never needs repeating.
function updateContextTitle() {
  const project = projectById(state.view.projectId), chapter = chapterById(project, state.view.chapterId);
  const scope = state.view.favoritesOnly ? 'Favorites' : state.view.selectedOnly ? 'Selected' : chapter?.name.split(' / ').pop() || project?.name || (state.clips.length ? 'All clips' : 'Pocket Room');
  els.contextTitle.textContent = scope;
  els.clipCount.textContent = state.clips.length ? plural(filteredClips().length, 'clip') : '';
}

function updateSelectionUI() {
  const count = state.selected.size;
  const visibleSelected = filteredClips().filter(clip => state.selected.has(clip.id)).length;
  const hiddenSelected = count - visibleSelected;
  els.selectionSummary.textContent = count ? `${count.toLocaleString()} selected${hiddenSelected ? `, ${hiddenSelected} not shown` : ''}` : 'No clips selected';
  els.exportCount.textContent = count ? plural(count, 'clip') + ' selected' : 'No clips selected';
  const chosen = state.clips.filter(clip => state.selected.has(clip.id));
  const seconds = chosen.reduce((sum, clip) => { const e = ensureEdit(clip); return sum + Math.max(0, (e.trimEnd || clip.duration) - e.trimStart); }, 0);
  const graded = chosen.filter(clip => adjustments.edited(clip, ensureEdit(clip))).length;
  const cap = Number(state.exportSettings.maxMB) || 0;
  $('#export-summary').textContent = count ? `${formatDuration(seconds)} in total, ${graded ? `${graded} edited` : 'none edited'}${cap ? `, up to ${cap} MB each` : ''}` : 'Select clips in the grid or the filmstrip.';
  els.startExport.lastChild.textContent = count ? `Send ${plural(count, 'clip')}` : 'Send';
  els.startExport.disabled = count === 0 || state.exporting;
  updateScope();
  els.clearSelection.disabled = !count;
  const visible = filteredClips();
  const allVisibleSelected = visible.length > 0 && visible.every(clip => state.selected.has(clip.id));
  els.selectAllFiltered.textContent = allVisibleSelected ? 'Deselect shown' : 'Select all';
  els.selectAllFiltered.disabled = visible.length === 0;
  els.assignCount.textContent = count ? `${count} clip${count === 1 ? '' : 's'} selected` : 'No clips selected';
  els.assignSelected.disabled = count === 0;
  $$('.clip-card').forEach(card => {
    const checkbox = $('input[type="checkbox"]', card);
    if (checkbox) checkbox.checked = state.selected.has(card.dataset.id);
    card.classList.toggle('selected', state.selected.has(card.dataset.id));
  });
}

function selectionChanged() {
  finishAdjustment();
  if (!state.selected.size) state.bulk=false;
  if (state.view.selectedOnly) applyFilters();
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
  $('#selection-scope-hint').textContent=$('#selection-scope').value==='view'?'Matches what the browser shows now, with its search and filters.':'Includes every clip in the group, even ones that search or filters hide.';
  $('#add-selection').disabled=$('#replace-selection').disabled=Boolean(error)||!clips.length;
}
function openSelection() {
  finishAdjustment();
  const select=$('#selection-scope');select.replaceChildren();
  select.add(new Option('Clips in this view','view'));
  select.add(new Option(state.view.projectId?`All of ${projectById(state.view.projectId)?.name||'this folder'}`:'Whole library','trip'));
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
  renderSidebar();
}

// Sidebar: where you are. The library shortcuts sit above the trips, which open like folders.
const expanded = new Set();
function renderSidebar() {
  const members = state.clips.map(clip => membership(clip.id));
  const favorites = favoritesSet();
  const scopeKey = state.view.favoritesOnly ? 'favorites' : state.view.selectedOnly ? 'selected' : '';
  const row = (attrs, label, count, { selected = false, depth = 0, toggle = '' } = {}) =>
    `<button class="source-row${selected ? ' selected' : ''}" type="button" style="--depth:${depth}" ${attrs}>${toggle}<span class="source-label">${escapeHtml(label)}</span><span class="source-count">${count.toLocaleString()}</span></button>`;
  let html = `<h3>Library</h3>`
    + row('data-scope="all"', 'All clips', state.clips.length, { selected: !scopeKey && !state.view.projectId })
    + row('data-scope="favorites"', 'Favorites', state.clips.filter(c => favorites.has(c.id)).length, { selected: scopeKey === 'favorites' })
    + row('data-scope="selected"', 'Selected', state.selected.size, { selected: scopeKey === 'selected' });
  const projects = state.organization.projects || [];
  if (projects.length) {
    html += `<div class="sidebar-heading"><h3>${state.organization.folders ? 'Folders' : 'Trips'}</h3>${state.organization.folders ? '' : '<button class="text-button" id="manage-library" type="button">Edit</button>'}</div>`;
    for (const p of projects) {
      const inTrip = members.filter(m => m.projectId === p.id);
      const open = expanded.has(p.id), hasChapters = p.chapters?.length > 0;
      const toggle = `<span class="disclosure${open ? ' open' : ''}"${hasChapters ? ` data-toggle="${escapeHtml(p.id)}"` : ''} aria-hidden="true">${hasChapters ? icon('right') : ''}</span>`;
      html += row(`data-project="${escapeHtml(p.id)}"${hasChapters ? ` aria-expanded="${open}"` : ''}`, p.name, inTrip.length, { selected: !scopeKey && state.view.projectId === p.id && !state.view.chapterId, toggle });
      if (open) for (const c of p.chapters) {
        html += row(`data-project="${escapeHtml(p.id)}" data-chapter="${escapeHtml(c.id)}"`, c.name.split(' / ').pop(), inTrip.filter(m => inChapter(m, c.id)).length, { selected: !scopeKey && state.view.projectId === p.id && state.view.chapterId === c.id, depth: 1 + chapterDepth(p, c), toggle: '<span class="disclosure"></span>' });
      }
    }
  }
  els.sidebarList.innerHTML = html;
  updateContextTitle();
}
function chapterDepth(project, chapter) { let depth = 0; for (let c = chapter; c?.parentId && depth < 20; c = chapterById(project, c.parentId)) depth++; return depth; }
// The chevron only opens or closes a trip. The row itself chooses what the browser shows.
function chooseScope(target) {
  const toggle = target.closest('[data-toggle]');
  if (toggle) { const id = toggle.dataset.toggle; expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderSidebar(); return; }
  const row = target.closest('.source-row'); if (!row) return;
  const scope = row.dataset.scope;
  rememberPlace();
  state.view.favoritesOnly = scope === 'favorites'; state.view.selectedOnly = scope === 'selected';
  state.view.projectId = scope ? '' : row.dataset.project || ''; state.view.chapterId = scope ? '' : row.dataset.chapter || '';
  if (state.view.projectId) expanded.add(state.view.projectId);
  els.showFilter.value = scope === 'favorites' || scope === 'selected' ? scope : 'all';
  const place = state.view.places?.[placeKey()];
  if (place?.activeId && place.activeId !== state.activeId && filteredClips().some(c => c.id === place.activeId)) setActiveClip(place.activeId, false);
  applyFilters(true);
  restoreScroll();
}
// Each folder remembers its current clip and how far the grid was scrolled, so going back to
// a trip lands where you left it. Places are saved with the view.
function placeKey() { return state.view.favoritesOnly ? 'favorites' : state.view.selectedOnly ? 'selected' : `${state.view.projectId || ''}/${state.view.chapterId || ''}`; }
function rememberPlace() {
  const places = state.view.places ||= {}, key = placeKey();
  places[key] = { activeId: state.activeId, scroll: state.view.mode === 'grid' ? els.grid.scrollTop : places[key]?.scroll || 0 };
  const keys = Object.keys(places); if (keys.length > 100) delete places[keys[0]];
}
function restoreScroll() { const place = state.view.places?.[placeKey()]; if (place && state.view.mode === 'grid') els.grid.scrollTop = place.scroll || 0; }

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
    const matchesFavorite = !state.view.favoritesOnly || favorites.has(clip.id);
    const matchesSelected = !state.view.selectedOnly || state.selected.has(clip.id);
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
  renderSidebar();
  renderClips();
  updateNavigation();
  updateClearFilters();
  if (save) scheduleSave();
}

function updateClearFilters() {
  const filtered = Boolean(els.profileFilter.value || els.dateFilter.value);
  els.clearFilters.classList.toggle('hidden', !(els.search.value || filtered));
  $('#filter-menu').classList.toggle('active', filtered);
}

// One clip card, two layouts: a tile in the grid, a frame in the viewer's filmstrip.
// Only the visible layout is in the page, so selection and favorites behave the same in both.
function clipContainer() { return state.view.mode === 'grid' ? els.grid : els.filmstrip; }
function renderClips() {
  if (state.thumbnailObserver) state.thumbnailObserver.disconnect();
  const container = clipContainer();
  els.grid.innerHTML = '';
  els.filmstrip.innerHTML = '';
  const clips = filteredClips();
  // With no library there is nothing to inspect or play, so the window shows only the way in.
  els.shell.classList.toggle('no-library', state.clips.length === 0);
  els.empty.classList.toggle('hidden', state.clips.length > 0);
  els.grid.classList.toggle('hidden', state.clips.length === 0);
  if (state.clips.length && !clips.length) {
    const none = document.createElement('div');
    none.className = 'empty-state';
    none.innerHTML = '<h2>No matching clips</h2><p>Try a different search or filter.</p>';
    container.append(none);
    updateSelectionUI();
    return;
  }
  const fragment = document.createDocumentFragment();
  let lastDate = null;
  const groupDates = container === els.grid && (state.view.sort === 'oldest' || state.view.sort === 'newest');
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
    if (state.selected.has(clip.id)) card.classList.add('selected');
    // A card shows only what tells clips apart. Profile appears only when it needs attention.
    card.innerHTML = `
      <div class="clip-thumb" data-thumb-id="${escapeHtml(clip.id)}"><span class="thumb-skeleton"></span><span class="clip-profile" data-profile-id="${clip.id}"${profileTag(clip) ? '' : ' hidden'}>${escapeHtml(profileTag(clip))}</span></div>
      <label class="clip-check" aria-label="Select ${escapeHtml(clip.name)}"><input type="checkbox" ${state.selected.has(clip.id) ? 'checked' : ''}><span aria-hidden="true">${icon('check')}</span></label>
      <button class="favorite-card${favorites.has(clip.id) ? ' active' : ''}" type="button" aria-label="${favorites.has(clip.id) ? 'Remove favorite' : 'Add favorite'}">${icon('star')}</button>
      <div class="clip-info"><strong>${clipLabel(clip)}</strong><small class="clip-status" data-status-id="${clip.id}">${clipStatus(clip)}</small><span class="clip-duration">${formatDuration(clip.duration)}</span></div>`;
    card.addEventListener('click', event => {
      if (event.target.closest('.clip-check, .favorite-card')) return;
      if (event.shiftKey || event.metaKey || event.ctrlKey) selectClip(clip.id,event.shiftKey);
      else state.selectionAnchor=clip.id;
      setActiveClip(clip.id);
    });
    card.addEventListener('dblclick', event => { if (!event.target.closest('.clip-check, .favorite-card')) setMode('viewer'); });
    card.addEventListener('keydown', event => {
      if (event.target !== card) return;
      if (event.key === 'Enter') { event.preventDefault(); setActiveClip(clip.id); setMode('viewer'); }
    });
    $('input[type="checkbox"]', card).addEventListener('click', event => {
      selectClip(clip.id,event.shiftKey,event.target.checked);
    });
    $('.favorite-card', card).addEventListener('click', event => { event.stopPropagation(); toggleFavorite(clip.id); });
    card.addEventListener('contextmenu', event => { event.preventDefault(); openClipMenu(clip.id); });
    card.draggable = hasCurrentExport(clip);
    card.addEventListener('dragstart', event => { event.preventDefault(); dragExports(clip.id); });
    fragment.append(card);
  }
  container.append(fragment);
  setupThumbnailObserver();
  revealActiveClip();
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
  }, { root: clipContainer(), rootMargin: state.view.mode === 'grid' ? '120px' : '0px 400px' });
  $$('.clip-thumb[data-thumb-id]', clipContainer()).forEach(node => state.thumbnailObserver.observe(node));
}

function revealActiveClip() { $('.clip-card.active', clipContainer())?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }

// Grid mode is for picking and exporting, viewer mode for grading and watching.
function setMode(mode, { save = true } = {}) {
  state.view.mode = mode;
  els.shell.classList.toggle('mode-grid', mode === 'grid');
  els.shell.classList.toggle('mode-viewer', mode === 'viewer');
  $('#grid-mode').setAttribute('aria-checked', String(mode === 'grid'));
  $('#viewer-mode').setAttribute('aria-checked', String(mode === 'viewer'));
  // The selection bar follows the clips: under the grid, or under the filmstrip.
  (mode === 'grid' ? $('.browser') : $('.viewer-panel')).insertBefore($('.selection-bar'), mode === 'grid' ? null : $('#stream-bar'));
  renderClips();
  if (mode === 'grid') { els.video.pause(); showTab('export'); }
  else { showTab('edit'); if (state.activeId) queueFrame(); }
  if (save) scheduleSave();
}
// Cmd+Plus and Cmd+Minus size the grid's thumbnails, like Photos. A trackpad pinch does the same.
const THUMB_SIZES = [132, 178, 228, 280];
function setThumbSize(size, save = true) {
  state.view.thumbSize = THUMB_SIZES.includes(size) ? size : 178;
  els.grid.style.setProperty('--thumb', `${state.view.thumbSize}px`);
  revealActiveClip(); if (save) scheduleSave();
}
function stepThumbSize(step) {
  if (state.view.mode !== 'grid') return;
  const index = THUMB_SIZES.indexOf(state.view.thumbSize || 178);
  setThumbSize(step ? THUMB_SIZES[Math.max(0, Math.min(THUMB_SIZES.length - 1, index + step))] : 178);
}
let sidebarChosen = false;
function toggleSidebar() { sidebarChosen = true; els.shell.classList.toggle('sidebar-hidden'); }
// Narrow windows give the width to the picture. Once the user shows or hides the sidebar, their choice wins.
function fitSidebar() { if (!sidebarChosen) els.shell.classList.toggle('sidebar-hidden', window.innerWidth < 1180); }

// Drag a handle to trim. The playhead follows the handle so you see the frame you cut on.
function bindTrimHandle(handle, key) {
  handle.addEventListener('pointerdown', event => {
    const clip = activeClip(); if (!clip || state.bulk) return;
    event.preventDefault(); handle.setPointerCapture(event.pointerId);
    const rect = $('#timeline').getBoundingClientRect();
    const move = ev => {
      const edit = ensureEdit(clip), t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)) * clip.duration;
      const value = Math.round((key === 'trimStart' ? Math.min(t, edit.trimEnd - .2) : Math.max(t, edit.trimStart + .2)) * 100) / 100;
      state.playhead = value; gpu?.seek(value); updateEdit(key, value);
    };
    const up = () => { handle.removeEventListener('pointermove', move); finishAdjustment(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up, { once: true }); handle.addEventListener('pointercancel', up, { once: true });
  });
}
function updateTimeline(clip) {
  const d = Number(clip?.duration) || 0, edit = clip ? ensureEdit(clip) : null;
  const start = d ? edit.trimStart / d * 100 : 0, end = d ? (edit.trimEnd || d) / d * 100 : 100;
  $('#timeline-keep').style.left = `${start}%`; $('#timeline-keep').style.width = `${Math.max(0, end - start)}%`;
  $('#trim-in-handle').style.left = `${start}%`; $('#trim-out-handle').style.left = `${end}%`;
  $('#trim-in-handle').disabled = $('#trim-out-handle').disabled = !clip || state.bulk;
}

const thumbUrls = new Map();
function showThumb(node, url) { const existing = $('img', node); if (existing) { existing.src = url; return; } const img = new Image(); img.alt = ''; img.draggable = false; img.src = url; $('.thumb-skeleton', node)?.remove(); node.prepend(img); }
// Thumbnails show each clip's grade. The key changes when anything that changes the picture does.
function thumbKey(clip) { const edit = ensureEdit(clip); return JSON.stringify([resolvedProfile(clip, edit), ...adjustments.COLOR_KEYS.map(k => edit[k]), edit.vivid, edit.trimStart]); }
// After an edit, cards on screen whose grade changed get a new thumbnail.
let regradeTimer;
function regradeThumbs() {
  clearTimeout(regradeTimer);
  regradeTimer = setTimeout(() => {
    const byId = new Map(state.clips.map(c => [c.id, c]));
    for (const node of $$('.clip-thumb[data-thumb-id]', clipContainer())) {
      const clip = byId.get(node.dataset.thumbId);
      if (clip && node.dataset.thumbKey && node.dataset.thumbKey !== thumbKey(clip) && !state.thumbQueue.includes(node)) state.thumbQueue.unshift(node);
    }
    pumpThumbnails();
  }, 400);
}
function pumpThumbnails() {
  // Three at a time keeps the card busy without starving preview playback.
  while (state.thumbLoading < 3 && state.thumbQueue.length) {
    const node = state.thumbQueue.shift();
    if (!node?.isConnected) continue;
    const clip = state.clips.find(c => c.id === node.dataset.thumbId); if (!clip) continue;
    const key = thumbKey(clip), cacheKey = clip.id + key;
    const cached = thumbUrls.get(cacheKey);
    if (cached) { node.dataset.thumbKey = key; showThumb(node, cached); continue; }
    state.thumbLoading += 1;
    pocket.thumbnail({ id: clip.id, settings: ensureEdit(clip) }).then(url => {
      if (url) thumbUrls.set(cacheKey, url);
      if (node.isConnected && url && thumbKey(clip) === key) { node.dataset.thumbKey = key; showThumb(node, url); }
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
  revealActiveClip();
  renderActiveClip();
  if (state.view.mode !== 'grid') queueFrame();
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
    els.activeName.textContent = 'No clip';
    els.activeMeta.textContent = '';
    els.currentTime.textContent = formatTime(0);
    els.durationTime.textContent = formatTime(0);
    els.activeFavorite.classList.remove('active');
    els.activeFavorite.innerHTML = icon('star');
    updateNavigation();
    return;
  }
  const edit = ensureEdit(clip);
  els.activeName.textContent = clipLabel(clip);
  els.activeName.title = clip.name;
  const member = membership(clip.id);
  const project = projectById(member.projectId);
  const chapter = chapterById(project, member.chapterId);
  const captured = captureTime(clip);
  // The number is the title. The file name stays in the tooltip, and format details sit quietly beside it.
  els.activeMeta.textContent = [captured ? `${dateLabel(captured, true)} at ${timeLabel(clip)}` : '', resolutionLabel(clip), clip.fps ? `${formatFps(clip.fps)} fps` : ''].filter(Boolean).join(', ');
  els.activeMeta.title = [chapter?.name, formatBytes(clip.size)].filter(Boolean).join(', ');
  els.seek.max = String(Number(clip.duration) || 0);
  els.seek.value = String(state.playhead);
  els.currentTime.textContent = formatTime(state.playhead);
  els.durationTime.textContent = formatTime(clip.duration);
  els.trimStart.textContent = `${Number(edit.trimStart).toFixed(2)}s`;
  els.trimEnd.textContent = `${Number(edit.trimEnd).toFixed(2)}s`;
  updateTimeline(clip);
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
    : profileHint(clip);
  els.profileHint.hidden = !els.profileHint.textContent;
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
// Up and Down move a row in the grid. Date headings break the rows, so rows come from where
// the cards sit, and the nearest card in the next row wins.
function navigateRow(direction) {
  const cards = $$('.clip-card', els.grid), current = $('.clip-card.active', els.grid);
  if (!current) return navigateClip(direction);
  const from = current.getBoundingClientRect(), center = from.left + from.width / 2;
  const rows = cards.map(card => ({ card, rect: card.getBoundingClientRect() })).filter(({ rect }) => direction > 0 ? rect.top > from.top + from.height / 2 : rect.top < from.top - from.height / 2);
  if (!rows.length) return;
  const top = direction > 0 ? Math.min(...rows.map(r => r.rect.top)) : Math.max(...rows.map(r => r.rect.top));
  const row = rows.filter(r => Math.abs(r.rect.top - top) < 2);
  const next = row.reduce((best, r) => Math.abs(r.rect.left + r.rect.width / 2 - center) < Math.abs(best.rect.left + best.rect.width / 2 - center) ? r : best);
  setActiveClip(next.card.dataset.id);
}

// Comma and period step one frame, like Final Cut. Steps can leave the trimmed range, so a
// new trim point can be set outside it. The playhead sits mid-frame so the shown frame is exact.
function stepFrame(frames) {
  const clip = activeClip(); if (!clip || state.view.mode === 'grid') return;
  els.video.pause();
  const fps = Number(clip.fps) || 30, last = Math.max(0, Math.floor(clip.duration * fps) - 1);
  const index = Math.max(0, Math.min(last, Math.floor(state.playhead * fps + .001) + frames));
  state.playhead = Math.min(clip.duration, (index + .5) / fps);
  gpu?.seek(state.playhead, true);
  els.seek.value = state.playhead; els.currentTime.textContent = formatTime(state.playhead); setRangeFill(els.seek);
  queueFrame();
}

// Right-click a card for the actions you would otherwise find in several places. The clip
// becomes the current clip first, like Finder highlights what you click, so each action
// acts on what the inspector shows. Copy and paste are the Edit menu commands.
function clipMenuItems(clip) {
  const favorite = favoritesSet().has(clip.id), selected = state.selected.has(clip.id), sep = { type: 'separator' };
  return [
    ...(state.view.mode === 'grid' ? [{ id: 'open', label: 'Open in viewer', accelerator: 'Return' }, sep] : []),
    { id: 'favorite', label: favorite ? 'Remove from favorites' : 'Add to favorites', accelerator: 'F' },
    { id: 'select', label: selected ? 'Deselect' : 'Select', accelerator: 'X' }, sep,
    { id: 'copy', label: 'Copy color adjustments', accelerator: 'Shift+CmdOrCtrl+C' },
    { id: 'paste', label: 'Paste color adjustments', accelerator: 'Shift+CmdOrCtrl+V', enabled: Boolean(state.colorClipboard) }, sep,
    { id: 'reveal', label: 'Show in Finder' },
    { id: 'revealExport', label: 'Show export in Finder', enabled: Boolean(state.exportRecords[clip.id]) }
  ];
}
async function openClipMenu(id) {
  const clip = state.clips.find(c => c.id === id); if (!clip) return;
  if (state.activeId !== id) setActiveClip(id);
  await pocket.clipMenu({ id, items: clipMenuItems(clip) }).catch(error => toast(friendlyError(error), 'error'));
}
function clipAction(choice, id) {
  if (!state.clips.some(c => c.id === id)) return;
  if (choice === 'open') setMode('viewer');
  else if (choice === 'favorite') toggleFavorite(id);
  else if (choice === 'select') selectClip(id);
  else if (choice === 'copy' || choice === 'paste') editCommand(choice);
  else if (choice === 'reveal' || choice === 'revealExport') pocket.showInFinder({ id, exported: choice === 'revealExport' }).catch(error => toast(friendlyError(error), 'error'));
}

// The Look row shows the current frame through each conversion the clip's profile offers, so
// you choose by seeing. Flat is the recording itself. Natural and Vivid are DJI's LUTs.
function currentLook(edit) { return !edit.lutStrength ? 'flat' : edit.vivid ? 'vivid' : 'natural'; }
function renderLook(clip, edit, profile, lutAvailable) {
  els.lookSection.hidden = !lutAvailable;
  if (!lutAvailable) return;
  const look = currentLook(edit), vividAvailable = profile === 'D-Log2' && Boolean(state.luts.dlog2Vivid);
  for (const tile of $$('.look-tile', els.lookSection)) {
    tile.hidden = tile.dataset.look === 'vivid' && !vividAvailable;
    tile.disabled = state.bulk;
    tile.setAttribute('aria-checked', String(!state.bulk && tile.dataset.look === (look === 'vivid' && !vividAvailable ? 'natural' : look)));
  }
  scheduleLooks();
}
function chooseLook(look) {
  const clip = activeClip(); if (!clip || state.bulk) return;
  finishAdjustment(); history.begin('Look', [clip.id], state.edits);
  const edit = ensureEdit(clip);
  if (look === 'flat') edit.lutStrength = 0;
  else { edit.lutStrength = edit.lutStrength || 100; edit.vivid = look === 'vivid'; }
  finishAdjustment(); afterAdjustment();
}
// Tiles are drawn from the paused frame on the GPU, after the picture settles.
let looksTimer;
function scheduleLooks() { clearTimeout(looksTimer); looksTimer = setTimeout(drawLooks, 150); }
function drawLooks() {
  const clip = activeClip(); if (!clip || !gpu || els.lookSection.hidden || state.view.mode === 'grid') return;
  const edit = ensureEdit(clip), strength = (edit.lutStrength || 100) / 100;
  const looks = $$('.look-tile', els.lookSection).filter(t => !t.hidden).map(t => ({ canvas: $('canvas', t), vivid: t.dataset.look === 'vivid', strength: t.dataset.look === 'flat' ? 0 : strength }));
  gpu.drawLooks(clip, edit, looks).catch(() => {});
}

// L flips D-Log2's vivid conversion on the current clip, so the two looks can be compared
// quickly, also while streaming. It is a real, undoable edit.
function toggleVivid() {
  const clip = activeClip(); if (!clip) return;
  if (resolvedProfile(clip) !== 'D-Log2' || !state.luts.dlog2Vivid) return toast('Vivid is only for D-Log2 clips.');
  finishAdjustment(); history.begin('Vivid', [clip.id], state.edits);
  const edit = ensureEdit(clip); edit.vivid = !edit.vivid;
  finishAdjustment(); afterAdjustment();
  toast(edit.vivid ? 'Vivid on' : 'Vivid off');
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
  renderLook(clip, edit, profile, lutAvailable);
  const unresolved=profile==='Unknown';
  const notice=$('#profile-notice');notice.hidden=!unresolved;
  notice.textContent='Original preview. Choose the recorded input profile to enable color adjustments. BT.709 tags do not identify the recording mode.';
  const targets=state.bulk?state.clips.filter(c=>state.selected.has(c.id)):[clip];
  const unknown=targets.filter(c=>resolvedProfile(c)==='Unknown').length;
  const blocked=unknown>0;
  const reason=unknown?(state.bulk?`${unknown} selected clip${unknown===1?' has':'s have'} an unknown input profile. Choose the recorded profile to enable Brilliance and the other color controls.`:'Choose this clip\'s recorded input profile to enable Brilliance and the other color controls.'):'';
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
  if(render){renderActiveClip();if(gpu?.clip?.id===state.activeId){gpu.setGrade(activeClip(),ensureEdit(activeClip()));hlgStill();}else queueFrame();}
  refreshStatus();
}

function queueFrame(before=false){
  const clip=activeClip();if(!clip||!gpu)return;
  const edit=ensureEdit(clip),time=state.playhead,token=++state.frameToken;
  gpu.setGrade(clip,edit,before);if(resolvedProfile(clip)==='HLG')hlgStill(before);else els.frame.hidden=true;
  if(gpu.clip?.id===clip.id)return;
  els.frameLoading.classList.remove('hidden');
  gpu.load(clip,time).then(()=>{if(token===state.frameToken){gpu.setGrade(clip,ensureEdit(clip),before);scheduleLooks();}}).catch(error=>{if(token===state.frameToken)toast(friendlyError(error),'error');}).finally(()=>els.frameLoading.classList.add('hidden'));
}

// HLG is converted by the export engine only, so a paused HLG clip shows the engine's own
// still over the video. It is the exported picture. Playback shows macOS's picture, ungraded.
let hlgTimer, hlgToken = 0, hlgBefore = false;
function hlgStill(before = hlgBefore) {
  clearTimeout(hlgTimer); hlgBefore = before; hlgToken += 1;
  const clip = activeClip();
  if (!clip || resolvedProfile(clip) !== 'HLG' || state.view.mode === 'grid' || !els.video.paused) { els.frame.hidden = true; return; }
  const token = hlgToken;
  hlgTimer = setTimeout(async () => {
    try {
      const url = await pocket.frame({ id: clip.id, time: state.playhead, settings: ensureEdit(clip), before });
      if (token !== hlgToken || state.activeId !== clip.id || !els.video.paused) return;
      els.frame.src = url; els.frame.hidden = false;
    } catch (error) { if (token === hlgToken && !/abort/i.test(error.message)) toast(friendlyError(error), 'error'); }
  }, 150);
}

function previewProfileError(clip) {
  const profile = resolvedProfile(clip);
  if (profile === 'Unknown') return 'Choose Normal, D-Log M, D-Log, or D-Log2 to render an edited preview.';
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
    if (state.activeId) queueFrame();
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
    if (chapter && name) { chapter.name = name; renderManageDialog(); renderSidebar(); renderActiveClip(); scheduleSave(); }
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
const stream={on:false,idleTimer:null};
function playable(clip){return resolvedProfile(clip)!=='HLG';}
function setStreaming(on){
  if(on===stream.on)return;
  if(on&&!activeClip()){const first=filteredClips().find(playable);if(!first)return toast('No clips to show. Change the filters first.','error');setActiveClip(first.id);}
  if(on&&(els.libraryDialog.open||$('#selection-dialog').open))return;
  finishAdjustment();document.activeElement?.blur();
  if(on&&state.view.mode==='grid')setMode('viewer');
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
  play.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${paused?PLAY_GLYPH:PAUSE_GLYPH}</svg>`;play.setAttribute('aria-label',paused?'Play':'Pause');play.classList.toggle('playing',!paused);
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
  if(auto)diag(`next ${next?.name||'none, end of list'}`);
  if(!next){if(auto)syncStreamBar();return;}
  setActiveClip(next.id);syncStreamBar();playPreview();
  if(auto)checkAutoplay(next);
}
// Records whether the next clip really started. If it has not started within 3 s it gets one
// more play request, and the log says so.
function checkAutoplay(clip){
  let started=false;const onPlaying=()=>{started=true;diag(`playing ${clip.name}`);};
  els.video.addEventListener('playing',onPlaying,{once:true});
  setTimeout(()=>{els.video.removeEventListener('playing',onPlaying);if(started||state.activeId!==clip.id)return;const v=els.video;
    diag(`not playing ${clip.name}: paused=${v.paused} ready=${v.readyState} time=${v.currentTime.toFixed(2)} audio=${gpu?.audio.state}, retrying`);
    if(v.paused)playPreview();},3000);
}
function diag(line){pocket.log?.(line).catch(()=>{});}
// Settings are saved with the library. Autoplay is one preference shared by the editor
// preview and streaming mode.
function setAutoplay(on){state.preferences.autoplay=on;$('#setting-autoplay').checked=on;$('#stream-autoplay').checked=on;scheduleSave();}
const DEFAULT_PREFERENCES={autoplay:true};
// The dialog edits a copy. Nothing changes until Save, and Cancel or Esc discards the edits.
function fillSettings(preferences){$('#setting-autoplay').checked=preferences.autoplay;}
function saveSettingsDialog(){setAutoplay($('#setting-autoplay').checked);$('#settings-dialog').close();}
const LUT_NAMES={dlog2:'D-Log2',dlog2Vivid:'D-Log2 vivid',dlog:'D-Log',dlogm:'D-Log M'};
async function openSettings(){
  const dialog=$('#settings-dialog');if(dialog.open||els.libraryDialog.open||$('#selection-dialog').open)return;
  finishAdjustment();fillSettings(state.preferences);dialog.showModal();
  try{const info=await pocket.settingsInfo();state.luts=info.luts;
    $('#settings-version').textContent=`Version ${info.version}`;
    $('#settings-luts').innerHTML=Object.entries(LUT_NAMES).map(([key,name])=>`<li class="${info.luts[key]?'':'missing'}"><span>${name}</span><b>${info.luts[key]?'Installed':'Missing'}</b></li>`).join('');
    showCacheSize(info.cacheBytes);if(state.activeId)renderActiveClip();
  }catch(error){toast(friendlyError(error,'Settings could not be loaded.'),'error');}
}
function showCacheSize(bytes){$('#settings-cache').textContent=bytes?`Thumbnails and preview files use ${formatBytes(bytes)}. They are made again when needed, so clearing them is safe.`:'No thumbnails or preview files are stored right now.';}
async function clearCache(){
  const button=$('#clear-cache');button.disabled=true;
  try{showCacheSize(await pocket.clearCache());}catch(error){toast(friendlyError(error,'The cache could not be cleared.'),'error');}finally{button.disabled=false;}
}
function stopGradedPreview(){gpu?.clear();}
async function playPreview(){
  const clip=activeClip();if(!clip)return;
  try{if(!els.video.paused){els.video.pause();$('span',els.playPreview).textContent='Play preview';return;}
    await gpu.load(clip,state.playhead);if(state.activeId!==clip.id)return;gpu.setGrade(clip,ensureEdit(clip));await gpu.play();if(state.activeId===clip.id)$('span',els.playPreview).textContent=els.video.paused?'Play preview':'Pause';
  }catch(error){toast(friendlyError(error),'error');}
}

function validateExport() {
  if (!state.selected.size) return 'Select at least one clip to export.';
  if (!state.output) return 'Choose an output folder.';
  const unknown = [...state.selected].map(id => state.clips.find(clip => clip.id === id)).filter(Boolean).filter(clip => resolvedProfile(clip) === 'Unknown');
  if (unknown.length) return `${unknown.length} selected clip${unknown.length === 1 ? ' has' : 's have'} an unknown profile. Choose Normal, D-Log M, D-Log, or D-Log2 in the inspector before exporting.`;
  const maxMB = els.maxSize.value;
  if (maxMB !== '' && Number(maxMB) <= 0) return 'Maximum size must be greater than 0 MB.';
  return '';
}

// Send saves each selected clip whose export is missing or out of date, then opens the share
// menu with all of them. Clips already sent with these settings go straight to the menu.
// Closing the menu still leaves the files in the export folder.
async function startExport() {
  const chosen = orderedClips(state.clips.filter(clip => state.selected.has(clip.id)));
  const stale = chosen.filter(clip => !hasCurrentExport(clip));
  if (chosen.length && !stale.length) { els.exportError.classList.add('hidden'); return shareExports(); }
  const error = validateExport();
  els.exportError.classList.toggle('hidden', !error);
  els.exportError.textContent = error;
  if (error) return;
  state.exporting = true; state.sendAfterExport = true;
  els.startExport.disabled = true;
  $('#export-panel').classList.add('exporting');
  els.cancelExport.classList.remove('hidden');
  els.exportJob.classList.remove('hidden');
  els.exportState.textContent = 'Starting export';
  try {
    await pocket.export({
      ids: stale.map(clip => clip.id), edits: state.edits,
      options: { resolution: state.exportSettings.resolution, quality: state.exportSettings.quality, maxMB: state.exportSettings.maxMB === '' ? null : Number(state.exportSettings.maxMB) },
      output: state.output
    });
  } catch (err) {
    state.exporting = false; state.sendAfterExport = false;
    $('#export-panel').classList.remove('exporting');
    els.cancelExport.classList.add('hidden');
    els.startExport.disabled = false;
    els.exportError.textContent = friendlyError(err, 'The export could not be started.');
    els.exportError.classList.remove('hidden');
  }
}

// Export rows use the same clip numbers as the rest of the app, with plain states.
const EXPORT_STATES = { queued: 'Waiting', encoding: 'Exporting', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
function exportName(item) { const clip = state.clips.find(c => c.id === item.id); return clip ? clipLabel(clip) : item.name; }
function handleExport(event = {}) {
  for(const item of event.items||[])if(item.status==='done'&&item.receipt)state.exportRecords[item.id]=item.receipt;
  refreshStatus();
  const progress = Math.max(0, Math.min(1, Number(event.progress) || 0));
  els.exportJob.classList.remove('hidden');
  els.exportPercent.textContent = `${Math.round(progress * 100)}%`;
  els.exportBar.style.width = `${progress * 100}%`;
  els.exportItems.innerHTML = (event.items || []).map(item => `
    <div class="export-item ${escapeHtml(item.status)}">
      <strong title="${escapeHtml(item.error || item.path || item.name)}">${escapeHtml(exportName(item))}</strong><span>${escapeHtml(EXPORT_STATES[item.status] || item.status)}</span>
      <div class="mini-progress"><i style="width:${Math.max(0, Math.min(100, Number(item.progress) > 1 ? Number(item.progress) : Number(item.progress || 0) * 100))}%"></i></div>
    </div>`).join('');
  const labels = { running: 'Exporting', complete: 'Export complete', 'completed-with-errors': 'Finished with errors', cancelled: 'Export cancelled' };
  els.exportState.textContent = labels[event.state] || 'Exporting';
  state.exporting = event.state === 'running';
  $('#export-panel').classList.toggle('exporting', state.exporting);
  els.cancelExport.classList.toggle('hidden', !state.exporting);
  els.startExport.disabled = state.exporting || state.selected.size === 0;
  if (event.state === 'completed-with-errors') toast('Export finished with errors.', 'error');
  if (event.state === 'cancelled') { toast('Export cancelled.'); state.sendAfterExport = false; }
  // A finished Send opens the share menu, unless you have gone to another app meanwhile.
  // Then the notification says it is done, and Send opens the menu at once.
  if (event.state === 'complete' || event.state === 'completed-with-errors') {
    const send = state.sendAfterExport; state.sendAfterExport = false;
    if (send && document.hasFocus() && shareIds().length) shareExports();
    else if (event.state === 'complete') toast('Export complete.');
  }
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
  els.sort.addEventListener('change', () => { state.view.sort = els.sort.value; applyFilters(true); });
  // Show narrows the current trip or chapter. The sidebar's Favorites and Selected cover the whole library.
  els.showFilter.addEventListener('change', () => { state.view.favoritesOnly = els.showFilter.value === 'favorites'; state.view.selectedOnly = els.showFilter.value === 'selected'; applyFilters(true); });
  els.clearFilters.addEventListener('click', () => {
    els.search.value = ''; els.profileFilter.value = ''; els.dateFilter.value = '';
    applyFilters(true);
  });
  els.sidebarList.addEventListener('click', event => {
    if (event.target.closest('#manage-library')) { renderManageDialog(); els.libraryDialog.showModal(); return; }
    chooseScope(event.target);
  });
  // The filmstrip has no scrollbar. A mouse wheel moves it sideways, and trackpads swipe as usual.
  els.filmstrip.addEventListener('wheel', event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { els.filmstrip.scrollLeft += event.deltaY; event.preventDefault(); } }, { passive: false });
  let pinch = 0; els.grid.addEventListener('wheel', event => { if (!event.ctrlKey) return; event.preventDefault(); pinch -= event.deltaY; if (Math.abs(pinch) > 60) { stepThumbSize(Math.sign(pinch)); pinch = 0; } }, { passive: false });
  let scrollTimer; els.grid.addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(() => { if (state.view.mode === 'grid' && state.clips.length) rememberPlace(); }, 300); }, { passive: true });
  $('#grid-mode').addEventListener('click', () => setMode('grid'));
  $('#viewer-mode').addEventListener('click', () => setMode('viewer'));
  $('#toggle-sidebar').addEventListener('click', toggleSidebar);
  bindTrimHandle($('#trim-in-handle'), 'trimStart');
  bindTrimHandle($('#trim-out-handle'), 'trimEnd');
  els.previousClip.addEventListener('click', () => navigateClip(-1));
  els.nextClip.addEventListener('click', () => navigateClip(1));
  els.activeFavorite.addEventListener('click', () => toggleFavorite());
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
  $('#stream-autoplay').addEventListener('change',event=>{setAutoplay(event.target.checked);event.target.blur();});
  $('#settings-form').addEventListener('submit',event=>{event.preventDefault();saveSettingsDialog();});
  $('#settings-cancel').addEventListener('click',()=>$('#settings-dialog').close());
  $('#settings-reset').addEventListener('click',()=>fillSettings(DEFAULT_PREFERENCES));
  $('#settings-button').addEventListener('click',openSettings);
  $('#open-lut-folder').addEventListener('click',()=>pocket.openLuts().catch(error=>toast(friendlyError(error,'The LUT folder could not be opened.'),'error')));
  $('#clear-cache').addEventListener('click',clearCache);
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
    renderPresets();refreshStatus();updateSelectionUI();scheduleSave();
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
    if(!stream.on||event.metaKey||event.ctrlKey||event.altKey||document.querySelector('dialog[open]'))return;
    wakeStream();
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setStreaming(false);}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopImmediatePropagation();streamStep(event.key==='ArrowLeft'?-1:1);}
  },true);
  window.addEventListener('keydown', event => {
    if(document.querySelector('dialog[open]'))return;
    const target = event.target;
    if(event.code==='Space'&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!isTextEditing()&&!(target instanceof HTMLSelectElement)&&!target?.matches('input[type=checkbox], [role=switch]')){
      event.preventDefault();
      // Space in the grid opens the clip first, so sound never plays without its picture.
      if(!event.repeat){if(state.view.mode==='grid'&&state.activeId)setMode('viewer');playPreview();}
      return;
    }
    if((event.metaKey||event.ctrlKey)&&!isTextEditing()){
      const key=event.key.toLowerCase();
      const action=key==='z'?(event.shiftKey?'redo':'undo'):event.shiftKey&&key==='c'?'copy':event.shiftKey&&key==='v'?'paste':null;
      if(action){event.preventDefault();editCommand(action);return;}
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target?.isContentEditable || els.libraryDialog.open) return;
    // Single keys act alone. With Cmd, Ctrl or Option they belong to the menus, like Cmd+O.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); navigateClip(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); navigateClip(1); }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && state.view.mode === 'grid') { event.preventDefault(); navigateRow(event.key === 'ArrowUp' ? -1 : 1); }
    if (event.code === 'Comma' || event.code === 'Period') { event.preventDefault(); stepFrame(event.code === 'Comma' ? -1 : 1); }
    if (event.key.toLowerCase() === 'l' && !event.repeat) { event.preventDefault(); toggleVivid(); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFavorite(); }
    if (event.key.toLowerCase() === 'g') { event.preventDefault(); setMode('grid'); }
    if (event.key.toLowerCase() === 'v') { event.preventDefault(); setMode('viewer'); }
    if (event.key.toLowerCase() === 'i' && state.view.mode !== 'grid') { event.preventDefault(); els.markStart.click(); }
    if (event.key.toLowerCase() === 'o' && state.view.mode !== 'grid') { event.preventDefault(); els.markEnd.click(); }
    if (event.key.toLowerCase() === 'b' && !event.repeat && state.view.mode !== 'grid' && state.activeId) { event.preventDefault(); els.beforeHold.classList.add('held'); queueFrame(true); window.addEventListener('keyup', up => { if (up.key.toLowerCase() === 'b') { els.beforeHold.classList.remove('held'); queueFrame(false); } }, { once: true }); }
    if (event.key.toLowerCase() === 'x' && state.activeId) {
      event.preventDefault();
      state.selectionAnchor=state.activeId;
      state.selected.has(state.activeId) ? state.selected.delete(state.activeId) : state.selected.add(state.activeId);
      selectionChanged();
      if (!state.view.selectedOnly) renderClips();
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
  // Scope reads as one short line. The hint appears only while several clips change at once.
  $('#scope-label').textContent=state.bulk?`${ids.length} selected clip${ids.length===1?'':'s'}`:'This clip';
  $('#scope-hint').textContent=state.bulk?`${hidden?`${hidden} not shown in this view. `:''}Color and profile change on every selected clip. Trim and audio stay per clip.`:'';
  $('#scope-hint').hidden=!state.bulk;
  $('#bulk-edit').textContent=state.bulk?'Back to this clip':state.selected.size?`Edit ${state.selected.size} selected`:'Edit selected';
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
function finishAdjustment(){const top=history.undoStack.at(-1);history.commit(state.edits);if(history.undoStack.at(-1)!==top)regradeThumbs();if($('#bulk-edit'))updateScope();}
function afterAdjustment(){
  regradeThumbs();state.previewToken+=1;scheduleSave();renderActiveClip();refreshStatus();
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
  if(command==='settings'){openSettings();return;}
  if(command==='grid'||command==='viewer'){setMode(command);return;}
  if(command==='sidebar'){toggleSidebar();return;}
  if(command.startsWith('thumbs-')){stepThumbSize(command==='thumbs-larger'?1:command==='thumbs-smaller'?-1:0);return;}
  if(command==='open'){chooseSource();return;}
  if(command==='rescan'){if(state.source)scan(state.source);return;}
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
function hasCurrentExport(clip){const receipt=state.exportRecords[clip.id];return Boolean(receipt)&&receipt.signature===adjustments.signature(clip,ensureEdit(clip),state.exportSettings);}
// Dragging a selected card carries every selected clip's export. Other cards carry their own.
function dragExports(id){const clip=state.clips.find(c=>c.id===id);if(clip&&hasCurrentExport(clip))pocket.startDrag(state.selected.has(id)?shareIds():[id]);}
// Share covers selected clips whose export still matches their edits.
function shareIds(){return state.clips.filter(c=>state.selected.has(c.id)&&clipStatus(c).includes('Exported')&&!clipStatus(c).includes('outdated')).map(c=>c.id);}
async function shareExports(){
  const rect=els.startExport.getBoundingClientRect();
  try{const result=await pocket.share({ids:shareIds(),x:rect.left,y:rect.top});if(result.missing)toast(`${result.missing} exported file${result.missing===1?' was':'s were'} moved or deleted, so ${result.missing===1?'it is':'they are'} not included.`,'error');}
  catch(error){toast(friendlyError(error,'The share menu could not be opened.'),'error');}
}
function refreshStatus(){
  for(const node of $$('[data-profile-id]')){const clip=state.clips.find(c=>c.id===node.dataset.profileId);if(clip){const tag=profileTag(clip);node.textContent=tag;node.hidden=!tag;node.title=profileDescription(clip);}}
  for(const node of $$('[data-status-id]')){const clip=state.clips.find(c=>c.id===node.dataset.statusId);node.textContent=clip?clipStatus(clip):'';const card=node.closest('.clip-card');if(card&&clip)card.draggable=hasCurrentExport(clip);}
  $('#clip-status').textContent=activeClip()?clipStatus(activeClip()):'';
}
// Where the clips are going decides their size. Discord's free limit is 20 MB since August 2026
// per news reports (Discord's own page was not reachable to confirm), Messages
// takes a normal 1080p file, and Full quality keeps 4K for editing later.
const DESTINATIONS={discord:{resolution:1080,quality:'balanced',maxMB:20},messages:{resolution:1080,quality:'balanced',maxMB:0},full:{resolution:2160,quality:'best',maxMB:0}};
function renderDestination(){
  const current=JSON.stringify(adjustments.exportOptions(state.exportSettings));
  for(const button of $$('[data-destination]'))button.setAttribute('aria-checked',String(JSON.stringify(adjustments.exportOptions(DESTINATIONS[button.dataset.destination]))===current));
}
function applyExportOptions(options){
  state.exportSettings={resolution:String(options.resolution),quality:options.quality,maxMB:options.maxMB?String(options.maxMB):''};
  els.resolution.value=state.exportSettings.resolution;els.quality.value=options.quality;els.maxSize.value=state.exportSettings.maxMB;
  renderPresets();refreshStatus();updateSelectionUI();scheduleSave();
}
function renderPresets(){
  renderDestination();
  const select=$('#preset-select');
  select.innerHTML='<option value="">Custom settings</option><option value="default">1080p balanced</option>'+state.exportPresets.map((p,i)=>`<option value="${i}">${escapeHtml(p.name)}</option>`).join('');
  const current=JSON.stringify(adjustments.exportOptions(state.exportSettings));
  const index=state.exportPresets.findIndex(p=>JSON.stringify(adjustments.exportOptions(p))===current);
  select.value=index>=0?String(index):current===JSON.stringify(adjustments.exportOptions())?'default':'';
}
function bindPolish(){
  $('#resolve-profile').addEventListener('click',()=>{els.profileSelect.scrollIntoView({block:'nearest'});els.profileSelect.focus();});
  els.moreControls.addEventListener('toggle',()=>{if(state.view.moreOpen!==els.moreControls.open){state.view.moreOpen=els.moreControls.open;scheduleSave();}});
  $('#destination').addEventListener('click',event=>{const button=event.target.closest('[data-destination]');if(button)applyExportOptions(DESTINATIONS[button.dataset.destination]);});
  const exportMore=$('#export-more');
  exportMore.addEventListener('toggle',()=>{if(state.view.exportMoreOpen!==exportMore.open){state.view.exportMoreOpen=exportMore.open;scheduleSave();}});
  els.lookSection.addEventListener('click',event=>{const tile=event.target.closest('.look-tile');if(tile&&!tile.disabled)chooseLook(tile.dataset.look);});
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
    applyExportOptions(value==='default'?adjustments.exportOptions():adjustments.exportOptions(state.exportPresets[Number(value)]));
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
  pocket.onClipAction(({ choice, id } = {}) => clipAction(choice, id));
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
    state.preferences = { ...state.preferences, ...(data?.preferences || {}) };
    $('#stream-autoplay').checked = state.preferences.autoplay;
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
    els.showFilter.value = state.view.favoritesOnly ? 'favorites' : state.view.selectedOnly ? 'selected' : 'all';
    if (state.view.projectId) expanded.add(state.view.projectId);
    els.moreControls.open = Boolean(state.view.moreOpen);
    $('#export-more').open = Boolean(state.view.exportMoreOpen);
    fitSidebar(); window.addEventListener('resize', fitSidebar);
    reconcileState();
    renderAll();
    els.profileFilter.value = state.view.profile || '';
    els.dateFilter.value = state.view.date || '';
    applyFilters();
    setMode(state.view.mode === 'grid' ? 'grid' : 'viewer', { save: false });
    setThumbSize(state.view.thumbSize, false);
    restoreScroll();
  } catch (error) {
    toast(friendlyError(error, 'Pocket Room could not load its saved state.'), 'error');
    renderAll();
  }
}

init();
