# 貓家日子預約系統一次性設定

## 一、部署 Google Apps Script

1. 開啟「貓家日子預約資料」Google Sheet。
2. 選擇「擴充功能 → Apps Script」。
3. 將預設 `Code.gs` 的內容全部刪除，貼上本專案 `google-apps-script/Code.gs` 的完整內容。
4. 按「儲存」。
5. 右上角選擇「部署 → 新增部署作業」。
6. 類型選擇「網頁應用程式」。
7. 執行身分選擇「我」。
8. 存取權選擇「任何人」。
9. 完成授權後，複製以 `/exec` 結尾的網頁應用程式網址。

請勿使用測試部署的 `/dev` 網址。日後若修改 Apps Script，需到「管理部署作業」建立新版本並更新現有部署。

## 二、建立 LINE LIFF App

1. 進入 LINE Developers Console，選擇與貓家日子官方帳號 Messaging API 相同的 Provider。
2. 建立或開啟一個 LINE Login Channel，並在 Basic settings 將貓家日子 LINE Official Account 設為 Linked LINE Official Account。
3. 進入 LIFF 分頁，新增 LIFF App：
   - LIFF app name：`貓家日子住宿預約`
   - Size：`Full`
   - Endpoint URL：`https://dayswithcats68.github.io/booking/`
   - Scope：勾選 `chat_message.write`
   - Add friend option：建議選 `On (normal)`
4. 儲存後複製 LIFF ID，例如 `1234567890-AbcdEfgh`。

## 三、更新網站設定

將 Apps Script `/exec` 網址和 LIFF ID 填入 `config.js`。正式發布前應確認：

- Apps Script `/exec` 網址在瀏覽器開啟時回傳 `"ok":true`。
- LINE Developers 的 Endpoint URL 完全等於 GitHub Pages 網址。
- 官方帳號的預約入口使用 LIFF URL：`https://liff.line.me/{LIFF_ID}`。
- LIFF App 已勾選 `chat_message.write`。

## 四、測試

1. 從貓家日子 LINE 官方帳號的一對一對話點擊 LIFF 預約入口。
2. 使用測試姓名與日期送出一筆預約。
3. 確認 LINE 對話收到預約文字。
4. 確認 Google Sheet 的「住宿預約」新增一列，「貓咪資料」依貓咪數量新增對應列。
5. 測試完成後，可在 Google Sheet 刪除該筆測試資料。
