import { useEffect, useMemo, useState } from 'react';

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

  const appsScriptUrl = (import.meta.env.VITE_APPS_SCRIPT_URL || '').trim();
  const requestUrl =
    import.meta.env.DEV && appsScriptUrl.startsWith('https://script.google.com') ? '/apps-script-proxy' : appsScriptUrl;

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
    setPrevElectricUnit(toNumber(reading.currentElectricUnit, 0));
    setRoomPrice(toNumber(reading.roomPrice, 2500));
    setWaterPrice(toNumber(reading.waterPrice, 100));
    setElectricRate(toNumber(reading.electricRate, 6));
    setTargetBudget(toNumber(reading.targetBudget, 2800));
  };

  const fetchRemote = async (method, payload) => {
    if (!appsScriptUrl) throw new Error('ยังไม่ได้ตั้งค่า VITE_APPS_SCRIPT_URL');
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
      setSyncMessage('ยังไม่ตั้งค่า Google Sheets URL');
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
      setSyncMessage('ยังไม่ตั้งค่า Google Sheets URL (ใช้ local ได้ปกติ)');
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
    setPrevElectricUnit(toNumber(latestReading.currentElectricUnit, prevElectricUnit));
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
      setNote('');
    } catch (error) {
      addDebugLog('save:error', { message: error?.message });
      setSaveMessage(error.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-black p-4">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">🏠 คำนวณค่าห้องเช่า</h1>
          <p className="text-gray-300">บันทึกย้อนหลังได้ และดึงเลขหน่วยไฟล่าสุดมาใช้เดือนถัดไป</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4 mb-6 text-sm text-zinc-200">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
            <div>
              <div className="font-semibold">Google Sheets Sync (optional)</div>
              <div className="text-zinc-400 break-all">
                {appsScriptUrl ? `เชื่อม URL แล้ว: ${appsScriptUrl}` : 'ยังไม่ตั้งค่า `VITE_APPS_SCRIPT_URL` (ตอนนี้จะบันทึกในเครื่องด้วย localStorage)'}
              </div>
            </div>
            <button
              type="button"
              onClick={syncFromGoogleSheets}
              disabled={isSyncing || !appsScriptUrl}
              className="px-4 py-2 rounded-lg bg-blue-600 disabled:bg-zinc-700 text-white font-medium"
            >
              {isSyncing ? 'กำลังซิงก์...' : 'ซิงก์จาก Google Sheets'}
            </button>
            <button
              type="button"
              onClick={testGoogleSheetsConnection}
              disabled={!appsScriptUrl}
              className="px-4 py-2 rounded-lg bg-zinc-700 disabled:bg-zinc-700/50 text-white font-medium"
            >
              ทดสอบการเชื่อมต่อ
            </button>
          </div>
          {syncMessage && <div className="mt-2 text-emerald-300">{syncMessage}</div>}
          <div className="mt-3 bg-black/30 border border-zinc-700 rounded-xl p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="font-semibold text-zinc-100">Debug Log</div>
              <button
                type="button"
                onClick={() => setDebugLogs([])}
                className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-200"
              >
                ล้าง log
              </button>
            </div>
            <div className="space-y-2 max-h-40 overflow-auto pr-1 text-xs">
              {debugLogs.length === 0 && <div className="text-zinc-400">ยังไม่มี debug log</div>}
              {debugLogs.map((item) => (
                <div key={item.id} className="border border-zinc-800 rounded p-2">
                  <div className="text-zinc-300">
                    {formatDateTime(item.timestamp)} | <span className="text-cyan-300">{item.step}</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words text-zinc-400 mt-1">
                    {typeof item.detail === 'string' ? item.detail : JSON.stringify(item.detail, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-1 bg-white rounded-3xl shadow-2xl p-8">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">💡 ข้อมูลค่าใช้จ่าย</h2>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">📆 เดือนบิล</label>
                <input
                  type="month"
                  value={billingMonth}
                  onChange={(e) => setBillingMonth(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">🏠 ค่าห้อง (บาท)</label>
                <input
                  type="number"
                  value={roomPrice}
                  onChange={(e) => setRoomPrice(toNumber(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">💧 ค่าน้ำ (บาท)</label>
                <input
                  type="number"
                  value={waterPrice}
                  onChange={(e) => setWaterPrice(toNumber(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">⚡ หน่วยไฟเดือนที่แล้ว</label>
                  <input
                    type="number"
                    value={prevElectricUnit}
                    onChange={(e) => setPrevElectricUnit(toNumber(e.target.value))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">⚡ หน่วยไฟเดือนนี้</label>
                  <input
                    type="number"
                    value={currentElectricUnit}
                    onChange={(e) => setCurrentElectricUnit(toNumber(e.target.value))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleUseLatestAsPrevious}
                  disabled={!latestReading}
                  className="flex-1 px-4 py-2 rounded-lg bg-zinc-800 text-white disabled:bg-zinc-400"
                >
                  ใช้เลขล่าสุดเป็นเดือนที่แล้ว
                </button>
              </div>

              {latestReading && (
                <div className="text-sm bg-blue-50 text-blue-800 border border-blue-200 rounded-lg p-3">
                  ล่าสุด: เดือน {latestReading.billingMonth} | หน่วยไฟเดือนนี้ {latestReading.currentElectricUnit}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">🔥 ค่าไฟต่อหน่วย (บาท)</label>
                <input
                  type="number"
                  step="0.1"
                  value={electricRate}
                  onChange={(e) => setElectricRate(toNumber(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">🎯 เป้าหมายค่าใช้จ่าย (บาท)</label>
                <input
                  type="number"
                  value={targetBudget}
                  onChange={(e) => setTargetBudget(toNumber(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">📝 หมายเหตุ (optional)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                  placeholder="เช่น เดือนนี้เปิดแอร์เยอะ"
                />
              </div>

              <button
                type="button"
                onClick={handleSaveReading}
                disabled={isSaving}
                className="w-full px-4 py-3 rounded-xl bg-emerald-600 text-white font-bold text-lg disabled:bg-emerald-300"
              >
                {isSaving ? 'กำลังบันทึก...' : 'บันทึกข้อมูลเดือนนี้'}
              </button>

              {saveMessage && (
                <div className="text-sm rounded-lg p-3 bg-zinc-100 text-zinc-800 border border-zinc-200">{saveMessage}</div>
              )}
            </div>
          </div>

          <div className="xl:col-span-2 space-y-6">
            <div
              className={`bg-white rounded-3xl shadow-2xl p-8 transition-all duration-300 ${
                isOverBudget ? 'ring-4 ring-red-400' : isNearBudget ? 'ring-4 ring-yellow-400' : 'ring-4 ring-green-400'
              }`}
            >
              <h2 className="text-2xl font-bold mb-6 text-gray-800">{isOverBudget ? '⚠️' : '✅'} ค่าใช้จ่ายปัจจุบัน</h2>

              <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-gray-600">🏠 ค่าห้อง</span>
                  <span className="font-semibold text-lg">{formatNumber(roomPrice)} บาท</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-gray-600">💧 ค่าน้ำ</span>
                  <span className="font-semibold text-lg">{formatNumber(waterPrice)} บาท</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-gray-600">⚡ ไฟใช้ไป ({electricUnitsUsed} หน่วย)</span>
                  <span className="font-semibold text-lg">{formatNumber(electricCost)} บาท</span>
                </div>
                <div
                  className={`flex justify-between items-center py-3 border-2 rounded-xl px-4 ${
                    isOverBudget ? 'bg-red-50 border-red-300' : isNearBudget ? 'bg-yellow-50 border-yellow-300' : 'bg-green-50 border-green-300'
                  }`}
                >
                  <span className="font-bold text-xl">💰 รวมทั้งหมด</span>
                  <span
                    className={`font-bold text-2xl ${
                      isOverBudget ? 'text-red-600' : isNearBudget ? 'text-yellow-600' : 'text-green-600'
                    }`}
                  >
                    {formatNumber(totalCost)} บาท
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-yellow-400 to-orange-500 rounded-3xl shadow-2xl p-8 text-white">
              <h2 className="text-2xl font-bold mb-6">📅 เป้าหมายและวางแผน</h2>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white/20 rounded-xl p-4">
                  <div className="text-sm opacity-90">📅 วันนี้</div>
                  <div className="text-2xl font-bold">{currentDay}</div>
                </div>
                <div className="bg-white/20 rounded-xl p-4">
                  <div className="text-sm opacity-90">📆 วันในเดือน</div>
                  <div className="text-2xl font-bold">{totalDaysInMonth}</div>
                </div>
                <div className="bg-white/20 rounded-xl p-4">
                  <div className="text-sm opacity-90">⏳ วันที่เหลือ</div>
                  <div className="text-2xl font-bold">{remainingDays}</div>
                </div>
                <div className="bg-white/20 rounded-xl p-4">
                  <div className="text-sm opacity-90">🎯 เป้าหมาย</div>
                  <div className="text-xl font-bold">{formatNumber(targetBudget)}฿</div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="bg-white/20 rounded-xl p-4">
                  <div className="text-sm opacity-90 mb-2">💡 งบค่าไฟที่เหลือ</div>
                  <div className="text-xl font-bold">{formatNumber(budgetForElectric)} บาท</div>
                </div>
                <div className="bg-white/20 rounded-xl p-4">
                  <div className="text-sm opacity-90 mb-2">⚡ หน่วยไฟใช้ได้ทั้งเดือน</div>
                  <div className="text-xl font-bold">{formatNumber(maxElectricUnitsForMonth)} หน่วย</div>
                </div>
                <div className="bg-white/20 rounded-xl p-4">
                  <div className="text-sm opacity-90 mb-2">📊 หน่วยไฟ/วันที่แนะนำ</div>
                  <div className="text-xl font-bold">{electricUnitsPerDay.toFixed(1)} หน่วย/วัน</div>
                </div>
                <div className="bg-white/30 rounded-xl p-4 border-2 border-white/50">
                  <div className="text-sm opacity-90 mb-2">🔋 หน่วยไฟที่เหลือใช้ได้</div>
                  <div className="text-2xl font-bold">{formatNumber(remainingElectricUnits)} หน่วย</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-3xl shadow-2xl p-6">
                <h3 className="text-xl font-bold mb-4 text-gray-800">📚 ประวัติย้อนหลัง</h3>
                <div className="space-y-3 max-h-96 overflow-auto pr-1">
                  {history.length === 0 && <div className="text-gray-500">ยังไม่มีข้อมูลที่บันทึก</div>}
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
                      }}
                      className="w-full text-left border rounded-xl p-3 hover:bg-zinc-50"
                    >
                      <div className="flex justify-between gap-3">
                        <div className="font-semibold">เดือน {item.billingMonth}</div>
                        <div className="text-sm text-zinc-500">{formatDateTime(item.updatedAt)}</div>
                      </div>
                      <div className="text-sm text-zinc-700 mt-1">
                        หน่วยก่อน {item.prevElectricUnit} | หน่วยนี้ {item.currentElectricUnit} | ใช้ {item.electricUnitsUsed}
                      </div>
                      <div className="text-sm text-zinc-700">รวม {formatNumber(item.totalCost)} บาท</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-2xl p-6">
                <h3 className="text-xl font-bold mb-4 text-gray-800">🧾 Logs</h3>
                <div className="space-y-3 max-h-96 overflow-auto pr-1">
                  {logs.length === 0 && <div className="text-gray-500">ยังไม่มี log</div>}
                  {logs.map((log) => (
                    <div key={log.id} className="border rounded-xl p-3">
                      <div className="flex justify-between gap-3">
                        <div className="font-semibold text-sm">{log.action}</div>
                        <div className="text-xs text-zinc-500">{formatDateTime(log.timestamp)}</div>
                      </div>
                      <div className="text-sm text-zinc-700 mt-1">
                        {log.detail?.billingMonth ? `เดือน ${log.detail.billingMonth}` : ''}
                        {log.detail?.after?.currentElectricUnit ? ` | หน่วยไฟ ${log.detail.after.currentElectricUnit}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center mt-8 text-gray-400">
          <p>ถ้าไม่ตั้งค่า Google Sheets ระบบจะบันทึกในเครื่องนี้ก่อน (localStorage)</p>
        </div>
      </div>
    </div>
  );
};

export default RentCalculator;
