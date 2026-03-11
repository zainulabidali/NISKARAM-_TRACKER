import { auth, db } from './firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc, getDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js'; let madrasaId = null;
let classMap = {};
let studentMap = {};

let editModal;
let recordEditModal;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        if (user.uid === 'mt0k0d3UeAgcB8RTzq5k3M97UKa2') {
            window.location.href = 'superadmin.html';
            return;
        }

        const adminDoc = await getDoc(doc(db, "admins", user.uid));
        if (adminDoc.exists()) {
            madrasaId = adminDoc.data().madrasaId;
            init();
        } else {
            alert("Access Denied. Only Admins can access this panel.");
            signOut(auth).then(() => {
                window.location.href = 'login.html';
            });
        }
    } else {
        window.location.href = 'login.html';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            signOut(auth).then(() => {
                window.location.href = 'login.html';
            });
        });
    }

    const btnCopyMadrasaLink = document.getElementById('btnCopyMadrasaLink');
    if (btnCopyMadrasaLink) {
        btnCopyMadrasaLink.addEventListener('click', async (e) => {
            e.preventDefault();
            if (madrasaId) {
                const url = window.location.origin + window.location.pathname.replace('admin.html', 'home.html') + '?m=' + madrasaId;
                try {
                    await navigator.clipboard.writeText(url);
                    const originalHTML = btnCopyMadrasaLink.innerHTML;
                    btnCopyMadrasaLink.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Copied!';
                    btnCopyMadrasaLink.classList.replace('btn-primary', 'btn-success');
                    
                    setTimeout(() => {
                        btnCopyMadrasaLink.innerHTML = originalHTML;
                        btnCopyMadrasaLink.classList.replace('btn-success', 'btn-primary');
                    }, 2000);
                } catch (err) {
                    console.error('Failed to copy: ', err);
                    alert("Failed to copy link to clipboard.");
                }
            }
        });
    }
});

// Navigation Logic
window.openAdminModule = (moduleId) => {
    document.getElementById('adminDashboardGrid').classList.add('d-none');
    document.querySelectorAll('.admin-module-pane').forEach(p => p.classList.add('d-none'));
    
    const targetModule = document.getElementById(moduleId);
    if (targetModule) {
        targetModule.classList.remove('d-none');
    }

    if (moduleId === 'records') {
        populateRecordClassFilter();
        loadAdminRecordsView();
    }
};

window.closeAdminModule = () => {
    document.querySelectorAll('.admin-module-pane').forEach(p => p.classList.add('d-none'));
    document.getElementById('adminDashboardGrid').classList.remove('d-none');
};

async function init() {
    if (madrasaId) {
        const url = window.location.origin + window.location.pathname.replace('admin.html', 'home.html') + '?m=' + madrasaId;
        const linkContainer = document.getElementById('madrasaLinkTextContainer');
        if (linkContainer) {
            linkContainer.textContent = url;
        }
    }

    await loadClasses();
    await loadSubjects();
    await loadStudents();
    await loadBooks();
}

async function loadClasses() {
    const list = document.getElementById('classesList');
    const classSelect = document.getElementById('studentClass');
    const subjectClass = document.getElementById('subjectClass');
    const subjectClassFilter = document.getElementById('subjectClassFilter');

    if (!madrasaId) return;

    const q = query(collection(db, "classes"), where("madrasaId", "==", madrasaId));
    const snap = await getDocs(q);

    list.innerHTML = snap.empty ? '<li class="list-group-item text-muted border-0 px-0">No classes found.</li>' : '';
    
    classSelect.innerHTML = '<option value="">Select Class</option>';
    subjectClass.innerHTML = '<option value="">Select Class</option>';
    subjectClassFilter.innerHTML = '<option value="all">All Classes</option>';
    document.getElementById('editClass').innerHTML = '<option value="">Select Class</option>'; // Clear for re-population
    classMap = {};

    snap.forEach(d => {
        const data = d.data();
        classMap[d.id] = data.name;
        list.innerHTML += `
      <li class="list-group-item d-flex justify-content-between align-items-center bg-transparent border rounded p-2 mb-2">
        <span class="fw-bold px-2">${data.name}</span>
        <div>
           <button class="btn btn-sm btn-outline-primary edit-btn rounded-circle me-1" data-id="${d.id}" data-type="classes" data-name="${data.name}"><i class="bi bi-pencil"></i></button>
           <button class="btn btn-sm btn-outline-danger del-btn rounded-circle" data-id="${d.id}" data-type="classes"><i class="bi bi-trash"></i></button>
        </div>
      </li>
    `;
        classSelect.innerHTML += `<option value="${d.id}">${data.name}</option>`;
        subjectClass.innerHTML += `<option value="${d.id}">${data.name}</option>`;
        subjectClassFilter.innerHTML += `<option value="${d.id}">${data.name}</option>`;
        document.getElementById('editClass').innerHTML += `<option value="${d.id}">${data.name}</option>`;
    });

    attachCrudEvents();
}

let activeSubjectClassFilter = 'all';

document.getElementById('subjectClassFilter').addEventListener('change', (e) => {
    activeSubjectClassFilter = e.target.value;
    loadSubjects();
});

async function loadSubjects() {
    const list = document.getElementById('subjectsList');
    if (!madrasaId) return;

    const q = query(collection(db, "subjects"), where("madrasaId", "==", madrasaId));
    const snap = await getDocs(q);

    list.innerHTML = '';
    
    let subjectsToShow = [];
    snap.forEach(d => subjectsToShow.push({ id: d.id, ...d.data() }));

    if (activeSubjectClassFilter !== 'all') {
        subjectsToShow = subjectsToShow.filter(s => s.classId === activeSubjectClassFilter);
    }
    
    subjectsToShow.sort((a,b) => a.name.localeCompare(b.name));

    if (subjectsToShow.length === 0) {
        list.innerHTML = '<li class="list-group-item text-muted border-0 px-0 text-center py-4 bg-white rounded-4 shadow-sm border border-light mt-2"><i class="bi bi-journal-x fs-1 opacity-25 d-block mb-2"></i>No subjects found.</li>';
        return;
    }

    subjectsToShow.forEach(data => {
        const className = classMap[data.classId] || "Unknown Class";
        list.innerHTML += `
      <li class="list-group-item d-flex justify-content-between align-items-center bg-transparent border rounded p-3 mb-2 profile-hover-card bg-white">
        <div>
           <div class="fw-bold mb-1">${data.name}</div>
           <div class="badge bg-light text-dark shadow-sm">${className}</div>
        </div>
        <div>
           <button class="btn btn-sm text-primary edit-btn fs-5 me-2" data-id="${data.id}" data-type="subjects" data-name="${data.name}" data-class="${data.classId}"><i class="bi bi-pencil-square"></i></button>
           <button class="btn btn-sm text-danger del-btn fs-5" data-id="${data.id}" data-type="subjects"><i class="bi bi-trash"></i></button>
        </div>
      </li>
    `;
    });
    attachCrudEvents();
}

async function loadBooks() {
    const list = document.getElementById('booksList');
    if (!madrasaId) return;

    const q = query(collection(db, "books"), where("madrasaId", "==", madrasaId));
    const snap = await getDocs(q);

    list.innerHTML = snap.empty ? '<li class="list-group-item text-muted border-0 px-0">No books found.</li>' : '';

    snap.forEach(d => {
        const data = d.data();
        list.innerHTML += `
      <li class="list-group-item d-flex justify-content-between align-items-center bg-transparent border rounded p-2 mb-2">
        <span class="fw-bold px-2">${data.name}</span>
        <div>
           <button class="btn btn-sm btn-outline-primary edit-btn rounded-circle me-1" data-id="${d.id}" data-type="books" data-name="${data.name}"><i class="bi bi-pencil"></i></button>
           <button class="btn btn-sm btn-outline-danger del-btn rounded-circle" data-id="${d.id}" data-type="books"><i class="bi bi-trash"></i></button>
        </div>
      </li>
    `;
    });
    attachCrudEvents();
}

async function loadStudents() {
    const list = document.getElementById('studentsList');
    if (!madrasaId) return;

    const q = query(collection(db, "students"), where("madrasaId", "==", madrasaId));
    const snap = await getDocs(q);

    list.innerHTML = snap.empty ? '<li class="list-group-item text-muted border-0 px-0">No students found.</li>' : '';
    studentMap = {};

    snap.forEach(d => {
        const data = d.data();
        studentMap[d.id] = data;
        const className = classMap[data.classId] || "Unknown Class";
        list.innerHTML += `
      <li class="list-group-item d-flex justify-content-between align-items-center bg-transparent border rounded p-3">
        <div>
           <div class="fw-bold mb-1">${data.name}</div>
           <div class="badge bg-light text-dark shadow-sm">${className}</div>
        </div>
        <div>
           <button class="btn btn-sm text-primary edit-btn fs-5 me-2" data-id="${d.id}" data-type="students" data-name="${data.name}" data-class="${data.classId}"><i class="bi bi-pencil-square"></i></button>
           <button class="btn btn-sm text-danger del-btn fs-5" data-id="${d.id}" data-type="students"><i class="bi bi-trash"></i></button>
        </div>
      </li>
    `;
    });
    attachCrudEvents();
}

// Universal Edit/Delete Attacher
function attachCrudEvents() {
    // Setup Delete
    document.querySelectorAll('.del-btn').forEach(b => {
        b.onclick = async () => {
            if (confirm(`Delete this ${b.dataset.type.slice(0, -1)}?`)) {
                await deleteDoc(doc(db, b.dataset.type, b.dataset.id));
                // Reload correct panel
                if (b.dataset.type === 'classes') loadClasses();
                if (b.dataset.type === 'subjects') loadSubjects();
                if (b.dataset.type === 'books') loadBooks();
                if (b.dataset.type === 'students') loadStudents();
                if (b.dataset.type === 'records') loadAdminRecords();
            }
        };
    });

    // Setup Edit modal populator
    document.querySelectorAll('.edit-btn').forEach(b => {
        b.onclick = () => {
            if (!editModal) editModal = new bootstrap.Modal(document.getElementById('editModal'));

            document.getElementById('editId').value = b.dataset.id;
            document.getElementById('editCollection').value = b.dataset.type;
            document.getElementById('editName').value = b.dataset.name;

            if (b.dataset.type === 'students' || b.dataset.type === 'subjects') {
                document.getElementById('classEditFields').classList.remove('d-none');
                document.getElementById('editClass').value = b.dataset.class;
            } else {
                document.getElementById('classEditFields').classList.add('d-none');
            }

            document.getElementById('editModalTitle').innerText = `Edit ${b.dataset.type.slice(0, -1)}`;
            editModal.show();
        };
    });
}

// Modal Save Logic
document.getElementById('saveEditBtn').onclick = async () => {
    const col = document.getElementById('editCollection').value;
    const id = document.getElementById('editId').value;
    const newName = document.getElementById('editName').value;

    const payload = { name: newName };
    if (col === 'students' || col === 'subjects') {
        payload.classId = document.getElementById('editClass').value;
    }

    try {
        await updateDoc(doc(db, col, id), payload);
        editModal.hide();
        if (col === 'classes') loadClasses();
        if (col === 'subjects') loadSubjects();
        if (col === 'books') loadBooks();
        if (col === 'students') loadStudents();
    } catch (e) {
        alert("Error updating: " + e.message);
    }
};

document.getElementById('addClassForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const name = document.getElementById('className').value;
    await addDoc(collection(db, "classes"), { name, madrasaId });
    document.getElementById('className').value = '';
    await loadClasses();
    btn.disabled = false;
};

document.getElementById('addSubjectForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const name = document.getElementById('subjectName').value;
    const classId = document.getElementById('subjectClass').value;
    await addDoc(collection(db, "subjects"), { name, classId, madrasaId });
    document.getElementById('subjectName').value = '';
    await loadSubjects();
    btn.disabled = false;
};

document.getElementById('addBookForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const name = document.getElementById('bookName').value;
    await addDoc(collection(db, "books"), { name, madrasaId });
    document.getElementById('bookName').value = '';
    await loadBooks();
    btn.disabled = false;
};

document.getElementById('addStudentForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const name = document.getElementById('studentName').value;
    const classId = document.getElementById('studentClass').value;
    await addDoc(collection(db, "students"), { name, classId, madrasaId });
    document.getElementById('studentName').value = '';
    await loadStudents();
    btn.disabled = false;
};

// ============================================
// RECORDS MANANGEMENT (DUAL-VIEW)
// ============================================

// Toggle initial Records view based on Classes
let activeAdminDateFilter = 'all';
let activeHistoryStudentId = null;

// Date Pill Logic
document.querySelectorAll('.admin-date-btn').forEach(btn => {
    btn.onclick = (e) => {
        // Update Active styling
        document.querySelectorAll('.admin-date-btn').forEach(b => {
            b.classList.remove('btn-dark');
            b.classList.add('btn-light', 'text-muted');
        });
        btn.classList.remove('btn-light', 'text-muted');
        btn.classList.add('btn-dark');

        const filterType = btn.dataset.filter;
        const customInput = document.getElementById('adminCustomDate');

        if (filterType === 'custom') {
            customInput.classList.remove('d-none');
            // Wait for user to pick a date via the change event
            return; 
        } else {
            customInput.classList.add('d-none');
        }

        if (filterType === 'all') {
            activeAdminDateFilter = 'all';
        } else if (filterType === 'today') {
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            activeAdminDateFilter = `${yyyy}-${mm}-${dd}`;
        } else if (filterType === 'yesterday') {
            const yest = new Date();
            yest.setDate(yest.getDate() - 1);
            const yyyy = yest.getFullYear();
            const mm = String(yest.getMonth() + 1).padStart(2, '0');
            const dd = String(yest.getDate()).padStart(2, '0');
            activeAdminDateFilter = `${yyyy}-${mm}-${dd}`;
        }

        if (activeHistoryStudentId) viewStudentHistory(activeHistoryStudentId);
    };
});

document.getElementById('adminCustomDate').addEventListener('change', (e) => {
    if (e.target.value) {
        activeAdminDateFilter = e.target.value;
        if (activeHistoryStudentId) viewStudentHistory(activeHistoryStudentId);
    }
});



function populateRecordClassFilter() {
    const classFilter = document.getElementById('recordClassFilter');
    classFilter.innerHTML = '<option value="all">All Classes</option>';
    
    // Sort classMap by name for cleaner UI
    const sortedClasses = Object.keys(classMap).map(k => ({id: k, name: classMap[k]})).sort((a,b) => a.name.localeCompare(b.name));
    
    sortedClasses.forEach(c => {
        classFilter.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });
}

document.getElementById('recordClassFilter').addEventListener('change', loadAdminRecordsView);

function loadAdminRecordsView() {
    document.getElementById('recordsHistoryView').classList.add('d-none');
    document.getElementById('recordsListView').classList.remove('d-none');

    const selectedClass = document.getElementById('recordClassFilter').value;
    const listContainer = document.getElementById('recordsStudentList');
    
    listContainer.innerHTML = '';

    let studentsToShow = Object.values(studentMap);
    if (selectedClass !== 'all') {
        studentsToShow = studentsToShow.filter(s => s.classId === selectedClass);
    }
    
    // Sort students alphabetically
    studentsToShow.sort((a, b) => a.name.localeCompare(b.name));

    if (studentsToShow.length === 0) {
        listContainer.innerHTML = `
        <div class="text-center py-4 bg-white rounded-4 shadow-sm border border-light p-4">
           <i class="bi bi-people display-4 text-muted opacity-25 mb-3"></i>
           <p class="text-muted fw-bold">No students found matching this criteria.</p>
        </div>`;
        return;
    }

    studentsToShow.forEach(student => {
        // Find the original document ID (studentMap has id encoded inside the objects if not, we must rely on keys)
        // Since studentMap stores {d.id: data}, we find key by matching.
        const sId = Object.keys(studentMap).find(key => studentMap[key] === student);
        const className = classMap[student.classId] || "Unknown Class";

        listContainer.innerHTML += `
        <div class="card p-3 shadow-sm border-0 rounded-4 bg-white profile-hover-card mb-2" style="cursor: pointer;" onclick="viewStudentHistory('${sId}')">
            <div class="d-flex align-items-center gap-3">
                <div class="avatar bg-light text-primary fw-bold text-center rounded-circle d-flex align-items-center justify-content-center shadow-sm" style="width:45px;height:45px; font-size:1.1rem; border: 2px solid #e9ecef;">
                    ${student.name.charAt(0).toUpperCase()}
                </div>
                <div>
                    <h6 class="fw-bold mb-0 text-dark">${student.name}</h6>
                    <small class="text-muted fw-bold">${className}</small>
                </div>
                <div class="ms-auto text-primary">
                    <i class="bi bi-chevron-right"></i>
                </div>
            </div>
        </div>
        `;
    });
}

// Back Button Behavior
document.getElementById('btnBackToStudents').addEventListener('click', loadAdminRecordsView);

// Make function global so inline onclicks can call it
window.viewStudentHistory = async function(studentId) {
    document.getElementById('recordsListView').classList.add('d-none');
    document.getElementById('recordsHistoryView').classList.remove('d-none');

    activeHistoryStudentId = studentId;

    const student = studentMap[studentId];
    if (!student) return;

    document.getElementById('historyStudentName').innerText = student.name;
    document.getElementById('historyStudentClass').innerText = classMap[student.classId] || "Unknown Class";
    document.getElementById('historyStudentAvatar').innerText = student.name.charAt(0).toUpperCase();

    const container = document.getElementById('recordsAdminList');
    container.innerHTML = `
        <div class="text-center py-5 bg-white rounded-4 shadow-sm border border-light p-4">
           <div class="spinner-border text-primary border-3" role="status" style="width: 3rem; height: 3rem;"></div>
           <p class="text-muted fw-bold mt-3">Loading history...</p>
        </div>`;

    // Query firebase for this students exact records 
    let q;
    if (activeAdminDateFilter && activeAdminDateFilter !== 'all') {
        q = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("studentId", "==", studentId), where("date", "==", activeAdminDateFilter));
    } else {
        q = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("studentId", "==", studentId));
    }
    const snap = await getDocs(q);

    if (snap.empty) {
        container.innerHTML = `
        <div class="text-center py-5 bg-white rounded-4 shadow-sm border border-light p-4">
           <div class="display-3 mb-3">⏳</div>
           <p class="text-muted fw-bold">No tracking records exist yet.</p>
        </div>`;
        document.getElementById('bulkActionContainer').classList.add('d-none');
        return;
    }

    document.getElementById('bulkActionContainer').classList.remove('d-none');
    document.getElementById('selectAllRecordsCheckbox').checked = false;
    document.getElementById('bulkDeleteBtn').classList.add('d-none');

    container.innerHTML = '';
    let results = [];
    snap.forEach(d => results.push({ id: d.id, ...d.data() }));
    results.sort((a, b) => new Date(b.date) - new Date(a.date)); // descending date

    results.forEach(r => {
        const rawPrayers = r.prayers || {};
        const orderedPrayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
        
        const emojiMap = {
            fajr: '🌅 Fajr',
            dhuhr: '☀️ Dhuhr',
            asr: '🌤 Asr',
            maghrib: '🌇 Maghrib',
            isha: '🌙 Isha'
        };

        const prayText = orderedPrayers.map(p => {
            if (!rawPrayers[p]) return '';
            const status = rawPrayers[p];
            let col = status === 'Jamaat' ? 'text-success bg-success bg-opacity-10'
                : status === 'Individual' ? 'text-warning bg-warning bg-opacity-10 text-dark' : 'text-danger bg-danger bg-opacity-10';
            const emojiName = emojiMap[p] || p;
            return `<span class="badge rounded-pill fw-bold shadow-sm px-3 py-2 me-1 mb-2 ${col}">${emojiName}</span>`;
        }).filter(html => html !== '').join('');

        const salawatCount = r.salawatCount || 0;
        const subjScore = r.subjectScore || 0;

        container.innerHTML += `
        <div class="card shadow-sm border-0 rounded-4 p-4 bg-white">
          <div class="d-flex justify-content-between align-items-center mb-3">
             <div class="d-flex align-items-center gap-2">
                <input class="form-check-input mt-0 record-checkbox" type="checkbox" value="${r.id}" style="width:1.2rem;height:1.2rem;cursor:pointer;">
                <span class="badge bg-light text-dark border shadow-sm px-3 py-2" style="font-size: 0.85rem;"><i class="bi bi-calendar3 me-2 text-primary"></i>${r.date}</span>
             </div>
             <div class="badge rounded-pill py-2 px-3 fw-bold shadow-sm" style="background: linear-gradient(135deg, #22c55e, #16a34a); color: white; font-size: 0.9rem;">
                 🏆 ${r.totalScore} pts
             </div>
          </div>
          
          <div class="d-flex flex-wrap border-bottom border-light pb-2 mb-3">
             ${prayText}
          </div>
          
          <div class="d-flex flex-column gap-3 mb-4">
             <div class="d-flex gap-2">
                 <div class="small fw-bold text-muted bg-light px-3 py-2 rounded-3 border-0 shadow-sm flex-fill text-center">
                    📚 Subjects:<span class="text-accent ms-2 fs-6">${subjScore}</span>
                 </div>
                 <div class="small fw-bold text-muted bg-light px-3 py-2 rounded-3 border-0 shadow-sm flex-fill text-center">
                    📿 Salawat:<span class="text-info ms-2 fs-6">${salawatCount}</span>
                 </div>
             </div>
          </div>

          <div class="d-flex gap-2 justify-content-end">
                <button class="btn btn-sm btn-outline-primary edit-record-btn fw-bold px-3 rounded-pill" data-id="${r.id}" data-studentid="${studentId}"><i class="bi bi-pencil-square me-1"></i> Edit</button>
                <button class="btn btn-sm btn-outline-danger del-btn fw-bold px-3 rounded-pill" data-id="${r.id}" data-type="records" data-studentid="${studentId}"><i class="bi bi-trash me-1"></i> Delete</button>
          </div>
        </div>
      `;
    });

    // Attach Crud events safely for dynamic items
    
    // Delete btn logic for these specific records needs slight re-attach to cause UI refresh properly
    document.querySelectorAll('#recordsAdminList .del-btn').forEach(b => {
        b.onclick = async () => {
            if (confirm("Are you sure you want to delete this record?")) {
                await deleteDoc(doc(db, "records", b.dataset.id));
                viewStudentHistory(b.dataset.studentid); // reload this view
            }
        };
    });

    // Checkbox synchronization logic
    const allChecks = document.querySelectorAll('.record-checkbox');
    const selectAll = document.getElementById('selectAllRecordsCheckbox');
    const bulkDelBtn = document.getElementById('bulkDeleteBtn');

    function syncBulkUi() {
        const checkedCount = document.querySelectorAll('.record-checkbox:checked').length;
        selectAll.checked = (checkedCount === allChecks.length && allChecks.length > 0);
        if (checkedCount > 0) {
            bulkDelBtn.classList.remove('d-none');
        } else {
            bulkDelBtn.classList.add('d-none');
        }
    }

    allChecks.forEach(cb => {
        cb.addEventListener('change', syncBulkUi);
    });

    selectAll.onchange = (e) => {
        const isChecked = e.target.checked;
        allChecks.forEach(cb => cb.checked = isChecked);
        syncBulkUi();
    };

    bulkDelBtn.onclick = async () => {
        const selectedIds = Array.from(document.querySelectorAll('.record-checkbox:checked')).map(cb => cb.value);
        if (selectedIds.length === 0) return;

        if (confirm(`Are you sure you want to delete ${selectedIds.length} selected records? This cannot be undone.`)) {
            try {
                const batch = writeBatch(db);
                selectedIds.forEach(id => {
                    batch.delete(doc(db, "records", id));
                });
                await batch.commit();
                viewStudentHistory(studentId); // re-render layout completely
            } catch (err) {
                alert("Error deleting records: " + err.message);
            }
        }
    };

    // Record Edit Form populator
    document.querySelectorAll('.edit-record-btn').forEach(b => {
        b.onclick = async () => {
            const rId = b.dataset.id;
            const stuId = b.dataset.studentid;
            const rDoc = await getDoc(doc(db, "records", rId));
            const data = rDoc.data();

            if (!recordEditModal) recordEditModal = new bootstrap.Modal(document.getElementById('recordEditModal'));

            const pCont = document.getElementById('recordEditFormContainer');
            
            // Store hidden trackers
            let html = `
                <input type="hidden" id="editRecordId" value="${rId}">
                <input type="hidden" id="editHistoryStudentId" value="${stuId}">
                <h6 class="text-muted fw-bold border-bottom pb-2 mb-3">Prayers</h6>
            `;

            const formItems = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
            formItems.forEach(p => {
                const pCap = p.charAt(0).toUpperCase() + p.slice(1);
                const currentVal = data[p] || data.prayers?.[pCap] || 'Not Prayed';

                html += `
                  <div class="mb-3 p-2 bg-light rounded-3 shadow-sm border border-white">
                     <label class="fw-bold small mb-2 text-dark">${pCap}</label>
                     <select class="form-select form-select-sm border-0 shadow-sm prayer-edit-select fw-bold text-secondary" data-key="${p}" data-cap="${pCap}">
                        <option value="Jamaat" ${currentVal === 'Jamaat' ? 'selected' : ''}>Jamaat (2pts)</option>
                        <option value="Individual" ${currentVal === 'Individual' ? 'selected' : ''}>Individual (1pt)</option>
                        <option value="Not Prayed" ${currentVal === 'Not Prayed' ? 'selected' : ''}>Not Prayed (0pts)</option>
                     </select>
                  </div>
                `;
            });

            const currSubj = data.subjectScore || 0;
            const currSal = data.salawatCount || 0;

            html += `
                <h6 class="text-muted fw-bold border-bottom pb-2 mb-3 mt-4">Additional Points</h6>
                <div class="row g-2">
                    <div class="col-6">
                        <label class="fw-bold small text-dark mb-1">Subjects Score</label>
                        <input type="number" id="editSubjectScore" class="form-control bg-light border-0 shadow-sm fw-bold" value="${currSubj}" min="0">
                    </div>
                    <div class="col-6">
                        <label class="fw-bold small text-dark mb-1">Salawat Count</label>
                        <input type="number" id="editSalawatCount" class="form-control bg-light border-0 shadow-sm fw-bold" value="${currSal}" min="0" step="50">
                    </div>
                </div>
            `;

            pCont.innerHTML = html;
            recordEditModal.show();
        };
    });
};

document.getElementById('saveRecordEditBtn').onclick = async () => {
    const id = document.getElementById('editRecordId').value;
    const stuId = document.getElementById('editHistoryStudentId').value;
    const selects = document.querySelectorAll('.prayer-edit-select');

    let prayerScore = 0;
    let prayersData = {};
    let lowerKeysData = {};

    selects.forEach(sel => {
        const val = sel.value;
        const key = sel.dataset.key;
        const cap = sel.dataset.cap;

        // Strip "Not Prayed" correctly like tracker logic
        if (val !== 'Not Prayed') {
            prayersData[cap] = val;
            lowerKeysData[key] = val;    
        }

        if (val === 'Jamaat') prayerScore += 2;
        if (val === 'Individual') prayerScore += 1;
    });

    const newSubjScore = parseInt(document.getElementById('editSubjectScore').value) || 0;
    const newSalawatCount = parseInt(document.getElementById('editSalawatCount').value) || 0;

    try {
        const rRef = doc(db, "records", id);
        const rDoc = await getDoc(rRef);
        const currentData = rDoc.data();

        // Total score calculation logic based on user's tracker preferences: Prayer Points + Subject Points
        const totalScore = prayerScore + newSubjScore;

        await updateDoc(rRef, {
            prayers: prayersData, // explicitly overwrite prayers so removed ones disappear
            fajr: lowerKeysData.fajr || "",
            dhuhr: lowerKeysData.dhuhr || "",
            asr: lowerKeysData.asr || "",
            maghrib: lowerKeysData.maghrib || "",
            isha: lowerKeysData.isha || "",
            prayerScore,
            subjectScore: newSubjScore,
            salawatCount: newSalawatCount,
            totalScore
        });

        recordEditModal.hide();
        viewStudentHistory(stuId); // Refresh the currently active view
    } catch (err) {
        alert("Failed to update record: " + err.message);
    }
};
