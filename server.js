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
  autoUnreserveSeconds: 30 // ✔ 30초 후 자동 예약 취소
};

const state = {
  temperature: null,
  acOn: false,
  fanOn: false,
  seatUsed: null,  // true: 앉아있음 / false 또는 null: 비어있음
  seatReserved: false,
  alarm: false,    // 지금은 사용하지 않지만 형태만 유지
  lastSeatChange: null,
  unreserveTimeoutId: null,
  lastEvent: null  // 'AUTO_UNRESERVE' | null
};

// ===================
// 로직 함수
// ===================

// 온도에 따라 팬/에어컨 제어
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

// 🔁 예약 자동 해제 타이머 설정
function scheduleAutoUnreserve() {
  // 기존 타이머 제거
  if (state.unreserveTimeoutId) {
    clearTimeout(state.unreserveTimeoutId);
    state.unreserveTimeoutId = null;
  }

  // 명확한 조건: seatUsed === false 또는 null → 비어있다고 처리
  const isSeatEmpty = (state.seatUsed === false || state.seatUsed === null);

  if (state.seatReserved === true && isSeatEmpty) {

    // 30초 후 재확인 후 취소
    state.unreserveTimeoutId = setTimeout(() => {
      const stillEmpty = (state.seatUsed === false || state.seatUsed === null);

      if (state.seatReserved === true && stillEmpty) {
        state.seatReserved = false;
        state.lastEvent = 'AUTO_UNRESERVE';

        console.log('⏰ 30초 동안 착석 없음(null/false) → 좌석 예약 자동 취소 (AUTO_UNRESERVE)');
      }
    }, config.autoUnreserveSeconds * 1000);

  }
}

// 좌석 상태 업데이트
function handleSeatChange(seatUsed) {
  state.seatUsed = seatUsed;
  state.lastSeatChange = Date.now();

  // 좌석 상태 바뀌면 자동취소 조건 재검사
  scheduleAutoUnreserve();
}

// ===================
// 아두이노 API
// ===================

// 아두이노 GET → seatReserved, fanOn 전달
app.get('/api/data', (req, res) => {
  res.json({
    seatReserved: state.seatReserved,
    fanOn: state.fanOn
  });
});

// 아두이노 POST → temperature, seatUsed 수신
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
    updated.fanOn = state.fanOn;
  }

  // 착석 상태 처리
  if (typeof seatUsed !== 'undefined') {
    if (typeof seatUsed !== 'boolean') {
      return res.status(400).json({ error: 'seatUsed는 true/false여야 합니다.' });
    }
    handleSeatChange(seatUsed);
    updated.seatUsed = state.seatUsed;
  }

  const { unreserveTimeoutId, ...safeState } = state;

  res.json({ ok: true, updated, state: safeState });
});

// ===================
// 웹 API
// ===================

// 전체 상태 조회 (웹에서 2초마다 호출)
app.get('/api/status', (req, res) => {
  const { unreserveTimeoutId, ...safeState } = state;
  res.json({ config, state: safeState });
});

// 예약 토글 버튼 (예약 페이지)
app.post('/api/toggleSeatReserved', (req, res) => {
  state.seatReserved = !state.seatReserved;
  console.log('seatReserved 상태 변경:', state.seatReserved);

  // 예약 상태 바꿀 때도 자동취소 타이머 재설정
  scheduleAutoUnreserve();

  res.json({ seatReserved: state.seatReserved });
});

// ===================
// 웹 페이지 라우팅
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
// 서버 시작
// ===================
app.listen(PORT, () => {
  console.log(`🚀 testChair server running on port ${PORT}`);
});
