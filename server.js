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
  absenceAlarmMinutes: 3,
  autoUnreserveMinutes: 5, // 5분 지나면 예약 자동 해제
};

const state = {
  temperature: null,
  acOn: false,
  seatUsed: null,
  alarm: false,
  seatReserved: false,
  lastSeatChange: null,
  seatTimeoutId: null,
};

// ===================
// 로직
// ===================
function updateACLogic(temp) {
  if (temp == null) return;
  if (!state.acOn && temp >= config.acOnTemp) state.acOn = true;
  else if (state.acOn && temp <= config.acOffTemp) state.acOn = false;
}

function handleSeatChange(seatUsed) {
  const now = Date.now();
  state.seatUsed = seatUsed;
  state.lastSeatChange = now;

  if (state.seatTimeoutId) {
    clearTimeout(state.seatTimeoutId);
    state.seatTimeoutId = null;
  }

  if (!seatUsed) {
    state.alarm = false;
    state.seatTimeoutId = setTimeout(() => {
      // absenceAlarmMinutes 후 알람 켬
      if (state.seatUsed === false) {
        state.alarm = true;

        // 5분 이상 비어있으면 예약 자동 해제
        const absenceMinutes = (Date.now() - state.lastSeatChange) / 60000;
        if (absenceMinutes >= config.autoUnreserveMinutes && state.seatReserved === true) {
          state.seatReserved = false;
          console.log('⏰ 5분 이상 비어 있음 → seatReserved 자동 해제');
        }
      }
    }, config.absenceAlarmMinutes * 60 * 1000);
  } else {
    state.alarm = false;
  }
}

// ===================
// 라우팅 (아두이노)
// ===================

// 아두이노 GET: seatReserved만 응답
app.get('/api/data', (req, res) => {
  res.json({ seatReserved: state.seatReserved });
});

// 아두이노 POST: temperature, seatUsed만 수신
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
  }

  if (typeof seatUsed !== 'undefined') {
    if (typeof seatUsed !== 'boolean') {
      return res.status(400).json({ error: 'seatUsed는 true/false여야 합니다.' });
    }
    handleSeatChange(seatUsed);
    updated.seatUsed = state.seatUsed;
    updated.alarm = state.alarm;
  }

  const { seatTimeoutId, ...safeState } = state;
  res.json({ ok: true, updated, state: safeState });
});

// ===================
// 라우팅 (웹)
// ===================

// 상태 조회(JSON) – 두 페이지 공통 사용
app.get('/api/status', (req, res) => {
  const { seatTimeoutId, ...safeState } = state;
  res.json({ config, state: safeState });
});

// seatReserved 토글 – 예약 페이지에서 사용
app.post('/api/toggleSeatReserved', (req, res) => {
  state.seatReserved = !state.seatReserved;
  console.log('seatReserved 상태 변경:', state.seatReserved);
  res.json({ seatReserved: state.seatReserved });
});

// 기본/메뉴 페이지
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 온도 페이지
app.get('/temperature', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'temperature.html'));
});

// 좌석 예약 페이지
app.get('/reservation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reservation.html'));
});

// ===================
// 실행
// ===================
app.listen(PORT, () => {
  console.log(`✅ testChair server is running on port ${PORT}`);
});
