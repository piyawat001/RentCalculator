import { useState, useEffect } from 'react';

const RentCalculator = () => {
  // State สำหรับข้อมูลพื้นฐาน
  const [roomPrice, setRoomPrice] = useState(2500);
  const [waterPrice, setWaterPrice] = useState(100);
  const [prevElectricUnit, setPrevElectricUnit] = useState(595);
  const [currentElectricUnit, setCurrentElectricUnit] = useState(652);
  const [electricRate, setElectricRate] = useState(6);
  const [targetBudget, setTargetBudget] = useState(2800);
  
  // State สำหรับวันที่
  const [currentDay, setCurrentDay] = useState(0);
  const [totalDaysInMonth, setTotalDaysInMonth] = useState(0);

  // คำนวณค่าไฟฟ้า
  const electricUnitsUsed = Math.max(0, currentElectricUnit - prevElectricUnit);
  const electricCost = electricUnitsUsed * electricRate;
  const totalCost = roomPrice + waterPrice + electricCost;

  // คำนวณเป้าหมายและแผน
  const budgetForElectric = Math.max(0, targetBudget - roomPrice - waterPrice);
  const maxElectricUnitsForMonth = budgetForElectric / electricRate;
  const electricUnitsPerDay = maxElectricUnitsForMonth / totalDaysInMonth;
  const remainingDays = Math.max(0, totalDaysInMonth - currentDay);
  const remainingElectricUnits = Math.max(0, remainingDays * electricUnitsPerDay);

  // สถานะการใช้จ่าย
  const isOverBudget = totalCost > targetBudget;
  const isNearBudget = totalCost > targetBudget * 0.9;

  // ฟังก์ชันจัดรูปแบบตัวเลข
  const formatNumber = (num) => {
    return num.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  // ตรวจจับวันที่อัตโนมัติ
  useEffect(() => {
    const today = new Date();
    const currentDate = today.getDate();
    const year = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    setCurrentDay(currentDate);
    setTotalDaysInMonth(daysInMonth);
  }, []);

  return (
    <div className="min-h-screen bg-black p-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            🏠 คำนวณค่าห้องเช่า
          </h1>
          <p className="text-gray-300">จัดการงบประมาณและวางแผนค่าใช้จ่ายของคุณ</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ฟอร์มกรอกข้อมูล */}
          <div className="bg-white rounded-3xl shadow-2xl p-8">
            <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center">
              💡 ข้อมูลค่าใช้จ่าย
            </h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  🏠 ค่าห้อง (บาท)
                </label>
                <input
                  type="number"
                  value={roomPrice}
                  onChange={(e) => setRoomPrice(Number(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  💧 ค่าน้ำ (บาท)
                </label>
                <input
                  type="number"
                  value={waterPrice}
                  onChange={(e) => setWaterPrice(Number(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    ⚡ หน่วยไฟเดือนที่แล้ว
                  </label>
                  <input
                    type="number"
                    value={prevElectricUnit}
                    onChange={(e) => setPrevElectricUnit(Number(e.target.value))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    ⚡ หน่วยไฟเดือนนี้
                  </label>
                  <input
                    type="number"
                    value={currentElectricUnit}
                    onChange={(e) => setCurrentElectricUnit(Number(e.target.value))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  🔥 ค่าไฟต่อหน่วย (บาท)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={electricRate}
                  onChange={(e) => setElectricRate(Number(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  🎯 เป้าหมายค่าใช้จ่าย (บาท)
                </label>
                <input
                  type="number"
                  value={targetBudget}
                  onChange={(e) => setTargetBudget(Number(e.target.value))}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                />
              </div>
            </div>
          </div>

          {/* ผลการคำนวณ */}
          <div className="space-y-6">
            {/* ค่าใช้จ่ายปัจจุบัน */}
            <div className={`bg-white rounded-3xl shadow-2xl p-8 transition-all duration-300 ${
              isOverBudget ? 'ring-4 ring-red-400' : isNearBudget ? 'ring-4 ring-yellow-400' : 'ring-4 ring-green-400'
            }`}>
              <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center">
                {isOverBudget ? '⚠️' : '✅'} ค่าใช้จ่ายปัจจุบัน
              </h2>
              
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
                
                <div className={`flex justify-between items-center py-3 border-2 rounded-xl px-4 ${
                  isOverBudget ? 'bg-red-50 border-red-300' : isNearBudget ? 'bg-yellow-50 border-yellow-300' : 'bg-green-50 border-green-300'
                }`}>
                  <span className="font-bold text-xl">💰 รวมทั้งหมด</span>
                  <span className={`font-bold text-2xl ${
                    isOverBudget ? 'text-red-600' : isNearBudget ? 'text-yellow-600' : 'text-green-600'
                  }`}>
                    {formatNumber(totalCost)} บาท
                  </span>
                </div>

                <div className={`text-center py-3 rounded-xl font-bold text-lg ${
                  isOverBudget ? 'bg-red-100 text-red-700' : isNearBudget ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                }`}>
                  {isOverBudget ? '🚨 เกินเป้าหมาย!' : isNearBudget ? '⚠️ ใกล้เป้าหมาย' : '🎉 อยู่ในเป้าหมาย'}
                </div>
              </div>
            </div>

            {/* เป้าหมายและวางแผน */}
            <div className="bg-gradient-to-br from-yellow-400 to-orange-500 rounded-3xl shadow-2xl p-8 text-white">
              <h2 className="text-2xl font-bold mb-6 flex items-center">
                📅 เป้าหมายและวางแผน
              </h2>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4">
                  <div className="text-sm opacity-90">📅 วันนี้</div>
                  <div className="text-2xl font-bold">{currentDay}</div>
                </div>
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4">
                  <div className="text-sm opacity-90">📆 วันในเดือน</div>
                  <div className="text-2xl font-bold">{totalDaysInMonth}</div>
                </div>
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4">
                  <div className="text-sm opacity-90">⏳ วันที่เหลือ</div>
                  <div className="text-2xl font-bold">{remainingDays}</div>
                </div>
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4">
                  <div className="text-sm opacity-90">🎯 เป้าหมาย</div>
                  <div className="text-xl font-bold">{formatNumber(targetBudget)}฿</div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4">
                  <div className="text-sm opacity-90 mb-2">💡 งบประมาณค่าไฟที่เหลือ</div>
                  <div className="text-xl font-bold">{formatNumber(budgetForElectric)} บาท</div>
                </div>
                
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4">
                  <div className="text-sm opacity-90 mb-2">⚡ หน่วยไฟที่ใช้ได้ทั้งเดือน</div>
                  <div className="text-xl font-bold">{formatNumber(maxElectricUnitsForMonth)} หน่วย</div>
                </div>
                
                <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4">
                  <div className="text-sm opacity-90 mb-2">📊 หน่วยไฟต่อวันที่แนะนำ</div>
                  <div className="text-xl font-bold">{electricUnitsPerDay.toFixed(1)} หน่วย/วัน</div>
                </div>
                
                <div className="bg-white/30 backdrop-blur-sm rounded-xl p-4 border-2 border-white/50">
                  <div className="text-sm opacity-90 mb-2">🔋 หน่วยไฟที่เหลือใช้ได้</div>
                  <div className="text-2xl font-bold">{formatNumber(remainingElectricUnits)} หน่วย</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center mt-8 text-gray-400">
          <p>💡 ปรับแต่งค่าต่างๆ เพื่อวางแผนการใช้จ่ายให้เหมาะสม</p>
        </div>
      </div>
    </div>
  );
};

export default RentCalculator;
