import { auth, db } from './firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js';
import { collection, query, getDocs, doc, setDoc, updateDoc, getDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js';

// Re-initialize firebase config to create secondary app for creating users without logging out
const firebaseConfig = {
    apiKey: "AIzaSyDJ3uQLXF2z1EDlPopQwNJSVcGBc-rObHo",
    authDomain: "niskaram-tracker.firebaseapp.com",
    projectId: "niskaram-tracker",
    storageBucket: "niskaram-tracker.firebasestorage.app",
    messagingSenderId: "638791881406",
    appId: "1:638791881406:web:01bfd69062fd193726c4ef"
};
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = getAuth(secondaryApp);

const SUPER_ADMIN_UID = 'mt0k0d3UeAgcB8RTzq5k3M97UKa2';

// Protect route
onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (user.uid === SUPER_ADMIN_UID) {
            loadMadrasas();
            return;
        } else {
            signOut(auth).then(() => {
                window.location.href = 'login.html';
            });
        }
    } else {
        window.location.href = 'login.html';
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => window.location.href = 'login.html');
});

document.getElementById('refreshBtn').addEventListener('click', () => {
    loadMadrasas();
    loadAnalyticsAndRanking();
});

async function loadAnalyticsAndRanking() {
    try {
        const mSnap = await getDocs(query(collection(db, "madrasas")));
        const sSnap = await getDocs(query(collection(db, "students")));
        const cSnap = await getDocs(query(collection(db, "classes")));
        const rSnap = await getDocs(query(collection(db, "records")));
        
        const madrasas = [];
        let activeCount = 0;
        mSnap.forEach(d => {
            const m = d.data();
            madrasas.push({...m, id: d.id, totalScore: 0});
            if (m.status === 'active') activeCount++;
        });

        const students = sSnap.size;
        const classes = cSnap.size;
        
        let todayEntriesCount = 0;
        const todayStr = new Date().toISOString().split('T')[0];
        
        rSnap.forEach(d => {
            const r = d.data();
            if (r.date === todayStr) todayEntriesCount++;
            
            // For leaderboard
            const mData = madrasas.find(m => m.id === r.madrasaId);
            if (mData) {
                mData.totalScore += Number(r.totalScore) || 0;
            }
        });

        document.getElementById('statMadrasas').innerText = madrasas.length;
        document.getElementById('statStudents').innerText = students;
        document.getElementById('statClasses').innerText = classes;
        document.getElementById('statRecords').innerText = rSnap.size;
        document.getElementById('statToday').innerText = todayEntriesCount;
        document.getElementById('statActive').innerText = activeCount;
        
        // Render leaderboard
        madrasas.sort((a,b) => b.totalScore - a.totalScore);
        const top = madrasas.slice(0, 5);
        const lbUi = document.getElementById('madrasaLeaderboardList');
        if (top.length === 0 || top[0].totalScore === 0) {
            lbUi.innerHTML = '<li class="list-group-item text-muted border-0 text-center py-3">No points recorded yet.</li>';
        } else {
            lbUi.innerHTML = top.filter(m => m.totalScore > 0).map((m, i) => `
                <li class="list-group-item d-flex justify-content-between align-items-center border-0 px-0 profile-hover-card">
                  <div class="d-flex align-items-center gap-3">
                      <span class="fs-5 fw-bold" style="width:25px;">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</span>
                      <h6 class="mb-0 fw-bold text-dark">${m.name}</h6>
                  </div>
                  <span class="badge rounded-pill bg-success bg-opacity-10 text-success fw-bold p-2 shadow-sm">🏆 ${m.totalScore} pts</span>
                </li>
            `).join('');
        }
    } catch(err) {
        console.error("Analytics Error", err);
    }
}

async function loadMadrasas() {
    loadAnalyticsAndRanking();
    
    const madrasasList = document.getElementById('madrasasList');
    madrasasList.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>';

    try {
        const q = query(collection(db, "madrasas"));
        const querySnapshot = await getDocs(q);

        madrasasList.innerHTML = '';

        if (querySnapshot.empty) {
            madrasasList.innerHTML = '<div class="alert alert-light text-center">No Madrasas found. Create one above!</div>';
            return;
        }

        querySnapshot.forEach((docSnap) => {
            const m = docSnap.data();
            const isExpired = new Date(m.expiryDate) < new Date();
            const statusBadge = isExpired
                ? '<span class="badge bg-danger">Expired</span>'
                : '<span class="badge bg-success">Active</span>';

            madrasasList.innerHTML += `
        <div class="card p-3 shadow-sm border-0 rounded-4">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <h6 class="mb-0 fw-bold text-dark">${m.name}</h6>
            ${statusBadge}
          </div>
          <p class="mb-1 small text-muted"><i class="bi bi-person me-1"></i> Admin: ${m.adminEmail}</p>
          <p class="mb-3 small text-muted"><i class="bi bi-calendar-x me-1"></i> Expiry: ${m.expiryDate}</p>
          
          <div class="d-flex flex-wrap gap-2 align-items-center mb-3">
             <button class="btn btn-sm btn-outline-primary fw-bold px-3 rounded-pill flex-grow-1 edit-madrasa-btn" data-id="${docSnap.id}" data-name="${m.name}"><i class="bi bi-pencil-square me-1"></i> Edit</button>
             <button class="btn btn-sm btn-outline-info fw-bold px-3 rounded-pill flex-grow-1 view-admin-btn" data-email="${m.adminEmail}"><i class="bi bi-person-badge me-1"></i> Admin</button>
             <button class="btn btn-sm btn-dark fw-bold px-3 rounded-pill flex-grow-1 login-admin-btn" data-id="${docSnap.id}"><i class="bi bi-box-arrow-in-right me-1"></i> Login as Admin</button>
             <button class="btn btn-sm btn-outline-danger fw-bold px-3 rounded-pill flex-grow-1 delete-madrasa-btn" data-id="${docSnap.id}"><i class="bi bi-trash me-1"></i> Delete</button>
          </div>
          
          <div class="d-flex flex-wrap gap-2 align-items-center mt-2 pt-2 border-top">
              <input type="date" id="ext-${docSnap.id}" class="form-control form-control-sm bg-light border-0 fw-bold text-secondary" value="${m.expiryDate}" style="width:140px;">
              <button class="btn btn-sm btn-accent renew-btn fw-bold px-3 rounded-pill" data-id="${docSnap.id}">Update Expiry</button>
              <button class="btn btn-sm ${m.status === 'active' ? 'btn-danger' : 'btn-success'} toggle-status-btn fw-bold px-3 rounded-pill ms-auto" data-id="${docSnap.id}" data-current="${m.status}">
                  ${m.status === 'active' ? 'Deactivate' : 'Activate'}
              </button>
          </div>
        </div>
      `;
        });

        // Setup Delete Madrasa
        document.querySelectorAll('.delete-madrasa-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetBtn = e.target.closest('button');
                const id = targetBtn.getAttribute('data-id');
                if (confirm('Are you sure you want to completely DELETE this Madrasa? This action cannot be undone.')) {
                    await deleteDoc(doc(db, "madrasas", id));
                    loadMadrasas();
                }
            });
        });

        // Setup Edit Madrasa
        document.querySelectorAll('.edit-madrasa-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetBtn = e.target.closest('button');
                const id = targetBtn.getAttribute('data-id');
                const name = targetBtn.getAttribute('data-name');
                if (!window.editMadrasaModalObj) {
                    window.editMadrasaModalObj = new bootstrap.Modal(document.getElementById('editMadrasaModal'));
                }
                document.getElementById('editMadrasaId').value = id;
                document.getElementById('editMadrasaName').value = name;
                window.editMadrasaModalObj.show();
            });
        });

        // Setup View Admin
        document.querySelectorAll('.view-admin-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetBtn = e.target.closest('button');
                const email = targetBtn.getAttribute('data-email');
                if (!window.viewAdminModalObj) {
                    window.viewAdminModalObj = new bootstrap.Modal(document.getElementById('viewAdminModal'));
                }
                document.getElementById('adminEmailDisplay').innerText = email;
                document.getElementById('adminInitial').innerHTML = email.charAt(0).toUpperCase();
                window.viewAdminModalObj.show();
            });
        });

        // Attach event listeners for Login as Admin
        document.querySelectorAll('.login-admin-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.closest('button').getAttribute('data-id');
                // Set the override ID in localStorage and redirect without un-authenticating
                localStorage.setItem('overrideMadrasaId', id);
                window.location.href = 'admin.html';
            });
        });

        // Attach event listeners for Extend buttons (Explicit Expiry update)
        document.querySelectorAll('.renew-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                const newDate = document.getElementById(`ext-${id}`).value;
                if (newDate) {
                    const origText = e.target.innerHTML;
                    e.target.innerHTML = "...";
                    e.target.disabled = true;
                    try {
                        await updateDoc(doc(db, "madrasas", id), {
                            expiryDate: newDate,
                            status: "active"
                        });
                        loadMadrasas();
                    } catch (err) {
                        alert('Error updating: ' + err.message);
                        e.target.innerHTML = origText;
                        e.target.disabled = false;
                    }
                }
            });
        });

        // Attach event listeners for Toggle Status
        document.querySelectorAll('.toggle-status-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                const currentStatus = e.target.getAttribute('data-current');
                const newStatus = currentStatus === 'active' ? 'inactive' : 'active';

                if (confirm(`Are you sure you want to ${newStatus === 'active' ? 'ACTIVATE' : 'DEACTIVATE'} this Madrasa?`)) {
                    await updateDoc(doc(db, "madrasas", id), { status: newStatus });
                    loadMadrasas();
                }
            });
        });
    } catch (error) {
        madrasasList.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
    }
}

document.getElementById('createMadrasaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('createBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating...';

    const name = document.getElementById('mName').value;
    const email = document.getElementById('mEmail').value;
    const password = document.getElementById('mPassword').value;
    const startDate = document.getElementById('mStartDate').value;
    const validityDays = parseInt(document.getElementById('mValidity').value);

    // Calculate expiry
    const sDateObj = new Date(startDate);
    sDateObj.setDate(sDateObj.getDate() + validityDays);
    const expiryDate = sDateObj.toISOString().split('T')[0];

    try {
        // 1. Generate new ID for Madrasa using standard collection append (without saving yet)
        const newMadrasaRef = doc(collection(db, "madrasas"));
        const madrasaId = newMadrasaRef.id;

        // 2. Create User via Secondary App to prevent logging out
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const newUserId = userCredential.user.uid;

        // 3. Save Admin document
        await setDoc(doc(db, "admins", newUserId), {
            email: email,
            madrasaId: madrasaId,
            isSuperAdmin: false,
            createdAt: new Date().toISOString()
        });

        // 4. Save Madrasa Document
        await setDoc(newMadrasaRef, {
            name: name,
            adminId: newUserId,
            adminEmail: email,
            expiryDate: expiryDate,
            status: "active",
            startDate: new Date().toISOString()
        });

        // Sign out secondary auth to be safe
        await signOut(secondaryAuth);

        alert("Madrasa created successfully!");
        e.target.reset();
        loadMadrasas();
    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Create Madrasa & Admin';
    }
});

document.getElementById('saveMadrasaEditBtn')?.addEventListener('click', async () => {
    const id = document.getElementById('editMadrasaId').value;
    const name = document.getElementById('editMadrasaName').value;
    const btn = document.getElementById('saveMadrasaEditBtn');
    btn.disabled = true;
    btn.innerText = 'Saving...';

    try {
        await updateDoc(doc(db, "madrasas", id), { name });
        window.editMadrasaModalObj.hide();
        loadMadrasas();
    } catch (e) {
        alert("Error updating Madrasa: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Save Changes';
    }
});

// ==========================================
// Global Announcements
// ==========================================
async function loadAnnouncements() {
    const list = document.getElementById('announcementList');
    if (!list) return;
    list.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-warning" role="status"></div></div>';
    
    try {
        const q = query(collection(db, "announcements"));
        const snap = await getDocs(q);
        
        let anns = [];
        snap.forEach(d => {
            anns.push({ id: d.id, ...d.data() });
        });
        
        anns.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        if (anns.length === 0) {
            list.innerHTML = '<div class="alert alert-light text-center mb-0 border-0 text-muted shadow-sm">No announcements active.</div>';
            return;
        }
        
        list.innerHTML = anns.map(a => `
            <div class="p-3 bg-light rounded-4 border-0 shadow-sm d-flex justify-content-between align-items-center mb-0 transition-all profile-hover-card">
                <div>
                   <h6 class="fw-bold mb-1 text-dark">${a.title}</h6>
                   <p class="mb-1 small text-secondary">${a.message}</p>
                   <small class="text-muted fw-bold" style="font-size: 0.70rem;"><i class="bi bi-clock me-1"></i>${new Date(a.createdAt).toLocaleString()}</small>
                </div>
                <button class="btn btn-sm btn-outline-danger shadow-sm rounded-circle del-ann-btn ms-3" data-id="${a.id}"><i class="bi bi-trash"></i></button>
            </div>
        `).join('');
        
        document.querySelectorAll('.del-ann-btn').forEach(b => {
            b.onclick = async (e) => {
                const id = e.target.closest('button').dataset.id;
                if(confirm("Delete this announcement?")) {
                    await deleteDoc(doc(db, "announcements", id));
                    loadAnnouncements();
                }
            }
        });
        
    } catch(err) {
        list.innerHTML = `<div class="text-danger p-3 bg-danger bg-opacity-10 rounded">Error: ${err.message}</div>`;
    }
}

document.getElementById('createAnnouncementForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnPostAnn');
    btn.disabled = true;
    btn.innerHTML = 'Posting...';
    
    const title = document.getElementById('annTitle').value;
    const message = document.getElementById('annMessage').value;
    
    try {
        await addDoc(collection(db, "announcements"), {
            title,
            message,
            createdAt: new Date().toISOString()
        });
        e.target.reset();
        loadAnnouncements();
    } catch(err) {
        alert("Error posting announcement: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-send me-1"></i> Post Announcement';
    }
});

loadAnnouncements();

// ==========================================
// Data Export Logic
// ==========================================
document.getElementById('btnExport')?.addEventListener('click', async () => {
    const type = document.getElementById('exportType').value;
    const format = document.getElementById('exportFormat').value;
    const btn = document.getElementById('btnExport');
    
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Preparing Export...';
    
    try {
        const snap = await getDocs(query(collection(db, type)));
        const data = [];
        snap.forEach(d => {
            data.push({ id: d.id, ...d.data() });
        });
        
        if (data.length === 0) {
            alert("No data found to export.");
            return;
        }

        const dateStr = new Date().toISOString().split('T')[0];
        const filename = `Export_${type}_${dateStr}`;

        if (format === 'json') {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", filename + ".json");
            document.body.appendChild(downloadAnchorNode); 
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        } 
        else if (format === 'csv') {
            const headers = Object.keys(data[0]);
            const csvRows = [];
            csvRows.push(headers.join(','));
            
            for (const row of data) {
                const values = headers.map(header => {
                    let val = row[header];
                    if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
                    return `"${String(val).replace(/"/g, '""')}"`;
                });
                csvRows.push(values.join(','));
            }
            const csvData = csvRows.join('\n');
            const blob = new Blob([csvData], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('hidden', '');
            a.setAttribute('href', url);
            a.setAttribute('download', filename + '.csv');
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
        else if (format === 'xlsx') {
            if (typeof XLSX === 'undefined') {
                alert("Excel export library not loaded. Ensure you're online.");
                return;
            }
            const flatData = data.map(row => {
               const flatRow = {...row};
               Object.keys(flatRow).forEach(k => {
                   if(typeof flatRow[k] === 'object' && flatRow[k] !== null) {
                       flatRow[k] = JSON.stringify(flatRow[k]);
                   }
               });
               return flatRow;
            });
            const ws = XLSX.utils.json_to_sheet(flatData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Data");
            XLSX.writeFile(wb, filename + ".xlsx");
        }
        
    } catch(err) {
        alert("Export failed: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-download me-1"></i> Download Data';
    }
});
