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
  autoUnreserveSeconds: 10   // 10초 후 자동 해제
};

const state = {
  temperature: null,
  acOn: false,
  fanOn: false,
  seatUsed: null,            // true면 착석, false/null이면 비어있음
  seatReserved: false,
  lastSeatChange: null,
  unreserveTimeoutId: null,
  lastEvent: null            // 'AUTO_UNRESERVE'
};

// ===================
// 공통 로직 함수
// ===================

// 온도에 따른 냉방/팬 로직
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
  // 기존 타이머 제거
  if (state.unreserveTimeoutId) {
    clearTimeout(state.unreserveTimeoutId);
    state.unreserveTimeoutId = null;
  }

  // 예약이 켜져 있지 않은 경우 → 타이머 필요 없음
  if (!state.seatReserved) return;

  // ❗ seatUsed가 true면 착석 중 → 절대 자동취소 안 함
  if (state.seatUsed === true) {
    console.log("✔ 착석 상태이므로 자동취소 타이머를 실행하지 않습니다.");
    return;
  }

  // seatUsed가 false/null이고 예약이 true → 10초 후 자동취소 타이머 설정
  state.unreserveTimeoutId = setTimeout(() => {
    if (state.seatReserved === true && state.seatUsed !== true) {
      state.seatReserved = false;
      state.lastEvent = 'AUTO_UNRESERVE';
      console.log('⏰ 10초 지나도 착석 없음 → 좌석 예약 자동 취소');
    }
  }, config.autoUnreserveSeconds * 1000);

  console.log("⏳ 자동취소 타이머 시작 (10초)");
}

// 좌석 사용 여부 변경 처리
function handleSeatChange(seatUsed) {
  state.seatUsed = seatUsed;
  state.lastSeatChange = Date.now();

  if (seatUsed === true) {
    // 착석하면 자동 취소 타이머 즉시 제거
    if (state.unreserveTimeoutId) {
      clearTimeout(state.unreserveTimeoutId);
      state.unreserveTimeoutId = null;
    }
    console.log("👤 착석 감지 → 예약 자동취소 비활성화");
    return;
  }

  // seatUsed = false이면 자동취소 가능 상태 → 다시 타이머 설정
  scheduleAutoUnreserve();
}

// ===================
// 아두이노 API
// ===================

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

  if (typeof temperature !== 'undefined') {
    if (typeof temperature !== 'number')
      return res.status(400).json({ error: 'temperature는 숫자여야 합니다.' });
    state.temperature = temperature;
    updateACLogic(temperature);
  }

  if (typeof seatUsed !== 'undefined') {
    if (typeof seatUsed !== 'boolean')
      return res.status(400).json({ error: 'seatUsed는 true/false여야 합니다.' });
    handleSeatChange(seatUsed);
  }

  res.json({ ok: true, state });
});

// ===================
// 웹페이지 API
// ===================

app.get('/api/status', (req, res) => {
  res.json({ config, state });
});

// seatReserved 토글 버튼 (예약 페이지)
app.post('/api/toggleSeatReserved', (req, res) => {
  state.seatReserved = !state.seatReserved;
  console.log("seatReserved 변경:", state.seatReserved);
  scheduleAutoUnreserve();
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
