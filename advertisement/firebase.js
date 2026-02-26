
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref as dbRef, set, push, onValue, remove, query as dbQuery, orderByChild, limitToLast, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCkO5LUOnIEd0fuc9X943d3apSALWb1eUc",
  authDomain: "chuyendoisophuonglaocai.firebaseapp.com",
  databaseURL: "https://chuyendoisophuonglaocai-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "chuyendoisophuonglaocai",
  storageBucket: "chuyendoisophuonglaocai.firebasestorage.app",
  messagingSenderId: "854154252245",
  appId: "1:854154252245:web:ec6a579e3904a968a7775c",
  measurementId: "G-ENY4MRJYE1",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);

export { 
    db, storage, 
    dbRef, set, push, onValue, remove, dbQuery, orderByChild, limitToLast, get,
    storageRef, uploadBytes, getDownloadURL, deleteObject 
};
