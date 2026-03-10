import { auth, db } from './firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, updateDoc, getDoc } from 'https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js'; let madrasaId = null;
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

    const madrasaLinkBtn = document.getElementById('madrasaLinkBtn');
    if (madrasaLinkBtn) {
        madrasaLinkBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (madrasaId) {
                const url = window.location.origin + window.location.pathname.replace('admin.html', 'home.html') + '?m=' + madrasaId;
                prompt("Copy this link and send it to your Madrasa WhatsApp group:", url);
            }
        });
    }
});

async function init() {
    await loadClasses();
    await loadSubjects();
    await loadStudents();
    await loadBooks();
}

async function loadClasses() {
    const list = document.getElementById('classesList');
    const classSelect = document.getElementById('studentClass');

    if (!madrasaId) return;

    const q = query(collection(db, "classes"), where("madrasaId", "==", madrasaId));
    const snap = await getDocs(q);

    list.innerHTML = snap.empty ? '<li class="list-group-item text-muted border-0 px-0">No classes found.</li>' : '';
    classSelect.innerHTML = '<option value="">Select Class</option>';
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
        document.getElementById('editClass').innerHTML += `<option value="${d.id}">${data.name}</option>`;
    });

    attachCrudEvents();
}

async function loadSubjects() {
    const list = document.getElementById('subjectsList');
    if (!madrasaId) return;

    const q = query(collection(db, "subjects"), where("madrasaId", "==", madrasaId));
    const snap = await getDocs(q);

    list.innerHTML = snap.empty ? '<li class="list-group-item text-muted border-0 px-0">No subjects found.</li>' : '';

    snap.forEach(d => {
        const data = d.data();
        list.innerHTML += `
      <li class="list-group-item d-flex justify-content-between align-items-center bg-transparent border rounded p-2 mb-2">
        <span class="fw-bold px-2">${data.name}</span>
        <div>
           <button class="btn btn-sm btn-outline-primary edit-btn rounded-circle me-1" data-id="${d.id}" data-type="subjects" data-name="${data.name}"><i class="bi bi-pencil"></i></button>
           <button class="btn btn-sm btn-outline-danger del-btn rounded-circle" data-id="${d.id}" data-type="subjects"><i class="bi bi-trash"></i></button>
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
    const recordStudentFilter = document.getElementById('recordStudentFilter');
    if (!madrasaId) return;

    const q = query(collection(db, "students"), where("madrasaId", "==", madrasaId));
    const snap = await getDocs(q);

    list.innerHTML = snap.empty ? '<li class="list-group-item text-muted border-0 px-0">No students found.</li>' : '';
    recordStudentFilter.innerHTML = '<option value="">All Students</option>';
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
        recordStudentFilter.innerHTML += `<option value="${d.id}">${data.name}</option>`;
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

            if (b.dataset.type === 'students') {
                document.getElementById('studentEditFields').classList.remove('d-none');
                document.getElementById('editClass').value = b.dataset.class;
            } else {
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
    await addDoc(collection(db, "subjects"), { name, madrasaId });
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
// RECORDS MANANGEMENT
// ============================================
document.getElementById('loadRecordsBtn').onclick = loadAdminRecords;

async function loadAdminRecords() {
    const studentId = document.getElementById('recordStudentFilter')?.value;
    const dateStr = document.getElementById('recordDateFilter').value;
    const container = document.getElementById('recordsAdminList');
    if (!dateStr && !studentId) {
        container.innerHTML = `<p class="text-danger small">Select a student or date.</p>`;
        return;
    }
    container.innerHTML = `<div class="spinner-border text-primary spinner-border-sm"></div>`;

    let q;
    if (studentId && dateStr) {
        q = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("studentId", "==", studentId), where("date", "==", dateStr));
    } else if (studentId) {
        q = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("studentId", "==", studentId));
    } else {
        q = query(collection(db, "records"), where("madrasaId", "==", madrasaId), where("date", "==", dateStr));
    }

    const snap = await getDocs(q);

    if (snap.empty) {
        container.innerHTML = `<p class="text-muted small">No records found for the given criteria.</p>`;
        return;
    }

    container.innerHTML = '';

    // Sort locally by date desc
    let results = [];
    snap.forEach(d => results.push({ id: d.id, ...d.data() }));
    results.sort((a, b) => new Date(b.date) - new Date(a.date));

    results.forEach(data => {
        const studentName = studentMap[data.studentId]?.name || 'Unknown Student';
        const d_id = data.id;

        // Count prayers marked
        let prayerCount = 0;
        if (data.prayers) {
            Object.values(data.prayers).forEach(v => {
                if (v && v !== 'Not Prayed') prayerCount++;
            });
        }

        let subjectsCompleted = data.subjects ? data.subjects.length : 0;

        container.innerHTML += `
          <div class="card p-3 shadow-sm border rounded bg-white">
             <div class="d-flex justify-content-between align-items-center mb-2">
                 <div>
                     <span class="fw-bold">${studentName}</span>
                     ${studentId ? `<br><small class="text-muted"><i class="bi bi-calendar"></i> ${data.date}</small>` : ''}
                 </div>
                 <span class="badge bg-primary rounded-pill">${data.totalScore} pts</span>
             </div>
             <p class="mb-1 small text-muted">Prayers marked: ${prayerCount}</p>
             <p class="mb-2 small text-muted">Subjects completed: ${subjectsCompleted}</p>
             <div class="d-flex gap-2 justify-content-end">
                 <button class="btn btn-sm btn-outline-primary edit-record-btn" data-id="${d_id}"><i class="bi bi-pencil-square"></i> Edit</button>
                 <button class="btn btn-sm btn-outline-danger del-btn" data-id="${d_id}" data-type="records"><i class="bi bi-trash"></i> Delete</button>
             </div>
          </div>
        `;
    });

    attachCrudEvents(); // Re-attach delete listeners

    // Attach Record Edit listeners
    document.querySelectorAll('.edit-record-btn').forEach(b => {
        b.onclick = async () => {
            const rId = b.dataset.id;
            const rDoc = await getDoc(doc(db, "records", rId));
            const data = rDoc.data();

            if (!recordEditModal) recordEditModal = new bootstrap.Modal(document.getElementById('recordEditModal'));

            const pCont = document.getElementById('recordEditFormContainer');
            // Build prayer form logic dynamically based on existing keys
            let html = `<input type="hidden" id="editRecordId" value="${rId}">`;

            const formItems = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
            formItems.forEach(p => {
                const pCap = p.charAt(0).toUpperCase() + p.slice(1);
                const currentVal = data[p] || data.prayers?.[pCap] || 'Not Prayed';

                html += `
                  <div class="mb-3 border rounded p-2 bg-light">
                     <label class="fw-bold small mb-2">${pCap}</label>
                     <select class="form-select form-select-sm prayer-edit-select" data-key="${p}" data-cap="${pCap}">
                        <option value="Jamaat" ${currentVal === 'Jamaat' ? 'selected' : ''}>Jamaat (1pt)</option>
                        <option value="Individual" ${currentVal === 'Individual' ? 'selected' : ''}>Individual (0.5pt)</option>
                        <option value="Not Prayed" ${currentVal === 'Not Prayed' ? 'selected' : ''}>Not Prayed (0pt)</option>
                     </select>
                  </div>
                `;
            });
            pCont.innerHTML = html;
            recordEditModal.show();
        };
    });
}

document.getElementById('saveRecordEditBtn').onclick = async () => {
    const id = document.getElementById('editRecordId').value;
    const selects = document.querySelectorAll('.prayer-edit-select');

    let prayerScore = 0;
    let prayersData = {};
    let lowerKeysData = {};

    selects.forEach(sel => {
        const val = sel.value;
        const key = sel.dataset.key;
        const cap = sel.dataset.cap;

        prayersData[cap] = val;
        lowerKeysData[key] = val;

        if (val === 'Jamaat') prayerScore += 1;
        if (val === 'Individual') prayerScore += 0.5;
    });

    try {
        const rRef = doc(db, "records", id);
        const rDoc = await getDoc(rRef);
        const currentData = rDoc.data();

        // Ensure new total score encapsulates unchanged subjectScore
        const totalScore = prayerScore + (currentData.subjectScore || 0);

        await updateDoc(rRef, {
            prayers: prayersData,
            ...lowerKeysData,
            prayerScore,
            totalScore
        });

        recordEditModal.hide();
        loadAdminRecords();
    } catch (err) {
        alert("Failed to update record: " + err.message);
    }
};
