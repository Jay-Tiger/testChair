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
  acOffTemp: 22,
  autoUnreserveSeconds: 10   // ✔ 예약 ON + 자리비움 10초 유지 → 자동 해제
};

const state = {
  temperature: null,
  acOn: false,
  fanOn: false,

  // 착석 상태: true = 앉아있음, false/null = 비어있음으로 취급
  seatUsed: null,

  // 예약 상태
  seatReserved: false,

  lastSeatChange: null,
  unreserveTimeoutId: null
};

// ===================
// 공통 로직
// ===================

// 온도 → 에어컨 / 팬 상태 결정
function updateACLogic(temp) {
  if (temp == null) return;

  // 🔴 미예약이면 무조건 에어컨/팬 OFF
  if (!state.seatReserved) {
    state.acOn = false;
    state.fanOn = false;
    return;
  }

  // ✅ 예약된 상태에서만 온도 기준으로 제어
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
  // 기존 타이머가 있으면 제거
  if (state.unreserveTimeoutId) {
    clearTimeout(state.unreserveTimeoutId);
    state.unreserveTimeoutId = null;
  }

  // 조건: 예약 ON 이고, 자리가 비어 있다고 판단될 때(seatUsed !== true)
  if (state.seatReserved === true && state.seatUsed !== true) {
    state.unreserveTimeoutId = setTimeout(() => {
      // 10초 뒤에도 여전히 조건이 유지되면 예약 해제
      if (state.seatReserved === true && state.seatUsed !== true) {
        state.seatReserved = false;
        state.acOn = false;   // 🔴 예약 자동 취소 시 에어컨/팬 OFF
        state.fanOn = false;
        console.log('⏰ 10초 동안 착석 없음 → 좌석 예약 자동 취소 (에어컨 OFF)');
      }
    }, config.autoUnreserveSeconds * 1000);
  }
}

// seatUsed 변경 처리
function handleSeatChange(seatUsed) {
  const now = Date.now();
  state.seatUsed = seatUsed;
  state.lastSeatChange = now;

  // 자리 상태 바뀔 때마다 자동 취소 타이머 재설정
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
}

// ===================
// 웹 API
// ===================

// 상태 조회(JSON) – 세 페이지에서 공통 사용
app.get('/api/status', (req, res) => {
  const { unreserveTimeoutId, ...safeState } = state;
  res.json({ config, state: safeState });
});

// 예약 ON/OFF 버튼 – 예약 페이지에서 사용
app.post('/api/toggleSeatReserved', (req, res) => {
  state.seatReserved = !state.seatReserved;
  console.log('예약 상태 변경:', state.seatReserved);

  // 🔴 예약을 끈 순간 에어컨/팬 OFF
  if (!state.seatReserved) {
    state.acOn = false;
    state.fanOn = false;
  }

  // 예약 상태가 바뀌었으니 자동 취소 타이머 다시 검사
  scheduleAutoUnreserve();

  res.json({ seatReserved: state.seatReserved });
});

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
