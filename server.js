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

  // absenceAlarmMinutes: 3  // ❌ 사용 안하므로 주석
  autoUnreserveSeconds: 30  // ✔ 30초 후 예약 자동 해제
};

const state = {
  temperature: null,
  acOn: false,
  fanOn: false,
  seatUsed: null,
  alarm: false,   // 알람은 이제 사용 안하지만 남겨두기만 함
  seatReserved: false,
  lastSeatChange: null,

  // alarmTimeoutId: null,   // ❌ 사용 안함
  unreserveTimeoutId: null,

  lastEvent: null
};

// ===================
// 로직 함수
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

function handleSeatChange(seatUsed) {
  const now = Date.now();
  state.seatUsed = seatUsed;
  state.lastSeatChange = now;

  // 🔄 타이머 정리
  if (state.unreserveTimeoutId) {
    clearTimeout(state.unreserveTimeoutId);
    state.unreserveTimeoutId = null;
  }

  // =====================
  // 3분 알람 → ❌ 사용 안 함
  // =====================
  /*
  if (!seatUsed) {
    state.alarmTimeoutId = setTimeout(() => {
      if (state.seatUsed === false) {
        state.alarm = true;
        state.lastEvent = 'ALARM_ON';
      }
    }, config.absenceAlarmMinutes * 60 * 1000);
  }
  */

  // =====================
  // ✔ 30초 후 예약 자동 해제
  // =====================
  if (!seatUsed) {
    state.unreserveTimeoutId = setTimeout(() => {
      if (state.seatUsed === false && state.seatReserved === true) {
        state.seatReserved = false;
        state.lastEvent = 'AUTO_UNRESERVE';
        console.log('⏰ 30초 자리 비움 → 좌석 자동 취소');
      }
    }, config.autoUnreserveSeconds * 1000);
  } 
}

// ===================
// 아두이노 API
// ===================

app.get('/api/data', (req, res) => {
  res.json({
    seatReserved: state.seatReserved,
    fanOn: state.fanOn
  });
});

app.post('/api/data', (req, res) => {
  const { temperature, seatUsed } = req.body;
  const updated = {};

  if (typeof temperature !== 'undefined') {
    if (typeof temperature !== 'number')
      return res.status(400).json({ error: 'temperature는 숫자여야 합니다.' });

    state.temperature = temperature;
    updateACLogic(temperature);
    updated.temperature = state.temperature;
    updated.acOn = state.acOn;
    updated.fanOn = state.fanOn;
  }

  if (typeof seatUsed !== 'undefined') {
    if (typeof seatUsed !== 'boolean')
      return res.status(400).json({ error: 'seatUsed는 true/false여야 합니다.' });

    handleSeatChange(seatUsed);

    updated.seatUsed = state.seatUsed;
    updated.alarm = state.alarm;   // (사용 안하지만 포함)
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
  res.json({ seatReserved: state.seatReserved });
});

// ===================
// 페이지 라우팅
// ===================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/temperature', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'temperature.html'));
});

app.get('/reservation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reservation.html'));
});

// ===================
// 서버 실행
// ===================
app.listen(PORT, () => {
  console.log(`🚀 testChair server running on port ${PORT}`);
});
