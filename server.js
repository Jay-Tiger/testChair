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
  absenceAlarmMinutes: 3,  // 알람 켜지는 시간(분)
  autoUnreserveMinutes: 5  // 예약 자동 해제 시간(분)
};

const state = {
  temperature: null,
  acOn: false,
  fanOn: false,            // 아두이노로 보내줄 팬 상태
  seatUsed: null,
  alarm: false,
  seatReserved: false,
  lastSeatChange: null,
  alarmTimeoutId: null,
  unreserveTimeoutId: null
};

// ===================
// 로직 함수
// ===================

// 온도에 따라 에어컨/팬 상태 결정
function updateACLogic(temp) {
  if (temp == null) return;

  // 에어컨 OFF → ON 구간
  if (!state.acOn && temp >= config.acOnTemp) {
    state.acOn = true;
    state.fanOn = true;   // 에어컨 켜질 때 팬도 ON
  }
  // 에어컨 ON → OFF 구간
  else if (state.acOn && temp <= config.acOffTemp) {
    state.acOn = false;
    state.fanOn = false;  // 에어컨 꺼질 때 팬도 OFF
  }
}

// 착석 상태 변경 로직
function handleSeatChange(seatUsed) {
  const now = Date.now();
  state.seatUsed = seatUsed;
  state.lastSeatChange = now;

  // 기존 타이머들 모두 삭제
  if (state.alarmTimeoutId) {
    clearTimeout(state.alarmTimeoutId);
    state.alarmTimeoutId = null;
  }
  if (state.unreserveTimeoutId) {
    clearTimeout(state.unreserveTimeoutId);
    state.unreserveTimeoutId = null;
  }

  if (!seatUsed) {
    // 자리 비워짐 → 알람 끄고, 일정 시간 뒤에 다시 켤 준비
    state.alarm = false;

    // 1) absenceAlarmMinutes 후 알람 ON 타이머
    state.alarmTimeoutId = setTimeout(() => {
      if (state.seatUsed === false) {
        state.alarm = true;
        console.log('⚠️ 3분 이상 자리 비움 → alarm = true');
      }
    }, config.absenceAlarmMinutes * 60 * 1000);

    // 2) autoUnreserveMinutes 후 seatReserved 자동 해제 타이머
    state.unreserveTimeoutId = setTimeout(() => {
      if (state.seatUsed === false && state.seatReserved === true) {
        state.seatReserved = false;
        console.log('⏰ 5분 이상 자리 비움 → seatReserved 자동 해제');
      }
    }, config.autoUnreserveMinutes * 60 * 1000);

  } else {
    // 사람이 다시 앉으면 알람 끔, 타이머는 위에서 이미 제거됨
    state.alarm = false;
  }
}

// ===================
// 라우팅 (아두이노용)
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

  // seatUsed 처리
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

// ===================
// 라우팅 (웹용 API)
// ===================

// 상태 조회(JSON) – 세 페이지 공통 사용
app.get('/api/status', (req, res) => {
  const { alarmTimeoutId, unreserveTimeoutId, ...safeState } = state;
  res.json({ config, state: safeState });
});

// seatReserved 토글 – 예약 페이지/버튼에서 호출
app.post('/api/toggleSeatReserved', (req, res) => {
  state.seatReserved = !state.seatReserved;
  console.log('seatReserved 상태 변경:', state.seatReserved);
  res.json({ seatReserved: state.seatReserved });
});

// ===================
// 라우팅 (웹 페이지)
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
  console.log(`✅ testChair server is running on port ${PORT}`);
});
