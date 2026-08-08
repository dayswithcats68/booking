# 貓家日子客用住宿試算與預約

這是一個部署於 GitHub Pages 的貓咪住宿試算與預約頁。客人可以從 LINE、Safari、Chrome 或其他瀏覽器開啟，完成試算與資料填寫後直接送出，不需要進入指定的 LINE 對話。

## 客人使用流程

1. 分別選擇小貓房與探險家庭房的數量；兩種房型可以同時預訂，再填寫貓咪數量、住宿日期、退宿時間與伙食加購。
2. 網頁即時計算原價、長住折扣、安親費、伙食費與預估總額。
3. 填寫飼主、緊急聯絡人，以及每隻貓咪的飲食、健康與照護資料。
4. 點選「送出預約資料」。
5. 完整資料送出後，按鈕改為「預約資料已送出」，頁面自動捲動至訂金匯款帳戶，並顯示預約編號與住宿須知圖片。
6. Apps Script 另外寄送一封新預約 Email 給指定的店家人員，並在貓家日子的 Google Calendar 建立一筆「待確認」住宿行程。

Email 會直接包含完整預約明細，包括預約編號與時段、飼主與緊急聯絡資料、房型與伙食方案、完整費用明細、每隻貓咪的飲食／健康／照護資料、其他補充及預約表連結。

## 資料結構

指定的 Google Spreadsheet ID：`1EM9yFt-zHo84abbOVvr10vb2GNm5XR1X2xBLMejlMoE`

- `住宿預約`：一筆預約一列，包含飼主、日期、房型、房間數量、伙食方案、加購數量、金額、狀態、Email 通知狀態與 Google Calendar 建立結果。混合預約的房型欄會寫成「貓家小貓房 1 間＋探險家庭房 1 間」；第 35 欄記錄總房數，第 36–37 欄記錄 Calendar 狀態與行程 ID。
- `貓咪資料`：每隻貓一列，以預約編號連回住宿預約。
- `google-apps-script/Code.gs`：驗證與重新計算價格、避免重複寫入、寫入兩張工作表、寄送新預約 Email，並以預約編號防止重複建立 Calendar 行程。

## 已包含的計價規則

- 貓家小貓房：每間每晚 NT$850，每間最多入住 3 隻貓，一筆預約最多 10 間
- 探險家庭房：每間每晚 NT$1,300，每間最多入住 6 隻貓，一筆預約最多 1 間
- 同一筆預約可同時選擇兩種房型；總容量與基本房費依各房型數量加總
- 每間基本房價包含 1 隻貓；貓咪總數超出房間數量的部分，每隻每晚加收 NT$200
- 最早入住時間：10:00
- 最晚退宿時間：20:30
- 入住 7–13 晚：住宿費享 95 折
- 入住 14 晚以上：住宿費享 9 折
- 超過 15:00 退宿：加收當次全部房間與加貓費合計單晚價格的 50%
- 乾飼料：每隻每日 NT$50，由客人選擇實際加購天數，最多不超過住宿晚數
- 罐頭：每罐 NT$40，由客人選擇整筆預約的總罐數，不再乘以貓咪數量
- 套組方案：早晚各一罐＋乾飼料，每隻每日 NT$100，由客人選擇實際加購天數，最多不超過住宿晚數
- 長住折扣僅套用於住宿費；超時安親費與伙食加購不參與折扣

## 正式設定

完整步驟請見 [`SETUP.md`](SETUP.md)。網站只需要在 `config.js` 設定 Apps Script Web App `/exec` 網址：

```js
window.CAT_STAY_CONFIG = Object.freeze({
  bookingEndpoint: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec",
});
```

Email 收件地址必須以逗號分隔，存放在 Apps Script 的 `BOOKING_NOTIFICATION_EMAILS` 指令碼屬性，不可寫入 GitHub 或前端程式。Calendar 預設使用 Apps Script 執行帳號的主要日曆；若日後要改用該帳號擁有的次要日曆，可在 `BOOKING_CALENDAR_ID` 指令碼屬性填入該日曆 ID。Calendar 僅要求 `calendar.events.owned`，不會取得日曆分享設定的管理權限。

## 檔案

- `index.html`：試算、表單與 Google Sheets 提交流程
- `config.js`：Apps Script Web App URL
- `assets/days-with-cats-logo.png`：品牌 Logo
- `assets/stay-guidelines.png`：預約送出後顯示的住宿須知
- `google-apps-script/Code.gs`：Google Sheets 收件與 Email 店家通知後端
- `google-apps-script/appsscript.json`：Apps Script 專案設定
