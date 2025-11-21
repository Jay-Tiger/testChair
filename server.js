const express = require('express');
const path = require('path');
const bodyParser = require('body-parser'); 
const admin = require('firebase-admin'); 
const moment = require('moment'); 

const firebaseConfigString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

// --- 예약 시간 및 주기 설정 ---
const config = {
  acOnTemp: 25,
  acOffTemp: 23,
  autoUnreserveMinutes: 0.1 
};

function getUnreserveMs() {
  return config.autoUnreserveMinutes * 60 * 1000;
}

// Firebase Admin 초기화
try {
    let serviceAccount;

    if (firebaseConfigString) {
        serviceAccount = JSON.parse(firebaseConfigString);
        console.log("클라우드 환경: 환경 변수에서 키를 로드합니다.");
    } else {
        serviceAccount = require("./firebase-key.json");
        console.log("로컬 개발 환경: 파일에서 키를 로드합니다.");
    }

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("🔥 Firebase Admin SDK 초기화 성공.");
} catch (error) {
    console.warn(`⚠️ Firebase Admin SDK 초기화 실패: ${error.message}`);
}

const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const state = {
  temperature: null,
  acOn: false,
  fanOn: false,
  seatUsed: null,
  alarm: false, 
  seatReserved: false,
  fcmToken: null,
  lastSeatChange: null,
  alarmTimeoutId: null,
  unreserveTimeoutId: null
};

function sendFCM(token, title, body, data = {}) {
    if (!admin.apps.length || !token) return;
    
    const message = {
        notification: { title, body },
        data: { ...data, timestamp: String(Date.now()) },
        token: token,
    };

    admin.messaging().send(message)
        .then((response) => console.log('FCM 성공:', response))
        .catch((error) => console.error('FCM 실패:', error));
}

function updateACLogic(temp) {
  if (temp == null || !state.seatReserved) return;

  if (!state.acOn && temp >= config.acOnTemp) {
    state.acOn = true;
    state.fanOn = true;
  }
  else if (state.acOn && temp <= config.acOffTemp) {
    state.acOn = false;
    state.fanOn = false;
  }
}

function handleSeatChange(seatUsed) {
  const now = Date.now();
  if (state.seatUsed === seatUsed) return;
  
  state.seatUsed = seatUsed;
  state.lastSeatChange = now;

  if (state.unreserveTimeoutId) clearTimeout(state.unreserveTimeoutId);
  state.unreserveTimeoutId = null;
  state.alarmTimeoutId = null; 
  state.alarm = false; 

  if (!seatUsed && state.seatReserved) {
    state.unreserveTimeoutId = setTimeout(() => {
      if (state.seatUsed === false && state.seatReserved === true) {
        state.seatReserved = false;
        state.alarm = true; 
        state.acOn = false;
        state.fanOn = false;
        
        if (state.fcmToken) {
            sendFCM(state.fcmToken, "예약 자동 해제", `장시간 자리 미사용으로 예약이 해제되었습니다.`, { action: 'unreserve_timeout' });
            state.fcmToken = null;
        }
      }
    }, getUnreserveMs());

  } else if (seatUsed) {
    state.alarm = false;
  }
}

// 아두이노 GET
app.get('/api/data', (req, res) => {
  res.json({
    seatReserved: state.seatReserved,
    fanOn: state.fanOn
  });
});

// 아두이노 POST
app.post('/api/data', (req, res) => {
  const { temperature, seatUsed } = req.body;
  const updated = {};

  if (typeof temperature !== 'undefined') {
    if (typeof temperature !== 'number') {
      return res.status(400).json({ error: 'temperature는 숫자여야 합니다.' });
    }
    state.temperature = temperature;
    updateACLogic(temperature);
    updated.temperature = state.temperature;
    updated.acOn = state.acOn;
    updated.fanOn = state.fanOn;
  }

  if (typeof seatUsed !== 'undefined') {
    if (typeof seatUsed !== 'boolean') {
      return res.status(400).json({ error: 'seatUsed는 true/false여야 합니다.' });
    }
    handleSeatChange(seatUsed);
    updated.seatUsed = state.seatUsed;
    updated.alarm = state.alarm;
  }

  const { alarmTimeoutId, unreserveTimeoutId, ...safeState } = state;
  res.json({ ok: true, updated, state: safeState });
});

// FCM 토큰 저장
app.post('/api/saveToken', (req, res) => {
    const { fcmToken } = req.body;
    if (fcmToken) {
        state.fcmToken = fcmToken;
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false });
    }
});

// Config 변경
app.post('/api/config', (req, res) => {
    const { acOnTemp, acOffTemp, autoUnreserveMinutes } = req.body;
    
    if (
      typeof acOnTemp === 'number' &&
      typeof acOffTemp === 'number' &&
      typeof autoUnreserveMinutes === 'number'
    ) {
        config.acOnTemp = acOnTemp;
        config.acOffTemp = acOffTemp;
        config.autoUnreserveMinutes = autoUnreserveMinutes;
        updateACLogic(state.temperature); 
        return res.json({ success: true, config });
    } else {
        return res.status(400).json({ success: false });
    }
});

// 상태 조회
app.get('/api/status', (req, res) => {
  res.setHeader('Content-Type', 'application/json'); 
  const { alarmTimeoutId, unreserveTimeoutId, ...safeState } = state;
  res.json({ config, state: safeState });
});

// 예약 토글
app.post('/api/toggleSeatReserved', (req, res) => {
  const { fcmToken } = req.body;
  
  const newState = !state.seatReserved;
  state.seatReserved = newState;
  
  if (newState) {
    state.fcmToken = fcmToken;
    state.lastSeatChange = Date.now(); 
    state.alarm = false;

    if (state.fcmToken) {
        sendFCM(state.fcmToken, "좌석 예약 완료", `좌석이 예약되었습니다.`, { action: 'reservation' });
    }

    if (state.seatUsed === false) {
        if (state.unreserveTimeoutId) clearTimeout(state.unreserveTimeoutId);
        
        state.unreserveTimeoutId = setTimeout(() => {
            if (state.seatUsed === false && state.seatReserved === true) {
                state.seatReserved = false;
                state.alarm = true;
                state.acOn = false;
                state.fanOn = false; 
                
                if (state.fcmToken) {
                    sendFCM(state.fcmToken, "예약 자동 해제", `자리 미사용으로 예약이 해제되었습니다.`, { action: 'unreserve_timeout' });
                    state.fcmToken = null;
                }
            }
        }, getUnreserveMs());
    }

  } else {
    if (state.unreserveTimeoutId) clearTimeout(state.unreserveTimeoutId);
    state.alarmTimeoutId = null; 
    state.unreserveTimeoutId = null;
    state.alarm = true;
    state.fcmToken = null; 
    
    state.acOn = false;
    state.fanOn = false;
    
    if (fcmToken) {
        sendFCM(fcmToken, "예약 해제 완료", "좌석 예약이 정상적으로 해제되었습니다.", { action: 'cancellation' });
    }
  }

  res.json({ seatReserved: state.seatReserved, alarm: state.alarm });
});

// 페이지 라우팅
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/temperature', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'temperature.html'));
});

app.get('/reservation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reservation.html'));
});

// 404 처리
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ 
            error: 'Not Found', 
            message: `API endpoint ${req.path} not found.`
        });
    }
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});
