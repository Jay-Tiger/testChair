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
  autoUnreserveSeconds: 30  // ✔ 30초 후 예약 자동 해제
};

const state = {
  temperature: null,
  acOn: false,
  fanOn: false,
  seatUsed: null,       // true: 앉아있음, false: 비어있음, null: 아직 모름
  alarm: false,         // 지금은 안 쓰지만 필드만 유지
  seatReserved: false,
  lastSeatChange: null,
  unreserveTimeoutId: null,
  lastEvent: null       // 'AUTO_UNRESERVE' | null (지금은 이거만 사용)
};

// ===================
// 공통 로직 함수
// ===================

// 온도에 따라 에어컨/팬 상태 결정
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
  // 기존 타이머 있으면 제거
  if (state.unreserveTimeoutId) {
    clearTimeout(state.unreserveTimeoutId);
    state.unreserveTimeoutId = null;
  }

  // 조건: "좌석은 비어 있고(seatUsed === false) + 예약은 걸려 있는 상태(seatReserved === true)"일 때만 타이머 설정
  if (state.seatReserved === true && state.seatUsed === false) {
    state.unreserveTimeoutId = setTimeout(() => {
      // 30초가 지난 시점에도 여전히 비어 있고 예약 상태면 취소
      if (state.seatReserved === true && state.seatUsed === false) {
        state.seatReserved = false;
        state.lastEvent = 'AUTO_UNRESERVE';
        console.log('⏰ 30초 자리 비움 → 좌석 예약 자동 취소 (AUTO_UNRESERVE)');
      }
    }, config.autoUnreserveSeconds * 1000);
  }
}

// 착석 상태 변경 로직
function handleSeatChange(seatUsed) {
  const now = Date.now();
  state.seatUsed = seatUsed;
  state.lastSeatChange = now;

  // 자리 상태가 바뀔 때마다 자동 취소 타이머 재설정
  scheduleAutoUnreserve();
}

// ===================
// 아두이노 API
// ===================

// 아두이노 GET: seatReserved, fanOn 전달
app.get('/api/data', (req, res) => {
  res.json({
    seatReserved: state.seatReserved,
    fanOn: state.fanOn
  });
});

// 아두이노 POST: temperature, seatUsed 수신
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

  // 좌석 사용 여부 처리
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
// 웹용 API
// ===================

// 상태 조회(JSON) – 세 페이지 공통 사용
app.get('/api/status', (req, res) => {
  const { unreserveTimeoutId, ...safeState } = state;
  res.json({ config, state: safeState });
});

// seatReserved 토글 – 예약 페이지/버튼에서 호출
app.post('/api/toggleSeatReserved', (req, res) => {
  // 예약 상태 토글
  state.seatReserved = !state.seatReserved;
  console.log('seatReserved 상태 변경:', state.seatReserved);

  // 토글 후에도 자동취소 조건을 다시 검사해서 타이머 재설정
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
