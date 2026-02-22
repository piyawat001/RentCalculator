import { useEffect, useMemo, useState } from 'react';
import { APPS_SCRIPT_PROXY_PATH, APPS_SCRIPT_URL } from '../shared/app-config.js';

const STORAGE_KEYS = {
  readings: 'rent-calculator:meter-readings',
  logs: 'rent-calculator:logs',
};

const ROOM_NO = 'ROOM-1';

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const formatNumber = (num) => toNumber(num).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('th-TH') : '-');

const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const loadJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const saveJson = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const sortByUpdatedDesc = (items) =>
  [...items].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));

const RentCalculator = () => {
  const [roomPrice, setRoomPrice] = useState(2500);
  const [waterPrice, setWaterPrice] = useState(100);
  const [prevElectricUnit, setPrevElectricUnit] = useState(595);
  const [currentElectricUnit, setCurrentElectricUnit] = useState(652);
  const [electricRate, setElectricRate] = useState(6);
  const [targetBudget, setTargetBudget] = useState(2800);
  const [billingMonth, setBillingMonth] = useState(getCurrentMonth());
  const [note, setNote] = useState('');

  const [currentDay, setCurrentDay] = useState(0);
  const [totalDaysInMonth, setTotalDaysInMonth] = useState(30);

  const [history, setHistory] = useState([]);
  const [logs, setLogs] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [debugLogs, setDebugLogs] = useState([]);
  const [activeTab, setActiveTab] = useState('entry');

  const appsScriptUrl = APPS_SCRIPT_URL;
  const requestUrl = APPS_SCRIPT_PROXY_PATH;

  const electricUnitsUsed = Math.max(0, currentElectricUnit - prevElectricUnit);
  const electricCost = electricUnitsUsed * electricRate;
  const totalCost = roomPrice + waterPrice + electricCost;

  const budgetForElectric = Math.max(0, targetBudget - roomPrice - waterPrice);
  const maxElectricUnitsForMonth = electricRate > 0 ? budgetForElectric / electricRate : 0;
  const electricUnitsPerDay = totalDaysInMonth > 0 ? maxElectricUnitsForMonth / totalDaysInMonth : 0;
  const remainingDays = Math.max(0, totalDaysInMonth - currentDay);
  const remainingElectricUnits = Math.max(0, remainingDays * electricUnitsPerDay);

  const isOverBudget = totalCost > targetBudget;
  const isNearBudget = totalCost > targetBudget * 0.9;
  const budgetStatus = isOverBudget ? 'over' : isNearBudget ? 'near' : 'ok';

  const latestReading = useMemo(() => sortByUpdatedDesc(history)[0] || null, [history]);

  const addDebugLog = (step, detail) => {
    const line = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      step,
      detail,
    };
    setDebugLogs((prev) => [line, ...prev].slice(0, 30));
  };

  const appendLog = (action, detail) => {
    const item = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      actor: 'owner',
      detail,
    };
    setLogs((prev) => {
      const next = [item, ...prev].slice(0, 200);
      saveJson(STORAGE_KEYS.logs, next);
      return next;
    });
  };

  const applyLatestReadingToForm = (reading) => {
    if (!reading) return;
    const latestUnit = toNumber(reading.currentElectricUnit, 0);
    setPrevElectricUnit(latestUnit);
    setCurrentElectricUnit(latestUnit);
    setRoomPrice(toNumber(reading.roomPrice, 2500));
    setWaterPrice(toNumber(reading.waterPrice, 100));
    setElectricRate(toNumber(reading.electricRate, 6));
    setTargetBudget(toNumber(reading.targetBudget, 2800));
  };

  const fetchRemote = async (method, payload) => {
    if (!appsScriptUrl) throw new Error('ยังไม่ได้ตั้งค่า APPS_SCRIPT_URL ในโค้ด');
    addDebugLog('request:start', { method, payload, url: requestUrl, directUrl: appsScriptUrl });

    let response;
    try {
      response = await fetch(requestUrl, {
        method,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: payload ? JSON.stringify(payload) : undefined,
      });
    } catch (error) {
      addDebugLog('request:network-error', {
        name: error?.name,
        message: error?.message,
        hint: 'มักเป็น CORS, สิทธิ์ Web App, หรือ browser บล็อก request',
      });
      throw error;
    }

    addDebugLog('request:response', { status: response.status, ok: response.ok, redirected: response.redirected });

    if (!response.ok) {
      throw new Error(`เชื่อมต่อ Google Sheets ไม่สำเร็จ (${response.status})`);
    }

    const text = await response.text();
    addDebugLog('request:raw-text', text.slice(0, 300));
    try {
      const parsed = JSON.parse(text);
      addDebugLog('request:parsed', { ok: parsed?.ok, keys: Object.keys(parsed || {}) });
      return parsed;
    } catch {
      addDebugLog('request:parse-error', text.slice(0, 300));
      throw new Error('รูปแบบ response จาก Apps Script ไม่ถูกต้อง');
    }
  };

  const testGoogleSheetsConnection = async () => {
    setSyncMessage('');
    if (!appsScriptUrl) {
      setSyncMessage('ยังไม่ตั้งค่า Google Sheets URL ในโค้ด');
      return;
    }

    try {
      const result = await fetchRemote('POST', { action: 'listReadings', roomNo: ROOM_NO });
      setSyncMessage(result?.ok ? 'ทดสอบเชื่อมต่อสำเร็จ' : `ทดสอบไม่ผ่าน: ${result?.error || 'Unknown error'}`);
    } catch (error) {
      setSyncMessage(`ทดสอบไม่ผ่าน: ${error?.message || 'Failed to fetch'}`);
    }
  };

  const syncFromGoogleSheets = async () => {
    if (!appsScriptUrl) {
      setSyncMessage('ยังไม่ตั้งค่า Google Sheets URL ในโค้ด (ใช้ local ได้ปกติ)');
      return;
    }

    setIsSyncing(true);
    setSyncMessage('');
    try {
      const result = await fetchRemote('POST', { action: 'listReadings', roomNo: ROOM_NO });
      if (!result?.ok) throw new Error(result?.error || 'โหลดข้อมูลไม่สำเร็จ');

      const remoteReadings = sortByUpdatedDesc(result.readings || []);
      const remoteLogs = Array.isArray(result.logs) ? result.logs : [];

      setHistory(remoteReadings);
      setLogs(remoteLogs);
      saveJson(STORAGE_KEYS.readings, remoteReadings);
      saveJson(STORAGE_KEYS.logs, remoteLogs);

      if (remoteReadings.length > 0) {
        applyLatestReadingToForm(remoteReadings[0]);
      }
      setSyncMessage(`ซิงก์สำเร็จ ${remoteReadings.length} รายการ`);
    } catch (error) {
      addDebugLog('sync:error', { message: error?.message, stack: error?.stack?.split('\n').slice(0, 2).join(' | ') });
      setSyncMessage(error.message || 'ซิงก์ไม่สำเร็จ');
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    const today = new Date();
    const currentDate = today.getDate();
    const year = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    setCurrentDay(currentDate);
    setTotalDaysInMonth(daysInMonth);
    const readings = sortByUpdatedDesc(loadJson(STORAGE_KEYS.readings, []));
    setHistory(readings);
    const localLogs = loadJson(STORAGE_KEYS.logs, []);
    setLogs(localLogs);
    if (readings.length > 0) {
      applyLatestReadingToForm(readings[0]);
    }
  }, []);

  const handleUseLatestAsPrevious = () => {
    if (!latestReading) return;
    const latestUnit = toNumber(latestReading.currentElectricUnit, prevElectricUnit);
    setPrevElectricUnit(latestUnit);
    setCurrentElectricUnit(latestUnit);
    setSaveMessage(`ดึงเลขล่าสุด ${latestReading.currentElectricUnit} มาเป็น "เดือนที่แล้ว" แล้ว`);
  };

  const buildCurrentRecord = () => {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      roomNo: ROOM_NO,
      billingMonth,
      roomPrice,
      waterPrice,
      prevElectricUnit,
      currentElectricUnit,
      electricRate,
      targetBudget,
      electricUnitsUsed,
      electricCost,
      totalCost,
      note,
      createdAt: now,
      updatedAt: now,
    };
  };

  const handleSaveReading = async () => {
    if (currentElectricUnit < prevElectricUnit) {
      setSaveMessage('หน่วยไฟเดือนนี้ต้องไม่น้อยกว่าเดือนที่แล้ว');
      return;
    }

    setIsSaving(true);
    setSaveMessage('');

    const record = buildCurrentRecord();
    const before = latestReading || null;

    try {
      setHistory((prev) => {
        const withoutSameMonth = prev.filter((item) => !(item.roomNo === ROOM_NO && item.billingMonth === billingMonth));
        const next = sortByUpdatedDesc([record, ...withoutSameMonth]);
        saveJson(STORAGE_KEYS.readings, next);
        return next;
      });

      appendLog('SAVE_READING', {
        roomNo: ROOM_NO,
        billingMonth,
        before,
        after: record,
      });

      if (appsScriptUrl) {
        addDebugLog('save:remote-start', { billingMonth: record.billingMonth, currentElectricUnit: record.currentElectricUnit });
        const result = await fetchRemote('POST', {
          action: 'saveReading',
          record,
          actor: 'owner',
        });
        if (!result?.ok) throw new Error(result?.error || 'บันทึกลง Google Sheets ไม่สำเร็จ');
      }

      setSaveMessage('บันทึกข้อมูลเรียบร้อย');
      setPrevElectricUnit(currentElectricUnit);
      setCurrentElectricUnit(currentElectricUnit);
      setNote('');
    } catch (error) {
      addDebugLog('save:error', { message: error?.message });
      setSaveMessage(error.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setIsSaving(false);
    }
  };

  const tabs = [
    { id: 'entry', label: 'กรอกข้อมูล', icon: '📝' },
    { id: 'plan', label: 'แผนใช้ไฟ', icon: '📅' },
    { id: 'history', label: 'ย้อนหลัง', icon: '📚' },
    { id: 'logs', label: 'Logs', icon: '🧾' },
    { id: 'sync', label: 'เชื่อมต่อ', icon: '🔗' },
  ];

  const statusUI = {
    ok: {
      badge: 'อยู่ในงบ',
      border: 'border-emerald-300',
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      ring: 'ring-emerald-300',
    },
    near: {
      badge: 'ใกล้เกินงบ',
      border: 'border-amber-300',
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      ring: 'ring-amber-300',
    },
    over: {
      badge: 'เกินงบ',
      border: 'border-rose-300',
      bg: 'bg-rose-50',
      text: 'text-rose-700',
      ring: 'ring-rose-300',
    },
  }[budgetStatus];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1f2937_0%,#0b1220_55%,#05070c_100%)] pb-24">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-5 rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-zinc-200">
                <span>🏠</span>
                <span>Rent Calculator Workspace</span>
              </div>
              <h1 className="text-2xl font-black tracking-tight text-white sm:text-4xl">คำนวณค่าห้องเช่า</h1>
              <p className="mt-2 text-sm text-zinc-300 sm:text-base">
                แยกเป็นแท็บสำหรับกรอกข้อมูล, วางแผน, ดูย้อนหลัง และจัดการการเชื่อมต่อ ใช้งานมือถือได้ง่ายขึ้น
              </p>
            </div>
            <div className={`rounded-2xl border ${statusUI.border} ${statusUI.bg} px-4 py-3`}>
              <div className={`text-xs font-semibold ${statusUI.text}`}>สถานะงบประมาณ</div>
              <div className={`mt-1 text-lg font-bold ${statusUI.text}`}>{statusUI.badge}</div>
              <div className="mt-1 text-sm text-zinc-700">รวม {formatNumber(totalCost)} บาท</div>
            </div>
          </div>
        </header>

        <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <div className="text-xs text-zinc-400">รวมทั้งหมด</div>
            <div className="mt-1 text-2xl font-bold text-white">{formatNumber(totalCost)}</div>
            <div className="text-xs text-zinc-400">บาท</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <div className="text-xs text-zinc-400">ใช้ไฟเดือนนี้</div>
            <div className="mt-1 text-2xl font-bold text-white">{electricUnitsUsed}</div>
            <div className="text-xs text-zinc-400">หน่วย</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <div className="text-xs text-zinc-400">เดือนบิล</div>
            <div className="mt-1 text-lg font-bold text-white">{billingMonth}</div>
            <div className="text-xs text-zinc-400">ห้อง {ROOM_NO}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <div className="text-xs text-zinc-400">ข้อมูลย้อนหลัง</div>
            <div className="mt-1 text-2xl font-bold text-white">{history.length}</div>
            <div className="text-xs text-zinc-400">รายการ</div>
          </div>
        </section>

        <nav className="sticky top-3 z-20 mb-5 rounded-2xl border border-white/10 bg-zinc-950/70 p-2 backdrop-blur-xl">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                    active
                      ? 'bg-white text-zinc-900 shadow'
                      : 'bg-white/0 text-zinc-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <span className="mr-1">{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {activeTab === 'entry' && (
          <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl bg-white p-5 shadow-2xl sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-zinc-900 sm:text-2xl">📝 กรอกข้อมูลเดือนนี้</h2>
                  <p className="text-sm text-zinc-500">บันทึกค่าเช่า/น้ำ/ไฟ และใช้เลขหน่วยล่าสุดได้ทันที</p>
                </div>
                {latestReading && (
                  <button
                    type="button"
                    onClick={handleUseLatestAsPrevious}
                    className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700"
                  >
                    ใช้เลขล่าสุด
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-zinc-700">📆 เดือนบิล</label>
                  <input
                    type="month"
                    value={billingMonth}
                    onChange={(e) => setBillingMonth(e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-lg"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">🏠 ค่าห้อง (บาท)</label>
                  <input
                    type="number"
                    value={roomPrice}
                    onChange={(e) => setRoomPrice(toNumber(e.target.value))}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-lg"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">💧 ค่าน้ำ (บาท)</label>
                  <input
                    type="number"
                    value={waterPrice}
                    onChange={(e) => setWaterPrice(toNumber(e.target.value))}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-lg"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">⚡ หน่วยไฟเดือนที่แล้ว</label>
                  <input
                    type="number"
                    value={prevElectricUnit}
                    onChange={(e) => setPrevElectricUnit(toNumber(e.target.value))}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-lg"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">⚡ หน่วยไฟเดือนนี้</label>
                  <input
                    type="number"
                    value={currentElectricUnit}
                    onChange={(e) => setCurrentElectricUnit(toNumber(e.target.value))}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-lg"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">🔥 ค่าไฟต่อหน่วย</label>
                  <input
                    type="number"
                    step="0.1"
                    value={electricRate}
                    onChange={(e) => setElectricRate(toNumber(e.target.value))}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-lg"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-zinc-700">🎯 เป้าหมายค่าใช้จ่าย</label>
                  <input
                    type="number"
                    value={targetBudget}
                    onChange={(e) => setTargetBudget(toNumber(e.target.value))}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-zinc-700">📝 หมายเหตุ</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-zinc-300 px-4 py-3"
                    placeholder="เช่น เดือนนี้เปิดแอร์เยอะ"
                  />
                </div>
              </div>

              {latestReading && (
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                  ล่าสุดในระบบ: เดือน {latestReading.billingMonth} | หน่วยไฟเดือนนี้ {latestReading.currentElectricUnit}
                </div>
              )}

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                <button
                  type="button"
                  onClick={handleSaveReading}
                  disabled={isSaving}
                  className="rounded-2xl bg-emerald-600 px-5 py-3 text-lg font-bold text-white disabled:bg-emerald-300"
                >
                  {isSaving ? 'กำลังบันทึก...' : 'บันทึกข้อมูลเดือนนี้'}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className="rounded-2xl border border-zinc-300 px-5 py-3 font-semibold text-zinc-700"
                >
                  ดูย้อนหลัง
                </button>
              </div>

              {saveMessage && <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">{saveMessage}</div>}
            </div>

            <div className="space-y-5">
              <div className={`rounded-3xl border-2 ${statusUI.border} ${statusUI.bg} p-5 shadow-xl`}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-lg font-bold text-zinc-900">💰 สรุปค่าใช้จ่าย</h3>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusUI.bg} ${statusUI.text}`}>
                    {statusUI.badge}
                  </span>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between border-b border-zinc-200 pb-2">
                    <span className="text-zinc-600">ค่าห้อง</span>
                    <span className="font-semibold">{formatNumber(roomPrice)} บาท</span>
                  </div>
                  <div className="flex justify-between border-b border-zinc-200 pb-2">
                    <span className="text-zinc-600">ค่าน้ำ</span>
                    <span className="font-semibold">{formatNumber(waterPrice)} บาท</span>
                  </div>
                  <div className="flex justify-between border-b border-zinc-200 pb-2">
                    <span className="text-zinc-600">ค่าไฟ ({electricUnitsUsed} หน่วย)</span>
                    <span className="font-semibold">{formatNumber(electricCost)} บาท</span>
                  </div>
                  <div className="mt-2 rounded-2xl bg-white/80 p-4">
                    <div className="text-xs text-zinc-500">รวมทั้งหมด</div>
                    <div className={`text-3xl font-black ${statusUI.text}`}>{formatNumber(totalCost)} บาท</div>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-400 p-5 text-white shadow-2xl">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-bold">⚡ ภาพรวมการใช้ไฟ</h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab('plan')}
                    className="rounded-full border border-white/40 bg-white/15 px-3 py-1 text-xs font-semibold"
                  >
                    เปิดแท็บแผนใช้ไฟ
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-white/20 p-3">
                    <div className="text-xs opacity-90">วันนี้</div>
                    <div className="text-xl font-bold">{currentDay}</div>
                  </div>
                  <div className="rounded-2xl bg-white/20 p-3">
                    <div className="text-xs opacity-90">วันในเดือน</div>
                    <div className="text-xl font-bold">{totalDaysInMonth}</div>
                  </div>
                  <div className="rounded-2xl bg-white/20 p-3">
                    <div className="text-xs opacity-90">เหลือใช้ได้</div>
                    <div className="text-xl font-bold">{formatNumber(remainingElectricUnits)}</div>
                    <div className="text-[11px] opacity-80">หน่วย</div>
                  </div>
                  <div className="rounded-2xl bg-white/20 p-3">
                    <div className="text-xs opacity-90">หน่วย/วันแนะนำ</div>
                    <div className="text-xl font-bold">{electricUnitsPerDay.toFixed(1)}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'plan' && (
          <section className="space-y-5">
            <div className="rounded-3xl bg-white p-5 shadow-2xl sm:p-6">
              <h2 className="text-xl font-bold text-zinc-900 sm:text-2xl">📅 แผนใช้ไฟตามงบ</h2>
              <p className="mt-1 text-sm text-zinc-500">ดูงบค่าไฟที่เหลือและจำนวนหน่วยที่ควรใช้ต่อวันสำหรับเดือนนี้</p>
              <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-xs text-zinc-500">งบค่าไฟที่เหลือ</div>
                  <div className="mt-1 text-2xl font-bold text-zinc-900">{formatNumber(budgetForElectric)}</div>
                  <div className="text-xs text-zinc-500">บาท</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-xs text-zinc-500">หน่วยไฟใช้ได้ทั้งเดือน</div>
                  <div className="mt-1 text-2xl font-bold text-zinc-900">{formatNumber(maxElectricUnitsForMonth)}</div>
                  <div className="text-xs text-zinc-500">หน่วย</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-xs text-zinc-500">หน่วยไฟต่อวัน</div>
                  <div className="mt-1 text-2xl font-bold text-zinc-900">{electricUnitsPerDay.toFixed(1)}</div>
                  <div className="text-xs text-zinc-500">หน่วย/วัน</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-xs text-zinc-500">วันที่เหลือ</div>
                  <div className="mt-1 text-2xl font-bold text-zinc-900">{remainingDays}</div>
                  <div className="text-xs text-zinc-500">วัน</div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-zinc-100 shadow-xl backdrop-blur">
              <h3 className="text-lg font-bold">คำแนะนำเร็ว</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm text-zinc-300">เลขเดือนก่อน</div>
                  <div className="mt-1 text-2xl font-bold">{prevElectricUnit}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm text-zinc-300">เลขเดือนนี้</div>
                  <div className="mt-1 text-2xl font-bold">{currentElectricUnit}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm text-zinc-300">ค่าไฟต่อหน่วย</div>
                  <div className="mt-1 text-2xl font-bold">{electricRate}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm text-zinc-300">เป้าหมายรวม</div>
                  <div className="mt-1 text-2xl font-bold">{formatNumber(targetBudget)}฿</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'history' && (
          <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl bg-white p-5 shadow-2xl sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-zinc-900 sm:text-2xl">📚 ประวัติย้อนหลัง</h2>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">
                  {history.length} รายการ
                </span>
              </div>
              <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
                {history.length === 0 && <div className="rounded-xl border border-zinc-200 p-4 text-zinc-500">ยังไม่มีข้อมูลที่บันทึก</div>}
                {history.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setBillingMonth(item.billingMonth);
                      setRoomPrice(toNumber(item.roomPrice));
                      setWaterPrice(toNumber(item.waterPrice));
                      setPrevElectricUnit(toNumber(item.prevElectricUnit));
                      setCurrentElectricUnit(toNumber(item.currentElectricUnit));
                      setElectricRate(toNumber(item.electricRate));
                      setTargetBudget(toNumber(item.targetBudget));
                      setNote(item.note || '');
                      setActiveTab('entry');
                    }}
                    className="w-full rounded-2xl border border-zinc-200 p-4 text-left transition hover:border-zinc-400 hover:bg-zinc-50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-bold text-zinc-900">เดือน {item.billingMonth}</div>
                      <div className="text-xs text-zinc-500">{formatDateTime(item.updatedAt)}</div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-zinc-700 sm:grid-cols-4">
                      <div>ก่อน: {item.prevElectricUnit}</div>
                      <div>ปัจจุบัน: {item.currentElectricUnit}</div>
                      <div>ใช้: {item.electricUnitsUsed}</div>
                      <div>รวม: {formatNumber(item.totalCost)}฿</div>
                    </div>
                    {item.note && <div className="mt-2 text-xs text-zinc-500">โน้ต: {item.note}</div>}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-zinc-100 shadow-xl backdrop-blur">
                <h3 className="text-lg font-bold">เลขล่าสุดสำหรับเดือนถัดไป</h3>
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                  {latestReading ? (
                    <>
                      <div className="text-sm text-zinc-300">เดือนล่าสุด</div>
                      <div className="mt-1 text-xl font-bold">{latestReading.billingMonth}</div>
                      <div className="mt-3 text-sm text-zinc-300">หน่วยไฟเดือนนี้ (ใช้เป็นเดือนที่แล้วได้)</div>
                      <div className="text-3xl font-black">{latestReading.currentElectricUnit}</div>
                      <button
                        type="button"
                        onClick={() => {
                          handleUseLatestAsPrevious();
                          setActiveTab('entry');
                        }}
                        className="mt-4 rounded-xl bg-blue-500 px-4 py-2 text-sm font-bold text-white"
                      >
                        ใช้เลขนี้ในฟอร์ม
                      </button>
                    </>
                  ) : (
                    <div className="text-sm text-zinc-300">ยังไม่มีข้อมูลย้อนหลัง</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'logs' && (
          <section className="rounded-3xl bg-white p-5 shadow-2xl sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-zinc-900 sm:text-2xl">🧾 Activity Logs</h2>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">{logs.length} logs</span>
            </div>
            <div className="space-y-3 max-h-[70vh] overflow-auto pr-1">
              {logs.length === 0 && <div className="rounded-xl border border-zinc-200 p-4 text-zinc-500">ยังไม่มี log</div>}
              {logs.map((log) => (
                <div key={log.id} className="rounded-2xl border border-zinc-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-bold text-white">{log.action}</div>
                    <div className="text-xs text-zinc-500">{formatDateTime(log.timestamp)}</div>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
                    <div>ผู้ใช้: {log.actor || '-'}</div>
                    <div>เดือน: {log.detail?.billingMonth || log.billingMonth || '-'}</div>
                    <div>ห้อง: {log.detail?.roomNo || log.roomNo || ROOM_NO}</div>
                    <div>หน่วยไฟ: {log.detail?.after?.currentElectricUnit || '-'}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'sync' && (
          <section className="space-y-5">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-zinc-100 shadow-xl backdrop-blur sm:p-6">
              <h2 className="text-xl font-bold sm:text-2xl">🔗 Google Sheets Sync</h2>
              <p className="mt-2 text-sm text-zinc-300">ใช้แท็บนี้สำหรับทดสอบการเชื่อมต่อ, ซิงก์ข้อมูลจากชีต และดู debug log</p>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs text-zinc-400">Apps Script URL</div>
                <div className="mt-1 break-all text-sm text-zinc-100">{appsScriptUrl || 'ยังไม่ตั้งค่า'}</div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={testGoogleSheetsConnection}
                  disabled={!appsScriptUrl}
                  className="rounded-2xl bg-zinc-800 px-4 py-3 font-semibold text-white disabled:opacity-60"
                >
                  ทดสอบการเชื่อมต่อ
                </button>
                <button
                  type="button"
                  onClick={syncFromGoogleSheets}
                  disabled={isSyncing || !appsScriptUrl}
                  className="rounded-2xl bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
                >
                  {isSyncing ? 'กำลังซิงก์...' : 'ซิงก์จาก Google Sheets'}
                </button>
              </div>

              {syncMessage && (
                <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  {syncMessage}
                </div>
              )}
            </div>

            <details className="rounded-3xl border border-zinc-800 bg-zinc-950/80 p-5 text-zinc-100" open>
              <summary className="cursor-pointer list-none text-lg font-bold">Debug Log</summary>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => setDebugLogs([])}
                  className="rounded-lg bg-zinc-800 px-3 py-1 text-xs font-semibold"
                >
                  ล้าง log
                </button>
              </div>
              <div className="mt-3 space-y-2 max-h-[45vh] overflow-auto pr-1 text-xs">
                {debugLogs.length === 0 && <div className="rounded-xl border border-zinc-800 p-3 text-zinc-400">ยังไม่มี debug log</div>}
                {debugLogs.map((item) => (
                  <div key={item.id} className="rounded-xl border border-zinc-800 p-3">
                    <div className="text-zinc-300">
                      {formatDateTime(item.timestamp)} | <span className="text-cyan-300">{item.step}</span>
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap break-words text-zinc-400">
                      {typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          </section>
        )}

        <div className="mt-6 text-center text-xs text-zinc-500">
          <p>ใช้แท็บล่าง/ด้านบนเพื่อสลับงานแต่ละส่วน แทนการเลื่อนหน้าเดียวที่ยาว</p>
        </div>
      </div>
    </div>
  );
};

export default RentCalculator;
