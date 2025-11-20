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
  acOnTemp: 25,
  acOffTemp: 23,

  autoUnreserveSeconds: 10,     // ✔ 예약 10초 후 자동 해제
  seatUsedTimeoutSeconds: 10    // ✔ seatUsed 10초 동안 업데이트 없으면 false 처리
};

const state = {
  temperature: null,
  acOn: false,
  fanOn: false,

  seatUsed: null,               // true: 사용중 / false 또는 null: 비어있음
  lastSeatUsedUpdate: null,     // seatUsed가 마지막으로 업데이트된 시간

  seatReserved: false,
  lastSeatChange: null,

  unreserveTimeoutId: null,
  lastEvent: null               // 'AUTO_UNRESERVE'
};

// ===================
// 공통 로직
// ===================

// 온도 → AC / Fan 제어 로직
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

// 예약 자동 해제 타이머 설정
function scheduleAutoUnreserve() {
  if (state.unreserveTimeoutId) {
    clearTimeout(state.unreserveTimeoutId);
    state.unreserveTimeoutId = null;
  }

  // 예약 ON + 좌석 사용중이 아님 (seatUsed != true)
  if (state.seatReserved === true && state.seatUsed !== true) {
    state.unreserveTimeoutId = setTimeout(() => {
      if (state.seatReserved === true && state.seatUsed !== true) {
        state.seatReserved = false;
        state.lastEvent = 'AUTO_UNRESERVE';
        console.log('⏰ 10초 동안 착석 없음 → 좌석 예약 자동 취소');

        // 🔥 이벤트를 0.5초만 유지하고 null로 초기화
        setTimeout(() => {
          if (state.lastEvent === 'AUTO_UNRESERVE') {
            state.lastEvent = null;
          }
        }, 500);  // ← 0.5초(500ms)
      }
    }, config.autoUnreserveSeconds * 1000);
  }
}

// seatUsed 업데이트 시 호출
function handleSeatChange(seatUsed) {
  const now = Date.now();
  state.seatUsed = seatUsed;
  state.lastSeatUsedUpdate = now;
  state.lastSeatChange = now;

  scheduleAutoUnreserve();
}

// ===================
// 아두이노 API
// ===================

// 아두이노 GET : seatReserved, fanOn 전달
app.get('/api/data', (req, res) => {
  res.json({
    seatReserved: state.seatReserved,
    fanOn: state.fanOn
  });
});

// 아두이노 POST : temperature, seatUsed 수신
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
// 웹 API
// ===================

app.get('/api/status', (req, res) => {
  const { unreserveTimeoutId, ...safeState } = state;
  res.json({ config, state: safeState });
});

app.post('/api/toggleSeatReserved', (req, res) => {
  state.seatReserved = !state.seatReserved;
  console.log('예약 상태 변경:', state.seatReserved);

  scheduleAutoUnreserve();
  res.json({ seatReserved: state.seatReserved });
});

// ============================
// seatUsed 자동 timeout 검사
// ============================

setInterval(() => {
  const now = Date.now();

  if (state.lastSeatUsedUpdate === null) return;

  const diff = (now - state.lastSeatUsedUpdate) / 1000;

  // 10초 넘게 업데이트 없으면 seatUsed → false 자동화
  if (diff >= config.seatUsedTimeoutSeconds) {
    if (state.seatUsed !== false) {
      console.log('⚠️ 10초 동안 seatUsed 데이터 없음 → 자동으로 seatUsed = false 처리');
      state.seatUsed = false;

      scheduleAutoUnreserve();
    }
  }
}, 1000);

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
