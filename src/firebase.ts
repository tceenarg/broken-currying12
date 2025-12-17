import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCLcGmE-mmZq8rTqitQrRjyURyq4uzbfLY",
  authDomain: "fon-analiz-7e346.firebaseapp.com",
  projectId: "fon-analiz-7e346",
  storageBucket: "fon-analiz-7e346.firebasestorage.app",
  messagingSenderId: "1:1035675048712:web:871a37038c5635b0516ab",
  appId: "BURAYA",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
