# 貓家日子預約系統設定

## 一、更新 Google Apps Script

1. 開啟「貓家日子預約資料」Google Sheet。
2. 選擇「擴充功能 → Apps Script」。
3. 將 `Code.gs` 的內容替換為本專案 `google-apps-script/Code.gs` 的完整內容，並同步替換 `appsscript.json`。
4. 到「專案設定 → 指令碼屬性」新增：
   - `BOOKING_NOTIFICATION_EMAILS`：接收通知的 Email 地址；多個地址以半形逗號分隔。
   - `BOOKING_CALENDAR_ID`：選填；不填時使用 Apps Script 執行帳號的主要 Google Calendar；若填寫，目標日曆必須由該帳號擁有。
   - `BOOKING_SPREADSHEET_ID`：僅供獨立 Apps Script 專案使用；由上述 Google Sheet 開啟的綁定專案不需設定。
   - `PAYMENT_ACCOUNT_NUMBER`：預約成功頁顯示的完整匯款帳號；僅填數字，不可寫入 GitHub 或前端檔案。
   - `TURNSTILE_SECRET_KEY`：選填；Cloudflare Turnstile 的 secret key，不可寫入 GitHub 或前端檔案。
   - `TURNSTILE_ALLOWED_HOSTNAMES`：啟用 Turnstile 時必填；允許的網站 hostname，以逗號分隔且不含 `https://` 或路徑，例如 `dayswithcats68.github.io,www.example.com`。
5. 在函式選單執行一次 `authorizeCalendar`，確認 Google Calendar 權限。
6. 選擇「部署 → 管理部署作業」，編輯目前的網頁應用程式部署。
7. 在「版本」選擇「建立新版本」，確認：
   - 執行身分：我
   - 誰可以存取：任何人
8. 完成授權並部署。沿用原本以 `/exec` 結尾的網址即可。
9. 以瀏覽器開啟 `/exec` 網址，確認回應包含 `"release":"cny-2027-production-r6"`、`"pricingVersion":"cny-2027-v2"`、`"emailNotificationConfigured":true` 與 `"paymentAccountConfigured":true`；若已啟用 Turnstile，另確認 `"botProtectionConfigured":true`；若指定次要日曆，再確認 `"calendarTarget":"configured"`。

請勿把實際收件地址貼到 `config.js`、GitHub 或任何前端檔案。原本的 `LINE_CHANNEL_ACCESS_TOKEN` 與 `LINE_NOTIFICATION_TO` 已不再使用，可以從指令碼屬性刪除。

## 二、設定 Email 店家通知

在 Apps Script 的「專案設定 → 指令碼屬性」新增一筆：

| 屬性 | 值 |
|---|---|
| `BOOKING_NOTIFICATION_EMAILS` | `first@example.com,second@example.com` |

每筆新預約只會寄出一次通知，主旨格式為：

```text
【新預約】王小明｜2026-08-10–2026-08-12｜2 間・4 隻貓
```

信件內文包含完整預約明細：預約與入住時段、飼主與緊急聯絡資料、各房型與房間數量、伙食方案、費用拆分、每隻貓咪的飲食／健康／照護資料、其他補充及 Google Sheet 連結。系統不建立契約檔案或附件；契約由店家人工製作。只有 Email 本身寄送失敗時，第 25 欄才會記錄「寄送失敗」。

新版後端首次收到預約時，會保留「住宿預約」工作表第 27–31 欄的舊版伙食欄位，以第 32–34 欄記錄「加購數量」、「伙食計價單位」與「單位價格」，第 35 欄記錄「房間數量」，第 36–37 欄記錄「Google Calendar 狀態」與「Google Calendar 行程 ID」，第 38–45 欄記錄計價版本、平日／春節晚數與小計、訂金金額。既有第 1–26 欄及 Email 狀態欄位置不變。

## 三、設定 Google Calendar

系統預設在 Apps Script 執行帳號的主要日曆建立行程。每筆行程使用客人填寫的入住與退宿時間，標題以「【待確認】貓家日子住宿」開頭，說明包含預約編號、房型、房數、貓咪、聯絡資料、伙食與預估總額。

若要改用該帳號擁有的次要日曆，請在 Apps Script 的「專案設定 → 指令碼屬性」加入：

| 屬性 | 值 |
|---|---|
| `BOOKING_CALENDAR_ID` | 目標 Google Calendar 的日曆 ID |

Calendar 行程 ID 由 Google 產生。重送時後端會先用已儲存的行程 ID 與預約編號查找，找不到時才補建，不會把不存在的行程誤標為成功。Calendar 建立失敗不會阻止預約寫入；第 36 欄會顯示「建立失敗」並在儲存格備註記錄原因，可用相同預約編號重試補建。

`appsscript.json` 將 Calendar 權限限制為 `calendar.events.owned`：可查看、建立、修改與刪除 Apps Script 執行帳號所擁有日曆中的行程，但不能更改日曆分享設定。

## 四、網站設定

`config.js` 保留 Apps Script `/exec` 網址，以及選填的 Turnstile 公開 site key。預約頁可以使用 GitHub Pages 網址或既有 LIFF 網址開啟；兩者都能送出，不再限制一對一 LINE 對話。

### 啟用真人驗證

1. 在 Cloudflare Turnstile 建立 Managed widget，先加入 `dayswithcats68.github.io`；若已購買自訂網域，也一併加入實際使用的 hostname。
2. 將公開 site key 填入 `config.js` 的 `turnstileSiteKey` 後發布 GitHub Pages。等待新設定可讀取，再繼續下一步。
3. 將 secret key 填入 Apps Script 指令碼屬性 `TURNSTILE_SECRET_KEY`；將相同 hostname 清單填入 `TURNSTILE_ALLOWED_HOSTNAMES`。secret key 不可貼到 issue、PR、聊天內容或任何 GitHub 檔案。
4. 開啟 Apps Script `/exec` 健康檢查，確認 `"botProtectionConfigured":true`，再從正式網頁送出一筆測試預約。

site key 是公開值；secret key 才是機密。若尚未取得金鑰，兩者都留空即可，現有預約流程不受影響。

### r5 發布順序

r5 將預約編號改為 128-bit 隨機值，因此這次先發布 GitHub Pages，再部署 Apps Script r5。舊後端可接受新版編號；反向部署時，瀏覽器仍快取舊頁面的客人會被新版後端要求重新整理。Turnstile 則務必先發布 site key，最後才設定後端 secret key。

## 五、自訂網域

購買網域後不需搬移 Google Sheet、Apps Script、Email 或 Calendar 資料；網域只取代客人看到的入口網址。

1. 在 GitHub 個人設定的 Pages 頁面驗證網域，依 GitHub 顯示的內容新增 DNS TXT 記錄，並保留該記錄。
2. 在本儲存庫的 `Settings → Pages → Custom domain` 先填入正式網域。
3. 再到網域商設定 DNS。若使用 `www.example.com`，新增 `CNAME`，指向 `dayswithcats68.github.io`，不可加上 `/booking`；若使用根網域 `example.com`，依 GitHub Pages 當下文件設定 `A`、`AAAA`、`ALIAS` 或 `ANAME`。
4. DNS 生效與憑證建立後，在 GitHub Pages 勾選 `Enforce HTTPS`。DNS 最長可能需 24 小時生效；不要使用萬用字元 `*.example.com`。
5. 將新 hostname 加到 Turnstile widget 與 `TURNSTILE_ALLOWED_HOSTNAMES`，並把 `index.html` 的 `og:image` 更新為正式網址。

切換完成前，原本的 GitHub Pages 網址仍可作為測試入口。若未來連網站主機也要更換，才需要搬動 HTML／CSS／圖片；預約資料仍可繼續留在原本的 Google 服務。

## 六、測試

1. 以測試姓名和日期從一般瀏覽器送出一筆預約。
2. 確認按鈕由「正在登記預約」改為「預約資料已送出」，頁面自動捲動至訂金匯款帳戶，並顯示預約編號、住宿須知圖片與契約條款預覽；契約摘要應正確帶入寄養期間、房型、貓咪數量及住宿費用；「複製帳號」應複製 `PAYMENT_ACCOUNT_NUMBER` 設定的純數字帳號。
3. 確認 Google Sheet 的「住宿預約」新增一列，「貓咪資料」依貓咪數量新增對應列。
4. 確認小貓房可選 0–10 間、眺跳家庭房可選 0–3 間、探險家庭房可選 0–1 間，至少須選一種房型；並確認可搭配選擇多種房型，總容量與基本房費會依間數加總。
5. 確認每間基本房價包含 1 隻貓，多出的貓咪每隻每晚加收 NT$200；7–13 晚住宿費為 95 折、14–29 晚為 9 折，且超時安親費仍以未折扣的單晚房價計算。
6. 確認 29 晚仍顯示 9 折；30 晚與 31 晚不顯示折扣率或預估總額，改為顯示「請洽詢」與長住專案說明，但仍可進入下一步及送出預約。後端的折扣名稱應記錄為「長住專案（待專屬報價）」，金額欄保留未套用專案折扣的內部參考值。
7. 分別確認乾飼料／套組依「每隻貓 × 加購天數」計價，罐頭則依整筆預約的總罐數計價、不再乘以貓咪數量，且加購天數不會超過住宿晚數。
8. 確認緊急聯絡人姓名、電話與關係均留空時仍可送出，試算表、Email 與 Calendar 以空白或「未填」呈現；並確認每個指定信箱都收到一封含完整預約、各房型數量、伙食數量與貓咪資料的新預約通知，混合房型不得漏掉其中一種，且信件不含附件。
9. 確認「住宿預約」第 25 欄顯示「已寄送」、第 35 欄正確記錄房間數量、第 36 欄顯示「已建立」，且第 37 欄有 Calendar 行程 ID。
10. 確認貓家日子的 Google Calendar 只有一筆相同預約編號的行程，日期、入住／退宿時間、標題與說明正確；混合房型應完整列出兩種房型與數量。
11. 確認 Apps Script 回應無法讀取時，頁面最晚會在逾時保護啟動後結束「正在登記預約」狀態，不會永久卡住。
12. 確認入住時間早於 10:00、退宿時間晚於 20:30，以及退宿時間與 15:00 前後區間不一致時，都無法送出。
13. 測試完成後，刪除兩張表內相同預約編號的測試資料，並刪除相同預約編號的 Calendar 測試行程。
14. 確認 2027/2/3–2/11 為春節計價晚，小貓房／眺跳家庭房／探險家庭房每晚起價分別為 NT$1,450／1,800／2,200，加貓每隻每晚 NT$200。
15. 確認含春節計價晚的住宿至少需 5 晚；春節晚不折扣，跨檔期的平日晚數獨立套用 7–13 晚 95 折、14–29 晚 9 折。
    - 2026/9/27 12:00（台灣時間）前只能試算，不能送出含春節計價晚的預約。
    - 2026/9/27 12:00 起自動開放至少 5 個春節計價晚的預約；未滿 5 晚仍不可送出，開放時間另行公告。
16. 確認春節訂金為住宿費 50%，店家確認後 3 日內支付；取消退款區間包含 2026/12/31、2027/1/23 與 2027/1/24 當日。
17. 確認退宿日為 2027/2/3–2/9 時無法選擇 15:00 後退宿；2/10–2/11 可選且依當晚房價 50% 計費；2/12 起仍依平日房價 50% 計費。
