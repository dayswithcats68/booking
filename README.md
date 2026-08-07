# 貓家日子客用住宿試算與預約

這是一個部署於 GitHub Pages 的貓咪住宿試算與預約頁。客人可以從 LINE、Safari、Chrome 或其他瀏覽器開啟，完成試算與資料填寫後直接送出，不需要進入指定的 LINE 對話。

## 客人使用流程

1. 選擇房型、貓咪數量、住宿日期、退宿時間、伙食加購方案與實際加購數量。
2. 網頁即時計算原價、長住折扣、安親費、伙食費與預估總額。
3. 填寫飼主、緊急聯絡人，以及每隻貓咪的飲食、健康與照護資料。
4. 點選「送出預約資料」。
5. 完整資料寫入 Google Sheets，頁面留在原處並顯示預約編號。
6. Apps Script 另外寄送一封新預約 Email 給指定的店家人員。

Email 會直接包含完整預約明細，包括預約編號與時段、飼主與緊急聯絡資料、房型與伙食方案、完整費用明細、每隻貓咪的飲食／健康／照護資料、其他補充及預約表連結。

## 資料結構

指定的 Google Spreadsheet ID：`1EM9yFt-zHo84abbOVvr10vb2GNm5XR1X2xBLMejlMoE`

- `住宿預約`：一筆預約一列，包含飼主、日期、房型、伙食方案、加購數量、金額、狀態與 Email 通知狀態。新版後端會保留第 27–31 欄的舊版伙食欄位，並新增第 32–34 欄記錄每貓加購數量、計價單位與每貓單價。
- `貓咪資料`：每隻貓一列，以預約編號連回住宿預約。
- `google-apps-script/Code.gs`：驗證與重新計算價格、避免重複寫入、寫入兩張工作表並寄送新預約 Email。

## 已包含的計價規則

- 貓家小貓房：每晚 NT$850，最多入住 4 隻貓
- 探險家庭房：每晚 NT$1,300，最多入住 6 隻貓
- 第 2 隻貓起：每隻每晚加收 NT$200
- 入住 7–13 晚：住宿費享 95 折
- 入住 14 晚以上：住宿費享 9 折
- 超過 15:00 退宿：加收當次單晚房價的 50%
- 乾飼料：每隻每日 NT$50，由客人選擇實際加購天數，最多不超過住宿晚數
- 罐頭：每隻每餐一罐 NT$30，由客人選擇整段住宿的實際加購餐數
- 套組方案：早晚各一罐＋乾飼料，每隻每日 NT$100，由客人選擇實際加購天數，最多不超過住宿晚數
- 長住折扣僅套用於住宿費；超時安親費與伙食加購不參與折扣

## 正式設定

完整步驟請見 [`SETUP.md`](SETUP.md)。網站只需要在 `config.js` 設定 Apps Script Web App `/exec` 網址：

```js
window.CAT_STAY_CONFIG = Object.freeze({
  bookingEndpoint: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec",
});
```

Email 收件地址必須以逗號分隔，存放在 Apps Script 的 `BOOKING_NOTIFICATION_EMAILS` 指令碼屬性，不可寫入 GitHub 或前端程式。

## 檔案

- `index.html`：試算、表單與 Google Sheets 提交流程
- `config.js`：Apps Script Web App URL
- `assets/days-with-cats-logo.png`：品牌 Logo
- `google-apps-script/Code.gs`：Google Sheets 收件與 Email 店家通知後端
- `google-apps-script/appsscript.json`：Apps Script 專案設定
