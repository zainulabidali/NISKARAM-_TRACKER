import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

const SUPER_ADMIN_UID = 'mt0k0d3UeAgcB8RTzq5k3M97UKa2';

// Global state tracking
window.currentUser = null;
window.currentMadrasaId = null;
window.isAdmin = false;
window.isSuperAdmin = false;

// ─── Session helpers ────────────────────────────────────────────────────────

/** Save madrasaId so all pages can use it even when not actively signed in. */
export function setActiveMadrasa(madrasaId) {
  window.currentMadrasaId = madrasaId;
  if (madrasaId) {
    localStorage.setItem('activeMadrasaId', madrasaId);
  } else {
    localStorage.removeItem('activeMadrasaId');
  }
}

/** Returns the active madrasaId from memory or localStorage. */
export function getActiveMadrasaId() {
  return window.currentMadrasaId || localStorage.getItem('activeMadrasaId') || null;
}

// ─── Bottom Navigation ──────────────────────────────────────────────────────

export const injectBottomNav = (activePage) => {
  const isParent = sessionStorage.getItem('parentStudentId') != null;
  let navHtml = '';

  if (isParent) {
    let indicatorState = '';
    if (activePage === 'parent_dashboard') indicatorState = 'nav-indicator-1';
    else indicatorState = 'nav-indicator-0';

    navHtml = `
      <div class="bottom-nav">
        <div class="nav-indicator ${indicatorState}" style="width: calc((100% - 16px) / 2);"></div>
        <a href="tracker.html" class="nav-item ${activePage === 'tracker' ? 'active' : ''}">
          <i class="bi bi-clipboard-check-fill"></i>
          <span>Tracker</span>
        </a>
        <a href="parent_dashboard.html" class="nav-item ${activePage === 'parent_dashboard' ? 'active' : ''}">
          <i class="bi bi-file-earmark-bar-graph-fill"></i>
          <span>Dashboard</span>
        </a>
      </div>
    `;
  } else {
    let indicatorState = '';
    if (activePage === 'home') indicatorState = 'nav-indicator-1';
    else if (activePage === 'history') indicatorState = 'nav-indicator-2';
    else indicatorState = 'nav-indicator-0';

    navHtml = `
      <div class="bottom-nav">
        <div class="nav-indicator ${indicatorState}"></div>
        <a href="tracker.html" class="nav-item ${activePage === 'tracker' ? 'active' : ''}">
          <i class="bi bi-clipboard-check-fill"></i>
          <span>Tracker</span>
        </a>
        <a href="home.html" class="nav-item ${activePage === 'home' ? 'active' : ''}">
          <i class="bi bi-trophy-fill"></i>
          <span>Leaderboard</span>
        </a>
        <a href="history.html" class="nav-item ${activePage === 'history' ? 'active' : ''}">
          <i class="bi bi-clock-history"></i>
          <span>History</span>
        </a>
      </div>
    `;
  }
  
  document.body.insertAdjacentHTML('beforeend', navHtml);

  if (!document.getElementById('bootstrap-icons-css')) {
    const link = document.createElement('link');
    link.id = 'bootstrap-icons-css';
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css';
    document.head.appendChild(link);
  }
};

// ─── END ────────────────────────────────────────────────────────
