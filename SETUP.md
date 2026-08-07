# 貓家日子預約系統設定

## 一、更新 Google Apps Script

1. 開啟「貓家日子預約資料」Google Sheet。
2. 選擇「擴充功能 → Apps Script」。
3. 將 `Code.gs` 的內容替換為本專案 `google-apps-script/Code.gs` 的完整內容並儲存。
4. 到「專案設定 → 指令碼屬性」新增：
   - `BOOKING_NOTIFICATION_EMAILS`：接收通知的 Email 地址；多個地址以半形逗號分隔。
5. 選擇「部署 → 管理部署作業」，編輯目前的網頁應用程式部署。
6. 在「版本」選擇「建立新版本」，確認：
   - 執行身分：我
   - 誰可以存取：任何人
7. 完成授權並部署。沿用原本以 `/exec` 結尾的網址即可。

請勿把實際收件地址貼到 `config.js`、GitHub 或任何前端檔案。原本的 `LINE_CHANNEL_ACCESS_TOKEN` 與 `LINE_NOTIFICATION_TO` 已不再使用，可以從指令碼屬性刪除。

## 二、設定 Email 店家通知

在 Apps Script 的「專案設定 → 指令碼屬性」新增一筆：

| 屬性 | 值 |
|---|---|
| `BOOKING_NOTIFICATION_EMAILS` | `first@example.com,second@example.com` |

每筆新預約只會寄出一次通知，主旨格式為：

```text
【新預約】王小明｜2026-08-10–2026-08-12｜2 隻貓
```

信件內文包含預約編號、飼主、聯絡電話、日期、房型、貓咪數量、預估金額及 Google Sheet 連結。Email 寄送失敗不會影響預約寫入。

## 三、網站設定

`config.js` 只保留 Apps Script `/exec` 網址。預約頁可以使用 GitHub Pages 網址或既有 LIFF 網址開啟；兩者都能送出，不再限制一對一 LINE 對話。

## 四、測試

1. 以測試姓名和日期從一般瀏覽器送出一筆預約。
2. 確認頁面顯示「預約資料已送出」與預約編號。
3. 確認 Google Sheet 的「住宿預約」新增一列，「貓咪資料」依貓咪數量新增對應列。
4. 確認每個指定信箱都收到一封新預約通知。
5. 確認「住宿預約」第 25 欄顯示「已寄送」。
6. 測試完成後，刪除兩張表內相同預約編號的測試資料。
