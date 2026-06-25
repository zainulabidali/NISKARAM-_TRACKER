import { auth, db } from './firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc, getDoc, writeBatch, setDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js';

let madrasaId = null;
let isSuperAdmin = false;
let classMap = {};
let studentMap = {};
let activeStudentClassId = null;
let activeStudentClassName = null;

let editModal;
let recordEditModal;

// Leaderboard & Charts global states
let leaderboardClassId = null;
let leaderboardPeriod = 'weekly';
let chartDistributionInstance = null;
let chartPerformersInstance = null;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Super Admin Impersonation logic
        const overrideId = localStorage.getItem('overrideMadrasaId');
        if (user.uid === 'mt0k0d3UeAgcB8RTzq5k3M97UKa2') {
            if (overrideId) {
                madrasaId = overrideId;
                setupImpersonationHeader();
                await checkMadrasaSubscriptionAndInit();
                return;
            } else {
                window.location.href = 'superadmin.html';
                return;
            }
        }

        const adminDoc = await getDoc(doc(db, "admins", user.uid));
        if (adminDoc.exists()) {
            madrasaId = adminDoc.data().madrasaId;
            await checkMadrasaSubscriptionAndInit();
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

async function checkMadrasaSubscriptionAndInit() {
    try {
        const mDoc = await getDoc(doc(db, "madrasas", madrasaId));
        if (mDoc.exists()) {
            const mData = mDoc.data();
            const today = new Date().toISOString().split('T')[0];
            const isExpired = mData.status !== 'active' || mData.expiryDate < today;

            if (isExpired) {
                document.body.innerHTML = `
                <div class="d-flex flex-column justify-content-center align-items-center vh-100 bg-light text-center p-4">
                    <div class="card p-5 shadow border-0 rounded-4" style="max-width: 500px;">
                        <i class="bi bi-exclamation-triangle-fill text-danger display-1 mb-4"></i>
                        <h2 class="fw-bold text-dark mb-3">Subscription Expired</h2>
                        <p class="text-muted fs-5 mb-4">Your Madrasa subscription has expired or is currently inactive. Please contact the administrator.</p>
                        <button id="expiredLogoutBtn" class="btn btn-primary rounded-pill py-2 px-4 shadow-sm fw-bold">Logout</button>
                        ${localStorage.getItem('overrideMadrasaId') ? '<button id="returnSuperAdminBtn" class="btn btn-outline-secondary rounded-pill py-2 px-4 shadow-sm fw-bold mt-3 d-block w-100">Return to Super Admin</button>' : ''}
                    </div>
                </div>`;

                document.getElementById('expiredLogoutBtn')?.addEventListener('click', () => {
                    localStorage.removeItem('overrideMadrasaId');
                    signOut(auth).then(() => window.location.href = 'login.html');
                });
                document.getElementById('returnSuperAdminBtn')?.addEventListener('click', () => {
                    localStorage.removeItem('overrideMadrasaId');
                    window.location.href = 'superadmin.html';
                });

                // Auto-update to inactive if expired date
                if (mData.status === 'active' && mData.expiryDate < today) {
                    await updateDoc(doc(db, "madrasas", madrasaId), { status: 'inactive' });
                }
                return;
            }

            // Active -> Init Dashboard
            init();
        } else {
            alert("Madrasa profile not found.");
            signOut(auth).then(() => window.location.href = 'login.html');
        }
    } catch (e) {
        console.error("Error verifying subscription:", e);
    }
}

function setupImpersonationHeader() {
    // Add an 'Exit Admin Mode' button next to logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn && logoutBtn.parentNode) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm btn-warning rounded-pill px-3 ms-2 fw-bold text-dark shadow-sm shadow';
        btn.innerHTML = '<i class="bi bi-arrow-return-left me-1"></i> Exit Admin Mode';
        btn.onclick = () => {
            localStorage.removeItem('overrideMadrasaId');
            window.location.href = 'superadmin.html';
        };
        logoutBtn.parentNode.insertBefore(btn, logoutBtn);
    }
}

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
                const url = window.location.origin + window.location.pathname.replace('admin.html', 'tracker.html') + '?m=' + madrasaId;
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
        loadRecordsClasses();
    }

    if (moduleId === 'students') {
        // Always start from the class folders view
        activeStudentClassId = null;
        activeStudentClassName = null;
        document.getElementById('studentClassDetailView').classList.add('d-none');
        document.getElementById('studentClassFoldersView').classList.remove('d-none');
        loadStudentClassFolders();
    }

    if (moduleId === 'leaderboard') {
        initLeaderboard();
    }

    if (moduleId === 'dbhealth') {
        document.getElementById('orphanScanResult').innerHTML = '';
        document.getElementById('recalcScanResult').innerHTML = '';
    }

    if (moduleId === 'datamanagement') {
        checkSuperAdminRole();
        updateDmMetrics();
        // Load active tab data
        const activeTabEl = document.querySelector('#dmTabs .nav-link.active');
        if (activeTabEl) {
            const targetId = activeTabEl.getAttribute('data-bs-target');
            if (targetId === '#dm-overview') updateDmMetrics();
            else if (targetId === '#dm-students') loadDmStudents();
            else if (targetId === '#dm-classes') loadDmClasses();
            else if (targetId === '#dm-subjects') loadDmSubjects();
            else if (targetId === '#dm-records') loadDmRecordsSetup();
            else if (targetId === '#dm-recovery') loadRecoveryBackups();
            else if (targetId === '#dm-logs') loadAuditLogsLedger();
        }
    }
};

window.closeAdminModule = () => {
    document.querySelectorAll('.admin-module-pane').forEach(p => p.classList.add('d-none'));
    document.getElementById('adminDashboardGrid').classList.remove('d-none');
};

async function init() {
    if (madrasaId) {
        const url = window.location.origin + window.location.pathname.replace('admin.html', 'tracker.html') + '?m=' + madrasaId;
        const linkContainer = document.getElementById('madrasaLinkTextContainer');
        if (linkContainer) {
            linkContainer.textContent = url;
        }
    }

    await loadClasses();
    await loadSubjects();
    await loadBooks();
    await loadAnnouncementsBanner();
    await migrateStudentsWithoutAdmissionNumbers();
    initRecordsRedesignListeners();

    // Data Management Center init
    await checkSuperAdminRole();
    await runExpiredBackupsCleanup();
    initDataManagementListeners();
}

async function migrateStudentsWithoutAdmissionNumbers() {
    if (!madrasaId) return;
    try {
        const q = query(collection(db, "students"), where("madrasaId", "==", madrasaId));
        const snap = await getDocs(q);

        let migratedCount = 0;
        let index = 1001;

        // Find existing used admission numbers to prevent collisions
        const lookupQ = query(collection(db, "admission_numbers"), where("madrasaId", "==", madrasaId));
        const lookupSnap = await getDocs(lookupQ);
        const existingNumbers = new Set();
        lookupSnap.forEach(d => existingNumbers.add(d.id));

        for (const studentDoc of snap.docs) {
            const student = studentDoc.data();
            if (!student.admission_number) {
                // Generate a unique admission number
                let generated = "";
                do {
                    generated = `ADM-${index}`;
                    index++;
                } while (existingNumbers.has(generated));

                existingNumbers.add(generated);

                console.log(`Migrating student ${student.name} to Admission Number: ${generated}`);

                // Update student doc
                await updateDoc(doc(db, "students", studentDoc.id), {
                    admission_number: generated
                });

                // Create lookup doc
                await setDoc(doc(db, "admission_numbers", generated), {
                    studentId: studentDoc.id,
                    classId: student.classId,
                    madrasaId: madrasaId
                });

                migratedCount++;
            } else {
                // Double-check if the lookup document exists. If not, recreate it.
                const lookupRef = doc(db, "admission_numbers", student.admission_number);
                const lookupCheck = await getDoc(lookupRef);
                if (!lookupCheck.exists()) {
                    await setDoc(lookupRef, {
                        studentId: studentDoc.id,
                        classId: student.classId,
                        madrasaId: madrasaId
                    });
                }
            }
        }
        if (migratedCount > 0) {
            console.log(`Successfully migrated ${migratedCount} students with new unique admission numbers.`);
        }
    } catch (err) {
        console.error("Migration error: ", err);
    }
}

async function loadClasses() {
    const list = document.getElementById('classesList');
    const subjectClass = document.getElementById('subjectClass');
    const subjectClassFilter = document.getElementById('subjectClassFilter');

    if (!madrasaId) return;

    const q = query(collection(db, "classes"), where("madrasaId", "==", madrasaId));
    const snap = await getDocs(q);

    list.innerHTML = snap.empty ? '<li class="list-group-item text-muted border-0 px-0">No classes found.</li>' : '';

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
        subjectClass.innerHTML += `<option value="${d.id}">${data.name}</option>`;
        subjectClassFilter.innerHTML += `<option value="${d.id}">${data.name}</option>`;
        document.getElementById('editClass').innerHTML += `<option value="${d.id}">${data.name}</option>`;
    });

    attachCrudEvents();
    // Refresh student folder list if the students module is open
    loadStudentClassFolders();
}

function loadStudentClassFolders() {
    const foldersList = document.getElementById('studentClassFoldersList');
    if (!foldersList) return;

    const classes = Object.entries(classMap).sort((a, b) => a[1].localeCompare(b[1]));

    if (classes.length === 0) {
        foldersList.innerHTML = `
            <div class="text-center py-4 bg-light rounded-4 p-4">
                <i class="bi bi-folder-x fs-1 opacity-25 d-block mb-2 text-success"></i>
                <p class="text-muted fw-bold mb-0">No classes found. Add classes first.</p>
            </div>`;
        return;
    }

    foldersList.innerHTML = '';
    classes.forEach(([id, name]) => {
        foldersList.innerHTML += `
            <div class="d-flex align-items-center gap-3 p-3 bg-white rounded-4 border shadow-sm profile-hover-card"
                 style="cursor: pointer;" onclick="openClassFolder('${id}', '${name.replace(/'/g, "\\'")}')">
                <div class="text-success fs-4"><i class="bi bi-folder2"></i></div>
                <span class="fw-bold text-dark flex-grow-1">${name}</span>
                <i class="bi bi-chevron-right text-muted"></i>
            </div>`;
    });
}

window.openClassFolder = async (classId, className) => {
    activeStudentClassId = classId;
    activeStudentClassName = className;

    document.getElementById('openedClassName').textContent = className;
    document.getElementById('studentClassFoldersView').classList.add('d-none');
    document.getElementById('studentClassDetailView').classList.remove('d-none');
    document.getElementById('studentName').value = '';

    await loadStudents();
};

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

    subjectsToShow.sort((a, b) => a.name.localeCompare(b.name));

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
    if (!madrasaId || !activeStudentClassId) return;

    list.innerHTML = '<li class="list-group-item border-0 px-0"><div class="text-center py-2"><div class="spinner-border spinner-border-sm text-success"></div></div></li>';

    const q = query(collection(db, "students"), where("madrasaId", "==", madrasaId), where("classId", "==", activeStudentClassId));
    const snap = await getDocs(q);

    // Always keep studentMap updated for the records module
    snap.forEach(d => { studentMap[d.id] = { ...d.data(), id: d.id }; });

    if (snap.empty) {
        list.innerHTML = `
            <li class="list-group-item border-0 px-0">
                <div class="text-center py-4 bg-light rounded-4 p-3">
                    <i class="bi bi-person-x fs-1 opacity-25 d-block mb-2 text-success"></i>
                    <p class="text-muted fw-bold mb-0">No students in this class yet.</p>
                </div>
            </li>`;
        return;
    }

    let students = [];
    snap.forEach(d => students.push({ id: d.id, ...d.data() }));
    students.sort((a, b) => a.name.localeCompare(b.name));

    list.innerHTML = '';
    students.forEach(data => {
        list.innerHTML += `
      <li class="list-group-item d-flex justify-content-between align-items-center bg-white border rounded-4 p-3 mb-1 shadow-sm">
        <div class="d-flex align-items-center gap-3">
           <div class="avatar bg-success bg-opacity-10 text-success fw-bold text-center rounded-circle d-flex align-items-center justify-content-center" style="width:38px;height:38px;font-size:1rem;">${data.name.charAt(0).toUpperCase()}</div>
           <div>
               <span class="fw-bold text-dark d-block">${data.name}</span>
               <small class="text-muted fw-bold">Admission: ${data.admission_number || 'None'}</small>
           </div>
        </div>
        <div>
           <button class="btn btn-sm text-primary edit-btn fs-5 me-1" data-id="${data.id}" data-type="students" data-name="${data.name}" data-class="${data.classId}" data-admission="${data.admission_number || ''}"><i class="bi bi-pencil-square"></i></button>
           <button class="btn btn-sm text-danger del-btn fs-5" data-id="${data.id}" data-type="students"><i class="bi bi-trash"></i></button>
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
            const typeName = b.dataset.type.slice(0, -1);
            const result = await Swal.fire({
                title: 'Are you sure?',
                text: `Do you want to delete this ${typeName}? This action cannot be undone!`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete it!',
                customClass: { popup: 'rounded-4' }
            });

            if (result.isConfirmed) {
                try {
                    if (b.dataset.type === 'students') {
                        const studentId = b.dataset.id;
                        const studentData = studentMap[studentId];
                        if (studentData && studentData.admission_number) {
                            try {
                                await deleteDoc(doc(db, "admission_numbers", studentData.admission_number));
                            } catch (e) { console.error("Error deleting lookup doc:", e); }
                        }
                        
                        // Cascade delete related records
                        try {
                            const recQ = query(collection(db, "records"), where("studentId", "==", studentId));
                            const recSnap = await getDocs(recQ);
                            if (!recSnap.empty) {
                                const batch = writeBatch(db);
                                recSnap.forEach(dDoc => batch.delete(dDoc.ref));
                                await batch.commit();
                                console.log(`Cascade deleted ${recSnap.size} records for student ${studentId}`);
                            }
                        } catch(e) {
                            console.error("Error cascade deleting records:", e);
                        }
                    }
                    await deleteDoc(doc(db, b.dataset.type, b.dataset.id));
                    Swal.fire({
                        title: 'Deleted!',
                        text: `The ${typeName} has been successfully deleted.`,
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false,
                        customClass: { popup: 'rounded-4' }
                    });
                    // Reload correct panel
                    if (b.dataset.type === 'classes') loadClasses();
                    if (b.dataset.type === 'subjects') loadSubjects();
                    if (b.dataset.type === 'books') loadBooks();
                    if (b.dataset.type === 'students') loadStudents(); // reloads current class
                    if (b.dataset.type === 'records') loadAdminRecords();
                } catch (error) {
                    Swal.fire({
                        title: 'Error',
                        text: `Failed to delete: ${error.message}`,
                        icon: 'error',
                        confirmButtonColor: '#d33',
                        customClass: { popup: 'rounded-4' }
                    });
                }
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

            if (b.dataset.type === 'students') {
                document.getElementById('classEditFields').classList.remove('d-none');
                document.getElementById('editClass').value = b.dataset.class;
                document.getElementById('studentEditFields').classList.remove('d-none');
                document.getElementById('editAdmissionNumber').value = b.dataset.admission || '';
            } else if (b.dataset.type === 'subjects') {
                document.getElementById('classEditFields').classList.remove('d-none');
                document.getElementById('editClass').value = b.dataset.class;
                document.getElementById('studentEditFields').classList.add('d-none');
            } else {
                document.getElementById('classEditFields').classList.add('d-none');
                document.getElementById('studentEditFields').classList.add('d-none');
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
    if (col === 'students') {
        payload.classId = document.getElementById('editClass').value;
        const newAdmission = document.getElementById('editAdmissionNumber').value.trim();
        if (!newAdmission) {
            alert("Admission Number is required!");
            return;
        }

        // Check if admission number changed
        const currentStudent = studentMap[id];
        const oldAdmission = currentStudent ? currentStudent.admission_number : null;

        if (newAdmission !== oldAdmission) {
            // Check uniqueness of newAdmission
            const lookupSnap = await getDoc(doc(db, "admission_numbers", newAdmission));
            if (lookupSnap.exists() && lookupSnap.data().studentId !== id) {
                alert("Duplicate Admission Number detected! Please choose a unique one.");
                return;
            }
            payload.admission_number = newAdmission;

            // Update lookup tables:
            // 1. Delete old lookup document
            if (oldAdmission) {
                try {
                    await deleteDoc(doc(db, "admission_numbers", oldAdmission));
                } catch (e) { console.error("Error deleting old lookup doc:", e); }
            }
            // 2. Create new lookup document
            await setDoc(doc(db, "admission_numbers", newAdmission), {
                studentId: id,
                classId: payload.classId,
                madrasaId: madrasaId
            });
        } else {
            // Ensure lookup doc is synced with classId/madrasaId
            await setDoc(doc(db, "admission_numbers", newAdmission), {
                studentId: id,
                classId: payload.classId,
                madrasaId: madrasaId
            }, { merge: true });
        }
    } else if (col === 'subjects') {
        payload.classId = document.getElementById('editClass').value;
    }

    try {
        await updateDoc(doc(db, col, id), payload);

        // Update local map cache
        if (col === 'students' && studentMap[id]) {
            studentMap[id] = { ...studentMap[id], ...payload };
        }

        editModal.hide();
        if (col === 'classes') loadClasses();
        if (col === 'subjects') loadSubjects();
        if (col === 'books') loadBooks();
        if (col === 'students') loadStudents(); // reloads current open class
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
    const name = document.getElementById('studentName').value.trim();
    const admissionNumber = document.getElementById('studentAdmissionNumber').value.trim();
    if (!name || !admissionNumber || !activeStudentClassId) { btn.disabled = false; return; }

    try {
        // Check uniqueness in lookup collection
        const lookupSnap = await getDoc(doc(db, "admission_numbers", admissionNumber));
        if (lookupSnap.exists()) {
            alert("Duplicate Admission Number detected! Please choose a unique one.");
            btn.disabled = false;
            return;
        }

        // Add student
        const newStuRef = await addDoc(collection(db, "students"), {
            name,
            admission_number: admissionNumber,
            classId: activeStudentClassId,
            madrasaId
        });

        // Add to lookup collection
        await setDoc(doc(db, "admission_numbers", admissionNumber), {
            studentId: newStuRef.id,
            classId: activeStudentClassId,
            madrasaId
        });

        document.getElementById('studentName').value = '';
        document.getElementById('studentAdmissionNumber').value = '';
        await loadStudents();
    } catch (err) {
        alert("Failed to add student: " + err.message);
    } finally {
        btn.disabled = false;
    }
};

// Back button: class detail -> class folders
document.getElementById('btnBackToClassFolders').addEventListener('click', () => {
    activeStudentClassId = null;
    activeStudentClassName = null;
    document.getElementById('studentClassDetailView').classList.add('d-none');
    document.getElementById('studentClassFoldersView').classList.remove('d-none');
});

// ============================================
// NEW CENTRALIZED RECORDS DASHBOARD MODULE
// ============================================

// Date utilities
const tzOffset = new Date().getTimezoneOffset() * 60000;
const todayStr = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 10);
const yest = new Date(Date.now() - tzOffset);
yest.setDate(yest.getDate() - 1);
const yesterdayStr = yest.toISOString().slice(0, 10);

function getDateAgo(days) {
    const d = new Date(Date.now() - tzOffset);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

let activeRecordsClassId = null;
let activeRecordsClassName = null;
let cachedClassStudents = [];
let cachedClassRecords = [];
let recordsState = {
    dateFilterType: 'yesterday', // 'today', 'yesterday', 'custom', 'range'
    singleDate: todayStr,
    startDate: getDateAgo(30),
    endDate: todayStr,
    selectedStudentId: 'all',
    prayerStatus: 'all', // 'all', 'completed', 'missed', 'partial'
    searchQuery: '',
    sortBy: 'date',
    sortDirection: 'desc',
    currentPage: 1,
    pageSize: 10
};

function sortRecordsTable(col) {
    if (recordsState.sortBy === col) {
        recordsState.sortDirection = recordsState.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        recordsState.sortBy = col;
        recordsState.sortDirection = 'desc';
    }
    
    // Update sort headers UI
    const cols = ['date', 'name', 'admission', 'completion'];
    cols.forEach(c => {
        const el = document.getElementById(`sortCol_${c}`);
        if (el) {
            el.innerHTML = `${c === 'date' ? 'Date' : c === 'name' ? 'Student Name' : c === 'admission' ? 'Admission No' : 'Completion %'} <i class="bi bi-arrow-down-up ms-1" style="font-size: 0.75rem;"></i>`;
        }
    });
    
    const activeEl = document.getElementById(`sortCol_${col}`);
    if (activeEl) {
        const arrow = recordsState.sortDirection === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down';
        activeEl.innerHTML = `${col === 'date' ? 'Date' : col === 'name' ? 'Student Name' : col === 'admission' ? 'Admission No' : 'Completion %'} <i class="bi ${arrow} ms-1" style="font-size: 0.75rem;"></i>`;
    }
    
    refreshClassRecordsUI();
}

function changeRecordsPage(page) {
    recordsState.currentPage = page;
    refreshClassRecordsUI();
}

// Load list of classes for selection screen
async function loadRecordsClasses() {
    activeRecordsClassId = null;
    activeRecordsClassName = null;
    
    document.getElementById('recordsClassListView').classList.remove('d-none');
    document.getElementById('recordsDashboardView').classList.add('d-none');
    
    const grid = document.getElementById('recordsClassListGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></div>';
    
    try {
        if (!madrasaId) return;
        const q = query(collection(db, "classes"), where("madrasaId", "==", madrasaId));
        const snap = await getDocs(q);
        
        grid.innerHTML = '';
        if (snap.empty) {
            grid.innerHTML = `
                <div class="col-12 text-center py-4">
                    <p class="text-muted fw-bold">No classes found. Add classes in the Classes module first.</p>
                </div>`;
            return;
        }
        
        let classes = [];
        snap.forEach(d => classes.push({ id: d.id, ...d.data() }));
        classes.sort((a, b) => a.name.localeCompare(b.name));
        
        classes.forEach(c => {
            grid.innerHTML += `
                <div class="col-12 col-sm-6 col-md-4">
                    <div class="card p-4 class-card bg-white" onclick="openClassRecords('${c.id}', '${c.name.replace(/'/g, "\\'")}')">
                        <div class="d-flex align-items-center gap-3">
                            <div class="bg-primary bg-opacity-10 text-primary rounded-circle d-inline-flex align-items-center justify-content-center" style="width: 48px; height: 48px;">
                                <i class="bi bi-easel fs-4"></i>
                            </div>
                            <div>
                                <h6 class="fw-bold mb-1 text-dark">${c.name}</h6>
                                <small class="text-muted">Click to view records</small>
                            </div>
                        </div>
                    </div>
                </div>`;
        });
    } catch(err) {
        grid.innerHTML = `<div class="col-12 alert alert-danger">Failed to load classes: ${err.message}</div>`;
    }
}

async function openClassRecords(classId, className) {
    activeRecordsClassId = classId;
    activeRecordsClassName = className;
    
    document.getElementById('recordsCurrentClassName').innerText = className;
    document.getElementById('recordsClassListView').classList.add('d-none');
    document.getElementById('recordsDashboardView').classList.remove('d-none');
    
    // Set default date range values (last 30 days)
    document.getElementById('recordsFilterStartDate').value = recordsState.startDate;
    document.getElementById('recordsFilterEndDate').value = recordsState.endDate;
    document.getElementById('recordsFilterSingleDate').value = recordsState.singleDate;
    
    // Set default dropdown selections
    document.getElementById('recordsFilterDateRange').value = recordsState.dateFilterType;
    document.getElementById('recordsFilterStudent').value = recordsState.selectedStudentId;
    document.getElementById('recordsFilterPrayerStatus').value = recordsState.prayerStatus;
    document.getElementById('recordsFilterSearch').value = recordsState.searchQuery;
    
    // Update column visibility based on recordsState.dateFilterType
    const singleCol = document.getElementById('filterSingleDateCol');
    const startCol = document.getElementById('filterStartDateCol');
    const endCol = document.getElementById('filterEndDateCol');
    if (singleCol && startCol && endCol) {
        if (recordsState.dateFilterType === 'custom') {
            singleCol.classList.remove('d-none');
            startCol.classList.add('d-none');
            endCol.classList.add('d-none');
        } else if (recordsState.dateFilterType === 'range') {
            singleCol.classList.add('d-none');
            startCol.classList.remove('d-none');
            endCol.classList.remove('d-none');
        } else {
            singleCol.classList.add('d-none');
            startCol.classList.add('d-none');
            endCol.classList.add('d-none');
        }
    }
    
    // Populate class in Report Center
    const reportClass = document.getElementById('pdfReportClass');
    if (reportClass) {
        reportClass.innerHTML = `<option value="${classId}">${className}</option>`;
    }
    
    // Fetch data
    await fetchRecordsClassData();
}

async function fetchRecordsClassData() {
    const tbody = document.getElementById('recordsHistoryTableBody');
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" class="text-center py-5">
                    <div class="spinner-border text-primary border-3" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="text-muted fw-bold mt-2">Loading class students & records...</p>
                </td>
            </tr>`;
    }
    
    try {
        if (!madrasaId || !activeRecordsClassId) return;
        
        // 1. Fetch Students
        const stuQ = query(collection(db, "students"), where("madrasaId", "==", madrasaId), where("classId", "==", activeRecordsClassId));
        const stuSnap = await getDocs(stuQ);
        cachedClassStudents = [];
        stuSnap.forEach(d => {
            cachedClassStudents.push({ id: d.id, ...d.data() });
        });
        cachedClassStudents.sort((a, b) => a.name.localeCompare(b.name));
        
        // Populate student filter dropdown
        const stuFilter = document.getElementById('recordsFilterStudent');
        if (stuFilter) {
            stuFilter.innerHTML = '<option value="all">All Students</option>';
            cachedClassStudents.forEach(s => {
                stuFilter.innerHTML += `<option value="${s.id}">${s.name} (${s.admission_number || 'None'})</option>`;
            });
        }
        
        // 2. Fetch Records
        const recQ = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("classId", "==", activeRecordsClassId));
        const recSnap = await getDocs(recQ);
        cachedClassRecords = [];
        recSnap.forEach(d => {
            cachedClassRecords.push({ id: d.id, ...d.data() });
        });
        
        // Sync PDF student list scope
        populateReportStudentSelect();
        
        // Refresh UI
        refreshClassRecordsUI();
    } catch(err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="12" class="alert alert-danger text-center">Failed to fetch dashboard data: ${err.message}</td></tr>`;
        }
    }
}

function refreshClassRecordsUI() {
    const { result, dateFilteredRecords } = getFilteredRecords();
    
    // 1. Calculate class overview metrics
    calculateClassMetrics(cachedClassStudents, cachedClassRecords, dateFilteredRecords);
    
    // 2. Sort records
    const sorted = getSortedRecords(result);
    
    // 3. Render table
    renderDashboardTable(sorted);
}

function isPrayerCompleted(val) {
    if (val === undefined || val === null) return false;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val > 0;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') {
        if (val.status !== undefined) return isPrayerCompleted(val.status);
        if (val.value !== undefined) return isPrayerCompleted(val.value);
        if (val.completed !== undefined) return isPrayerCompleted(val.completed);
        return Object.keys(val).length > 0;
    }
    if (typeof val === 'string') {
        const clean = val.trim().toLowerCase();
        if (clean === 'jamaat' || clean === 'individual' || clean === 'qaza') return true;
        if (clean === 'completed' || clean === 'yes' || clean === '1' || clean === 'true') return true;
        return false;
    }
    return false;
}

function getRecordCompletedPrayersCount(r) {
    if (!r) return 0;
    const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    return keys.filter(k => {
        const pCap = k.charAt(0).toUpperCase() + k.slice(1);
        const val = r[k] || r.prayers?.[k] || r[pCap] || r.prayers?.[pCap];
        return isPrayerCompleted(val);
    }).length;
}

function getFilteredRecords() {
    console.log(`[Debug Flow] Total records loaded: ${cachedClassRecords.length}`);
    let start = null;
    let end = null;
    
    if (recordsState.dateFilterType === 'today') {
        start = todayStr;
        end = todayStr;
    } else if (recordsState.dateFilterType === 'yesterday') {
        start = yesterdayStr;
        end = yesterdayStr;
    } else if (recordsState.dateFilterType === 'custom') {
        start = recordsState.singleDate;
        end = recordsState.singleDate;
    } else if (recordsState.dateFilterType === 'range') {
        start = recordsState.startDate;
        end = recordsState.endDate;
    }
    
    const dateFilteredRecords = cachedClassRecords.filter(r => {
        if (start && r.date < start) return false;
        if (end && r.date > end) return false;
        return true;
    });
    console.log(`[Debug Flow] Records after date filter: ${dateFilteredRecords.length}`);
    
    let result = [...dateFilteredRecords];
    
    // Filter by Student
    if (recordsState.selectedStudentId !== 'all') {
        result = result.filter(r => r.studentId === recordsState.selectedStudentId);
    }
    
    // Filter by Search Query (Student Name or Admission No)
    if (recordsState.searchQuery.trim() !== '') {
        const queryStr = recordsState.searchQuery.toLowerCase().trim();
        result = result.filter(r => {
            const student = cachedClassStudents.find(s => s.id === r.studentId);
            if (!student) return false;
            return student.name.toLowerCase().includes(queryStr) || 
                   (student.admission_number || '').toLowerCase().includes(queryStr);
        });
    }
    
    // Filter by Prayer Status
    if (recordsState.prayerStatus !== 'all') {
        result = result.filter(r => {
            const completedCount = getRecordCompletedPrayersCount(r);
            
            if (recordsState.prayerStatus === 'completed') {
                return completedCount === 5;
            } else if (recordsState.prayerStatus === 'missed') {
                return completedCount === 0;
            } else if (recordsState.prayerStatus === 'partial') {
                return completedCount > 0 && completedCount < 5;
            }
            return true;
        });
    }
    console.log(`[Debug Flow] Records after status filter: ${result.length}`);
    
    return { result, dateFilteredRecords };
}

function getSortedRecords(records) {
    const key = recordsState.sortBy;
    const dir = recordsState.sortDirection === 'asc' ? 1 : -1;
    
    return [...records].sort((a, b) => {
        if (key === 'date') {
            return a.date.localeCompare(b.date) * dir;
        } else if (key === 'name') {
            const stuA = cachedClassStudents.find(s => s.id === a.studentId)?.name || '';
            const stuB = cachedClassStudents.find(s => s.id === b.studentId)?.name || '';
            return stuA.localeCompare(stuB) * dir;
        } else if (key === 'admission') {
            const admA = cachedClassStudents.find(s => s.id === a.studentId)?.admission_number || '';
            const admB = cachedClassStudents.find(s => s.id === b.studentId)?.admission_number || '';
            return admA.localeCompare(admB) * dir;
        } else if (key === 'completion') {
            const compA = getRecordCompletedPrayersCount(a);
            const compB = getRecordCompletedPrayersCount(b);
            return (compA - compB) * dir;
        }
        return 0;
    });
}

function calculateClassMetrics(filteredStudents, filteredRecords, dateFilteredRecords) {
    const totalStudents = filteredStudents.length;
    const totalRecords = dateFilteredRecords.length;
    
    let totalCompleted = 0;
    let totalMissed = 0;
    let totalCompletedPrayers = 0;
    
    dateFilteredRecords.forEach(r => {
        const completedCount = getRecordCompletedPrayersCount(r);
        if (completedCount === 5) {
            totalCompleted++;
        } else if (completedCount === 0) {
            totalMissed++;
        }
        totalCompletedPrayers += completedCount;
    });
    
    const avgCompletion = totalRecords > 0 ? Math.round((totalCompletedPrayers / (totalRecords * 5)) * 100) : 0;
    
    let daysCount = 1;
    if (recordsState.dateFilterType === 'today' || recordsState.dateFilterType === 'yesterday') {
        daysCount = 1;
    } else if (recordsState.dateFilterType === 'custom') {
        daysCount = 1;
    } else if (recordsState.dateFilterType === 'range') {
        const start = new Date(recordsState.startDate);
        const end = new Date(recordsState.endDate);
        daysCount = Math.round((end - start) / 86400000) + 1;
        if (isNaN(daysCount) || daysCount < 1) daysCount = 1;
    }
    
    const totalExpectedRecords = totalStudents * daysCount;
    const attendancePct = totalExpectedRecords > 0 ? Math.min(Math.round((totalRecords / totalExpectedRecords) * 100), 100) : 0;
    
    document.getElementById('metricTotalStudents').innerText = totalStudents;
    document.getElementById('metricTotalRecords').innerText = totalRecords;
    document.getElementById('metricTotalCompleted').innerText = totalCompleted;
    document.getElementById('metricTotalMissed').innerText = totalMissed;
    document.getElementById('metricAvgCompletion').innerText = `${avgCompletion}%`;
    document.getElementById('metricAttendanceRate').innerText = `${attendancePct}%`;
}

function renderDashboardTable(records) {
    console.log(`[Debug Flow] Records rendered: ${records.length}`);
    const tbody = document.getElementById('recordsHistoryTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const totalCount = records.length;
    const totalPages = Math.ceil(totalCount / recordsState.pageSize) || 1;
    
    if (recordsState.currentPage > totalPages) {
        recordsState.currentPage = totalPages;
    }
    
    const startIndex = (recordsState.currentPage - 1) * recordsState.pageSize;
    const endIndex = Math.min(startIndex + recordsState.pageSize, totalCount);
    
    const summaryText = document.getElementById('recordsTableSummaryText');
    if (summaryText) {
        summaryText.innerText = `Showing ${totalCount > 0 ? startIndex + 1 : 0} - ${endIndex} of ${totalCount} records`;
    }
    
    renderTablePagination(totalPages);
    
    if (totalCount === 0) {
        tbody.innerHTML = `<tr><td colspan="12" class="text-center py-4 text-muted fw-bold">No history records found matching this criteria.</td></tr>`;
        return;
    }
    
    const paginatedRecords = records.slice(startIndex, endIndex);
    
    paginatedRecords.forEach(r => {
        const student = cachedClassStudents.find(s => s.id === r.studentId);
        const studentName = student ? student.name : 'Unknown Student';
        const admissionNo = student ? (student.admission_number || 'None') : 'None';
        const className = activeRecordsClassName || 'Class';
        
        const completedCount = getRecordCompletedPrayersCount(r);
        const completionPct = Math.round((completedCount / 5) * 100);
        
        const getStatusBadge = (val) => {
            if (val === 'Jamaat') return `<span class="badge bg-success bg-opacity-10 text-success fw-bold py-1 px-2 rounded-pill" style="font-size: 0.75rem;"><i class="bi bi-people-fill me-1"></i>Jam</span>`;
            if (val === 'Individual') return `<span class="badge bg-warning bg-opacity-10 text-warning fw-bold py-1 px-2 rounded-pill" style="font-size: 0.75rem;"><i class="bi bi-person-fill me-1"></i>Ind</span>`;
            if (val === 'Qaza') return `<span class="badge bg-info bg-opacity-10 text-info fw-bold py-1 px-2 rounded-pill" style="font-size: 0.75rem;"><i class="bi bi-clock-history me-1"></i>Qaz</span>`;
            if (val === 'Incorrect') return `<span class="badge bg-secondary bg-opacity-10 text-secondary fw-bold py-1 px-2 rounded-pill" style="font-size: 0.75rem;"><i class="bi bi-exclamation-triangle me-1"></i>Inc</span>`;
            if (val === 'Not Prayed') return `<span class="badge bg-danger bg-opacity-10 text-danger fw-bold py-1 px-2 rounded-pill" style="font-size: 0.75rem;"><i class="bi bi-x-circle me-1"></i>Mis</span>`;
            return `<span class="text-muted">—</span>`;
        };
        
        const fVal = r.fajr || r.prayers?.fajr || r.Fajr || r.prayers?.Fajr;
        const dVal = r.dhuhr || r.prayers?.dhuhr || r.Dhuhr || r.prayers?.Dhuhr;
        const aVal = r.asr || r.prayers?.asr || r.Asr || r.prayers?.Asr;
        const mVal = r.maghrib || r.prayers?.maghrib || r.Maghrib || r.prayers?.Maghrib;
        const iVal = r.isha || r.prayers?.isha || r.Isha || r.prayers?.Isha;
        
        const studiedQuran = r.subjects?.includes('quran') || r.subjects?.some(s => s.toLowerCase().includes('quran')) ? 'Yes' : 'No';
        const salawat = r.salawatCount || 0;
        let remarks = [];
        if (studiedQuran === 'Yes') remarks.push('Quran');
        if (salawat > 0) remarks.push(`Salawat: ${salawat}`);
        if (r.subjectScore > 0) remarks.push(`Subj: ${r.subjectScore}`);
        const remarksStr = remarks.length > 0 ? remarks.join(', ') : 'None';
        
        tbody.innerHTML += `
            <tr class="border-bottom border-light">
                <td class="fw-bold text-dark">${r.date}</td>
                <td><span class="fw-bold text-primary">${studentName}</span></td>
                <td class="text-muted fw-bold">${admissionNo}</td>
                <td><span class="badge bg-light text-dark border">${className}</span></td>
                <td class="text-center">${getStatusBadge(fVal)}</td>
                <td class="text-center">${getStatusBadge(dVal)}</td>
                <td class="text-center">${getStatusBadge(aVal)}</td>
                <td class="text-center">${getStatusBadge(mVal)}</td>
                <td class="text-center">${getStatusBadge(iVal)}</td>
                <td class="text-center"><strong class="${completionPct >= 80 ? 'text-success' : completionPct >= 50 ? 'text-warning' : 'text-danger'}">${completionPct}%</strong></td>
                <td class="text-muted small">${remarksStr}</td>
                <td class="text-center">
                    <div class="d-flex justify-content-center gap-1">
                        <button class="btn btn-sm btn-outline-success rounded-pill px-2 py-0" onclick="openEditRecordModalFromTable('${r.id}', '${r.studentId}')" title="Edit Record"><i class="bi bi-pencil"></i></button>
                        <button class="btn btn-sm btn-outline-danger rounded-pill px-2 py-0" onclick="deleteClassRecord('${r.id}')" title="Delete Record"><i class="bi bi-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });
}

function renderTablePagination(totalPages) {
    const list = document.getElementById('recordsTablePagination');
    if (!list) return;
    list.innerHTML = '';
    
    if (totalPages <= 1) return;
    
    list.innerHTML += `
        <li class="page-item ${recordsState.currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changeRecordsPage(${recordsState.currentPage - 1}); return false;">&laquo;</a>
        </li>
    `;
    
    for (let i = 1; i <= totalPages; i++) {
        list.innerHTML += `
            <li class="page-item ${recordsState.currentPage === i ? 'active' : ''}">
                <a class="page-link" href="#" onclick="changeRecordsPage(${i}); return false;">${i}</a>
            </li>
        `;
    }
    
    list.innerHTML += `
        <li class="page-item ${recordsState.currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changeRecordsPage(${recordsState.currentPage + 1}); return false;">&raquo;</a>
        </li>
    `;
}

async function deleteClassRecord(recordId) {
    const result = await Swal.fire({
        title: 'Are you sure?',
        text: "Are you sure you want to permanently delete this prayer record?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, delete it!',
        customClass: { popup: 'rounded-4' }
    });

    if (result.isConfirmed) {
        try {
            await deleteDoc(doc(db, "records", recordId));
            
            // Reload local cache
            const recQ = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("classId", "==", activeRecordsClassId));
            const recSnap = await getDocs(recQ);
            cachedClassRecords = [];
            recSnap.forEach(d => {
                cachedClassRecords.push({ id: d.id, ...d.data() });
            });
            
            refreshClassRecordsUI();
            
            Swal.fire({
                title: 'Deleted!',
                text: 'The prayer record has been deleted.',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false,
                customClass: { popup: 'rounded-4' }
            });
        } catch(e) {
            Swal.fire({
                title: 'Error',
                text: "Error deleting record: " + e.message,
                icon: 'error',
                confirmButtonColor: '#d33',
                customClass: { popup: 'rounded-4' }
            });
        }
    }
}

async function openEditRecordModalFromTable(rId, stuId) {
    try {
        const rDoc = await getDoc(doc(db, "records", rId));
        let data = {};
        if (rDoc.exists()) {
            data = rDoc.data();
        } else {
            data = {
                prayers: { fajr: "Not Prayed", dhuhr: "Not Prayed", asr: "Not Prayed", maghrib: "Not Prayed", isha: "Not Prayed" },
                subjectScore: 0,
                salawatCount: 0
            };
        }

        if (!recordEditModal) {
            recordEditModal = new bootstrap.Modal(document.getElementById('recordEditModal'));
        }

        const pCont = document.getElementById('recordEditFormContainer');
        
        let html = `
            <input type="hidden" id="editRecordId" value="${rId}">
            <input type="hidden" id="editHistoryStudentId" value="${stuId}">
            <h6 class="text-muted fw-bold border-bottom pb-2 mb-3">Prayers</h6>
        `;

        const formItems = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
        formItems.forEach(p => {
            const pCap = p.charAt(0).toUpperCase() + p.slice(1);
            const currentVal = data[p] || data.prayers?.[p] || data.prayers?.[pCap] || 'Not Prayed';

            html += `
              <div class="mb-3 p-2 bg-light rounded-3 shadow-sm border border-white">
                 <label class="fw-bold small mb-2 text-dark">${pCap}</label>
                 <select class="form-select form-select-sm border-0 shadow-sm prayer-edit-select fw-bold text-secondary" data-key="${p}" data-cap="${pCap}">
                    <option value="Jamaat" ${currentVal === 'Jamaat' ? 'selected' : ''}>Jamaat (1.0 pt)</option>
                    <option value="Individual" ${currentVal === 'Individual' ? 'selected' : ''}>Individual (0.5 pt)</option>
                    <option value="Qaza" ${currentVal === 'Qaza' ? 'selected' : ''}>Qaza (0.5 pt)</option>
                    <option value="Not Prayed" ${currentVal === 'Not Prayed' ? 'selected' : ''}>Not Prayed (0 pts)</option>
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
    } catch (err) {
        alert("Failed to load record details: " + err.message);
    }
}

// Expose functions globally for HTML event handlers
window.sortRecordsTable = sortRecordsTable;
window.changeRecordsPage = changeRecordsPage;
window.loadRecordsClasses = loadRecordsClasses;
window.openClassRecords = openClassRecords;
window.deleteClassRecord = deleteClassRecord;
window.openEditRecordModalFromTable = openEditRecordModalFromTable;

// Bind Filters UI Actions
function initRecordsRedesignListeners() {
    // 1. Date Filter Range type selector
    document.getElementById('recordsFilterDateRange').addEventListener('change', (e) => {
        recordsState.dateFilterType = e.target.value;
        recordsState.currentPage = 1;
        
        const singleCol = document.getElementById('filterSingleDateCol');
        const startCol = document.getElementById('filterStartDateCol');
        const endCol = document.getElementById('filterEndDateCol');
        
        if (recordsState.dateFilterType === 'custom') {
            singleCol.classList.remove('d-none');
            startCol.classList.add('d-none');
            endCol.classList.add('d-none');
        } else if (recordsState.dateFilterType === 'range') {
            singleCol.classList.add('d-none');
            startCol.classList.remove('d-none');
            endCol.classList.remove('d-none');
        } else {
            singleCol.classList.add('d-none');
            startCol.classList.add('d-none');
            endCol.classList.add('d-none');
        }
        
        refreshClassRecordsUI();
    });
    
    // Date input listeners
    document.getElementById('recordsFilterSingleDate').addEventListener('change', (e) => {
        recordsState.singleDate = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    document.getElementById('recordsFilterStartDate').addEventListener('change', (e) => {
        recordsState.startDate = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    document.getElementById('recordsFilterEndDate').addEventListener('change', (e) => {
        recordsState.endDate = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    
    // Student dropdown listener
    document.getElementById('recordsFilterStudent').addEventListener('change', (e) => {
        recordsState.selectedStudentId = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    
    // Prayer status select listener
    document.getElementById('recordsFilterPrayerStatus').addEventListener('change', (e) => {
        recordsState.prayerStatus = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    
    // Search text input listener
    document.getElementById('recordsFilterSearch').addEventListener('input', (e) => {
        recordsState.searchQuery = e.target.value;
        recordsState.currentPage = 1;
        refreshClassRecordsUI();
    });
    
    // Reset filters button click
    document.getElementById('recordsFilterResetBtn').addEventListener('click', () => {
        recordsState.dateFilterType = 'yesterday';
        recordsState.singleDate = todayStr;
        recordsState.startDate = getDateAgo(30);
        recordsState.endDate = todayStr;
        recordsState.selectedStudentId = 'all';
        recordsState.prayerStatus = 'all';
        recordsState.searchQuery = '';
        recordsState.sortBy = 'date';
        recordsState.sortDirection = 'desc';
        recordsState.currentPage = 1;
        
        document.getElementById('recordsFilterDateRange').value = 'yesterday';
        document.getElementById('recordsFilterSingleDate').value = todayStr;
        document.getElementById('recordsFilterStartDate').value = recordsState.startDate;
        document.getElementById('recordsFilterEndDate').value = todayStr;
        document.getElementById('recordsFilterStudent').value = 'all';
        document.getElementById('recordsFilterPrayerStatus').value = 'all';
        document.getElementById('recordsFilterSearch').value = '';
        
        document.getElementById('filterSingleDateCol').classList.add('d-none');
        document.getElementById('filterStartDateCol').classList.add('d-none');
        document.getElementById('filterEndDateCol').classList.add('d-none');
        
        refreshClassRecordsUI();
    });
    
    // Back to Class list view button
    document.getElementById('btnBackToClasses').addEventListener('click', () => {
        loadRecordsClasses();
    });

    // Record Update modal save logic
    document.getElementById('saveRecordEditBtn').onclick = async () => {
        const recordId = document.getElementById('editRecordId').value;
        const studentId = document.getElementById('editHistoryStudentId').value;
        const subjectScore = parseInt(document.getElementById('editSubjectScore').value) || 0;
        const salawatCount = parseInt(document.getElementById('editSalawatCount').value) || 0;
        
        const prayers = {};
        let prayerScore = 0;
        const PRAYER_SCORES = { "Jamaat": 2.0, "Individual": 1.0, "Qaza": 0.5, "Incorrect": 0.0, "Not Prayed": 0.0 };
        
        const selects = document.querySelectorAll('.prayer-edit-select');
        selects.forEach(s => {
            const key = s.dataset.key;
            const val = s.value;
            prayers[key] = val;
            prayerScore += PRAYER_SCORES[val] || 0;
        });
        prayerScore = parseFloat(prayerScore.toFixed(1));
        
        const totalScore = parseFloat((prayerScore + subjectScore).toFixed(1));
        
        const btn = document.getElementById('saveRecordEditBtn');
        btn.disabled = true;
        btn.innerText = "Updating...";
        
        try {
            const recordRef = doc(db, "records", recordId);
            const recordCheck = await getDoc(recordRef);
            
            const payload = {
                prayers,
                prayerScore,
                subjectScore,
                totalScore,
                salawatCount,
                timestamp: new Date().toISOString()
            };
            
            if (recordCheck.exists()) {
                await updateDoc(recordRef, payload);
            } else {
                // If it is a quick add, create full record doc
                const dateStr = recordId.split('_')[1];
                await setDoc(recordRef, {
                    madrasaId,
                    studentId,
                    classId: activeRecordsClassId,
                    date: dateStr,
                    ...payload
                });
            }
            
            bootstrap.Modal.getInstance(document.getElementById('recordEditModal')).hide();
            
            // Reload local cache
            const recQ = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("classId", "==", activeRecordsClassId));
            const recSnap = await getDocs(recQ);
            cachedClassRecords = [];
            recSnap.forEach(d => {
                cachedClassRecords.push({ id: d.id, ...d.data() });
            });
            
            refreshClassRecordsUI();
        } catch(err) {
            alert("Failed to update record: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerText = "Update Record";
        }
    };
    
    // PDF Report type dynamic fields
    document.getElementById('pdfReportType').addEventListener('change', updateReportPeriodInputs);
    document.getElementById('pdfReportScope').addEventListener('change', (e) => {
        const studentCol = document.getElementById('pdfReportStudentCol');
        if (e.target.value === 'single') {
            studentCol.classList.remove('d-none');
            populateReportStudentSelect();
        } else {
            studentCol.classList.add('d-none');
        }
    });
    
    // Report Center Buttons
    document.getElementById('btnPreviewReport').addEventListener('click', () => triggerReportAction('preview'));
    document.getElementById('btnPrintReportCenter').addEventListener('click', () => triggerReportAction('print'));
    document.getElementById('btnDownloadReport').addEventListener('click', () => triggerReportAction('download'));
    
    document.getElementById('btnPrintFromPreview').addEventListener('click', () => {
        bootstrap.Modal.getInstance(document.getElementById('pdfPreviewModal')).hide();
        triggerReportAction('print');
    });
    document.getElementById('btnDownloadFromPreview').addEventListener('click', () => {
        bootstrap.Modal.getInstance(document.getElementById('pdfPreviewModal')).hide();
        triggerReportAction('download');
    });
    
    // Set initial dynamic fields for period selector
    updateReportPeriodInputs();

    // Leaderboard Listeners
    document.getElementById('leaderboardClassSelect')?.addEventListener('change', (e) => {
        leaderboardClassId = e.target.value;
        fetchAndRenderLeaderboard();
    });

    document.querySelectorAll('input[name="leaderboardPeriod"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            leaderboardPeriod = e.target.value;
            fetchAndRenderLeaderboard();
        });
    });

    // Database Tools Listeners
    document.getElementById('btnScanOrphans')?.addEventListener('click', () => scanAndPurgeOrphans('scan'));
    document.getElementById('btnRecalculateScores')?.addEventListener('click', () => migrateHistoricalScores('scan'));
}

// PDF REPORT CENTER LOGIC
function populateReportStudentSelect() {
    const studentSelect = document.getElementById('pdfReportStudent');
    if (!studentSelect) return;
    studentSelect.innerHTML = '';
    cachedClassStudents.forEach(s => {
        studentSelect.innerHTML += `<option value="${s.id}">${s.name} (${s.admission_number || 'None'})</option>`;
    });
}

function updateReportPeriodInputs() {
    const type = document.getElementById('pdfReportType').value;
    const label = document.getElementById('pdfPeriodLabel');
    const container = document.getElementById('pdfPeriodInputs');
    if (!container) return;
    
    if (type === 'daily') {
        label.innerText = "Select Date";
        container.innerHTML = `<input type="date" id="pdfPeriodDaily" class="form-control bg-light border-0 shadow-sm fw-bold" value="${todayStr}">`;
    } else if (type === 'weekly') {
        label.innerText = "Select Date in Week";
        container.innerHTML = `<input type="date" id="pdfPeriodWeekly" class="form-control bg-light border-0 shadow-sm fw-bold" value="${todayStr}">`;
    } else if (type === 'monthly') {
        label.innerText = "Select Month & Year";
        
        let monthOptions = '';
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const currMonth = new Date().getMonth();
        months.forEach((m, idx) => {
            monthOptions += `<option value="${idx}" ${idx === currMonth ? 'selected' : ''}>${m}</option>`;
        });
        
        let yearOptions = '';
        const currYear = new Date().getFullYear();
        for (let y = currYear - 3; y <= currYear + 3; y++) {
            yearOptions += `<option value="${y}" ${y === currYear ? 'selected' : ''}>${y}</option>`;
        }
        
        container.innerHTML = `
            <div class="d-flex gap-2">
                <select id="pdfPeriodMonth" class="form-select bg-light border-0 shadow-sm fw-bold w-50">
                    ${monthOptions}
                </select>
                <select id="pdfPeriodYear" class="form-select bg-light border-0 shadow-sm fw-bold w-50">
                    ${yearOptions}
                </select>
            </div>`;
    }
}

async function triggerReportAction(action) {
    const type = document.getElementById('pdfReportType').value;
    const scope = document.getElementById('pdfReportScope').value;
    
    let startStr = '';
    let endStr = '';
    let periodStr = '';
    
    if (type === 'daily') {
        const inputVal = document.getElementById('pdfPeriodDaily').value;
        if (!inputVal) { alert("Please select a date."); return; }
        startStr = inputVal;
        endStr = inputVal;
        periodStr = new Date(inputVal).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
    } else if (type === 'weekly') {
        const inputVal = document.getElementById('pdfPeriodWeekly').value;
        if (!inputVal) { alert("Please select a date in the week."); return; }
        const baseDate = new Date(inputVal);
        const day = baseDate.getDay();
        const sun = new Date(baseDate);
        sun.setDate(baseDate.getDate() - day);
        const sat = new Date(baseDate);
        sat.setDate(baseDate.getDate() + (6 - day));
        
        startStr = sun.toISOString().split('T')[0];
        endStr = sat.toISOString().split('T')[0];
        periodStr = `Week of ${sun.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} to ${sat.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    } else if (type === 'monthly') {
        const m = parseInt(document.getElementById('pdfPeriodMonth').value);
        const y = parseInt(document.getElementById('pdfPeriodYear').value);
        
        const pad = (n) => String(n).padStart(2, '0');
        startStr = `${y}-${pad(m+1)}-01`;
        const lastDay = new Date(y, m + 1, 0).getDate();
        endStr = `${y}-${pad(m+1)}-${pad(lastDay)}`;
        
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        periodStr = `${monthNames[m]} ${y}`;
    }
    
    // Retrieve Institution Name
    let instName = "Niskaram Madrasa Tracker";
    try {
        const mDoc = await getDoc(doc(db, "madrasas", madrasaId));
        if (mDoc.exists()) {
            instName = mDoc.data().name || instName;
        }
    } catch(e) {}
    
    if (scope === 'all') {
        generateAllStudentsReport(action, instName, periodStr, startStr, endStr);
    } else {
        const studentId = document.getElementById('pdfReportStudent').value;
        if (!studentId) { alert("Please select a student."); return; }
        generateSingleStudentReport(action, instName, studentId, periodStr, startStr, endStr);
    }
}

function generateAllStudentsReport(action, instName, periodStr, startStr, endStr) {
    const reportRecords = cachedClassRecords.filter(r => r.date >= startStr && r.date <= endStr);
    
    let html = `
        <div class="print-header">
            <h1 class="print-title">${instName}</h1>
            <p class="print-subtitle"><strong>All Students Performance Report</strong></p>
            <p class="print-subtitle">Class: <strong>${activeRecordsClassName}</strong> | Period: <strong>${periodStr}</strong> | Generated: ${todayStr}</p>
        </div>
        
        <table class="print-table">
            <thead>
                <tr>
                    <th style="width: 50px;">S.No</th>
                    <th style="width: 120px;">Admission No</th>
                    <th style="text-align: left;">Student Name</th>
                    <th>Completed</th>
                    <th>Missed</th>
                    <th>Completion %</th>
                    <th>Submission Rate %</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    let overallCompleted = 0;
    let overallMissed = 0;
    let totalPctSum = 0;
    
    // Period Expected Days
    const start = new Date(startStr);
    const end = new Date(endStr);
    let calendarDays = Math.round((end - start) / 86400000) + 1;
    if (isNaN(calendarDays) || calendarDays < 1) calendarDays = 1;
    
    const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    const pStats = { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
    
    cachedClassStudents.forEach((student, idx) => {
        const studentRecs = reportRecords.filter(r => r.studentId === student.id);
        
        let completed = 0;
        let missed = 0;
        
        studentRecs.forEach(r => {
            keys.forEach(k => {
                const pCap = k.charAt(0).toUpperCase() + k.slice(1);
                const val = r[k] || r.prayers?.[k] || r[pCap] || r.prayers?.[pCap];
                if (isPrayerCompleted(val)) {
                    completed++;
                    pStats[k]++;
                } else {
                    missed++;
                }
            });
        });
        
        overallCompleted += completed;
        overallMissed += missed;
        
        const totalPrayersCount = studentRecs.length * 5;
        const completionPct = totalPrayersCount > 0 ? Math.round((completed / totalPrayersCount) * 100) : 0;
        totalPctSum += completionPct;
        
        const attendancePct = Math.min(Math.round((studentRecs.length / calendarDays) * 100), 100);
        
        html += `
            <tr>
                <td>${idx + 1}</td>
                <td>${student.admission_number || 'None'}</td>
                <td style="text-align: left; font-weight: bold;">${student.name}</td>
                <td>${completed}</td>
                <td>${missed}</td>
                <td class="${completionPct >= 80 ? 'print-badge-completed' : completionPct >= 50 ? 'print-badge-incorrect' : 'print-badge-missed'}">${completionPct}%</td>
                <td>${attendancePct}%</td>
            </tr>
        `;
    });
    
    const averageCompletion = cachedClassStudents.length > 0 ? Math.round(totalPctSum / cachedClassStudents.length) : 0;
    
    html += `
            </tbody>
        </table>
        
        <h4 style="margin-top: 30px; color: #1f7a63; border-bottom: 1px solid #ddd; padding-bottom: 5px;">Prayer-wise Summary Statistics</h4>
        <table class="print-table" style="margin-top: 10px;">
            <thead>
                <tr>
                    <th>Fajr</th>
                    <th>Dhuhr</th>
                    <th>Asr</th>
                    <th>Maghrib</th>
                    <th>Isha</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>${pStats.fajr} completed</td>
                    <td>${pStats.dhuhr} completed</td>
                    <td>${pStats.asr} completed</td>
                    <td>${pStats.maghrib} completed</td>
                    <td>${pStats.isha} completed</td>
                </tr>
            </tbody>
        </table>

        <div style="margin-top: 25px; background-color: #f9f9f9; padding: 15px; border-radius: 8px; border: 1px solid #eee;">
            <h5 style="margin-top:0; color:#333; font-weight:bold;">Overall Summary Totals</h5>
            <div style="display:flex; justify-content:space-between; font-size:10pt;">
                <div>Total Students: <strong>${cachedClassStudents.length}</strong></div>
                <div>Total Logs Registered: <strong>${reportRecords.length}</strong></div>
                <div>Total Completed Prayers: <strong class="print-badge-completed">${overallCompleted}</strong></div>
                <div>Total Missed Prayers: <strong class="print-badge-missed">${overallMissed}</strong></div>
                <div>Average Class Completion: <strong>${averageCompletion}%</strong></div>
            </div>
        </div>
        
        <div style="margin-top: 60px; display: flex; justify-content: space-between; font-size: 10pt;">
            <div>Report Evaluator Signature: ______________________</div>
            <div>Date: _______________</div>
        </div>
    `;
    
    handleReportOutput(action, html, `All_Students_Report_${activeRecordsClassName}`);
}

async function generateSingleStudentReport(action, instName, studentId, periodStr, startStr, endStr) {
    const student = cachedClassStudents.find(s => s.id === studentId);
    if (!student) { alert("Student not found."); return; }
    
    const studentRecs = cachedClassRecords.filter(r => r.studentId === studentId && r.date >= startStr && r.date <= endStr);
    studentRecs.sort((a, b) => a.date.localeCompare(b.date));
    
    // Period Expected Days
    const start = new Date(startStr);
    const end = new Date(endStr);
    let calendarDays = Math.round((end - start) / 86400000) + 1;
    if (isNaN(calendarDays) || calendarDays < 1) calendarDays = 1;
    
    let completed = 0;
    let missed = 0;
    const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    
    let tableRows = '';
    studentRecs.forEach(r => {
        const getStatusSymbol = (k) => {
            const pCap = k.charAt(0).toUpperCase() + k.slice(1);
            const val = r[k] || r.prayers?.[k] || r[pCap] || r.prayers?.[pCap];
            if (val === 'Jamaat') { completed++; return 'Jam (Y)'; }
            if (val === 'Individual') { completed++; return 'Ind (Y)'; }
            if (val === 'Qaza') { completed++; return 'Qaz (Y)'; }
            if (val === true || val === 'completed' || val === 'yes' || val === '1' || val === 'true' || val === 1) {
                completed++;
                return 'Jam (Y)';
            }
            if (val === 'Incorrect') { missed++; return 'Inc (N)'; }
            if (val === 'Not Prayed') { missed++; return 'Mis (N)'; }
            if (val === false || val === 'missed' || val === 'no' || val === '0' || val === 'false' || val === 0) {
                missed++;
                return 'Mis (N)';
            }
            missed++;
            return '—';
        };
        
        const fStatus = getStatusSymbol('fajr');
        const dStatus = getStatusSymbol('dhuhr');
        const aStatus = getStatusSymbol('asr');
        const mStatus = getStatusSymbol('maghrib');
        const iStatus = getStatusSymbol('isha');
        
        const studiedQuran = r.subjects?.includes('quran') || r.subjects?.some(s => s.toLowerCase().includes('quran')) ? 'Y' : '—';
        const salawat = r.salawatCount || 0;
        const subjScore = r.subjectScore || 0;
        
        tableRows += `
            <tr>
                <td style="font-weight:bold;">${r.date}</td>
                <td>${fStatus}</td>
                <td>${dStatus}</td>
                <td>${aStatus}</td>
                <td>${mStatus}</td>
                <td>${iStatus}</td>
                <td>${studiedQuran}</td>
                <td>${salawat}</td>
                <td>${subjScore}</td>
                <td><strong>${r.totalScore || 0}</strong></td>
            </tr>
        `;
    });
    
    const totalPrayersCount = studentRecs.length * 5;
    const completionPct = totalPrayersCount > 0 ? Math.round((completed / totalPrayersCount) * 100) : 0;
    const attendancePct = Math.min(Math.round((studentRecs.length / calendarDays) * 100), 100);
    const accumulatedPoints = studentRecs.reduce((sum, r) => sum + (Number(r.totalScore) || 0), 0);
    
    // Rank logic
    let classRank = '-';
    try {
        const allStudentScores = {};
        cachedClassStudents.forEach(s => allStudentScores[s.id] = 0);
        
        // Accumulate points for all students in class in this period
        const periodRecords = cachedClassRecords.filter(r => r.date >= startStr && r.date <= endStr);
        periodRecords.forEach(r => {
            if (allStudentScores[r.studentId] !== undefined) {
                allStudentScores[r.studentId] += Number(r.totalScore) || 0;
            }
        });
        
        const ranking = Object.entries(allStudentScores).sort((a, b) => b[1] - a[1]);
        const rankIndex = ranking.findIndex(entry => entry[0] === studentId) + 1;
        if (rankIndex > 0) classRank = `#${rankIndex}`;
    } catch(e) {}

    let performanceSummary = "Weak consistency. Needs improvement in regular tracking.";
    if (completionPct >= 80 && attendancePct >= 80) {
        performanceSummary = "Excellent dedication! Maintaining highly regular prayer consistency.";
    } else if (completionPct >= 60 && attendancePct >= 60) {
        performanceSummary = "Good effort. Stable prayer attendance. Keep practicing.";
    }
    
    let html = `
        <div class="print-header">
            <h1 class="print-title">${instName}</h1>
            <p class="print-subtitle"><strong>Student Performance Report Card</strong></p>
            <p class="print-subtitle">Period: <strong>${periodStr}</strong> | Generated: ${todayStr}</p>
        </div>
        
        <div style="background-color: #fcfcfc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 10px; margin-bottom: 20px;">
            <div class="row" style="display:flex; flex-wrap:wrap; font-size:10pt;">
                <div style="flex:1; min-width:200px;">
                    <div>Student Name: <strong>${student.name}</strong></div>
                    <div>Admission No: <strong>${student.admission_number || '-'}</strong></div>
                    <div>Class: <strong>${activeRecordsClassName}</strong></div>
                </div>
                <div style="flex:1; min-width:200px; border-left:1px solid #e2e8f0; padding-left:20px;">
                    <div>Class Rank: <strong>${classRank}</strong></div>
                    <div>Prayer Completion: <strong>${completionPct}%</strong></div>
                    <div>Submission Rate: <strong>${attendancePct}%</strong></div>
                    <div>Accumulated Points: <strong>${accumulatedPoints} pts</strong></div>
                </div>
            </div>
        </div>
        
        <h4 style="color:#1f7a63; border-bottom:1px solid #ddd; padding-bottom:5px; margin-top:25px;">Prayer Log Details</h4>
        <table class="print-table" style="margin-top: 10px; font-size: 8.5pt;">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Fajr</th>
                    <th>Dhuhr</th>
                    <th>Asr</th>
                    <th>Maghrib</th>
                    <th>Isha</th>
                    <th>Quran</th>
                    <th>Salawat</th>
                    <th>Subjects</th>
                    <th>Points</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows || '<tr><td colspan="10" class="text-center py-3 text-muted">No records found for this student in the selected period.</td></tr>'}
            </tbody>
        </table>
        
        <div style="margin-top: 20px; font-size: 8pt; color: #555;">
            * Legend: <strong>Jam (Y)</strong>: Prayed in Congregation, <strong>Ind (Y)</strong>: Prayed Individually, <strong>Qaz (Y)</strong>: Qaza, <strong>Inc (N)</strong>: Mistakenly Prayed, <strong>Mis (N)</strong>: Missed, <strong>—</strong>: No Entry.
        </div>
        
        <div style="margin-top: 20px; background-color: #f9f9f9; padding: 10px 15px; border-radius: 6px; border:1px solid #eee; font-size:9pt;">
            <strong>Teacher Performance Evaluation Summary:</strong><br/>
            <span class="text-muted">${performanceSummary}</span>
        </div>
        
        <div style="margin-top: 60px; display: flex; justify-content: space-between; font-size: 10pt;">
            <div>Class Teacher Signature: ______________________</div>
            <div>Parent Signature: ______________________</div>
        </div>
    `;
    
    handleReportOutput(action, html, `Student_Report_${student.name.replace(/\s+/g, '_')}`);
}

function handleReportOutput(action, html, filename) {
    if (action === 'preview') {
        const previewContent = document.getElementById('pdfPreviewContent');
        if (previewContent) {
            previewContent.innerHTML = html;
            const modal = new bootstrap.Modal(document.getElementById('pdfPreviewModal'));
            modal.show();
        }
    } else if (action === 'print' || action === 'download') {
        // Setup print container
        const existing = document.getElementById('printReportContainer');
        if (existing) existing.remove();
        
        const container = document.createElement('div');
        container.id = 'printReportContainer';
        container.innerHTML = html;
        document.body.appendChild(container);
        
        // Add printing layout class to body
        document.body.classList.add('printing-report');
        
        if (action === 'download') {
            console.log("Downloading report as PDF via Print Dialog.");
        }
        
        window.print();
        
        document.body.classList.remove('printing-report');
        container.remove();
    }
}


async function loadAnnouncementsBanner() {
    try {
        const q = query(collection(db, "announcements"));
        const snap = await getDocs(q);
        let anns = [];
        snap.forEach(d => { anns.push(d.data()); });

        if (anns.length > 0) {
            anns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            const latest = anns[0];
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
        }
    } catch (err) {
        console.error("Failed to load global announcements", err);
    }
}

// ==========================================
// LEADERBOARD & CHARTS LOGIC
// ==========================================
async function initLeaderboard() {
    const classSelect = document.getElementById('leaderboardClassSelect');
    if (!classSelect) return;
    classSelect.innerHTML = '<option value="">Select Class</option>';

    try {
        if (!madrasaId) return;
        const q = query(collection(db, "classes"), where("madrasaId", "==", madrasaId));
        const snap = await getDocs(q);
        
        let classes = [];
        snap.forEach(d => classes.push({ id: d.id, ...d.data() }));
        classes.sort((a, b) => a.name.localeCompare(b.name));
        
        classes.forEach(c => {
            classSelect.innerHTML += `<option value="${c.id}">${c.name}</option>`;
        });

        if (classes.length > 0) {
            classSelect.value = classes[0].id;
            leaderboardClassId = classes[0].id;
            await fetchAndRenderLeaderboard();
        } else {
            document.getElementById('leaderboardTableBody').innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No classes found. Please create a class first.</td></tr>`;
        }
    } catch(err) {
        console.error("Failed to load classes for leaderboard", err);
    }
}

async function fetchAndRenderLeaderboard() {
    const tbody = document.getElementById('leaderboardTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4"><span class="spinner-border spinner-border-sm me-2"></span>Loading rankings...</td></tr>`;
    }

    try {
        if (!madrasaId || !leaderboardClassId) return;

        // Calculate date range
        const today = new Date();
        const offset = today.getTimezoneOffset() * 60000;
        const todayLocal = new Date(today.getTime() - offset);
        const todayStr = todayLocal.toISOString().split('T')[0];

        const daysAgo = leaderboardPeriod === 'weekly' ? 6 : 29;
        const startDateLocal = new Date(todayLocal.getTime() - (daysAgo * 24 * 60 * 60 * 1000));
        const startStr = startDateLocal.toISOString().split('T')[0];

        // 1. Fetch Students
        const stuQ = query(collection(db, "students"), where("madrasaId", "==", madrasaId), where("classId", "==", leaderboardClassId));
        const stuSnap = await getDocs(stuQ);
        let students = [];
        stuSnap.forEach(d => {
            students.push({ id: d.id, ...d.data() });
        });

        if (students.length === 0) {
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No students in this class.</td></tr>`;
            }
            document.getElementById('leaderboardPodium').innerHTML = '';
            clearLeaderboardCharts();
            return;
        }

        // 2. Fetch Records
        const recQ = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("classId", "==", leaderboardClassId));
        const recSnap = await getDocs(recQ);
        let records = [];
        recSnap.forEach(d => {
            records.push(d.data());
        });

        const filteredRecords = records.filter(r => r.date >= startStr && r.date <= todayStr);
        const expectedDays = leaderboardPeriod === 'weekly' ? 7 : 30;

        let studentsStats = students.map(student => {
            const studentRecs = filteredRecords.filter(r => r.studentId === student.id);
            
            let prayerScore = 0;
            let subjectScore = 0;
            let salawatCount = 0;
            let loggedDays = studentRecs.length;
            let lastActivityDate = "";
            let completedPrayersCount = 0;

            let jamCount = 0;
            let indCount = 0;
            let qazCount = 0;
            let misCount = 0;

            const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

            studentRecs.forEach(r => {
                prayerScore += Number(r.prayerScore) || 0;
                subjectScore += Number(r.subjectScore) || 0;
                salawatCount += Number(r.salawatCount) || 0;
                
                if (!lastActivityDate || r.date > lastActivityDate) {
                    lastActivityDate = r.date;
                }

                keys.forEach(k => {
                    const pCap = k.charAt(0).toUpperCase() + k.slice(1);
                    const val = r[k] || r.prayers?.[k] || r[pCap] || r.prayers?.[pCap];
                    if (val === 'Jamaat') {
                        completedPrayersCount++;
                        jamCount++;
                    } else if (val === 'Individual') {
                        completedPrayersCount++;
                        indCount++;
                    } else if (val === 'Qaza') {
                        completedPrayersCount++;
                        qazCount++;
                    } else if (val === true || val === 'completed' || val === 'yes' || val === '1' || val === 'true' || val === 1) {
                        completedPrayersCount++;
                        jamCount++;
                    } else if (val === 'Incorrect' || val === 'Not Prayed') {
                        misCount++;
                    } else if (val === false || val === 'missed' || val === 'no' || val === '0' || val === 'false' || val === 0) {
                        misCount++;
                    } else {
                        misCount++;
                    }
                });
            });

            prayerScore = parseFloat(prayerScore.toFixed(1));
            subjectScore = parseFloat(subjectScore.toFixed(1));

            const totalPrayersCount = loggedDays * 5;
            const prayerPct = totalPrayersCount > 0 ? Math.round((completedPrayersCount / totalPrayersCount) * 100) : 0;
            const attendancePct = Math.round((loggedDays / expectedDays) * 100);

            return {
                id: student.id,
                name: student.name,
                admission_number: student.admission_number || 'None',
                prayerScore,
                subjectScore,
                totalScore: parseFloat((prayerScore + subjectScore).toFixed(1)),
                salawatCount,
                prayerPct,
                attendancePct,
                lastActivityDate: lastActivityDate || 'No Activity',
                jamCount,
                indCount,
                qazCount,
                misCount
            };
        });

        // Sort: 1. Highest Prayer Score -> 2. Highest Attendance % -> 3. Most Recent Activity
        studentsStats.sort((a, b) => {
            if (b.prayerScore !== a.prayerScore) {
                return b.prayerScore - a.prayerScore;
            }
            if (b.attendancePct !== a.attendancePct) {
                return b.attendancePct - a.attendancePct;
            }
            if (a.lastActivityDate === 'No Activity' && b.lastActivityDate !== 'No Activity') return 1;
            if (b.lastActivityDate === 'No Activity' && a.lastActivityDate !== 'No Activity') return -1;
            return b.lastActivityDate.localeCompare(a.lastActivityDate);
        });

        // Render visual podium (Top 3)
        const podiumCont = document.getElementById('leaderboardPodium');
        if (podiumCont) {
            podiumCont.innerHTML = '';
            const places = [];
            if (studentsStats[0]) places.push({ rank: 1, student: studentsStats[0], emoji: '🥇', class: 'podium-rank-1', order: 2 });
            if (studentsStats[1]) places.push({ rank: 2, student: studentsStats[1], emoji: '🥈', class: 'podium-rank-2', order: 1 });
            if (studentsStats[2]) places.push({ rank: 3, student: studentsStats[2], emoji: '🥉', class: 'podium-rank-3', order: 3 });

            places.sort((a, b) => a.order - b.order);

            places.forEach(p => {
                podiumCont.innerHTML += `
                    <div class="col-12 col-sm-4 order-${p.order}">
                        <div class="podium-card ${p.class} text-center h-100 py-3 shadow-sm">
                            <div class="medal-icon">${p.emoji}</div>
                            <h6 class="fw-bold mb-1 text-dark text-truncate">${p.student.name}</h6>
                            <p class="text-muted small mb-2">Adm: ${p.student.admission_number}</p>
                            <h4 class="fw-bold text-success mb-2">${p.student.prayerScore} <span class="fs-6 text-muted fw-normal">Pts</span></h4>
                            
                            <div class="mt-3 pt-2 border-top d-flex justify-content-around">
                                <div class="px-2">
                                    <small class="text-muted d-block" style="font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Prayer Completion</small>
                                    <span class="fw-bold text-success fs-4 d-block mt-1">${p.student.prayerPct}%</span>
                                </div>
                                <div class="px-2 border-start">
                                    <small class="text-muted d-block" style="font-size: 0.65rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Submission Rate</small>
                                    <span class="fw-bold text-primary fs-4 d-block mt-1">${p.student.attendancePct}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        // Render rankings table
        if (tbody) {
            tbody.innerHTML = '';
            studentsStats.forEach((s, idx) => {
                const rankEmoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
                const rankClass = idx < 3 ? 'fw-bold fs-5 text-warning' : 'text-muted';
                
                tbody.innerHTML += `
                    <tr class="border-bottom border-light">
                        <td class="text-center ${rankClass}">${rankEmoji}</td>
                        <td><strong>${s.name}</strong></td>
                        <td class="text-muted">${s.admission_number}</td>
                        <td class="text-center fw-bold text-success">${s.prayerScore} <small class="text-muted fw-normal">(Total: ${s.totalScore})</small></td>
                        <td class="text-center">
                            <div class="d-flex flex-column align-items-center">
                                <span class="fw-bold text-success" style="font-size: 1rem; line-height: 1.2;">${s.prayerPct}%</span>
                                <div class="progress w-100 mt-1" style="height: 6px; background-color: #e9ecef; border-radius: 3px; max-width: 90px;">
                                    <div class="progress-bar bg-success" role="progressbar" style="width: ${s.prayerPct}%;" aria-valuenow="${s.prayerPct}" aria-valuemin="0" aria-valuemax="100"></div>
                                </div>
                            </div>
                        </td>
                        <td class="text-center"><span class="badge bg-primary bg-opacity-10 text-primary fw-bold">${s.attendancePct}%</span></td>
                        <td class="text-muted small">${s.lastActivityDate}</td>
                    </tr>
                `;
            });
        }

        // Aggregate counts for chart
        let totalJam = 0, totalInd = 0, totalQaz = 0, totalMis = 0;
        studentsStats.forEach(s => {
            totalJam += s.jamCount;
            totalInd += s.indCount;
            totalQaz += s.qazCount;
            totalMis += s.misCount;
        });

        renderDistributionChart(totalJam, totalInd, totalQaz, totalMis);
        renderTopPerformersChart(studentsStats.slice(0, 5));

    } catch(err) {
        console.error("Leaderboard render error", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="alert alert-danger text-center">Failed to load rankings: ${err.message}</td></tr>`;
        }
    }
}

function clearLeaderboardCharts() {
    if (chartDistributionInstance) {
        chartDistributionInstance.destroy();
        chartDistributionInstance = null;
    }
    if (chartPerformersInstance) {
        chartPerformersInstance.destroy();
        chartPerformersInstance = null;
    }
}

function renderDistributionChart(jam, ind, qaz, mis) {
    const ctx = document.getElementById('chartPrayerDistribution')?.getContext('2d');
    if (!ctx) return;

    if (chartDistributionInstance) {
        chartDistributionInstance.destroy();
    }

    if (jam === 0 && ind === 0 && qaz === 0 && mis === 0) {
        return;
    }

    chartDistributionInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Jamaat', 'Individual', 'Qaza', 'Missed'],
            datasets: [{
                data: [jam, ind, qaz, mis],
                backgroundColor: ['#10b981', '#f59e0b', '#0dcaf0', '#ef4444'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { family: 'Inter', weight: 'bold' }
                    }
                }
            }
        }
    });
}

function renderTopPerformersChart(topStudents) {
    const ctx = document.getElementById('chartTopPerformers')?.getContext('2d');
    if (!ctx) return;

    if (chartPerformersInstance) {
        chartPerformersInstance.destroy();
    }

    if (topStudents.length === 0) return;

    const labels = topStudents.map(s => s.name);
    const data = topStudents.map(s => s.prayerScore);

    chartPerformersInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Prayer Points',
                data: data,
                backgroundColor: 'rgba(21, 94, 77, 0.85)',
                borderColor: '#155e4d',
                borderWidth: 2,
                borderRadius: 8
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    title: { display: true, text: 'Points' }
                },
                y: {
                    grid: { display: false }
                }
            }
        }
    });
}

// ==========================================
// DATABASE TOOLS & HEALTH LOGIC
// ==========================================
async function scanAndPurgeOrphans(action = 'scan') {
    const resultDiv = document.getElementById('orphanScanResult');
    if (!resultDiv) return;
    
    resultDiv.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${action === 'scan' ? 'Scanning' : 'Purging'} database...`;
    
    try {
        if (!madrasaId) return;
        
        const stuQ = query(collection(db, "students"), where("madrasaId", "==", madrasaId));
        const stuSnap = await getDocs(stuQ);
        const studentIds = new Set();
        stuSnap.forEach(d => studentIds.add(d.id));
        
        const recQ = query(collection(db, "records"), where("madrasaId", "==", madrasaId));
        const recSnap = await getDocs(recQ);
        
        let orphans = [];
        recSnap.forEach(d => {
            const data = d.data();
            if (data.studentId && !studentIds.has(data.studentId)) {
                orphans.push({ id: d.id, ...data });
            }
        });
        
        if (orphans.length === 0) {
            resultDiv.innerHTML = `<div class="alert alert-success mt-2 py-2 mb-0"><i class="bi bi-check-circle-fill me-2"></i>No orphan records found. Database is healthy!</div>`;
            return;
        }
        
        if (action === 'scan') {
            resultDiv.innerHTML = `
                <div class="alert alert-warning mt-2 py-2 mb-2"><i class="bi bi-exclamation-triangle-fill me-2"></i>Found <strong>${orphans.length}</strong> orphan records.</div>
                <button id="btnPurgeOrphans" class="btn btn-danger btn-sm rounded-pill fw-bold px-3"><i class="bi bi-trash-fill me-1"></i>Delete Orphans</button>
            `;
            
            document.getElementById('btnPurgeOrphans').onclick = () => scanAndPurgeOrphans('purge');
        } else {
            const chunkSize = 400;
            let chunksCount = 0;
            for (let i = 0; i < orphans.length; i += chunkSize) {
                const chunk = orphans.slice(i, i + chunkSize);
                const batch = writeBatch(db);
                chunk.forEach(o => {
                    batch.delete(doc(db, "records", o.id));
                });
                await batch.commit();
                chunksCount += chunk.length;
            }
            resultDiv.innerHTML = `<div class="alert alert-success mt-2 py-2 mb-0"><i class="bi bi-check-circle-fill me-2"></i>Successfully deleted <strong>${chunksCount}</strong> orphan records.</div>`;
        }
    } catch(err) {
        resultDiv.innerHTML = `<div class="alert alert-danger mt-2 py-2 mb-0">Error: ${err.message}</div>`;
    }
}

async function migrateHistoricalScores(action = 'scan') {
    const resultDiv = document.getElementById('recalcScanResult');
    if (!resultDiv) return;
    
    resultDiv.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${action === 'scan' ? 'Scanning' : 'Migrating'} records...`;
    
    try {
        if (!madrasaId) return;
        
        const recQ = query(collection(db, "records"), where("madrasaId", "==", madrasaId));
        const recSnap = await getDocs(recQ);
        
        const PRAYER_SCORES = { "Jamaat": 2.0, "Individual": 1.0, "Qaza": 0.5, "Incorrect": 0.0, "Not Prayed": 0.0 };
        const keys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
        
        let outOfSyncRecords = [];
        recSnap.forEach(d => {
            const r = d.data();
            
            let expectedPrayerScore = 0;
            keys.forEach(k => {
                const val = r[k] || r.prayers?.[k];
                expectedPrayerScore += PRAYER_SCORES[val] || 0;
            });
            expectedPrayerScore = parseFloat(expectedPrayerScore.toFixed(1));
            
            const expectedTotalScore = parseFloat((expectedPrayerScore + (Number(r.subjectScore) || 0)).toFixed(1));
            
            const currentPrayerScore = Number(r.prayerScore) || 0;
            const currentTotalScore = Number(r.totalScore) || 0;
            
            if (Math.abs(currentPrayerScore - expectedPrayerScore) > 0.01 || Math.abs(currentTotalScore - expectedTotalScore) > 0.01) {
                outOfSyncRecords.push({
                    id: d.id,
                    ref: d.ref,
                    payload: {
                        prayerScore: expectedPrayerScore,
                        totalScore: expectedTotalScore
                    }
                });
            }
        });
        
        if (outOfSyncRecords.length === 0) {
            resultDiv.innerHTML = `<div class="alert alert-success mt-2 py-2 mb-0"><i class="bi bi-check-circle-fill me-2"></i>All records are synced with the new scoring model!</div>`;
            return;
        }
        
        if (action === 'scan') {
            resultDiv.innerHTML = `
                <div class="alert alert-warning mt-2 py-2 mb-2"><i class="bi bi-exclamation-triangle-fill me-2"></i>Found <strong>${outOfSyncRecords.length}</strong> records using old scoring system.</div>
                <button id="btnRunRecalc" class="btn btn-primary btn-sm rounded-pill fw-bold px-3"><i class="bi bi-play-fill me-1"></i>Run Recalculation</button>
            `;
            
            document.getElementById('btnRunRecalc').onclick = () => migrateHistoricalScores('migrate');
        } else {
            const chunkSize = 400;
            let chunksCount = 0;
            for (let i = 0; i < outOfSyncRecords.length; i += chunkSize) {
                const chunk = outOfSyncRecords.slice(i, i + chunkSize);
                const batch = writeBatch(db);
                chunk.forEach(item => {
                    batch.update(item.ref, item.payload);
                });
                await batch.commit();
                chunksCount += chunk.length;
            }
            
            resultDiv.innerHTML = `<div class="alert alert-success mt-2 py-2 mb-0"><i class="bi bi-check-circle-fill me-2"></i>Successfully updated <strong>${chunksCount}</strong> records to new scores.</div>`;
        }
    } catch(err) {
        resultDiv.innerHTML = `<div class="alert alert-danger mt-2 py-2 mb-0">Error: ${err.message}</div>`;
    }
}

// Expose leaderboard and cleanup functions globally
window.initLeaderboard = initLeaderboard;
window.fetchAndRenderLeaderboard = fetchAndRenderLeaderboard;
window.scanAndPurgeOrphans = scanAndPurgeOrphans;
window.migrateHistoricalScores = migrateHistoricalScores;


// ============================================================================
// DATA MANAGEMENT CENTER OPERATIONS & EVENT LISTENERS
// ============================================================================

// Clear local storage cache
function clearLocalStorageCacheForClassStudents(studentId = null) {
    if (studentId) {
        localStorage.removeItem(`points_${studentId}`);
        localStorage.removeItem(`salawat_${studentId}`);
        localStorage.removeItem(`days_${studentId}`);
        localStorage.removeItem(`streak_${studentId}`);
        return;
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('points_') || key.startsWith('salawat_') || key.startsWith('days_') || key.startsWith('streak_'))) {
            localStorage.removeItem(key);
        }
    }
}

// Role check
async function checkSuperAdminRole() {
    isSuperAdmin = (auth.currentUser && auth.currentUser.uid === 'mt0k0d3UeAgcB8RTzq5k3M97UKa2');
    console.log("Logged user role - Super Admin:", isSuperAdmin);
    
    const saElements = document.querySelectorAll('.super-admin-only');
    saElements.forEach(el => {
        if (isSuperAdmin) {
            el.classList.remove('d-none');
            el.disabled = false;
        } else {
            el.classList.add('d-none');
            el.disabled = true;
        }
    });
}

// Audit logger
async function writeAuditLog({ action, entityType, entityId, backupId = null, details }) {
    if (!madrasaId || !auth.currentUser) return;
    try {
        const userRole = isSuperAdmin ? 'Super Admin' : 'Admin';
        const logDoc = {
            action,
            entityType,
            entityId,
            userId: auth.currentUser.uid,
            userRole,
            backupId,
            timestamp: new Date().toISOString(),
            details,
            madrasaId
        };
        const logRef = doc(collection(db, "audit_logs"));
        await setDoc(logRef, logDoc);
    } catch (e) {
        console.error("Failed to write audit log:", e);
    }
}

// Secure step-by-step confirmation wrapper
async function executeSecureDelete({
    title,
    text,
    backupType,
    fetchDataToBackup,
    performDelete,
    onSuccess
}) {
    const warnResult = await Swal.fire({
        title: title || 'Warning!',
        text: text || 'This action may permanently delete data.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Proceed',
        customClass: { popup: 'rounded-4' }
    });
    if (!warnResult.isConfirmed) return;

    const confirmInput = await Swal.fire({
        title: 'Confirm Deletion',
        text: 'Type "DELETE" in all caps to continue:',
        input: 'text',
        inputPlaceholder: 'DELETE',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Verify',
        customClass: { popup: 'rounded-4' },
        inputValidator: (value) => {
            if (value !== 'DELETE') {
                return 'You must type DELETE exactly to proceed!';
            }
        }
    });
    if (!confirmInput.isConfirmed) return;

    const backupQuestion = await Swal.fire({
        title: 'Create Backup?',
        text: 'Do you want to create a backup snapshot before executing deletion?',
        icon: 'question',
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: 'Yes, Backup First',
        denyButtonText: 'No, Just Delete',
        cancelButtonText: 'Cancel',
        confirmButtonColor: '#10b981',
        denyButtonColor: '#f59e0b',
        customClass: { popup: 'rounded-4' }
    });

    if (backupQuestion.isDismissed) return;

    let backupId = null;
    if (backupQuestion.isConfirmed) {
        try {
            Swal.fire({
                title: 'Creating Backup...',
                text: 'Please wait...',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            const dataToBackup = await fetchDataToBackup();
            backupId = await createSystemBackup(backupType, dataToBackup);
            
            await Swal.fire({
                title: 'Backed Up!',
                text: '💾 Backup Created Successfully',
                icon: 'success',
                timer: 1500,
                showConfirmButton: false,
                customClass: { popup: 'rounded-4' }
            });
        } catch (err) {
            await Swal.fire({
                title: 'Backup Failed',
                text: 'Could not create backup: ' + err.message + '. Aborting deletion.',
                icon: 'error',
                customClass: { popup: 'rounded-4' }
            });
            return;
        }
    }

    const finalConfirm = await Swal.fire({
        title: 'Final Confirmation',
        text: 'Delete Now? This will execute the permanent delete.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        confirmButtonText: 'Yes, Delete Now',
        customClass: { popup: 'rounded-4' }
    });
    if (!finalConfirm.isConfirmed) return;

    try {
        Swal.fire({
            title: 'Deleting...',
            text: 'Please wait while the operation completes.',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        const deletedCount = await performDelete(backupId);
        
        await Swal.fire({
            title: 'Deleted!',
            text: '✅ Data Deleted Successfully',
            icon: 'success',
            timer: 2000,
            showConfirmButton: false,
            customClass: { popup: 'rounded-4' }
        });

        if (onSuccess) onSuccess(deletedCount);
    } catch (err) {
        await Swal.fire({
            title: 'Operation Failed',
            text: '❌ Operation Failed: ' + err.message,
            icon: 'error',
            customClass: { popup: 'rounded-4' }
        });
    }
}

// Backup actions
async function createSystemBackup(backupType, data) {
    const backupId = 'backup_' + Date.now();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    
    const backupDoc = {
        backupId,
        backupType,
        madrasaId,
        createdBy: auth.currentUser.uid,
        createdAt,
        expiresAt,
        data: JSON.stringify(data)
    };
    
    await setDoc(doc(db, "system_backups", backupId), backupDoc);
    
    await writeAuditLog({
        action: 'Backup Creation',
        entityType: 'backup',
        entityId: backupId,
        backupId: backupId,
        details: `Created ${backupType}`
    });
    
    return backupId;
}

// Restore a backup
async function restoreSystemBackup(backupId) {
    try {
        const backupRef = doc(db, "system_backups", backupId);
        const backupSnap = await getDoc(backupRef);
        if (!backupSnap.exists()) {
            throw new Error("Backup document not found or expired.");
        }
        
        const backup = backupSnap.data();
        const parsedData = JSON.parse(backup.data);
        
        Swal.fire({
            title: 'Restoring...',
            text: 'Restoring documents back to Firestore...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });
        
        const type = backup.backupType;
        let restoreCount = 0;
        const chunk = 400;
        
        if (type === 'Student Backup' || type === 'Full System Backup') {
            const students = parsedData.students || [];
            const admLookups = parsedData.admission_numbers || [];
            const records = parsedData.records || [];
            
            for (let i = 0; i < students.length; i += chunk) {
                const batch = writeBatch(db);
                students.slice(i, i + chunk).forEach(s => {
                    batch.set(doc(db, "students", s.id), {
                        name: s.name,
                        admission_number: s.admission_number,
                        classId: s.classId,
                        madrasaId: s.madrasaId
                    });
                    restoreCount++;
                });
                await batch.commit();
            }
            
            for (let i = 0; i < admLookups.length; i += chunk) {
                const batch = writeBatch(db);
                admLookups.slice(i, i + chunk).forEach(a => {
                    batch.set(doc(db, "admission_numbers", a.id), {
                        studentId: a.studentId,
                        classId: a.classId,
                        madrasaId: a.madrasaId
                    });
                    restoreCount++;
                });
                await batch.commit();
            }
            
            for (let i = 0; i < records.length; i += chunk) {
                const batch = writeBatch(db);
                records.slice(i, i + chunk).forEach(r => {
                    batch.set(doc(db, "records", r.id), {
                        madrasaId: r.madrasaId,
                        studentId: r.studentId,
                        classId: r.classId,
                        date: r.date,
                        prayers: r.prayers || {},
                        prayerScore: r.prayerScore,
                        subjectScore: r.subjectScore,
                        totalScore: r.totalScore,
                        salawatCount: r.salawatCount || 0,
                        subjects: r.subjects || [],
                        books: r.books || [],
                        timestamp: r.timestamp || new Date().toISOString()
                    });
                    restoreCount++;
                });
                await batch.commit();
            }
        }
        
        if (type === 'Class Backup' || type === 'Full System Backup') {
            const classes = parsedData.classes || [];
            const students = parsedData.students || [];
            const admLookups = parsedData.admission_numbers || [];
            const records = parsedData.records || [];
            const subjects = parsedData.subjects || [];
            
            for (let i = 0; i < classes.length; i += chunk) {
                const batch = writeBatch(db);
                classes.slice(i, i + chunk).forEach(c => {
                    batch.set(doc(db, "classes", c.id), {
                        name: c.name,
                        madrasaId: c.madrasaId
                    });
                    restoreCount++;
                });
                await batch.commit();
            }
            
            for (let i = 0; i < subjects.length; i += chunk) {
                const batch = writeBatch(db);
                subjects.slice(i, i + chunk).forEach(sub => {
                    batch.set(doc(db, "subjects", sub.id), {
                        name: sub.name,
                        classId: sub.classId,
                        madrasaId: sub.madrasaId
                    });
                    restoreCount++;
                });
                await batch.commit();
            }

            for (let i = 0; i < students.length; i += chunk) {
                const batch = writeBatch(db);
                students.slice(i, i + chunk).forEach(s => {
                    batch.set(doc(db, "students", s.id), {
                        name: s.name,
                        admission_number: s.admission_number,
                        classId: s.classId,
                        madrasaId: s.madrasaId
                    });
                    restoreCount++;
                });
                await batch.commit();
            }
            for (let i = 0; i < admLookups.length; i += chunk) {
                const batch = writeBatch(db);
                admLookups.slice(i, i + chunk).forEach(a => {
                    batch.set(doc(db, "admission_numbers", a.id), {
                        studentId: a.studentId,
                        classId: a.classId,
                        madrasaId: a.madrasaId
                    });
                    restoreCount++;
                });
                await batch.commit();
            }
            for (let i = 0; i < records.length; i += chunk) {
                const batch = writeBatch(db);
                records.slice(i, i + chunk).forEach(r => {
                    batch.set(doc(db, "records", r.id), {
                        madrasaId: r.madrasaId,
                        studentId: r.studentId,
                        classId: r.classId,
                        date: r.date,
                        prayers: r.prayers || {},
                        prayerScore: r.prayerScore,
                        subjectScore: r.subjectScore,
                        totalScore: r.totalScore,
                        salawatCount: r.salawatCount || 0,
                        subjects: r.subjects || [],
                        books: r.books || [],
                        timestamp: r.timestamp || new Date().toISOString()
                    });
                    restoreCount++;
                });
                await batch.commit();
            }
        }
        
        if (type === 'Subject Backup') {
            const subjects = parsedData.subjects || [];
            const records = parsedData.records || [];
            
            for (let i = 0; i < subjects.length; i += chunk) {
                const batch = writeBatch(db);
                subjects.slice(i, i + chunk).forEach(sub => {
                    batch.set(doc(db, "subjects", sub.id), {
                        name: sub.name,
                        classId: sub.classId,
                        madrasaId: sub.madrasaId
                    });
                    restoreCount++;
                });
                await batch.commit();
            }
            
            for (let i = 0; i < records.length; i += chunk) {
                const batch = writeBatch(db);
                records.slice(i, i + chunk).forEach(r => {
                    batch.set(doc(db, "records", r.id), {
                        madrasaId: r.madrasaId,
                        studentId: r.studentId,
                        classId: r.classId,
                        date: r.date,
                        prayers: r.prayers || {},
                        prayerScore: r.prayerScore,
                        subjectScore: r.subjectScore,
                        totalScore: r.totalScore,
                        salawatCount: r.salawatCount || 0,
                        subjects: r.subjects || [],
                        books: r.books || [],
                        timestamp: r.timestamp || new Date().toISOString()
                    });
                    restoreCount++;
                });
                await batch.commit();
            }
        }
        
        if (type === 'Records Backup') {
            const records = parsedData.records || [];
            
            for (let i = 0; i < records.length; i += chunk) {
                const batch = writeBatch(db);
                records.slice(i, i + chunk).forEach(r => {
                    batch.set(doc(db, "records", r.id), {
                        madrasaId: r.madrasaId,
                        studentId: r.studentId,
                        classId: r.classId,
                        date: r.date,
                        prayers: r.prayers || {},
                        prayerScore: r.prayerScore,
                        subjectScore: r.subjectScore,
                        totalScore: r.totalScore,
                        salawatCount: r.salawatCount || 0,
                        subjects: r.subjects || [],
                        books: r.books || [],
                        timestamp: r.timestamp || new Date().toISOString()
                    });
                    restoreCount++;
                });
                await batch.commit();
            }
        }

        await writeAuditLog({
            action: 'Backup Restore',
            entityType: 'backup',
            entityId: backupId,
            backupId: backupId,
            details: `Restored ${type} snapshot (${restoreCount} documents)`
        });
        
        clearLocalStorageCacheForClassStudents();
        
        await Swal.fire({
            title: 'Restored!',
            text: '♻ Data Restored Successfully',
            icon: 'success',
            timer: 2000,
            showConfirmButton: false,
            customClass: { popup: 'rounded-4' }
        });
        
        loadClasses();
        loadSubjects();
        loadRecoveryBackups();
        loadAuditLogsLedger();
        updateDmMetrics();
    } catch(err) {
        Swal.fire('Restoration Failed', err.message, 'error');
    }
}

// Download a backup as JSON
function downloadSystemBackup(backupId, backupType, dataStr) {
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Backup_${backupType.replace(/\s+/g, '_')}_${backupId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// Expiration checking cleanup
async function runExpiredBackupsCleanup() {
    if (!madrasaId) return;
    try {
        const nowStr = new Date().toISOString();
        const q = query(collection(db, "system_backups"), where("madrasaId", "==", madrasaId), where("expiresAt", "<=", nowStr));
        const snap = await getDocs(q);
        
        if (snap.empty) return;
        
        let deleteCount = 0;
        const batch = writeBatch(db);
        snap.forEach(d => {
            batch.delete(d.ref);
            deleteCount++;
        });
        await batch.commit();
        console.log(`Cleaned up ${deleteCount} expired backups automatically.`);
        
        await writeAuditLog({
            action: 'Permanent Delete',
            entityType: 'backup',
            entityId: 'multiple',
            details: `Cleaned up ${deleteCount} expired backup files (24h window passed)`
        });
        
        loadRecoveryBackups();
        updateDmMetrics();
    } catch (e) {
        console.error("Failed during automated backups cleanup:", e);
    }
}

// Metrics calculator
async function updateDmMetrics() {
    if (!madrasaId) return;
    try {
        const sSnap = await getDocs(query(collection(db, "students"), where("madrasaId", "==", madrasaId)));
        document.getElementById('dmMetricStudents').innerText = sSnap.size;

        const bSnap = await getDocs(query(collection(db, "system_backups"), where("madrasaId", "==", madrasaId)));
        document.getElementById('dmMetricBackups').innerText = bSnap.size;
        
        const badge = document.getElementById('activeBackupsBadge');
        if (badge) {
            if (bSnap.size > 0) {
                badge.innerText = bSnap.size;
                badge.classList.remove('d-none');
            } else {
                badge.classList.add('d-none');
            }
        }

        const lSnap = await getDocs(query(collection(db, "audit_logs"), where("madrasaId", "==", madrasaId)));
        document.getElementById('dmMetricLogs').innerText = lSnap.size;
    } catch(e) {
        console.error("Failed updating metrics:", e);
    }
}

// Local data gathering helpers
async function gatherStudentBackupData(studentIds) {
    const students = [];
    const admission_numbers = [];
    const records = [];
    for (const sid of studentIds) {
        const sDoc = await getDoc(doc(db, "students", sid));
        if (sDoc.exists()) {
            const sData = sDoc.data();
            students.push({ id: sDoc.id, ...sData });
            if (sData.admission_number) {
                const aDoc = await getDoc(doc(db, "admission_numbers", sData.admission_number));
                if (aDoc.exists()) {
                    admission_numbers.push({ id: aDoc.id, ...aDoc.data() });
                }
            }
            const recQ = query(collection(db, "records"), where("studentId", "==", sid));
            const recSnap = await getDocs(recQ);
            recSnap.forEach(d => {
                records.push({ id: d.id, ...d.data() });
            });
        }
    }
    return { students, admission_numbers, records };
}

async function gatherClassBackupData(classIds) {
    const classes = [];
    const students = [];
    const admission_numbers = [];
    const records = [];
    const subjects = [];
    for (const cid of classIds) {
        const cDoc = await getDoc(doc(db, "classes", cid));
        if (cDoc.exists()) {
            classes.push({ id: cDoc.id, ...cDoc.data() });
            const subQ = query(collection(db, "subjects"), where("classId", "==", cid));
            const subSnap = await getDocs(subQ);
            subSnap.forEach(d => subjects.push({ id: d.id, ...d.data() }));
            
            const stuQ = query(collection(db, "students"), where("classId", "==", cid));
            const stuSnap = await getDocs(stuQ);
            for (const sDoc of stuSnap.docs) {
                const sData = sDoc.data();
                students.push({ id: sDoc.id, ...sData });
                if (sData.admission_number) {
                    const aDoc = await getDoc(doc(db, "admission_numbers", sData.admission_number));
                    if (aDoc.exists()) {
                        admission_numbers.push({ id: aDoc.id, ...aDoc.data() });
                    }
                }
                const recQ = query(collection(db, "records"), where("studentId", "==", sDoc.id));
                const recSnap = await getDocs(recQ);
                recSnap.forEach(d => records.push({ id: d.id, ...d.data() }));
            }
        }
    }
    return { classes, students, admission_numbers, records, subjects };
}

async function gatherSubjectBackupData(subjectIds) {
    const subjects = [];
    const records = [];
    for (const subId of subjectIds) {
        const subDoc = await getDoc(doc(db, "subjects", subId));
        if (subDoc.exists()) {
            subjects.push({ id: subDoc.id, ...subDoc.data() });
            const recQ = query(collection(db, "records"), where("madrasaId", "==", madrasaId));
            const recSnap = await getDocs(recQ);
            recSnap.forEach(d => {
                const r = d.data();
                if (r.subjects && r.subjects.includes(subId)) {
                    records.push({ id: d.id, ...r });
                }
            });
        }
    }
    return { subjects, records };
}

async function gatherRecordsBackupData(classId, studentId, startDate, endDate) {
    const records = [];
    let q = query(collection(db, "records"), where("madrasaId", "==", madrasaId));
    if (classId !== 'all') {
        q = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("classId", "==", classId));
    }
    if (studentId !== 'all') {
        q = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("studentId", "==", studentId));
    }
    const snap = await getDocs(q);
    snap.forEach(d => {
        const r = d.data();
        let match = true;
        if (startDate && r.date < startDate) match = false;
        if (endDate && r.date > endDate) match = false;
        if (match) {
            records.push({ id: d.id, ...r });
        }
    });
    return { records };
}

// Local deletion executions
async function performStudentDelete(studentIds, backupId) {
    let deletedCount = 0;
    for (const sid of studentIds) {
        const sDoc = await getDoc(doc(db, "students", sid));
        if (sDoc.exists()) {
            const sData = sDoc.data();
            if (sData.admission_number) {
                try {
                    await deleteDoc(doc(db, "admission_numbers", sData.admission_number));
                    deletedCount++;
                } catch(e) { console.error(e); }
            }
            const recQ = query(collection(db, "records"), where("studentId", "==", sid));
            const recSnap = await getDocs(recQ);
            if (!recSnap.empty) {
                const recRefs = [];
                recSnap.forEach(d => recRefs.push(d.ref));
                const chunkLimit = 400;
                for (let i = 0; i < recRefs.length; i += chunkLimit) {
                    const chunk = recRefs.slice(i, i + chunkLimit);
                    const batch = writeBatch(db);
                    chunk.forEach(ref => {
                        batch.delete(ref);
                        deletedCount++;
                    });
                    await batch.commit();
                }
            }
            await deleteDoc(doc(db, "students", sid));
            deletedCount++;
            clearLocalStorageCacheForClassStudents(sid);
        }
    }
    
    await writeAuditLog({
        action: 'Student Delete',
        entityType: 'student',
        entityId: studentIds.length === 1 ? studentIds[0] : 'multiple',
        backupId,
        details: `Deleted ${studentIds.length} students (Cascade deleted matching admission lookups and daily logs)`
    });
    return deletedCount;
}

async function performClassDelete(classIds, backupId) {
    let deletedCount = 0;
    for (const cid of classIds) {
        const stuQ = query(collection(db, "students"), where("classId", "==", cid));
        const stuSnap = await getDocs(stuQ);
        const sids = stuSnap.docs.map(d => d.id);
        
        if (sids.length > 0) {
            deletedCount += await performStudentDelete(sids, null);
        }
        
        const subQ = query(collection(db, "subjects"), where("classId", "==", cid));
        const subSnap = await getDocs(subQ);
        if (!subSnap.empty) {
            const batch = writeBatch(db);
            subSnap.forEach(d => {
                batch.delete(d.ref);
                deletedCount++;
            });
            await batch.commit();
        }
        
        await deleteDoc(doc(db, "classes", cid));
        deletedCount++;
    }
    
    await writeAuditLog({
        action: 'Class Delete',
        entityType: 'class',
        entityId: classIds.length === 1 ? classIds[0] : 'multiple',
        backupId,
        details: `Deleted ${classIds.length} classes, cascading to class students, subjects, admission lookup tables, and history tracker logs.`
    });
    return deletedCount;
}

async function performSubjectDelete(subjectIds, backupId) {
    let deletedCount = 0;
    const chunkLimit = 400;
    for (const subId of subjectIds) {
        const recQ = query(collection(db, "records"), where("madrasaId", "==", madrasaId));
        const recSnap = await getDocs(recQ);
        
        const updatesList = [];
        recSnap.forEach(d => {
            const r = d.data();
            if (r.subjects && r.subjects.includes(subId)) {
                const newSubs = r.subjects.filter(id => id !== subId);
                const subDiff = r.subjects.length - newSubs.length;
                const newSubScore = Math.max(0, (r.subjectScore || 0) - subDiff);
                const newTotalScore = parseFloat(((r.prayerScore || 0) + newSubScore).toFixed(1));
                
                updatesList.push({
                    ref: d.ref,
                    payload: {
                        subjects: newSubs,
                        subjectScore: newSubScore,
                        totalScore: newTotalScore
                    }
                });
            }
        });
        
        for (let i = 0; i < updatesList.length; i += chunkLimit) {
            const chunk = updatesList.slice(i, i + chunkLimit);
            const batch = writeBatch(db);
            chunk.forEach(item => {
                batch.update(item.ref, item.payload);
                deletedCount++;
            });
            await batch.commit();
        }
        
        await deleteDoc(doc(db, "subjects", subId));
        deletedCount++;
    }
    
    await writeAuditLog({
        action: 'Subject Delete',
        entityType: 'subject',
        entityId: subjectIds.length === 1 ? subjectIds[0] : 'multiple',
        backupId,
        details: `Deleted ${subjectIds.length} subjects (Recalculated daily studied scores in affected student daily records)`
    });
    return deletedCount;
}

async function performRecordsDelete(classId, studentId, startDate, endDate, backupId) {
    let deletedCount = 0;
    let q = query(collection(db, "records"), where("madrasaId", "==", madrasaId));
    if (classId !== 'all') {
        q = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("classId", "==", classId));
    }
    if (studentId !== 'all') {
        q = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("studentId", "==", studentId));
    }
    
    const snap = await getDocs(q);
    const recordsToDelete = [];
    
    snap.forEach(d => {
        const r = d.data();
        let match = true;
        if (startDate && r.date < startDate) match = false;
        if (endDate && r.date > endDate) match = false;
        if (match) {
            recordsToDelete.push(d.ref);
            clearLocalStorageCacheForClassStudents(r.studentId);
        }
    });
    
    const chunkLimit = 400;
    for (let i = 0; i < recordsToDelete.length; i += chunkLimit) {
        const chunk = recordsToDelete.slice(i, i + chunkLimit);
        const batch = writeBatch(db);
        chunk.forEach(ref => {
            batch.delete(ref);
            deletedCount++;
        });
        await batch.commit();
    }
    
    await writeAuditLog({
        action: 'Record Reset',
        entityType: 'records',
        entityId: studentId !== 'all' ? studentId : 'multiple',
        backupId,
        details: `Wiped ${recordsToDelete.length} daily tracker records (Filter Class: ${classId}, Student: ${studentId}, Period: ${startDate || 'any'} to ${endDate || 'any'})`
    });
    return deletedCount;
}

// UI Lists Fetch & Populate
async function loadDmStudents() {
    const tbody = document.getElementById('dmStudentsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Loading students...</td></tr>';
    
    try {
        const classFilter = document.getElementById('dmStudentClassFilter');
        const queryVal = classFilter ? classFilter.value : 'all';
        const searchInput = document.getElementById('dmStudentSearch');
        const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : '';

        const classQ = query(collection(db, "classes"), where("madrasaId", "==", madrasaId));
        const classSnap = await getDocs(classQ);
        const lClassMap = {};
        classSnap.forEach(d => lClassMap[d.id] = d.data().name);
        
        if (classFilter && classFilter.children.length <= 1) {
            classFilter.innerHTML = '<option value="all">All Classes</option>';
            Object.entries(lClassMap).sort((a,b)=>a[1].localeCompare(b[1])).forEach(([id, name]) => {
                classFilter.innerHTML += `<option value="${id}">${name}</option>`;
            });
        }

        let studentQ = query(collection(db, "students"), where("madrasaId", "==", madrasaId));
        if (queryVal !== 'all') {
            studentQ = query(collection(db, "students"), where("madrasaId", "==", madrasaId), where("classId", "==", queryVal));
        }
        
        const snap = await getDocs(studentQ);
        let stuList = [];
        snap.forEach(d => stuList.push({ id: d.id, ...d.data() }));
        
        if (searchVal) {
            stuList = stuList.filter(s => 
                (s.name && s.name.toLowerCase().includes(searchVal)) || 
                (s.admission_number && s.admission_number.toLowerCase().includes(searchVal))
            );
        }

        stuList.sort((a,b) => a.name.localeCompare(b.name));

        if (stuList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">No students matching criteria.</td></tr>';
            document.getElementById('dmStudentSelectAll').checked = false;
            updateStudentsSelectedCount();
            return;
        }

        tbody.innerHTML = stuList.map(s => `
            <tr>
                <td><input type="checkbox" class="dm-student-checkbox" data-id="${s.id}"></td>
                <td class="fw-bold">${s.name}</td>
                <td>${s.admission_number || 'None'}</td>
                <td><span class="badge bg-light text-dark">${lClassMap[s.classId] || 'Unknown Class'}</span></td>
            </tr>
        `).join('');

        document.getElementById('dmStudentSelectAll').checked = false;
        document.querySelectorAll('.dm-student-checkbox').forEach(cb => {
            cb.addEventListener('change', updateStudentsSelectedCount);
        });
        updateStudentsSelectedCount();

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-danger text-center">Error: ${err.message}</td></tr>`;
    }
}

function updateStudentsSelectedCount() {
    const checked = document.querySelectorAll('.dm-student-checkbox:checked');
    const deleteBtn = document.getElementById('btnDmDeleteSelectedStudents');
    document.getElementById('dmStudentsSelectedCount').innerText = `${checked.length} student(s) selected`;
    if (deleteBtn) {
        deleteBtn.disabled = checked.length === 0;
    }
}

async function loadDmClasses() {
    const tbody = document.getElementById('dmClassesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" class="text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Loading classes...</td></tr>';
    
    try {
        const cSnap = await getDocs(query(collection(db, "classes"), where("madrasaId", "==", madrasaId)));
        let classList = [];
        cSnap.forEach(d => classList.push({ id: d.id, ...d.data(), studentCount: 0 }));

        const sSnap = await getDocs(query(collection(db, "students"), where("madrasaId", "==", madrasaId)));
        sSnap.forEach(d => {
            const s = d.data();
            const matchingClass = classList.find(c => c.id === s.classId);
            if (matchingClass) matchingClass.studentCount++;
        });

        classList.sort((a,b)=> a.name.localeCompare(b.name));

        if (classList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-muted">No classes found.</td></tr>';
            document.getElementById('dmClassSelectAll').checked = false;
            updateClassesSelectedCount();
            return;
        }

        tbody.innerHTML = classList.map(c => `
            <tr>
                <td><input type="checkbox" class="dm-class-checkbox" data-id="${c.id}"></td>
                <td class="fw-bold">${c.name}</td>
                <td><span class="badge bg-success bg-opacity-10 text-success fw-bold">${c.studentCount} active students</span></td>
            </tr>
        `).join('');

        document.getElementById('dmClassSelectAll').checked = false;
        document.querySelectorAll('.dm-class-checkbox').forEach(cb => {
            cb.addEventListener('change', updateClassesSelectedCount);
        });
        updateClassesSelectedCount();

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-danger text-center">Error: ${e.message}</td></tr>`;
    }
}

function updateClassesSelectedCount() {
    const checked = document.querySelectorAll('.dm-class-checkbox:checked');
    const deleteBtn = document.getElementById('btnDmDeleteSelectedClasses');
    document.getElementById('dmClassesSelectedCount').innerText = `${checked.length} class(es) selected`;
    if (deleteBtn) {
        deleteBtn.disabled = checked.length === 0;
    }
}

async function loadDmSubjects() {
    const tbody = document.getElementById('dmSubjectsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" class="text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Loading subjects...</td></tr>';
    
    try {
        const filterEl = document.getElementById('dmSubjectClassFilter');
        const activeFilter = filterEl ? filterEl.value : 'all';

        const classQ = query(collection(db, "classes"), where("madrasaId", "==", madrasaId));
        const classSnap = await getDocs(classQ);
        const lClassMap = {};
        classSnap.forEach(d => lClassMap[d.id] = d.data().name);

        if (filterEl && filterEl.children.length <= 1) {
            filterEl.innerHTML = '<option value="all">All Classes</option>';
            Object.entries(lClassMap).sort((a,b)=>a[1].localeCompare(b[1])).forEach(([id, name]) => {
                filterEl.innerHTML += `<option value="${id}">${name}</option>`;
            });
        }

        let subQ = query(collection(db, "subjects"), where("madrasaId", "==", madrasaId));
        if (activeFilter !== 'all') {
            subQ = query(collection(db, "subjects"), where("madrasaId", "==", madrasaId), where("classId", "==", activeFilter));
        }

        const sSnap = await getDocs(subQ);
        let subList = [];
        sSnap.forEach(d => subList.push({ id: d.id, ...d.data() }));
        subList.sort((a,b)=>a.name.localeCompare(b.name));

        if (subList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-muted">No subjects found.</td></tr>';
            document.getElementById('dmSubjectSelectAll').checked = false;
            updateSubjectsSelectedCount();
            return;
        }

        tbody.innerHTML = subList.map(s => `
            <tr>
                <td><input type="checkbox" class="dm-subject-checkbox" data-id="${s.id}"></td>
                <td class="fw-bold">${s.name}</td>
                <td><span class="badge bg-light text-dark">${lClassMap[s.classId] || 'Unknown Class'}</span></td>
            </tr>
        `).join('');

        document.getElementById('dmSubjectSelectAll').checked = false;
        document.querySelectorAll('.dm-subject-checkbox').forEach(cb => {
            cb.addEventListener('change', updateSubjectsSelectedCount);
        });
        updateSubjectsSelectedCount();

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-danger text-center">Error: ${e.message}</td></tr>`;
    }
}

function updateSubjectsSelectedCount() {
    const checked = document.querySelectorAll('.dm-subject-checkbox:checked');
    const deleteBtn = document.getElementById('btnDmDeleteSelectedSubjects');
    document.getElementById('dmSubjectsSelectedCount').innerText = `${checked.length} subject(s) selected`;
    if (deleteBtn) {
        deleteBtn.disabled = checked.length === 0;
    }
}

async function loadDmRecordsSetup() {
    const classFilter = document.getElementById('dmRecordsClassFilter');
    const studentFilter = document.getElementById('dmRecordsStudentFilter');
    if (!classFilter || !studentFilter) return;

    try {
        const cSnap = await getDocs(query(collection(db, "classes"), where("madrasaId", "==", madrasaId)));
        classFilter.innerHTML = '<option value="all">All Classes</option>';
        cSnap.forEach(d => {
            classFilter.innerHTML += `<option value="${d.id}">${d.data().name}</option>`;
        });

        document.getElementById('dmRecordsStartDate').value = '';
        document.getElementById('dmRecordsEndDate').value = '';

        classFilter.onchange = async () => {
            const cid = classFilter.value;
            studentFilter.innerHTML = '<option value="all">All Students</option>';
            
            let q = query(collection(db, "students"), where("madrasaId", "==", madrasaId));
            if (cid !== 'all') {
                q = query(collection(db, "students"), where("madrasaId", "==", madrasaId), where("classId", "==", cid));
            }
            const sSnap = await getDocs(q);
            let studentsList = [];
            sSnap.forEach(d => studentsList.push({ id: d.id, ...d.data() }));
            studentsList.sort((a,b) => a.name.localeCompare(b.name));

            studentsList.forEach(s => {
                studentFilter.innerHTML += `<option value="${s.id}">${s.name} (${s.admission_number || 'None'})</option>`;
            });
        };

        classFilter.onchange();

    } catch (e) {
        console.error("Failed loading records settings UI:", e);
    }
}

async function loadRecoveryBackups() {
    const tbody = document.getElementById('dmRecoveryTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Loading backups...</td></tr>';
    
    try {
        const q = query(collection(db, "system_backups"), where("madrasaId", "==", madrasaId));
        const snap = await getDocs(q);
        
        let backupsList = [];
        snap.forEach(d => backupsList.push(d.data()));
        backupsList.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));

        if (backupsList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">No backups found. Snapshots will appear here on deletion.</td></tr>';
            return;
        }

        tbody.innerHTML = backupsList.map(b => {
            const timeDiff = new Date(b.expiresAt) - new Date();
            let relativeExpiry = "Expired";
            if (timeDiff > 0) {
                const hours = Math.floor(timeDiff / (1000 * 60 * 60));
                const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
                relativeExpiry = `${hours}h ${minutes}m remaining`;
            }
            
            return `
                <tr>
                    <td class="fw-bold"><i class="bi bi-file-earmark-code text-indigo me-1"></i>${b.backupType}</td>
                    <td>${new Date(b.createdAt).toLocaleString()}</td>
                    <td><span class="badge ${timeDiff > 0 ? 'bg-success bg-opacity-10 text-success' : 'bg-danger bg-opacity-10 text-danger'} fw-bold">${relativeExpiry}</span></td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-success restore-bk-btn rounded-pill px-3 py-1 me-1" data-id="${b.backupId}"><i class="bi bi-arrow-counterclockwise me-1"></i>Restore</button>
                        <button class="btn btn-sm btn-outline-primary download-bk-btn rounded-pill px-3 py-1 me-1" data-id="${b.backupId}" data-type="${b.backupType}" data-payload='${b.data.replace(/'/g, "&apos;")}'><i class="bi bi-download me-1"></i>Download</button>
                        <button class="btn btn-sm btn-outline-danger delete-bk-btn rounded-pill px-3 py-1" data-id="${b.backupId}"><i class="bi bi-trash me-1"></i>Delete</button>
                    </td>
                </tr>
            `;
        }).join('');

        document.querySelectorAll('.restore-bk-btn').forEach(btn => {
            btn.onclick = () => restoreSystemBackup(btn.dataset.id);
        });

        document.querySelectorAll('.download-bk-btn').forEach(btn => {
            btn.onclick = () => downloadSystemBackup(btn.dataset.id, btn.dataset.type, btn.dataset.payload);
        });

        document.querySelectorAll('.delete-bk-btn').forEach(btn => {
            btn.onclick = async () => {
                const result = await Swal.fire({
                    title: 'Permanent Delete?',
                    text: 'Do you want to permanently erase this backup from recovery storage? This cannot be undone!',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#ef4444',
                    confirmButtonText: 'Permanently Erase',
                    customClass: { popup: 'rounded-4' }
                });
                
                if (result.isConfirmed) {
                    try {
                        await deleteDoc(doc(db, "system_backups", btn.dataset.id));
                        await writeAuditLog({
                            action: 'Permanent Delete',
                            entityType: 'backup',
                            entityId: btn.dataset.id,
                            details: `Permanently deleted backup snapshot file ${btn.dataset.id}`
                        });
                        await Swal.fire({
                            title: 'Erase Complete',
                            text: 'Backup file permanently deleted.',
                            icon: 'success',
                            timer: 1500,
                            showConfirmButton: false,
                            customClass: { popup: 'rounded-4' }
                        });
                        loadRecoveryBackups();
                        updateDmMetrics();
                    } catch(err) {
                        Swal.fire('Error', err.message, 'error');
                    }
                }
            };
        });

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-danger text-center">Error: ${e.message}</td></tr>`;
    }
}

async function loadAuditLogsLedger() {
    const tbody = document.getElementById('dmLogsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Loading audit ledger...</td></tr>';
    
    try {
        const filterVal = document.getElementById('dmLogsActionFilter').value;
        let q = query(collection(db, "audit_logs"), where("madrasaId", "==", madrasaId));
        const snap = await getDocs(q);
        
        let logsList = [];
        snap.forEach(d => logsList.push(d.data()));
        
        if (filterVal !== 'all') {
            logsList = logsList.filter(l => l.action === filterVal);
        }

        logsList.sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp));

        if (logsList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">No logs matching criteria.</td></tr>';
            return;
        }

        tbody.innerHTML = logsList.map(l => `
            <tr class="profile-hover-card">
                <td class="fw-bold"><span class="badge ${
                    l.action.includes('Delete') ? 'bg-danger bg-opacity-10 text-danger' : 
                    l.action.includes('Reset') ? 'bg-warning bg-opacity-10 text-warning' : 
                    l.action.includes('Restore') ? 'bg-success bg-opacity-10 text-success' : 'bg-primary bg-opacity-10 text-primary'
                } px-2 py-1">${l.action}</span></td>
                <td><span class="fw-bold">${l.userId === auth.currentUser.uid ? 'You' : 'Teacher'}</span> <small class="text-muted">(${l.userRole})</small></td>
                <td style="max-width: 300px; word-break: break-all;">${l.details}</td>
                <td>${new Date(l.timestamp).toLocaleString()}</td>
            </tr>
        `).join('');

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-danger text-center">Error: ${e.message}</td></tr>`;
    }
}

// Bind DMC Click Triggers & Inputs
function initDataManagementListeners() {
    document.getElementById('dmStudentSelectAll')?.addEventListener('change', (e) => {
        const state = e.target.checked;
        document.querySelectorAll('.dm-student-checkbox').forEach(cb => cb.checked = state);
        updateStudentsSelectedCount();
    });

    document.getElementById('dmClassSelectAll')?.addEventListener('change', (e) => {
        const state = e.target.checked;
        document.querySelectorAll('.dm-class-checkbox').forEach(cb => cb.checked = state);
        updateClassesSelectedCount();
    });

    document.getElementById('dmSubjectSelectAll')?.addEventListener('change', (e) => {
        const state = e.target.checked;
        document.querySelectorAll('.dm-subject-checkbox').forEach(cb => cb.checked = state);
        updateSubjectsSelectedCount();
    });

    document.getElementById('btnDmResetStudentFilters')?.addEventListener('click', () => {
        document.getElementById('dmStudentClassFilter').value = 'all';
        document.getElementById('dmStudentSearch').value = '';
        loadDmStudents();
    });

    document.getElementById('btnDmResetSubjectFilters')?.addEventListener('click', () => {
        document.getElementById('dmSubjectClassFilter').value = 'all';
        loadDmSubjects();
    });

    document.getElementById('dmStudentClassFilter')?.addEventListener('change', loadDmStudents);
    document.getElementById('dmStudentSearch')?.addEventListener('input', loadDmStudents);
    document.getElementById('dmSubjectClassFilter')?.addEventListener('change', loadDmSubjects);
    document.getElementById('dmLogsActionFilter')?.addEventListener('change', loadAuditLogsLedger);

    document.querySelectorAll('#dmTabs button[data-bs-toggle="tab"]').forEach(tab => {
        tab.addEventListener('shown.bs.tab', (e) => {
            const targetId = e.target.getAttribute('data-bs-target');
            if (targetId === '#dm-students') loadDmStudents();
            else if (targetId === '#dm-classes') loadDmClasses();
            else if (targetId === '#dm-subjects') loadDmSubjects();
            else if (targetId === '#dm-records') loadDmRecordsSetup();
            else if (targetId === '#dm-recovery') loadRecoveryBackups();
            else if (targetId === '#dm-logs') loadAuditLogsLedger();
            else if (targetId === '#dm-overview') updateDmMetrics();
        });
    });

    document.getElementById('btnDmDeleteSelectedStudents')?.addEventListener('click', () => {
        const checked = document.querySelectorAll('.dm-student-checkbox:checked');
        const sids = Array.from(checked).map(cb => cb.dataset.id);
        
        executeSecureDelete({
            title: 'Delete Selected Students?',
            text: `This will cascade delete ${sids.length} selected student profiles, their admission numbers, and daily prayer records!`,
            backupType: 'Student Backup',
            fetchDataToBackup: () => gatherStudentBackupData(sids),
            performDelete: (backupId) => performStudentDelete(sids, backupId),
            onSuccess: () => {
                loadDmStudents();
                updateDmMetrics();
            }
        });
    });

    document.getElementById('btnDmDeleteAllStudents')?.addEventListener('click', async () => {
        if (!isSuperAdmin) return;
        const sSnap = await getDocs(query(collection(db, "students"), where("madrasaId", "==", madrasaId)));
        const sids = sSnap.docs.map(d => d.id);
        
        if (sids.length === 0) {
            Swal.fire('Info', 'No students to delete.', 'info');
            return;
        }

        executeSecureDelete({
            title: '⚠️ DELETE ALL STUDENTS?',
            text: `CRITICAL ACTION: This will permanently delete ALL ${sids.length} students, their admission numbers, and their records for this entire Madrasa!`,
            backupType: 'Full System Backup',
            fetchDataToBackup: () => gatherStudentBackupData(sids),
            performDelete: (backupId) => performStudentDelete(sids, backupId),
            onSuccess: () => {
                loadDmStudents();
                updateDmMetrics();
            }
        });
    });

    document.getElementById('btnDmDeleteSelectedClasses')?.addEventListener('click', () => {
        if (!isSuperAdmin) return;
        const checked = document.querySelectorAll('.dm-class-checkbox:checked');
        const cids = Array.from(checked).map(cb => cb.dataset.id);
        
        executeSecureDelete({
            title: 'Delete Selected Classes?',
            text: `CRITICAL ACTION: This will delete ${cids.length} classes, all students inside them, their subjects, and daily prayer logs!`,
            backupType: 'Class Backup',
            fetchDataToBackup: () => gatherClassBackupData(cids),
            performDelete: (backupId) => performClassDelete(cids, backupId),
            onSuccess: () => {
                loadDmClasses();
                updateDmMetrics();
            }
        });
    });

    document.getElementById('btnDmDeleteAllClasses')?.addEventListener('click', async () => {
        if (!isSuperAdmin) return;
        const cSnap = await getDocs(query(collection(db, "classes"), where("madrasaId", "==", madrasaId)));
        const cids = cSnap.docs.map(d => d.id);
        
        if (cids.length === 0) {
            Swal.fire('Info', 'No classes to delete.', 'info');
            return;
        }

        executeSecureDelete({
            title: '⚠️ DELETE ALL CLASSES?',
            text: `CRITICAL ACTION: This will completely delete ALL ${cids.length} classes, all students, all subjects, all records, and resets the entire Madrasa roster!`,
            backupType: 'Full System Backup',
            fetchDataToBackup: () => gatherClassBackupData(cids),
            performDelete: (backupId) => performClassDelete(cids, backupId),
            onSuccess: () => {
                loadDmClasses();
                updateDmMetrics();
            }
        });
    });

    document.getElementById('btnDmDeleteSelectedSubjects')?.addEventListener('click', () => {
        const checked = document.querySelectorAll('.dm-subject-checkbox:checked');
        const subIds = Array.from(checked).map(cb => cb.dataset.id);
        
        executeSecureDelete({
            title: 'Delete Selected Subjects?',
            text: `This will delete ${subIds.length} subjects and automatically recalculate studied daily scores in affected daily records.`,
            backupType: 'Subject Backup',
            fetchDataToBackup: () => gatherSubjectBackupData(subIds),
            performDelete: (backupId) => performSubjectDelete(subIds, backupId),
            onSuccess: () => {
                loadDmSubjects();
                updateDmMetrics();
            }
        });
    });

    document.getElementById('btnDmDeleteAllSubjects')?.addEventListener('click', async () => {
        if (!isSuperAdmin) return;
        const sSnap = await getDocs(query(collection(db, "subjects"), where("madrasaId", "==", madrasaId)));
        const subIds = sSnap.docs.map(d => d.id);
        
        if (subIds.length === 0) {
            Swal.fire('Info', 'No subjects to delete.', 'info');
            return;
        }

        executeSecureDelete({
            title: '⚠️ DELETE ALL SUBJECTS?',
            text: `This will delete ALL ${subIds.length} subjects from the system and updates daily log subject scores to 0.`,
            backupType: 'Subject Backup',
            fetchDataToBackup: () => gatherSubjectBackupData(subIds),
            performDelete: (backupId) => performSubjectDelete(subIds, backupId),
            onSuccess: () => {
                loadDmSubjects();
                updateDmMetrics();
            }
        });
    });

    document.getElementById('btnDmResetFilteredRecords')?.addEventListener('click', () => {
        const cid = document.getElementById('dmRecordsClassFilter').value;
        const sid = document.getElementById('dmRecordsStudentFilter').value;
        const sDate = document.getElementById('dmRecordsStartDate').value;
        const eDate = document.getElementById('dmRecordsEndDate').value;

        executeSecureDelete({
            title: 'Reset Filtered Records?',
            text: `This will permanently delete daily prayer logs matching: Class: ${cid}, Student: ${sid}, Date Range: ${sDate || 'any'} to ${eDate || 'any'}.`,
            backupType: 'Records Backup',
            fetchDataToBackup: () => gatherRecordsBackupData(cid, sid, sDate, eDate),
            performDelete: (backupId) => performRecordsDelete(cid, sid, sDate, eDate, backupId),
            onSuccess: () => {
                updateDmMetrics();
            }
        });
    });

    document.getElementById('btnDmDeleteAllRecords')?.addEventListener('click', () => {
        if (!isSuperAdmin) return;
        executeSecureDelete({
            title: '⚠️ RESET ALL TRACKING DATA?',
            text: `CRITICAL ACTION: This will completely wipe ALL historical daily logs and prayer tracking records for this entire Madrasa. Student rosters and classes remain untouched.`,
            backupType: 'Records Backup',
            fetchDataToBackup: () => gatherRecordsBackupData('all', 'all', '', ''),
            performDelete: (backupId) => performRecordsDelete('all', 'all', '', '', backupId),
            onSuccess: () => {
                updateDmMetrics();
            }
        });
    });
    
    // Periodically sweep expired backups
    setInterval(runExpiredBackupsCleanup, 60 * 60 * 1000);
}

// Expose DMC functions globally to help manual execution
window.checkSuperAdminRole = checkSuperAdminRole;
window.executeSecureDelete = executeSecureDelete;
window.createSystemBackup = createSystemBackup;
window.restoreSystemBackup = restoreSystemBackup;
window.downloadSystemBackup = downloadSystemBackup;
window.runExpiredBackupsCleanup = runExpiredBackupsCleanup;
window.updateDmMetrics = updateDmMetrics;
window.loadDmStudents = loadDmStudents;
window.loadDmClasses = loadDmClasses;
window.loadDmSubjects = loadDmSubjects;
window.loadDmRecordsSetup = loadDmRecordsSetup;
window.loadRecoveryBackups = loadRecoveryBackups;
window.loadAuditLogsLedger = loadAuditLogsLedger;
window.initDataManagementListeners = initDataManagementListeners;


