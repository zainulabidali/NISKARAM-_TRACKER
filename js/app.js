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
  const navHtml = `
    <div class="bottom-nav shadow-sm">
      <a href="home.html" class="nav-item ${activePage === 'home' ? 'active' : ''}">
        <i class="bi bi-house-door-fill"></i>
        <span>Home</span>
      </a>
      <a href="tracker.html" class="nav-item ${activePage === 'tracker' ? 'active' : ''}">
        <i class="bi bi-clipboard-check-fill"></i>
        <span>Tracker</span>
      </a>
      <a href="history.html" class="nav-item ${activePage === 'history' ? 'active' : ''}">
        <i class="bi bi-clock-history"></i>
        <span>History</span>
      </a>
      <a href="profile.html" class="nav-item ${activePage === 'profile' ? 'active' : ''}">
        <i class="bi bi-person-fill"></i>
        <span>Profile</span>
      </a>
    </div>
  `;
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
