import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc, query, orderBy, limit, where } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// Firebase configuration - REPLACE WITH YOUR CONFIG
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

let app = null;
let db = null;
let auth = null;
let currentUserId = null;

// Initialize Firebase
export async function initFirebase(config) {
    if (app) return { db, auth, userId: currentUserId };

    const finalConfig = config || firebaseConfig;

    // Check if config has real values
    if (finalConfig.apiKey === "YOUR_API_KEY") {
        console.warn('CareerFit: Firebase not configured. Using local storage only.');
        return null;
    }

    try {
        app = initializeApp(finalConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        // Sign in anonymously to get a user ID
        await signInAnonymously(auth);

        return new Promise((resolve) => {
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    currentUserId = user.uid;
                    console.log('CareerFit: Firebase initialized, user:', currentUserId);
                    resolve({ db, auth, userId: currentUserId });
                }
            });
        });
    } catch (error) {
        console.error('CareerFit: Firebase initialization error:', error);
        return null;
    }
}

// Get user's job history collection reference
function getJobHistoryRef() {
    if (!db || !currentUserId) return null;
    return collection(db, 'users', currentUserId, 'jobHistory');
}

// Save a job to Firebase
export async function saveJobToFirebase(job) {
    const historyRef = getJobHistoryRef();
    if (!historyRef) {
        console.log('CareerFit: Firebase not available, skipping cloud save');
        return null;
    }

    try {
        const jobRef = doc(historyRef, job.id);
        await setDoc(jobRef, {
            ...job,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        console.log('CareerFit: Saved to Firebase:', job.title);
        return job;
    } catch (error) {
        console.error('CareerFit: Error saving to Firebase:', error);
        return null;
    }
}

// Get all jobs from Firebase
export async function getJobsFromFirebase(limitCount = 500) {
    const historyRef = getJobHistoryRef();
    if (!historyRef) return [];

    try {
        const q = query(historyRef, orderBy('scannedAt', 'desc'), limit(limitCount));
        const snapshot = await getDocs(q);
        const jobs = [];
        snapshot.forEach((doc) => {
            jobs.push({ id: doc.id, ...doc.data() });
        });
        console.log('CareerFit: Loaded', jobs.length, 'jobs from Firebase');
        return jobs;
    } catch (error) {
        console.error('CareerFit: Error loading from Firebase:', error);
        return [];
    }
}

// Get a single job by ID
export async function getJobFromFirebase(jobId) {
    const historyRef = getJobHistoryRef();
    if (!historyRef) return null;

    try {
        const jobRef = doc(historyRef, jobId);
        const snapshot = await getDoc(jobRef);
        if (snapshot.exists()) {
            return { id: snapshot.id, ...snapshot.data() };
        }
        return null;
    } catch (error) {
        console.error('CareerFit: Error getting job from Firebase:', error);
        return null;
    }
}

// Update job status in Firebase
export async function updateJobInFirebase(jobId, updates) {
    const historyRef = getJobHistoryRef();
    if (!historyRef) return null;

    try {
        const jobRef = doc(historyRef, jobId);
        await setDoc(jobRef, {
            ...updates,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        console.log('CareerFit: Updated job in Firebase:', jobId);
        return true;
    } catch (error) {
        console.error('CareerFit: Error updating job in Firebase:', error);
        return false;
    }
}

// Delete a job from Firebase
export async function deleteJobFromFirebase(jobId) {
    const historyRef = getJobHistoryRef();
    if (!historyRef) return false;

    try {
        const jobRef = doc(historyRef, jobId);
        await deleteDoc(jobRef);
        console.log('CareerFit: Deleted job from Firebase:', jobId);
        return true;
    } catch (error) {
        console.error('CareerFit: Error deleting from Firebase:', error);
        return false;
    }
}

// Clear all job history from Firebase
export async function clearFirebaseHistory() {
    const historyRef = getJobHistoryRef();
    if (!historyRef) return false;

    try {
        const snapshot = await getDocs(historyRef);
        const deletePromises = [];
        snapshot.forEach((doc) => {
            deletePromises.push(deleteDoc(doc.ref));
        });
        await Promise.all(deletePromises);
        console.log('CareerFit: Cleared all jobs from Firebase');
        return true;
    } catch (error) {
        console.error('CareerFit: Error clearing Firebase history:', error);
        return false;
    }
}

// Sync local storage to Firebase (for migration)
export async function syncLocalToFirebase(localJobs) {
    if (!db || !currentUserId) return false;

    try {
        for (const job of localJobs) {
            await saveJobToFirebase(job);
        }
        console.log('CareerFit: Synced', localJobs.length, 'jobs to Firebase');
        return true;
    } catch (error) {
        console.error('CareerFit: Error syncing to Firebase:', error);
        return false;
    }
}

// Check if Firebase is configured and ready
export function isFirebaseReady() {
    return db !== null && currentUserId !== null;
}

export { db, auth, currentUserId };
