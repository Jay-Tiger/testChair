const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================
// 설정 & 상태
// ===================
const config = {
  acOnTemp: 27,
  acOffTemp: 24,
  autoUnreserveSeconds: 30,     // 30초 뒤 예약 자동 해제
  seatUsedTimeoutSeconds: 10    // ✔ 방법1: 10초 동안 seatUsed 업데이트 없으면 false 처리
};

const state = {
  temperature: null,
  acOn: false,
  fanOn: false,
  seatUsed: null,
  lastSeatUsedUpdate: null,      // ✔ seatUsed 업데이트 시간 저장
  seatReserved: false,
  lastSeatChange: null,
  unreserveTimeoutId: null,
  lastEvent: null                // 'AUTO_UNRESERVE'
};

// ===================
// 공통 로직 함수
// ===================

function updateACLogic(temp) {
  if (temp == null) return;

  if (!state.acOn && temp >= config.acOnTemp) {
    state.acOn = true;
    state.fanOn = true;
  } else if (state.acOn && temp <= config.acOffTemp) {
    state.acOn = false;
    state.fanOn = false;
  }
}

// 🔁 예약 자동 해제 타이머 설정/재설정
function scheduleAutoUnreserve() {
  if (state.unreserveTimeoutId) {
    clearTimeout(state.unreserveTimeoutId);
    state.unreserveTimeoutId = null;
  }

  // seatUsed !== true → false 또는 null이면 "자리 비어있음"
  if (state.seatReserved === true && state.seatUsed !== true) {
    state.unreserveTimeoutId = setTimeout(() => {
      if (state.seatReserved === true && state.seatUsed !== true) {
        state.seatReserved = false;
        state.lastEvent = 'AUTO_UNRESERVE';
        console.log('⏰ 30초 동안 착석 없음 → 좌석 예약 자동 취소');
      }
    }, config.autoUnreserveSeconds * 1000);
  }
}

// 착석 상태 변경 로직
function handleSeatChange(seatUsed) {
  const now = Date.now();
  state.seatUsed = seatUsed;
  state.lastSeatUsedUpdate = now;       // ✔ 업데이트 시간 기록
  state.lastSeatChange = now;

  scheduleAutoUnreserve();
}

// ===================
// 아두이노 API
// ===================

// 아두이노 GET (seatReserved, fanOn 값 전달)
app.get('/api/data', (req, res) => {
  res.json({
    seatReserved: state.seatReserved,
    fanOn: state.fanOn
  });
});

// 아두이노 POST (temperature, seatUsed 수신)
app.post('/api/data', (req, res) => {
  const { temperature, seatUsed } = req.body;
  const updated = {};

  if (typeof temperature !== 'undefined') {
    if (typeof temperature !== 'number') {
      return res.status(400).json({ error: 'temperature는 숫자여야 합니다.' });
    }
    state.temperature = temperature;
    updateACLogic(temperature);
  }

  if (typeof seatUsed !== 'undefined') {
    if (typeof seatUsed !== 'boolean') {
      return res.status(400).json({ error: 'seatUsed는 true/false여야 합니다.' });
    }
    handleSeatChange(seatUsed);
  }

  const { unreserveTimeoutId, ...safeState } = state;
  res.json({ ok: true, updated, state: safeState });
});

// ===================
// 웹용 API
// ===================

app.get('/api/status', (req, res) => {
  const { unreserveTimeoutId, ...safeState } = state;
  res.json({ config, state: safeState });
});

app.post('/api/toggleSeatReserved', (req, res) => {
  state.seatReserved = !state.seatReserved;
  scheduleAutoUnreserve();
  res.json({ seatReserved: state.seatReserved });
});

// ============================
// 방법 1: seatUsed 자동 초기화 로직
// ============================

// ✔ 1초마다 seatUsed 최신 업데이트 검사
setInterval(() => {
  const now = Date.now();

  // 아직 아두이노 신호를 한 번도 못 받았다면 무시
  if (state.lastSeatUsedUpdate === null) return;

  const diff = (now - state.lastSeatUsedUpdate) / 1000;

  // 10초 이상 seatUsed 업데이트가 없으면 false 처리
  if (diff >= config.seatUsedTimeoutSeconds) {
    if (state.seatUsed !== false) {
      console.log('⚠️ 10초 동안 seatUsed 업데이트 없음 → seatUsed = false 자동 설정');
      state.seatUsed = false;

      // 좌석 상태 바뀐 것으로 처리 → 자동취소 타이머 갱신
      scheduleAutoUnreserve();
    }
  }
}, 1000); // 1초마다 체크


// ============================
// 페이지 라우팅
// ============================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/temperature', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'temperature.html'));
});

app.get('/reservation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reservation.html'));
});

// ============================
// 서버 실행
// ============================

app.listen(PORT, () => {
  console.log(`🚀 testChair server running on port ${PORT}`);
});
