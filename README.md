# 貓家日子客用住宿試算與預約

這是一個部署於 GitHub Pages 的貓咪住宿試算與 LINE LIFF 預約頁。客人從貓家日子 LINE 官方帳號的一對一對話開啟後，可以完成試算、填寫資料、同步登記至 Google Sheets，並以自己的 LINE 身分將完整內容直接傳入目前的官方帳號對話。

## 客人使用流程

1. 從貓家日子 LINE 官方帳號的 LIFF 預約入口開啟網頁。
2. 選擇房型、貓咪數量、住宿日期與退宿時間。
3. 網頁即時計算原價、長住折扣、安親費與預估總額。
4. 填寫飼主、緊急聯絡人，以及每隻貓咪的飲食、健康與照護資料。
5. 點選「送出預約資料」。
6. 系統將資料寫入 Google Sheets，再用 `liff.sendMessages()` 傳到目前的 LINE 對話。

為避免把個人資料傳入群組或其他聊天室，送出功能只會在 LINE 的一對一 LIFF 對話環境中啟用。直接從一般瀏覽器開啟時仍可試算，但無法送出預約。

## 資料結構

指定的 Google Spreadsheet ID：`1EM9yFt-zHo84abbOVvr10vb2GNm5XR1X2xBLMejlMoE`

- `住宿預約`：一筆預約一列，包含飼主、日期、房型、金額、狀態與 LINE 傳送狀態。
- `貓咪資料`：每隻貓一列，以預約編號連回住宿預約。
- `google-apps-script/Code.gs`：接收預約、驗證與重新計算價格、去除重複預約並寫入兩張工作表。

## 已包含的計價規則

- 貓家小貓房：每晚 NT$850，最多入住 4 隻貓
- 探險家庭房：每晚 NT$1,300，最多入住 6 隻貓
- 第 2 隻貓起：每隻每晚加收 NT$200
- 入住 7–13 晚：住宿費享 95 折
- 入住 14 晚以上：住宿費享 9 折
- 超過 15:00 退宿：加收當次單晚房價的 50%
- 長住折扣套用於住宿費；超時安親費不參與折扣

## 啟用正式送出

完整的一次性設定請見 [`SETUP.md`](SETUP.md)。完成後，將 Apps Script Web App `/exec` 網址及 LIFF ID 填入 `config.js`：

```js
window.CAT_STAY_CONFIG = Object.freeze({
  liffId: "1234567890-AbcdEfgh",
  bookingEndpoint: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec",
});
```

LIFF Rich Menu 或官方帳號內的預約按鈕，必須連到 `https://liff.line.me/{LIFF_ID}`，不能直接連 GitHub Pages 網址。

## 檔案

- `index.html`：試算、表單、Google Sheets 提交與 LIFF 傳送流程
- `config.js`：LIFF ID 與 Apps Script Web App URL
- `assets/days-with-cats-logo.png`：品牌 Logo
- `google-apps-script/Code.gs`：Google Apps Script 後端
- `google-apps-script/appsscript.json`：Apps Script 專案設定
