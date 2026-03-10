import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDJ3uQLXF2z1EDlPopQwNJSVcGBc-rObHo",
  authDomain: "niskaram-tracker.firebaseapp.com",
  projectId: "niskaram-tracker",
  storageBucket: "niskaram-tracker.firebasestorage.app",
  messagingSenderId: "638791881406",
  appId: "1:638791881406:web:01bfd69062fd193726c4ef"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
