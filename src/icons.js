const paths={
 folder:'<path d="M3 7V5h6l2 2h10v12H3Z"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
 star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',
 play:'<path d="m8 4 12 8-12 8Z"/>',pause:'<path d="M8 5v14M16 5v14"/>',stream:'<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8"/>',compare:'<path d="M12 3v18M9 5H4v14h5M15 5h5v14h-5"/>',export:'<path d="M12 16V3m-4 4 4-4 4 4M4 14v6h16v-6"/>',
 undo:'<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',redo:'<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',paste:'<path d="M8 5H4v16h16V5h-4"/><rect x="8" y="3" width="8" height="4" rx="1"/>',sort:'<path d="M8 3v18m-4-4 4 4 4-4M14 5h7m-7 6h5m-5 6h3"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',select:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/>'
};
export function icon(name){return `<svg class="action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||''}</svg>`;}
export function decorateIcons(){for(const el of document.querySelectorAll('[data-icon]'))el.insertAdjacentHTML('afterbegin',icon(el.dataset.icon));}
