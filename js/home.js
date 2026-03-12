import { db } from './firebase.js';
import { injectBottomNav } from './app.js';
import { collection, query, where, getDocs, doc, getDoc, orderBy, limit } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

let madrasaId = null;
let allClasses = {};
let classesLoaded = false;
let classesLoadPromise = null;

const leaderboardCache = new Map();

// Initialize Today's Date
const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
document.getElementById('todayDate').innerText = new Date().toLocaleDateString('en-US', options);

document.addEventListener('DOMContentLoaded', async () => {
    injectBottomNav('home');

    const urlParams = new URLSearchParams(window.location.search);
    const mParam = urlParams.get('m');

    if (mParam) {
        localStorage.setItem('activeMadrasaId', mParam);
        madrasaId = mParam;
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        madrasaId = localStorage.getItem('activeMadrasaId');
    }

    if (!madrasaId) {
        document.getElementById('madrasaNameDisplay').innerText = 'Madrasa Niskaram Tracker';
        renderLeaderboardMessage('No Madrasa selected. Please use the link provided by your admin.');
        return;
    }

    // Load Madrasa Name
    const docSnap = await getDoc(doc(db, 'madrasas', madrasaId));
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.status !== 'active') {
            document.getElementById('madrasaNameDisplay').innerText = 'Inactive Madrasa';
            return;
        }
        document.getElementById('madrasaNameDisplay').innerText = data.name;
    } else {
        localStorage.removeItem('activeMadrasaId');
        document.getElementById('madrasaNameDisplay').innerText = 'Madrasa Not Found';
        return;
    }

    setupClassFilter();
    renderLeaderboardMessage('Select a class to load leaderboard.');
    await loadAnnouncementsBanner();
});

function setupClassFilter() {
    const classFilter = document.getElementById('classFilter');

    classFilter.innerHTML = '<option value="">Select Class</option>';

    // Lazy-load classes only when user interacts with dropdown.
    const lazyLoader = () => {
        ensureClassesLoaded().catch((err) => {
            console.error('Failed to load classes', err);
            renderLeaderboardMessage('Could not load classes. Please try again.');
        });
    };

    classFilter.addEventListener('focus', lazyLoader, { once: true });
    classFilter.addEventListener('pointerdown', lazyLoader, { once: true });

    classFilter.addEventListener('change', async () => {
        const selectedClassId = classFilter.value;

        if (!selectedClassId) {
            localStorage.removeItem('selectedLeaderboardClass');
            renderLeaderboardMessage('Select a class to load leaderboard.');
            return;
        }

        localStorage.setItem('selectedLeaderboardClass', selectedClassId);
        await loadLeaderboardForClass(selectedClassId);
    });
}

async function ensureClassesLoaded() {
    if (classesLoaded) return;
    if (classesLoadPromise) {
        await classesLoadPromise;
        return;
    }

    const classFilter = document.getElementById('classFilter');
    classFilter.disabled = true;
    classFilter.innerHTML = '<option value="">Loading classes...</option>';

    classesLoadPromise = (async () => {
        const q = query(collection(db, 'classes'), where('madrasaId', '==', madrasaId));
        const snap = await getDocs(q);

        allClasses = {};
        const classRows = [];

        snap.forEach((d) => {
            const name = d.data().name || 'Unnamed Class';
            allClasses[d.id] = name;
            classRows.push({ id: d.id, name });
        });

        classRows.sort((a, b) => a.name.localeCompare(b.name));

        classFilter.innerHTML = '<option value="">Select Class</option>';
        classRows.forEach((cls) => {
            classFilter.innerHTML += `<option value="${cls.id}">${cls.name}</option>`;
        });

        const savedClassId = localStorage.getItem('selectedLeaderboardClass');
        if (savedClassId && allClasses[savedClassId]) {
            classFilter.value = savedClassId;
        }

        if (classRows.length === 0) {
            renderLeaderboardMessage('No classes found for this madrasa.');
        }

        classesLoaded = true;
    })();

    try {
        await classesLoadPromise;
    } finally {
        classFilter.disabled = false;
        classesLoadPromise = null;
    }
}

function getLeaderboardDateWindow() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localDate = new Date(now.getTime() - offset);
    const todayStr = localDate.toISOString().split('T')[0];

    const weeklyBound = new Date(localDate);
    weeklyBound.setDate(localDate.getDate() - 7);
    const weeklyBoundStr = weeklyBound.toISOString().split('T')[0];

    const monthlyBound = new Date(localDate);
    monthlyBound.setDate(localDate.getDate() - 30);
    const monthlyBoundStr = monthlyBound.toISOString().split('T')[0];

    return { todayStr, weeklyBoundStr, monthlyBoundStr };
}

function showLeaderboardLoading() {
    const loadingHtml = `
      <div class="text-center py-4">
        <div class="spinner-border text-primary spinner-border-sm"></div>
      </div>
    `;

    ['todayList', 'weeklyList', 'monthlyList'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = loadingHtml;
    });
}

function renderLeaderboardMessage(message) {
    const html = `
      <div class="text-center py-5">
        <i class="bi bi-funnel display-4 text-muted opacity-50 mb-3"></i>
        <p class="text-muted fw-bold">${message}</p>
      </div>
    `;

    ['todayList', 'weeklyList', 'monthlyList'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    });
}

async function fetchClassRecords(classId, monthlyBoundStr) {
    const optimizedQuery = query(
        collection(db, 'records'),
        where('madrasaId', '==', madrasaId),
        where('classId', '==', classId),
        where('date', '>=', monthlyBoundStr)
    );

    try {
        return await getDocs(optimizedQuery);
    } catch (err) {
        // Fallback for missing composite index while still keeping class-scoped reads.
        if (err?.code === 'failed-precondition') {
            const fallbackQuery = query(
                collection(db, 'records'),
                where('madrasaId', '==', madrasaId),
                where('classId', '==', classId)
            );
            return await getDocs(fallbackQuery);
        }
        throw err;
    }
}

async function getLeaderboardDataForClass(classId) {
    if (leaderboardCache.has(classId)) {
        return leaderboardCache.get(classId);
    }

    const { todayStr, weeklyBoundStr, monthlyBoundStr } = getLeaderboardDateWindow();
    const students = {};
    const recordsById = new Map();

    const stuQ = query(
        collection(db, 'students'),
        where('madrasaId', '==', madrasaId),
        where('classId', '==', classId)
    );

    const [stuSnap, recSnap] = await Promise.all([
        getDocs(stuQ),
        fetchClassRecords(classId, monthlyBoundStr)
    ]);

    stuSnap.forEach((d) => {
        const data = d.data();
        students[d.id] = {
            id: d.id,
            name: data.name || 'Unknown Student',
            classId: data.classId || classId
        };
    });

    recSnap.forEach((d) => {
        const data = d.data();
        if (data.date >= monthlyBoundStr) {
            const recId = d.id || `${data.studentId}_${data.date}`;
            recordsById.set(recId, {
                _id: recId,
                studentId: data.studentId,
                date: data.date,
                totalScore: Number(data.totalScore) || 0,
                salawatCount: Number(data.salawatCount) || 0
            });
        }
    });

    // Merge unsynced local records so leaderboard reflects latest local state without extra reads.
    const offlineRecords = JSON.parse(localStorage.getItem('trackerData') || '[]');
    offlineRecords.forEach((offRec) => {
        if (
            offRec.madrasaId === madrasaId &&
            offRec.classId === classId &&
            offRec.date >= monthlyBoundStr
        ) {
            const recId = offRec._id || `${offRec.studentId}_${offRec.date}`;
            recordsById.set(recId, {
                _id: recId,
                studentId: offRec.studentId,
                date: offRec.date,
                totalScore: Number(offRec.totalScore) || 0,
                salawatCount: Number(offRec.salawatCount) || 0
            });
        }
    });

    const payload = {
        students,
        records: Array.from(recordsById.values()),
        todayStr,
        weeklyBoundStr
    };

    leaderboardCache.set(classId, payload);
    return payload;
}

async function loadLeaderboardForClass(classId) {
    showLeaderboardLoading();
    const classFilter = document.getElementById('classFilter');
    classFilter.disabled = true;

    try {
        const data = await getLeaderboardDataForClass(classId);
        renderLeaderboards(data);
    } catch (err) {
        console.error('Failed to load leaderboard', err);
        renderLeaderboardMessage('Could not load leaderboard data. Please retry.');
    } finally {
        classFilter.disabled = false;
    }
}

function renderLeaderboards(data) {
    const { students, records, todayStr, weeklyBoundStr } = data;

    const scoresToday = {};
    const scoresWeekly = {};
    const scoresMonthly = {};
    const salawatToday = {};
    const salawatWeekly = {};
    const salawatMonthly = {};

    Object.keys(students).forEach((studentId) => {
        scoresToday[studentId] = 0;
        scoresWeekly[studentId] = 0;
        scoresMonthly[studentId] = 0;
        salawatToday[studentId] = 0;
        salawatWeekly[studentId] = 0;
        salawatMonthly[studentId] = 0;
    });

    records.forEach((r) => {
        const studentId = r.studentId;
        if (scoresMonthly[studentId] === undefined) return;

        const score = Number(r.totalScore) || 0;
        const salawat = Number(r.salawatCount) || 0;

        scoresMonthly[studentId] += score;
        salawatMonthly[studentId] += salawat;

        if (r.date >= weeklyBoundStr) {
            scoresWeekly[studentId] += score;
            salawatWeekly[studentId] += salawat;
        }

        if (r.date === todayStr) {
            scoresToday[studentId] += score;
            salawatToday[studentId] += salawat;
        }
    });

    const generateHTML = (scoresObj, salawatObj) => {
        const sorted = Object.keys(scoresObj)
            .filter((id) => scoresObj[id] > 0 || salawatObj[id] > 0)
            .map((id) => ({
                id,
                score: scoresObj[id],
                salawat: salawatObj[id],
                name: students[id].name,
                classId: students[id].classId
            }))
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return b.salawat - a.salawat;
            })
            .slice(0, 6);

        if (sorted.length === 0) {
            return `
              <div class="text-center py-5">
                 <i class="bi bi-box2 display-4 text-muted opacity-50 mb-3"></i>
                 <p class="text-muted fw-bold">No records found for this class.</p>
              </div>
            `;
        }

        return sorted.map((s, index) => {
            let rankBadge = '';
            let bgClass = 'bg-transparent';
            let borderClass = 'border-bottom border-light';

            if (index === 0) {
                rankBadge = '1';
                bgClass = 'bg-warning bg-opacity-10';
                borderClass = 'border border-warning';
            } else if (index === 1) {
                rankBadge = '2';
                bgClass = 'bg-secondary bg-opacity-10';
            } else if (index === 2) {
                rankBadge = '3';
                bgClass = 'bg-danger bg-opacity-10';
            } else {
                rankBadge = `#${index + 1}`;
            }

            const classNameStr = allClasses[s.classId] || 'Unknown Class';

            return `
              <a href="report.html?s=${s.id}" class="text-decoration-none">
                  <li class="list-group-item py-3 px-3 rounded-4 mb-2 ${bgClass} ${borderClass} shadow-sm profile-hover-card transition-all d-flex justify-content-between align-items-center">
                        <div class="d-flex align-items-center gap-3">
                            <span class="fs-5 fw-bold text-muted" style="width: 28px; text-align: center;">${rankBadge}</span>
                            <div class="avatar bg-white shadow-sm text-primary fw-bold text-center rounded-circle d-flex align-items-center justify-content-center" style="width:45px;height:45px; font-size:1.1rem;">
                                ${s.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <h6 class="fw-bold text-dark mb-0">${s.name}</h6>
                                <small class="text-muted fw-bold">Class: ${classNameStr}</small>
                            </div>
                        </div>

                        <div class="d-flex flex-column gap-1 ms-auto text-end" style="background: linear-gradient(135deg, #eef7ff, #f6fbff); border-radius: 10px; padding: 6px 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                            <div class="badge fw-bold shadow-sm rounded-pill text-start" style="background: rgba(13,110,253,0.12); color: #0d6efd; font-size: 0.75rem;">
                                Score ${s.score}
                            </div>
                            <div class="badge fw-bold shadow-sm rounded-pill text-start" style="background: rgba(13,202,240,0.12); color: #0dcaf0; font-size: 0.75rem;">
                                Salawat ${s.salawat}
                            </div>
                        </div>
                  </li>
              </a>
            `;
        }).join('');
    };

    document.getElementById('todayList').innerHTML = generateHTML(scoresToday, salawatToday);
    document.getElementById('weeklyList').innerHTML = generateHTML(scoresWeekly, salawatWeekly);
    document.getElementById('monthlyList').innerHTML = generateHTML(scoresMonthly, salawatMonthly);
}

// ==========================================
// Global Announcements Banner
// ==========================================
async function loadAnnouncementsBanner() {
    try {
        let snap;

        try {
            const latestAnnouncementQ = query(
                collection(db, 'announcements'),
                orderBy('createdAt', 'desc'),
                limit(1)
            );
            snap = await getDocs(latestAnnouncementQ);
        } catch (err) {
            // Fallback if some legacy docs do not support the indexed order yet.
            const fallbackQ = query(collection(db, 'announcements'), limit(1));
            snap = await getDocs(fallbackQ);
        }

        if (snap.empty) return;

        const latest = snap.docs[0].data();
        const banner = document.getElementById('globalAnnouncementBanner');

        if (banner) {
            banner.innerHTML = `
                <div class="alert border border-warning shadow-sm rounded-4 d-flex align-items-start gap-3 mb-0" style="background: linear-gradient(to right, #fff8e1, #fffdf7);">
                    <i class="bi bi-megaphone-fill fs-4 text-warning mt-1"></i>
                    <div>
                        <h6 class="fw-bold text-dark mb-1">${latest.title} <span class="badge bg-warning text-dark ms-2 rounded-pill shadow-sm" style="font-size:0.65rem;">Notice</span></h6>
                        <p class="mb-0 small text-secondary">${latest.message}</p>
                    </div>
                </div>
            `;
            banner.classList.remove('d-none');
        }
    } catch (err) {
        console.error('Failed to load global announcements', err);
    }
}
