const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------
// 1. 서버 설정 & 상태
// ---------------------------
const config = {
  acOnTemp: 27,
  acOffTemp: 24,
  absenceAlarmMinutes: 3
};

const state = {
  temperature: null,
  acOn: false,
  seatUsed: null,
  alarm: false,
  seatReserved: false,  // ✅ 이 값만 아두이노로 전송
  lastSeatChange: null,
  seatTimeoutId: null
};

// ---------------------------
// 2. 로직 함수
// ---------------------------

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
      if (state.seatUsed === false) state.alarm = true;
    }, config.absenceAlarmMinutes * 60 * 1000);
  } else {
    state.alarm = false;
  }
}

// ---------------------------
// 3. 라우팅
// ---------------------------

// ✅ (아두이노용) GET /api/data: seatReserved만 보내줌
app.get('/api/data', (req, res) => {
  res.json({ seatReserved: state.seatReserved });
});

// ✅ (아두이노용) POST /api/data: temperature, seatUsed 받기
app.post('/api/data', (req, res) => {
  const { temperature, seatUsed } = req.body;
  const updated = {};

  // 온도 처리
  if (typeof temperature !== 'undefined') {
    if (typeof temperature !== 'number') {
      return res.status(400).json({ error: 'temperature는 숫자여야 합니다.' });
    }
    state.temperature = temperature;
    updateACLogic(temperature);
    updated.temperature = state.temperature;
    updated.acOn = state.acOn;
  }

  // seatUsed 처리
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

// (웹) 메인 페이지
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ✅ seatReserved 값을 토글하는 웹용 API
app.post('/api/toggleSeatReserved', (req, res) => {
  state.seatReserved = !state.seatReserved;
  console.log('seatReserved 상태 변경:', state.seatReserved);
  res.json({ seatReserved: state.seatReserved });
});

// (웹) 상태 조회
app.get('/api/status', (req, res) => {
  const { seatTimeoutId, ...safeState } = state;
  res.json({ config, state: safeState });
});

// ---------------------------
// 4. 서버 실행
// ---------------------------
app.listen(PORT, () => {
  console.log(`✅ testChair server is running on http://localhost:${PORT}`);
});
