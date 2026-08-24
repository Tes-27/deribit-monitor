# Position Monitor — Deribit · Bybit · Phemex

หน้าจอ monitor แบบ **read-only** สำหรับดู position, limit order และ **liquidation price** ทับกราฟแท่งเทียน
เป็น **HTML ไฟล์เดียว ไม่มี backend** — เปิดไฟล์ใน browser แล้วใช้ได้เลย (ต้องต่ออินเทอร์เน็ต)

ในโฟลเดอร์นี้มี 2 เครื่องมือ:

| ไฟล์ | คืออะไร |
|---|---|
| `index.html` | Position monitor (ต้องใช้ API key แบบ read-only) |
| `liq-calculator.html` | **Liquidation calculator** — คำนวณจุด liquidation ของ Deribit (BTC) แบบ Future / Inverse Perpetual / Option ไม่ต้องใช้ API key มีปุ่มดึง mark price / option chain จาก Deribit public API |

สร้างขึ้นเพราะหน้ากราฟของ Deribit เวอร์ชันใหม่ไม่แสดงเส้น liquidation แล้ว

## ฟีเจอร์

- กราฟแท่งเทียน + เส้นทับกราฟ: **entry** (น้ำเงิน), **liquidation** (แดง), **limit orders** (เขียว/ส้ม ประ)
- หลายพอร์ทแบบ tab + tab **ภาพรวม** รวม equity ทุกพอร์ทและวาดเส้นทุกพอร์ทบนกราฟเดียว
- แยกหมวด **Future Inverse / Future / Option / Spot** ทั้งใน dropdown และตาราง position
- ระยะห่างจาก liquidation เป็น % (เตือนสีแดงเมื่อใกล้กว่า 10%) + MM ratio ต่อพอร์ท
- อัปเดต real-time ผ่าน WebSocket, คลิกแถว position/order เพื่อสลับกราฟ
- read-only 100% — ไม่มีโค้ดส่งออเดอร์

## Exchange ที่รองรับ

| Exchange | ช่องทาง | หมายเหตุ |
|---|---|---|
| Deribit | WebSocket JSON-RPC | รองรับ testnet |
| Bybit | REST + WebSocket ผ่าน `api.bytick.com` / `stream.bytick.com` | โดเมนสำรองทางการ เพราะ `api.bybit.com` ถูกบล็อก DNS จาก ISP ไทย |
| Phemex | WebSocket ล้วน (`ws.phemex.com`) | REST ของ Phemex ไม่เปิด CORS ให้ browser — แท่งเทียนย้อนหลังจึงมีจำกัดเท่าที่ WS snapshot ให้มา |

## วิธีใช้

1. เปิด `index.html` ใน Chrome/Safari/Firefox
2. กด **⚙ ตั้งค่า** แล้วเพิ่มพอร์ท: เลือก exchange, ตั้งชื่อ, ใส่ API key + secret
3. สร้าง API key แบบ **read-only เท่านั้น**:
   - **Deribit**: สิทธิ์ `account:read` + `trade:read`
   - **Bybit**: เลือกประเภท Read-Only
   - **Phemex**: ไม่ติ๊กสิทธิ์ Trade

Key ถูกเก็บใน `localStorage` ของ browser บนเครื่องเท่านั้น ไม่ถูกส่งไปที่อื่นนอกจาก exchange นั้นๆ

## ข้อจำกัด

- Timeframe 6h ไม่มีบน Phemex (ปุ่มจะเปลี่ยนเป็น 4h อัตโนมัติ)
- uPnL ฝั่ง Phemex คำนวณจาก entry/mark ในแอป (ไม่รวม funding ที่ยังไม่ settle)
- Testnet toggle มีผลเฉพาะ Deribit
- Bybit option ไม่มีข้อมูลกราฟ (endpoint kline ไม่รองรับ category option)
