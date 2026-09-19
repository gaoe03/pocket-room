(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PocketLibrary = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  function clipNumber(clip) {
    const match = clip.name?.match(/^DJI_\d{14}_(\d+)(?:_[A-Za-z]+)?\./i);
    return match ? Number(match[1]) : null;
  }
  function captureTime(clip) {
    const match = clip.name?.match(/^DJI_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/i);
    return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}` : clip.recordedAt || clip.date || '';
  }
  function membership(organization, id) {
    return organization.assignments?.[id] || { projectId: '', chapterId: '' };
  }
  function orderedClips(clips, sort = 'oldest') {
    const chronological = (a, b) => captureTime(a).localeCompare(captureTime(b)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    return [...clips].sort((a, b) => {
      if (sort === 'newest') return chronological(b, a);
      if (sort === 'shortest') return a.duration - b.duration || chronological(a, b);
      if (sort === 'longest') return b.duration - a.duration || chronological(a, b);
      if (sort === 'number') return (clipNumber(a) ?? Infinity) - (clipNumber(b) ?? Infinity) || chronological(a, b);
      return chronological(a, b);
    });
  }
  function cleanOrganization(input = {}) {
    const name = value => typeof value === 'string' ? value.trim().slice(0, 100) : '';
    const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
    const seenProjects = new Set();
    const projects = (Array.isArray(input.projects) ? input.projects : []).filter(p => p && validId(p.id) && name(p.name) && !seenProjects.has(p.id) && seenProjects.add(p.id)).map(p => {
      const seenChapters = new Set();
      const chapters = (Array.isArray(p.chapters) ? p.chapters : []).filter(c => c && validId(c.id) && name(c.name) && !seenChapters.has(c.id) && seenChapters.add(c.id));
      return { id: p.id, name: name(p.name), chapters: chapters.map(c => ({ id: c.id, name: name(c.name), ...(validId(c.parentId) && seenChapters.has(c.parentId) ? { parentId: c.parentId } : {}) })) };
    });
    const assignments = {};
    for (const [id, value] of Object.entries(input.assignments || {})) {
      if (!validId(id) || !value || typeof value !== 'object') continue;
      const project = projects.find(p => p.id === value.projectId);
      assignments[id] = { projectId: project?.id || '', chapterId: project?.chapters.some(c => c.id === value.chapterId) ? value.chapterId : '' };
    }
    const favorites = [...new Set((Array.isArray(input.favorites) ? input.favorites : []).filter(validId))];
    return { ...(input.folders === true ? { folders: true } : {}), projects, assignments, favorites };
  }
  // A chapter filter includes the chapters nested inside it.
  function inChapter(organization, member, chapterId) {
    if (!chapterId) return true;
    const chapters = organization.projects?.find(p => p.id === member.projectId)?.chapters || [];
    for (let id = member.chapterId, hops = 0; id && hops < 20; id = chapters.find(c => c.id === id)?.parentId, hops++) if (id === chapterId) return true;
    return false;
  }
  function defaultView() {
    return { projectId: '', chapterId: '', sort: 'oldest' };
  }
  return { clipNumber, captureTime, membership, inChapter, orderedClips, cleanOrganization, defaultView };
});
