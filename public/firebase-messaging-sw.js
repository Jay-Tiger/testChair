// Firebase SDK 로드
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase 설정 (reservation.html과 동일한 정보 사용)
const firebaseConfig = {
  apiKey: "AIzaSyCHgmK9hXehqEeHTDxkUzQKtaH2yISRIy4",
  authDomain: "capston-chair.firebaseapp.com",
  databaseURL: "https://capston-chair-default-rtdb.firebaseio.com",
  projectId: "capston-chair",
  storageBucket: "capston-chair.firebasestorage.app",
  messagingSenderId: "362490624405",
  appId: "1:362490624405:web:a80ef4ef3a438e875ede9c",
  measurementId: "G-3M0V9L02RH"
};

// 앱 초기화
firebase.initializeApp(firebaseConfig);

// 메시징 인스턴스 가져오기
const messaging = firebase.messaging();

// 백그라운드에서 알림 수신 시 처리
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Background Message Received', payload);
  
  // 알림 데이터를 사용하여 알림을 표시
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico' // 아이콘 경로
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// 알림이 클릭되었을 때의 동작을 추가할 수 있습니다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // 클릭 시 포그라운드로 앱을 열거나 특정 페이지로 이동
  event.waitUntil(
    clients.openWindow('/')
  );
});
