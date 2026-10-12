// Paste your Firebase web-app config here to switch the app from "this browser only" to cloud sync.
// (Firebase console → Project settings → Your apps → Web app → SDK setup and configuration.)
// This config is not a secret — access is protected by the Firestore security rules in /firestore.rules.
// This app shares the come-back-fitz21 project with Come back and Little Bites (own web app registration).
// Set it to `null` to keep everything in this browser. See docs/FIREBASE.md.
//
// export const firebaseConfig = {
//   apiKey: '…', authDomain: '….firebaseapp.com', projectId: '…',
//   storageBucket: '….firebasestorage.app', messagingSenderId: '…', appId: '…',
// };
export const firebaseConfig = {
  apiKey: 'AIzaSyAv_YXHEGQ4Pl540ph7pnoG-XMgOjiJUDg',
  authDomain: 'come-back-fitz21.firebaseapp.com',
  projectId: 'come-back-fitz21',
  storageBucket: 'come-back-fitz21.firebasestorage.app',
  messagingSenderId: '819440729074',
  appId: '1:819440729074:web:07e5d97f9f7978597f896b',
};

// Only this account may open the book. The real lock is firestore.rules; this just gives a clear message.
export const allowedEmail = 'fitzgeraldryan21@gmail.com';
