# 貓家日子預約系統設定

## 一、更新 Google Apps Script

1. 開啟「貓家日子預約資料」Google Sheet。
2. 選擇「擴充功能 → Apps Script」。
3. 將 `Code.gs` 的內容替換為本專案 `google-apps-script/Code.gs` 的完整內容並儲存。
4. 到「專案設定 → 指令碼屬性」新增：
   - `LINE_CHANNEL_ACCESS_TOKEN`：貓家日子 Messaging API Channel 的 Channel Access Token。
   - `LINE_NOTIFICATION_TO`：接收通知的店家人員 `userId`，或店家通知群組的 `groupId`。
5. 選擇「部署 → 管理部署作業」，編輯目前的網頁應用程式部署。
6. 在「版本」選擇「建立新版本」，確認：
   - 執行身分：我
   - 誰可以存取：任何人
7. 完成授權並部署。沿用原本以 `/exec` 結尾的網址即可。

請勿把 Channel Access Token 貼到 `config.js`、GitHub 或任何前端檔案。若 Token 曾公開，請立即撤銷並重新簽發。

## 二、設定 LINE 店家通知

LINE Messaging API 的推播方向是「由官方帳號傳給使用者或群組」，無法把訊息推進官方帳號自己的收件匣。建議將通知送到店家管理人員的個人 LINE，或由工作人員組成的通知群組。

### 通知到一位店家人員

1. 在 LINE Developers Console 開啟貓家日子的 Messaging API Channel。
2. 到 Messaging API 分頁簽發 Channel Access Token。
3. 到 Basic settings 取得該管理人員的 `Your user ID`。此帳號必須已加入貓家日子官方帳號好友，且須與 Messaging API Channel 位於同一個 Provider。
4. 將 Token 與 `userId` 分別填入上述兩個指令碼屬性。

### 通知到店家群組

1. 將貓家日子官方帳號加入店家通知群組。
2. 從該群組送一則訊息，透過 Messaging API webhook 取得事件中的 `source.groupId`。
3. 將此 `groupId` 設為 `LINE_NOTIFICATION_TO`。

每筆新預約只會送出一個文字訊息，格式為：

```text
王小明已預約
```

## 三、網站設定

`config.js` 只保留 Apps Script `/exec` 網址。預約頁可以使用 GitHub Pages 網址或既有 LIFF 網址開啟；兩者都能送出，不再限制一對一 LINE 對話。

## 四、測試

1. 以測試姓名和日期從一般瀏覽器送出一筆預約。
2. 確認頁面顯示「預約資料已送出」與預約編號。
3. 確認 Google Sheet 的「住宿預約」新增一列，「貓咪資料」依貓咪數量新增對應列。
4. 確認指定的店家 LINE 或通知群組收到一則「測試姓名已預約」。
5. 確認「住宿預約」第 25 欄顯示「已傳送」。
6. 測試完成後，刪除兩張表內相同預約編號的測試資料。
