# Rent Calculator (Google Sheets Logs)

แอปคำนวณค่าเช่าห้อง + ค่าไฟ/ค่าน้ำ พร้อม:

- บันทึกข้อมูลรายเดือน
- ดึง `หน่วยไฟเดือนล่าสุด` มาใช้เป็น `เดือนที่แล้ว`
- ดูประวัติย้อนหลัง
- เก็บ `logs` ย้อนหลัง
- ใช้ `localStorage` ได้ทันที (ไม่ต้องมี database)
- Sync กับ `Google Sheets` ได้ผ่าน `Google Apps Script` (optional)

## Run

```bash
npm install
npm run dev
```

## ใช้แบบไม่ตั้งค่าอะไรเพิ่ม (เร็วสุด)

ถ้ายังไม่ตั้งค่า Google Sheets แอปจะบันทึกไว้ใน browser เครื่องนี้ผ่าน `localStorage` ก่อน

## ตั้งค่า Google Sheets (แนะนำสำหรับใช้งานจริงของคุณ)

### 1) สร้าง Google Spreadsheet

สร้างไฟล์ใหม่ 1 ไฟล์ แล้วสร้าง 2 sheet:

- `meter_readings`
- `logs`

### 2) ใส่ header แถวแรกให้ตรงนี้เป๊ะ

Sheet `meter_readings`

```text
id,roomNo,billingMonth,roomPrice,waterPrice,prevElectricUnit,currentElectricUnit,electricRate,targetBudget,electricUnitsUsed,electricCost,totalCost,note,createdAt,updatedAt
```

Sheet `logs`

```text
id,timestamp,action,actor,roomNo,billingMonth,detail
```

### 3) เปิด Apps Script แล้ววางโค้ด

- ไปที่ `Extensions > Apps Script`
- ลบโค้ดเดิม
- วางโค้ดจากไฟล์ `google-apps-script/Code.gs`
- กด Save

### 4) Deploy เป็น Web App

- กด `Deploy > New deployment`
- Type: `Web app`
- `Execute as`: `Me`
- `Who has access`: `Anyone` (หรือ `Anyone with Google account` ก็ได้ แต่จากหน้าเว็บภายนอกมักใช้ `Anyone`)
- Deploy แล้ว copy URL ที่ลงท้ายด้วย `/exec`

### 5) ใส่ URL ในโปรเจกต์

สร้างไฟล์ `.env.local` ที่ root โปรเจกต์:

```bash
cp .env.example .env.local
```

แล้วแก้ค่า:

```env
VITE_APPS_SCRIPT_URL=PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE
```

จากนั้น restart dev server (`npm run dev`)

## วิธีใช้งานในแอป

1. กด `ซิงก์จาก Google Sheets` (ครั้งแรก)
2. ระบบจะโหลดข้อมูลย้อนหลังมาแสดง
3. เดือนถัดไปกด `ใช้เลขล่าสุดเป็นเดือนที่แล้ว`
4. กรอก `หน่วยไฟเดือนนี้`
5. กด `บันทึกข้อมูลเดือนนี้`

ระบบจะ:

- คำนวณค่าใช้จ่าย
- บันทึกประวัติรายเดือน
- เขียน log การบันทึก
- เดือนหน้าสามารถดึงเลขล่าสุดมาใช้ต่อได้

## หมายเหตุสำคัญ

- แอปนี้ออกแบบสำหรับใช้คนเดียว (`ROOM-1` คงที่ในโค้ด)
- ถ้าต้องการหลายห้อง ค่อยขยาย `roomNo` เป็น input เพิ่มได้
- ถ้า Apps Script ติดปัญหา CORS ในบาง account/setting ให้ใช้ backend proxy ภายหลังได้ (แต่หลายเคสใช้งานได้ตรง)
