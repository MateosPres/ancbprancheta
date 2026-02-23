
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import "firebase/compat/storage";
import "firebase/compat/messaging";
import "firebase/compat/functions";

const firebaseConfig = { 
    apiKey: "AIzaSyCZ2yeJJ34VwYAmQnFCEv72Q1uDFFGKKjQ", 
    authDomain: "ancb-painel-db.firebaseapp.com", 
    projectId: "ancb-painel-db", 
    storageBucket: "ancb-painel-db.appspot.com", 
    messagingSenderId: "792900234002", 
    appId: "1:792900234002:web:2a37004deb046cb8f261cb", 
    measurementId: "G-VCMEKP1XP4" 
};

const app = firebase.initializeApp(firebaseConfig);
export const db = app.firestore();
export const auth = app.auth();
export const storage = app.storage();
export const functions = app.functions(); // Export functions capability

// --- MESSAGING SETUP ---
let messaging: firebase.messaging.Messaging | null = null;

try {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && firebase.messaging.isSupported()) {
        messaging = app.messaging();
    }
} catch (error) {
    console.warn("Firebase Messaging not supported in this environment", error);
}

export const requestFCMToken = async (vapidKey: string): Promise<string | null> => {
    if (!messaging) return null;
    
    // Safety check for iOS/Browsers without Notification API exposed
    if (typeof Notification === 'undefined') {
        console.warn("Notification API not available.");
        return null;
    }

    try {
        if (Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.log("Permissão de notificação negada pelo usuário.");
                return null;
            }
        } else if (Notification.permission !== 'granted') {
            return null;
        }

        const token = await messaging.getToken({ vapidKey });
        return token;

    } catch (error: any) {
        if (error.name === 'AbortError' || error.message?.includes('push service') || error.message?.includes('block')) {
            console.warn("Aviso: Notificações push bloqueadas ou canceladas. Usando apenas in-app.");
        } else {
            console.error("Erro ao recuperar token FCM:", error);
        }
        return null;
    }
};

export const onMessageListener = (callback: (payload: any) => void) => {
    if (!messaging) return () => {};
    return messaging.onMessage(callback);
};

export default firebase;
export { messaging };
